-- Removing the La Terenuri login also drops the cached session (it's a working login too).
create or replace function public.delete_terenuri_credentials()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_id uuid;
begin
  delete from public.terenuri_sessions where user_id = auth.uid();
  delete from public.terenuri_accounts where user_id = auth.uid() returning password_secret_id into secret_id;
  if secret_id is not null then
    delete from vault.secrets where id = secret_id;
  end if;
end;
$$;
