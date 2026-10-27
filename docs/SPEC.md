# Base Requirements — Personal Whiteboard & To-Do App

## 1. Purpose

The application provides a personal digital whiteboard for managing to-dos using movable notes.

A user owns a whiteboard and can optionally share it with colleagues. The application combines the flexibility of placing notes freely with lightweight structure for planning, prioritization, assignment, and tracking.

## 2. Core Concepts

The application consists of:

- A whiteboard containing notes
- Multiple ways to organize the same notes
- A list representation of the notes
- Detailed information associated with each note
- Filtering and search
- Sharing and collaboration

Each whiteboard is owned by one user. A user may own several and be a member of others.

---

## 3. Whiteboard

Users can create and position notes on a free canvas.

Notes retain their position when placed or moved.

The whiteboard supports three organization modes:

### Horizon

Notes can be organized into:

- Today
- This week
- Later

Moving a note between areas updates its horizon value.

### Priority

Notes can be organized into:

- High
- Medium
- Low

Moving a note between areas updates its priority.

### Free

Notes can be positioned freely without assigning an organizational value through their position.

Users can switch between organization modes without losing notes.

Users can create a new note from the whiteboard.

A note is written where it will live: title and text directly on the wall or at the top of the list, created on the first keystroke; the note panel is the optional detail layer (`rfcs/RFC-0005-wallybot-inline.md` §3.1). After Enter, Wallybot may propose a due date, a priority or a person as a pending change on the card: a dashed edge and a marigold dot with a six-second countdown, each field removable, Enter keeps, Esc discards, Undo for thirty seconds; the server holds the record and every write is reversible (`rfcs/RFC-0005-wallybot-inline.md` §3.3, §4). 'Always ask me' in the account menu turns the countdown off. The note panel shows the same change as a review in two groups, what the person typed (checked, read-only) and what Wallybot added (a checkbox per row), and may also propose subtasks, a reference as one property, and a cleaner title offered as a second line beside the person's own and kept only when ticked or tapped.

---

## 4. List View

Users can view the same notes as a list.

The list contains the same underlying notes as the whiteboard and does not create a separate set of tasks.

When an organization mode is active, the list groups notes according to that mode.

Changes made in either the whiteboard or list must be reflected in the other.

---

## 4a. Remembered view settings

Wally remembers, per user and per board, the view (wall or list), the grouping, and the
done / mine / priority / visibility filters. They are saved to the user's profile, so the board opens the
same way on every device. Opening the app goes straight into the user's only board, or to
the board home when they have none or several; the home marks the board last opened (see §4b).

A link that carries view settings in its query string shows those settings without saving
them; they are saved only once the user changes something. Search text, the property filter
and the open note are never remembered. "Reset view" forgets a board's saved settings.

## 4b. Boards

A user can own up to 20 boards and be a member of any number of boards shared with them.

Signing in, or opening the app, lands:

| Boards the user can open | Lands on               |
| ------------------------ | ---------------------- |
| 0                        | The board home (empty) |
| 1                        | That board             |
| 2 or more                | The board home         |

A link the visitor arrived with while signed out (a board or a share link) is followed after
sign-in, but a board only if the person who signed in can open it. Signing out never hands
the board that was open to whoever signs in next.

The board home lists every board the user can open: a "continue" card for the board last
opened, the user's own boards, then the boards shared with them with their role. Each group
is sorted by name. From the home a user can:

- Create a board. One field, prefilled with "Meine Wand" / "My Board"; the app then opens the
  new, empty board.
- Delete a board they own, after a confirmation that names the board and how many notes go
  with it. Its notes, members and share link go with it; members lose access at once.
- Leave a board shared with them, after a confirmation. Notes assigned to them on that board
  are unassigned. The owner cannot leave their own board; they delete it instead.

Rename stays in the board's own top bar. A user may delete their last board; the home then
shows an empty state with the create action.

On a board, the Wally mark leads to the board home, and the board switcher ends in "All
boards" and "New board".

---

## 5. Notes

Each note represents one to-do item.

A note has:

- Title
- Priority
- Horizon / grid position
- Due date
- Assignee
- Properties (user-defined key/value pairs)
- Tags
- Subtasks
- Colour
- Status
- Visibility (shared or private)
- Position on the whiteboard
- Creation history
- Movement history

Properties are free-form key/value pairs the user defines per note — for example
`Kunde: Müller GmbH` or `Vertragsnr: 4711`. Keys are not drawn from a fixed list: any label
the user types is allowed, and keys already used elsewhere on the board are offered as
autocomplete so the same property does not fragment across spellings.

The board can be filtered by a property, either by key alone (every note carrying it) or by
key and value.

This replaces an earlier fixed "reference" field that offered only Client / Contract / Claim.
That design assumed an integration with a surrounding host platform which does not
exist; in practice it was a single free-text field with a suggestion list, and it could not
record anything outside those three categories.

---

## 5a. Private notes

A private note is a normal note that only its creator can see. It sits on the same wall, in the
same columns, with the same subtasks, properties and filters; only the audience differs. The
reasoning and the decisions behind it are in [`rfcs/RFC-0001-private-notes.md`](rfcs/RFC-0001-private-notes.md).

**Who sees a private note.** Its creator, and nobody else: not other members, not the board
owner. Search, the tag list, the property filter and subtask counts never include another
person's private notes. To everyone else the note does not exist: reads and commands that
target it answer 404.

**Always yours.** A private note is always assigned to its creator and cannot be assigned to
anyone else. Assigning it to another person is refused with `422 PRIVATE_NOTE_NOT_ASSIGNABLE`.
The **Mine** filter includes the creator's private notes.

