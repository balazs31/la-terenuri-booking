-- La Terenuri booker: schema, RLS, RPCs and the pg_cron scheduler.

-- ---------------------------------------------------------------------------
-- La Terenuri (sportinclujnapoca.ro) login per user. The password lives in Vault;
-- the browser can only write it (set_terenuri_credentials) and never read it back.
create table public.terenuri_accounts (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email text not null,
  password_secret_id uuid not null,
  terenuri_user_id uuid,     -- their user id, filled in by the terenuri-check function
  display_name text,
  verified_at timestamptz,   -- last successful login test
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.terenuri_accounts enable row level security;
create policy "terenuri_accounts: select own" on public.terenuri_accounts for select to authenticated
  using (user_id = (select auth.uid()));

create function public.set_terenuri_credentials(p_email text, p_password text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  secret_id uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'email is required'; end if;

  select password_secret_id into secret_id from public.terenuri_accounts where user_id = uid;

  if secret_id is null then
    if coalesce(p_password, '') = '' then raise exception 'password is required'; end if;
    secret_id := vault.create_secret(p_password, 'terenuri_password_' || uid, 'La Terenuri password');
  elsif coalesce(p_password, '') <> '' then
    perform vault.update_secret(secret_id, p_password);
  end if;

  insert into public.terenuri_accounts (user_id, email, password_secret_id)
  values (uid, trim(p_email), secret_id)
  on conflict (user_id) do update
    set email = excluded.email,
        terenuri_user_id = null,
        display_name = null,
        verified_at = null,
        last_error = null,
        updated_at = now();
end;
$$;

create function public.delete_terenuri_credentials()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_id uuid;
begin
  delete from public.terenuri_accounts where user_id = auth.uid() returning password_secret_id into secret_id;
  if secret_id is not null then
    delete from vault.secrets where id = secret_id;
  end if;
end;
$$;

-- Edge functions only.
create function public.get_terenuri_credentials(p_user_id uuid)
returns table (email text, password text)
language sql
security definer
set search_path = ''
as $$
  select a.email, s.decrypted_secret
    from public.terenuri_accounts a
    join vault.decrypted_secrets s on s.id = a.password_secret_id
   where a.user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- WhatsApp notifications via CallMeBot (the API key is per phone number).
create table public.notification_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null default '',
  whatsapp_phone text not null check (whatsapp_phone ~ '^[1-9][0-9]{7,14}$'), -- international, no +
  callmebot_apikey text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index on public.notification_recipients (user_id);

alter table public.notification_recipients enable row level security;
create policy "recipients: own rows" on public.notification_recipients for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- One wanted reservation.
create table public.booking_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  complex_id uuid not null,
  complex_name text not null,
  facility_id uuid not null,
  facility_name text not null,
  min_people int not null default 1, -- > 1 → reservation type 'team', else 'individual'
  target_date date not null,
  -- Wanted start hours, inclusive (slots are 1h, starting 09..21). Outside the window the
  -- closest free hour of the same day is booked (later hour on a tie).
  pref_from smallint not null check (pref_from between 0 and 23),
  pref_to smallint not null check (pref_to between 0 and 23),
  -- Dry run: log in, watch the day open and pick an hour, but never send the booking.
  dry_run boolean not null default false,
  -- Set by trigger: when the day becomes bookable (target_date − 14 days, 00:00 Bucharest)
  -- and the polling window around it.
  release_at timestamptz not null,
  start_at timestamptz not null,
  give_up_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'booked', 'simulated', 'failed', 'cancelled', 'uncertain')),
  first_free_seen_at timestamptz, -- first check that saw a free hour on target_date
  booked_hour smallint,
  court_id uuid,
  reservation_id uuid,
  invite_link text, -- https://sportinclujnapoca.ro/reservations/confirm?id=<invite_link>
  result_message text,
  attempts int not null default 0,
  booking_attempts int not null default 0, -- POSTs sent
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pref_to >= pref_from),
  check (give_up_at > start_at)
);

create index on public.booking_jobs (user_id);
create index on public.booking_jobs (status, start_at);

create function public.booking_jobs_set_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.release_at := ((new.target_date - 14)::timestamp at time zone 'Europe/Bucharest');
  if new.release_at > now() + interval '2 minutes' then
    -- Unverified whether the site opens the day at 00:00 Bucharest or 00:00 UTC (02:00/03:00 Bucharest):
    -- watch both, fast around each moment, slowly in between.
    new.start_at := new.release_at - interval '2 minutes';
    new.give_up_at := new.release_at + interval '3 hours 30 minutes';
  else
    -- Day already open: grab whatever is closest, right away.
    new.start_at := now();
    new.give_up_at := now() + interval '10 minutes';
  end if;
  return new;
end;
$$;

create trigger booking_jobs_set_window before insert on public.booking_jobs
  for each row execute function public.booking_jobs_set_window();

alter table public.booking_jobs enable row level security;
create policy "jobs: select own" on public.booking_jobs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "jobs: insert own" on public.booking_jobs for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending'
              and target_date >= (now() at time zone 'Europe/Bucharest')::date);
-- Users may only cancel pending jobs; results are written by the edge function (service role).
create policy "jobs: cancel own" on public.booking_jobs for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (status = 'cancelled');

-- Atomically lease the jobs that are due now (called by run-bookings).
create function public.claim_booking_jobs(lease_seconds int default 200)
returns setof public.booking_jobs
language sql
security definer
set search_path = ''
as $$
  update public.booking_jobs
     set locked_until = now() + make_interval(secs => lease_seconds), updated_at = now()
   where id in (
     select id from public.booking_jobs
      where status = 'pending'
        and now() >= start_at
        and (locked_until is null or locked_until < now())
      for update skip locked
   )
  returning *;
$$;

-- Lets the edge function verify the header sent by pg_cron.
create function public.get_cron_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret';
$$;

revoke execute on function public.set_terenuri_credentials(text, text) from public, anon;
revoke execute on function public.delete_terenuri_credentials() from public, anon;
revoke execute on function public.get_terenuri_credentials(uuid) from public, anon, authenticated;
revoke execute on function public.claim_booking_jobs(int) from public, anon, authenticated;
revoke execute on function public.get_cron_secret() from public, anon, authenticated;
grant execute on function public.set_terenuri_credentials(text, text) to authenticated;
grant execute on function public.delete_terenuri_credentials() to authenticated;
grant execute on function public.get_terenuri_credentials(uuid) to service_role;
grant execute on function public.claim_booking_jobs(int) to service_role;
grant execute on function public.get_cron_secret() to service_role;

-- ---------------------------------------------------------------------------
-- Scheduler: ticks every minute, but only calls the edge function while a job is in its window.
-- Needs Vault secrets 'project_url' and 'cron_secret' (see README).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'run-bookings',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/run-bookings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  where exists (
    select 1 from public.booking_jobs
     where status = 'pending'
       and now() >= start_at - interval '1 minute'
       and now() < give_up_at + interval '2 minutes'
  );
  $$
);
