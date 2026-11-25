begin;

create table blog.reader_feedback (
  id uuid primary key default gen_random_uuid(),
  article_slug text,
  category text not null check (category in ('correction', 'accuracy', 'broken-link', 'accessibility', 'other')),
  message text not null check (char_length(message) between 20 and 4000),
  created_at timestamptz not null default now()
);

create index reader_feedback_created_at on blog.reader_feedback (created_at desc);
alter table blog.reader_feedback enable row level security;

create policy submit_public_feedback on blog.reader_feedback for insert to openblog_runtime
  with check (
    article_slug is null
    or exists (
      select 1 from blog.posts
      where posts.slug = reader_feedback.article_slug and posts.status = 'published'
    )
  );

revoke all on table blog.reader_feedback from public, openblog_runtime;
grant insert (article_slug, category, message) on blog.reader_feedback to openblog_runtime;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on table blog.reader_feedback from %I', role_name);
    end if;
  end loop;
end
$$;

commit;
