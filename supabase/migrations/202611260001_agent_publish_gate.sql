begin;

alter table blog.api_keys
  add column auto_publish boolean not null default false;

-- The runtime role receives no column grant for auto_publish. Only an
-- administrator can opt a specific, already-created agent key into publishing.
revoke select (auto_publish), update (auto_publish)
  on blog.api_keys from public, anon, authenticated, openblog_runtime;

create function blog.publish_agent_draft(key_hash text, draft_id uuid)
returns table (post_id uuid, article_slug text, publication_status text, published_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_user uuid;
  approved_key uuid;
begin
  select api_key.user_id, api_key.id
    into approved_user, approved_key
    from blog.api_keys as api_key
   where api_key.secret_hash = key_hash
     and api_key.revoked_at is null
     and api_key.auto_publish is true;

  if not found then
    return;
  end if;

  update blog.posts as post
     set status = 'published',
         published_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where post.id = draft_id
     and post.status = 'draft'
     and post.author_id = approved_user
     and post.agent_key_id = approved_key
     and post.section in ('news', 'teaching', 'find-out')
     and post.cover_url ~ '^https://blog[.]naborajs[.]me/media/covers/hermes-[0-9a-f]{64}-cover[.]jpg$'
     and pg_catalog.char_length(pg_catalog.btrim(post.cover_alt)) between 1 and 180
     and pg_catalog.jsonb_array_length(post.sources) >= 3
     and (
       select pg_catalog.count(*)
         from pg_catalog.jsonb_array_elements(post.sources) as source(item)
        where source.item ->> 'url' ~ '^https://[^/@[:space:]]+([/?#].*)?$'
          and pg_catalog.char_length(pg_catalog.btrim(source.item ->> 'title')) between 1 and 180
     ) = pg_catalog.jsonb_array_length(post.sources)
     and (
       select pg_catalog.count(distinct pg_catalog.lower((pg_catalog.regexp_match(source.item ->> 'url', '^https://([^/:?#]+)'))[1]))
         from pg_catalog.jsonb_array_elements(post.sources) as source(item)
     ) >= 2
     and pg_catalog.cardinality(pg_catalog.regexp_split_to_array(pg_catalog.btrim(post.body), '\s+')) >=
         case when post.section = 'news' then 250 else 650 end
     and (
       select pg_catalog.count(*)
         from pg_catalog.regexp_matches(post.body, '(^|\n)#{2,3}[ \t]+', 'g')
     ) >= case when post.section = 'news' then 2 else 3 end
     and post.body !~* '(lorem ipsum|todo:|citation needed|insert (source|citation|example)|to be added)'
  returning post.id, post.slug, post.status, post.published_at
       into post_id, article_slug, publication_status, published_at;

  if found then
    return next;
    return;
  end if;

  -- A retry after a successful publish returns the same result without
  -- resetting its publication timestamp or publishing another row.
  select post.id, post.slug, post.status, post.published_at
    into post_id, article_slug, publication_status, published_at
    from blog.posts as post
   where post.id = draft_id
     and post.status = 'published'
     and post.author_id = approved_user
     and post.agent_key_id = approved_key;

  if found then
    return next;
  end if;
end;
$$;

revoke all on function blog.publish_agent_draft(text, uuid) from public, anon, authenticated;
grant execute on function blog.publish_agent_draft(text, uuid) to openblog_runtime;

commit;
