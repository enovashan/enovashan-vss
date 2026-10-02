create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  article_slug text not null check (article_slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists comments_article_created_idx
  on public.comments (article_slug, created_at asc);

alter table public.comments enable row level security;
revoke all on public.comments from anon, authenticated;
grant all on public.comments to service_role;

create table if not exists public.comment_rate_limits (
  fingerprint text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0)
);

alter table public.comment_rate_limits enable row level security;
revoke all on public.comment_rate_limits from anon, authenticated;
grant all on public.comment_rate_limits to service_role;

create or replace function public.consume_comment_rate_limit(p_fingerprint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz;
  current_count integer;
begin
  delete from public.comment_rate_limits
  where window_started_at < now() - interval '1 day';

  insert into public.comment_rate_limits (fingerprint, window_started_at, attempt_count)
  values (p_fingerprint, now(), 1)
  on conflict (fingerprint) do update
    set window_started_at = case
          when comment_rate_limits.window_started_at < now() - interval '1 hour' then now()
          else comment_rate_limits.window_started_at
        end,
        attempt_count = case
          when comment_rate_limits.window_started_at < now() - interval '1 hour' then 1
          else comment_rate_limits.attempt_count + 1
        end
  returning window_started_at, attempt_count
  into current_window, current_count;

  return current_window >= now() - interval '1 hour' and current_count <= 5;
end;
$$;

revoke all on function public.consume_comment_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_comment_rate_limit(text) to service_role;

create table if not exists public.topic_suggestions (
  id uuid primary key default gen_random_uuid(),
  suggestion text not null check (char_length(suggestion) between 1 and 500),
  language text not null check (language in ('en', 'ur', 'ar')),
  dedupe_key text not null unique,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists topic_suggestions_created_idx
  on public.topic_suggestions (created_at desc);

alter table public.topic_suggestions enable row level security;
revoke all on public.topic_suggestions from anon, authenticated;
grant all on public.topic_suggestions to service_role;

create table if not exists public.topic_suggestion_rate_limits (
  fingerprint text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0)
);

alter table public.topic_suggestion_rate_limits enable row level security;
revoke all on public.topic_suggestion_rate_limits from anon, authenticated;
grant all on public.topic_suggestion_rate_limits to service_role;

create or replace function public.consume_topic_suggestion_rate_limit(p_fingerprint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz;
  current_count integer;
begin
  delete from public.topic_suggestion_rate_limits
  where window_started_at < now() - interval '1 day';

  insert into public.topic_suggestion_rate_limits (fingerprint, window_started_at, attempt_count)
  values (p_fingerprint, now(), 1)
  on conflict (fingerprint) do update
    set window_started_at = case
          when topic_suggestion_rate_limits.window_started_at < now() - interval '1 hour' then now()
          else topic_suggestion_rate_limits.window_started_at
        end,
        attempt_count = case
          when topic_suggestion_rate_limits.window_started_at < now() - interval '1 hour' then 1
          else topic_suggestion_rate_limits.attempt_count + 1
        end
  returning window_started_at, attempt_count
  into current_window, current_count;

  return current_window >= now() - interval '1 hour' and current_count <= 5;
end;
$$;

revoke all on function public.consume_topic_suggestion_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_topic_suggestion_rate_limit(text) to service_role;

create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (char_length(email) between 5 and 254),
  unsubscribe_token uuid not null default gen_random_uuid(),
  confirmed boolean not null default true,
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

create index if not exists subscribers_confirmed_idx
  on public.subscribers (confirmed) where unsubscribed_at is null;

alter table public.subscribers enable row level security;
revoke all on public.subscribers from anon, authenticated;
grant all on public.subscribers to service_role;

-- =============================================================================
-- CMS Posts: editorial articles, metadata, drafts, and target page mappings
-- =============================================================================
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  title text not null check (char_length(title) between 1 and 200),
  summary text not null default '',
  content_markdown text not null default '',
  content_html text not null default '',
  category text not null default '',
  read_time text not null default '',
  target_page text not null default 'stories',
  language text not null default 'en',
  status text not null default 'published' check (status in ('draft', 'published')),
  featured_on_home boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_target_page_idx
  on public.posts (target_page, published_at desc);

create index if not exists posts_slug_idx
  on public.posts (slug);

alter table public.posts enable row level security;
revoke all on public.posts from anon, authenticated;
grant all on public.posts to service_role;
