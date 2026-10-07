-- The site didn't open 2026-10-21 at 00:00 Bucharest nor 00:00 UTC (no free hour until 03:30, open by 20:42):
-- keep watching until the end of the release day (Bucharest), still fast around both midnights, slowly in between.
create or replace function public.booking_jobs_set_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.release_at := ((new.target_date - 14)::timestamp at time zone 'Europe/Bucharest');
  if new.release_at > now() + interval '2 minutes' then
    new.start_at := new.release_at - interval '2 minutes';
    new.give_up_at := ((new.target_date - 13)::timestamp at time zone 'Europe/Bucharest');
  else
    -- Day already open: grab whatever is closest, right away.
    new.start_at := now();
    new.give_up_at := now() + interval '10 minutes';
  end if;
  return new;
end;
$$;
