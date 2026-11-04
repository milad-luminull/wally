-- Retention (docs/superpowers/specs/2026-11-04-gdpr-retention-design.md).
--
-- These are database functions only because the hourly purge runs inside the database
-- (pg_cron). The API calls the same functions, so each rule exists once (ADR-0020 otherwise
-- keeps logic in the API).

-- Unassigns a former member's shared notes on one board: the member.remove rule. Does nothing
-- for the owner or for anyone who still holds an ACTIVE row on the board. A private note stays
-- its creator's, hidden, until they rejoin (PRIVATE_NOTES §3). Returns the notes changed.
create function release_assignments(board text, member text, at timestamptz)
returns integer
language plpgsql
set search_path = public
as $$
declare
  changed integer;
begin
  if exists (select 1 from whiteboards w where w.id = board and w.owner_id = member)
     or exists (
       select 1 from board_members m
       where m.board_id = board and m.user_id = member and m.status = 'ACTIVE'
     ) then
    return 0;
  end if;
  update notes
     set assignee_id = null, updated_at = at, revision = revision + 1
   where board_id = board
     and assignee_id = member
     and deleted_at is null
     and visibility <> 'PRIVATE';
  get diagnostics changed = row_count;
  return changed;
end
$$;
--> statement-breakpoint
revoke execute on function release_assignments(text, text, timestamptz) from public, anon, authenticated, service_role;
--> statement-breakpoint
-- Removes everyone who joined a board through its share link, and releases their notes.
-- Called when the link is regenerated or turned off, and by purge_expired() when it expires.
-- The caller bumps the board's revision. Returns the member rows deleted.
create function remove_link_members(board text, at timestamptz)
returns integer
language plpgsql
set search_path = public
as $$
declare
  removed text[];
  person text;
begin
  with gone as (
    delete from board_members
     where board_id = board and joined_by_link
    returning user_id
  )
  select coalesce(array_agg(user_id), '{}') into removed from gone;
  for person in select distinct p from unnest(removed) p where p is not null loop
    perform release_assignments(board, person, at);
  end loop;
  return cardinality(removed);
end
$$;
--> statement-breakpoint
revoke execute on function remove_link_members(text, timestamptz) from public, anon, authenticated, service_role;
--> statement-breakpoint
-- purge_expired(), as in 0003, plus the retention periods the owner set on 2026-11-04:
--   * an expired share link goes, with everyone who joined through it;
--   * a pending invite (and the email address in it) goes 30 days after it was made;
--   * assistant usage counters go after 30 days (enough for the daily limit).
-- Opening an expired link already fails (apps/api/src/lib/commands/index.ts); everything else
-- here may run up to an hour late, which the owner accepted. `create or replace` keeps the
-- pg_cron job that calls it.
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
  expired_board text;
begin
  foreach table_name in array expiring loop
    execute format('delete from %I where expires_at <= $1', table_name) using at;
    get diagnostics deleted = row_count;
    return next;
  end loop;

  table_name := 'share_links';
  deleted := 0;
  for expired_board in select l.board_id from share_links l where l.expires_at <= at loop
    if remove_link_members(expired_board, at) > 0 then
      update whiteboards set revision = revision + 1, updated_at = at where id = expired_board;
    end if;
    delete from share_links where board_id = expired_board;
    deleted := deleted + 1;
  end loop;
  return next;

  table_name := 'board_members';
  delete from board_members where status = 'PENDING' and invited_at <= at - interval '30 days';
  get diagnostics deleted = row_count;
  return next;

  table_name := 'assistant_usage';
  delete from assistant_usage where day < (at - interval '30 days')::date;
  get diagnostics deleted = row_count;
  return next;
end
$$;
--> statement-breakpoint
revoke execute on function purge_expired(timestamptz) from public, anon, authenticated, service_role;
