-- Cached La Terenuri session cookies, so cron runs refresh a token instead of logging in with the
-- password every minute. Edge functions only (RLS on, no policies → service role only).
create table public.terenuri_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null, -- session belongs to this La Terenuri login; ignored when the email changes
  cookies jsonb not null, -- [{ name, value }] as written by @supabase/ssr
  updated_at timestamptz not null default now()
);

alter table public.terenuri_sessions enable row level security;
