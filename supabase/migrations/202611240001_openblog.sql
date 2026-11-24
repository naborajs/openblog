begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'openblog_runtime') then
    create role openblog_runtime login noinherit nobypassrls;
  end if;
end
$$;

create schema blog;
revoke all on schema blog from public;
grant usage on schema blog to openblog_runtime;

create table blog.memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  role text not null default 'contributor' check (role in ('contributor', 'editor')),
  joined_at timestamptz not null default now()
);

create table blog.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references blog.memberships (user_id) on delete cascade,
  name text not null check (char_length(name) between 1 and 70),
  secret_hash text not null unique check (char_length(secret_hash) = 64),
  public_id text not null check (char_length(public_id) = 12),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table blog.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references blog.memberships (user_id) on delete set null,
  author_name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  section text not null check (section in ('news', 'teaching', 'find-out')),
  title text not null check (char_length(title) between 1 and 150),
  topic text not null default '',
  summary text not null check (char_length(summary) between 1 and 320),
  body text not null check (char_length(body) between 1 and 50000),
  cover_url text,
  cover_alt text,
  video_url text,
  video_captions text,
  transcript text,
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array'),
  related_slugs text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published')),
  agent_key_id uuid references blog.api_keys (id) on delete set null,
  idempotency_key text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_key_id, idempotency_key),
  check ((status = 'published') = (published_at is not null))
);

create index posts_published_at on blog.posts (published_at desc) where status = 'published';
create index posts_author on blog.posts (author_id);
create index api_keys_owner on blog.api_keys (user_id);

create function blog.current_user_id() returns uuid
language sql stable set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('openblog.user_id', true), '')::uuid
$$;

create function blog.is_editor() returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1 from blog.memberships
    where user_id = blog.current_user_id() and role = 'editor'
  )
$$;

create function blog.owner_for_agent_key(key_hash text)
returns table (user_id uuid, key_id uuid, author_name text)
language sql stable security definer set search_path = ''
as $$
  select membership.user_id, key.id, membership.name
  from blog.api_keys key
  join blog.memberships membership on membership.user_id = key.user_id
  where key.secret_hash = key_hash and key.revoked_at is null
$$;

revoke all on function blog.current_user_id(), blog.is_editor(), blog.owner_for_agent_key(text) from public;
grant execute on function blog.current_user_id(), blog.is_editor(), blog.owner_for_agent_key(text) to openblog_runtime;

alter table blog.memberships enable row level security;
alter table blog.api_keys enable row level security;
alter table blog.posts enable row level security;

create policy own_membership on blog.memberships for select to openblog_runtime
  using (user_id = blog.current_user_id());
create policy join_as_contributor on blog.memberships for insert to openblog_runtime
  with check (user_id = blog.current_user_id() and role = 'contributor');

create policy own_keys on blog.api_keys for select to openblog_runtime
  using (user_id = blog.current_user_id());
create policy create_own_key on blog.api_keys for insert to openblog_runtime
  with check (user_id = blog.current_user_id() and revoked_at is null);
create policy revoke_own_key on blog.api_keys for update to openblog_runtime
  using (user_id = blog.current_user_id() and revoked_at is null)
  with check (user_id = blog.current_user_id() and revoked_at is not null);

create policy readable_posts on blog.posts for select to openblog_runtime
  using (status = 'published' or author_id = blog.current_user_id() or blog.is_editor());
create policy create_own_drafts on blog.posts for insert to openblog_runtime
  with check (author_id = blog.current_user_id() and status = 'draft');
create policy update_editor_or_own_draft on blog.posts for update to openblog_runtime
  using (blog.is_editor() or (author_id = blog.current_user_id() and status = 'draft'))
  with check (blog.is_editor() or (author_id = blog.current_user_id() and status = 'draft'));

grant select, insert on blog.memberships to openblog_runtime;
grant select (id, user_id, name, public_id, created_at, revoked_at),
  insert (user_id, name, secret_hash, public_id), update (revoked_at)
  on blog.api_keys to openblog_runtime;
grant select, insert on blog.posts to openblog_runtime;
grant update (section, title, topic, summary, body, cover_url, cover_alt, video_url, video_captions,
  transcript, sources, related_slugs, status, published_at, updated_at) on blog.posts to openblog_runtime;

commit;
