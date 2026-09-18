# Base Requirements — Personal Whiteboard & To-Do App

## 1. Purpose

The application provides a personal digital whiteboard for managing to-dos using movable notes.

A user owns a whiteboard and can optionally share it with colleagues. The application combines the flexibility of placing notes freely with lightweight structure for planning, prioritization, assignment, and tracking.

## 2. Core Concepts

The application consists of:

* A whiteboard containing notes
* Multiple ways to organize the same notes
* A list representation of the notes
* Detailed information associated with each note
* Filtering and search
* Sharing and collaboration

The whiteboard is owned by one user.

---

## 3. Whiteboard

Users can create and position notes on a free canvas.

Notes retain their position when placed or moved.

The whiteboard supports three organization modes:

### Horizon

Notes can be organized into:

* Today
* This week
* Later

Moving a note between areas updates its horizon value.

### Priority

Notes can be organized into:

* High
* Medium
* Low

Moving a note between areas updates its priority.

### Free

Notes can be positioned freely without assigning an organizational value through their position.

Users can switch between organization modes without losing notes.

Users can create a new note from the whiteboard.

---

## 4. List View

Users can view the same notes as a list.

The list contains the same underlying notes as the whiteboard and does not create a separate set of tasks.

When an organization mode is active, the list groups notes according to that mode.

Changes made in either the whiteboard or list must be reflected in the other.

---

## 5. Notes

Each note represents one to-do item.

A note has:

* Title
* Priority
* Horizon / grid position
* Due date
* Assignee
* Reference
* Tags
* Subtasks
* Colour
* Status
* Position on the whiteboard
* Creation history
* Movement history

A reference can link the note to a relevant business object such as:

* Client
* Contract
* Claim

The exact supported reference types may depend on the surrounding platform capabilities.

---

## 6. Subtasks

A note can contain a checklist of subtasks.

Users can:

* Add a subtask
* Mark a subtask as completed
* Mark a completed subtask as incomplete
* Remove a subtask

The application should expose the number of subtasks associated with a note.

---

## 7. Note Lifecycle

Users with edit permission can:

* Create a note
* Edit a note
* Move a note
* Assign a note
* Mark a note as done
* Reopen a completed note
* Delete a note

Completed notes remain available unless deleted.

---

## 8. Filtering and Search

Users can filter the visible notes using:

* Text search
* Priority
* Assigned to me
* Completed / not completed

Filters affect the currently displayed notes but do not modify or delete them.

---

## 9. Sharing

The whiteboard owner can share the whiteboard with colleagues.

Sharing supports at least two permission levels:

* View
* Edit

The owner can:

* Invite a colleague by email
* Share access through a link
* See who has access to the whiteboard

Users with edit permission can modify notes.

Users with view permission can view the whiteboard and notes but cannot modify them.

Notes can be assigned to users who are members of the shared whiteboard.

---

## 10. History

The application records basic history for each note.

At minimum, history includes:

* When the note was created
* When the note was moved

History is informational and does not need to provide version restoration.

---

## 11. Responsive Behaviour

The application must work on desktop, tablet, and mobile screen sizes.

On smaller screens:

* Notes are available through a list-based representation
* Note details remain accessible
* Drag-and-drop positioning is not required

Dragging and free positioning are desktop capabilities.

---

## 12. Language

The application UI uses German copy.

---

## 13. Platform Integration

The application should integrate with the existing Finlex platform where relevant, including:

* Users
* Authentication and permissions
* Supported business references such as clients, contracts, and claims

The exact integration mechanism is outside the scope of these requirements.

---

## 14. Out of Scope

The initial version does not require:

* Real-time collaborative editing
* Comments or conversations on notes
* Attachments
* Notifications or reminders
* Recurring tasks
* Task dependencies
* Multiple whiteboards per user
* Workflow automation
* Version restoration
* Reporting or analytics
* Custom workflow or grid definitions

These capabilities can be considered separately if needed later.
