-- purge_expired() also removes expired deleted_identities rows: the one-hour tombstones an
-- account deletion leaves (apps/api/src/lib/account/erase.ts). Same function as 0001, one more
-- table; `create or replace` keeps the pg_cron job that calls it.
create or replace function purge_expired(at timestamptz default now())
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
    'assistant_tidies',
    'deleted_identities'
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
revoke execute on function purge_expired(timestamptz) from public, anon, authenticated, service_role;
