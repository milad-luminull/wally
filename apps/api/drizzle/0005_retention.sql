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