**Who may create and change.** Every role, including VIEW, can create a private note. A creator
can do everything with their own private note that a note allows: edit, move, assign (to
themselves), complete, reopen, delete and manage subtasks, whatever their role. Creating a
shared note still needs EDIT or OWNER.

**Who may switch.** Only the creator, and only with the EDIT or OWNER role, can make a shared
note private or a private note shared again, because either change alters what the shared
board shows. Making a note private assigns it to the creator in the same change. Making it
shared leaves the assignee as the creator. A note with no recorded creator (records older than
that field) cannot be made private.

**Viewers.** For a VIEW member every note created from the board is private. The New button, the
`N` shortcut, the zone `+` buttons and double-click are therefore available to viewers. A viewer
never changes a note's visibility, so a private note they created stays private.

**Copies.** A copy of a private note is private, created by and assigned to whoever copies it. A
copy of a shared note is shared.

**Leaving and rejoining.** When a member is removed or leaves, their private notes stay on the
board, keep their assignment to that member and stay hidden from everyone, while the member's
assignments on shared notes are released as before, leaving those notes unassigned. If the
person rejoins, with any role, the notes are visible to them again. Deleting a board deletes
all of its notes, members' private notes included.

**The lock.** On the wall and in the list a private note shows a small lock in place of the
assignee avatar, labelled "Private Notiz" / "Private note". Colour, border and opacity do not
change. In the note panel a **Privat** switch sits directly above **Assignee**. It is shown only
to the creator of a note and, for a shared note, only with the EDIT or OWNER role. It is disabled
on a private note whose creator now has the VIEW role. On a private note the assignee row shows
**You**, disabled. The switch is offered on every board, including an unshared one.

**The filter.** The filter bar has two single-choice chips after **Mine** and **Done**: **Nur
private** (only private) and **Private ausblenden** (hide private); neither pressed shows all
notes. The choice is remembered per board like the other filters (§4a) and can be given in a
link as `visibility=private` or `visibility=shared`. The chips appear when the filter is active
or at least one note in the current view is private. While **Nur private** is on, a new note is
created private so it stays in view. Whenever a new note would be private (a viewer, or anyone
with **Nur private** on), the New button and the palette entry read **Neue private Notiz** /
"New private note".

**Share sheet.** The owner is told, under the member list, that members can keep private notes
that only they can see.

---

## 6. Subtasks

A note can contain a checklist of subtasks.

Users can:

- Add a subtask
- Mark a subtask as completed
- Mark a completed subtask as incomplete
- Remove a subtask

The application should expose the number of subtasks associated with a note.

---

## 7. Note Lifecycle

Users with edit permission can:

- Create a note
- Edit a note
- Move a note
- Assign a note
- Mark a note as done
- Reopen a completed note
- Delete a note

Completed notes remain available unless deleted.

A VIEW member may do all of the above on their own private notes.

---

## 8. Filtering and Search

Users can filter the visible notes using:

- Text search
- Priority
- Assigned to me
- Completed / not completed
- Private notes: only private, or hide private

Filters affect the currently displayed notes but do not modify or delete them.

---

## 9. Sharing

The whiteboard owner can share the whiteboard with colleagues.

Sharing supports at least two permission levels:

- View
- Edit

The owner can:

- Invite a colleague by email
- Share access through a link
- See who has access to the whiteboard

Users with edit permission can modify notes.

Users with view permission can view the whiteboard and notes but cannot modify shared notes; they can keep private notes (§5a).

Notes can be assigned to users who are members of the shared whiteboard.

A member can leave a shared whiteboard. Notes assigned to them on it are unassigned.

---

## 10. History

The application records basic history for each note.

At minimum, history includes:

- When the note was created
- When the note was moved

History is informational and does not need to provide version restoration.

---

## 11. Responsive Behaviour

The application must work on desktop, tablet, and mobile screen sizes.

On smaller screens:

- Notes are available through a list-based representation
- Note details remain accessible
- Drag-and-drop positioning is not required

Dragging and free positioning are desktop capabilities.

---

## 12. Language

The application UI is available in German and English.

German is the default: it is what a new visitor sees unless their browser asks for English,
and it is the fallback whenever a language cannot be determined.

Each user chooses their language, and the choice is stored on their profile, so it follows
them to any device and survives signing out. It can be changed at any time from the account
menu. Before anyone is signed in, the browser's own preference decides.

Only interface copy is translated. Content a user typed — board names, note titles, tags and
property keys — is shown as entered, in whatever language it was written.

---

## 13. Identity

Wally is a standalone application. It does not integrate with, and is not part of, any other
product.

Users sign in through Auth0 (email/password and Google), which also authorizes MCP clients
such as ChatGPT ([`AUTH0.md`](AUTH0.md)); Firebase Authentication is the local and CI
default, not a production fallback (every production account is an Auth0 signup). The move to Supabase Auth is decided
([ADR-0021](adr/ADR-0021-supabase-auth-for-web-and-mcp.md)). Permissions are Wally's own: a whiteboard role per member, enforced by the API. There is no
external directory to synchronise against and no single sign-on requirement.

---

## 14. Out of Scope

The initial version does not require:

- Real-time collaborative editing
- Comments or conversations on notes
- Attachments
- Notifications or reminders
- Recurring tasks
- Task dependencies
- Workflow automation
- Version restoration
- Reporting or analytics
- Custom workflow or grid definitions

These capabilities can be considered separately if needed later.
