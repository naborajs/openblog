begin;

alter table blog.posts
  add column cover_credit jsonb,
  add constraint posts_cover_credit_object
    check (cover_credit is null or pg_catalog.jsonb_typeof(cover_credit) = 'object');

-- Approved automation keys can replace only a published cover and its image
-- description/attribution. The runtime role receives no direct UPDATE grant
-- for these fields; this function is the sole agent-facing write path.
create function blog.update_agent_cover(
  key_hash text,
  requested_slug text,
  requested_cover_url text,
  requested_cover_alt text,
  requested_cover_credit jsonb
)
returns table(updated_slug text, updated_cover_url text, updated_cover_alt text,
              updated_cover_credit jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_user uuid;
  approved_key uuid;
  cover_digest text;
  credit_key_count integer;
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

  cover_digest := (pg_catalog.regexp_match(
    coalesce(requested_cover_url, ''),
    '^https://blog[.]naborajs[.]me/media/covers/commons-([0-9a-f]{64})-cover[.]jpg$'
  ))[1];
  if cover_digest is null
     or coalesce(requested_slug, '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(requested_cover_alt, ''))) not between 1 and 180
     or pg_catalog.jsonb_typeof(requested_cover_credit) is distinct from 'object' then
    return;
  end if;

  select pg_catalog.count(*) into credit_key_count
    from pg_catalog.jsonb_object_keys(requested_cover_credit);
  if credit_key_count <> 9
     or requested_cover_credit ->> 'provider' <> 'Wikimedia Commons'
     or requested_cover_credit ->> 'media_type' <> 'photograph'
     or requested_cover_credit ->> 'sha256' <> cover_digest
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(requested_cover_credit ->> 'creator', ''))) not between 1 and 240
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(requested_cover_credit ->> 'license', ''))) not between 1 and 120
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(requested_cover_credit ->> 'visual_review', ''))) not between 20 and 500
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(requested_cover_credit ->> 'relevance', ''))) not between 20 and 500
     or coalesce(requested_cover_credit ->> 'source_url', '') !~ '^https://commons[.]wikimedia[.]org/wiki/File:[^/?#[:space:]]+$'
     or coalesce(requested_cover_credit ->> 'license_url', '') !~ '^https://creativecommons[.]org/(licenses/by/(2[.]0|3[.]0|4[.]0)|publicdomain/(zero|mark)/1[.]0)/?$'
     or coalesce(requested_cover_credit ->> 'license', '') !~* '^(CC BY (2[.]0|3[.]0|4[.]0)|CC0( 1[.]0)?|Public domain)$' then
    return;
  end if;

  update blog.posts as post
     set cover_url = requested_cover_url,
         cover_alt = pg_catalog.btrim(requested_cover_alt),
         cover_credit = requested_cover_credit,
         updated_at = pg_catalog.now()
   where post.slug = requested_slug
     and post.status = 'published'
  returning post.slug, post.cover_url, post.cover_alt, post.cover_credit, post.updated_at
       into updated_slug, updated_cover_url, updated_cover_alt, updated_cover_credit, updated_at;

  if found then
    return next;
  end if;
end;
$$;

revoke all on function blog.update_agent_cover(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function blog.update_agent_cover(text, text, text, text, jsonb) to openblog_runtime;

commit;
