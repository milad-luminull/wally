-- Expiry, the job Firestore's TTL policies did: every row whose expires_at has passed is
-- deleted. Board cleanup jobs carry no expiry and are never touched. Returns one row per
-- table with the number deleted. `pnpm maintenance` calls it too (apps/api/src/lib/db/purge.ts).
create function purge_expired(at timestamptz default now())
returns table (table_name text, deleted bigint)
language plpgsql
set search_path = public
as $$
declare
  expiring text[] := array[
    'board_operations',
    'assistant_audit',
    'assistant_attempts',
    'assistant_conversations',
    'assistant_suggestions',
    'assistant_tidies'
  ];
begin
  foreach table_name in array expiring loop
    execute format('delete from %I where expires_at <= $1', table_name) using at;
    get diagnostics deleted = row_count;
    return next;
  end loop;
end
$$;
--> statement-breakpoint
-- Only the API's own role runs it; never the Data API's roles.
revoke execute on function purge_expired(timestamptz) from public, anon, authenticated, service_role;
--> statement-breakpoint
-- Hourly, with Supabase Cron (pg_cron, https://supabase.com/docs/guides/cron). pg_cron runs
-- jobs only in the database `cron.database_name` names, so the job is scheduled there and
-- nowhere else: per-file test databases skip it. Scheduling a job under an existing name
-- replaces it, so a rerun changes nothing.
do $$
begin
  if current_database() = current_setting('cron.database_name', true) then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('wally-purge-expired', '17 * * * *', 'select purge_expired()');
  end if;
end
$$;
