import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { NoteDto, WhiteboardDto } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IconTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { BoardAxis, BoardView } from './hooks/useBoardViewState';
import { useActiveMembers } from './hooks/useMembers';
import { useBoardRename } from './hooks/mutations/useBoardRename';
import { useCreateNote } from './hooks/mutations/useCreateNote';
import { initialsOf } from './util/noteDerived';
import { nextFreeNotePosition } from './util/notePlacement';
import { ShareSheet } from './Share/ShareSheet';
import { AccountMenu } from './AccountMenu';
import { BoardSwitcher } from './BoardSwitcher';

const AXES: SegmentedOption<BoardAxis>[] = [
  { value: 'horizon', label: 'Horizont', hint: 'Nach Zeitraum ordnen' },
  { value: 'priority', label: 'Priorität', hint: 'Nach Dringlichkeit ordnen' },
  { value: 'free', label: 'Frei', hint: 'Notizen frei auf der Wand platzieren' },
];

const VIEWS: SegmentedOption<BoardView>[] = [
  { value: 'wand', label: 'Wand' },
  { value: 'list', label: 'Liste' },
];

interface TopBarProps {
  board: WhiteboardDto;
  boardId: string;
  notes: NoteDto[];
  view: BoardView;
  axis: BoardAxis;
  isDesktop: boolean;
  isBelowTablet: boolean;
  canEdit: boolean;
  isOwner: boolean;
  onSetView: (view: BoardView) => void;
  onSetAxis: (axis: BoardAxis) => void;
  onOpenNote: (id: string) => void;
}

export function TopBar({
  board,
  boardId,
  notes,
  view,
  axis,
  isDesktop,
  isBelowTablet,
  canEdit,
  isOwner,
  onSetView,
  onSetAxis,
  onOpenNote,
}: TopBarProps) {
  const { activeMembers } = useActiveMembers(boardId);
  const renameBoard = useBoardRename(boardId);
  const createNote = useCreateNote(boardId);

  const openCount = notes.filter((n) => n.status === 'OPEN').length;
  const overdueCount = notes.filter(
    (n) => n.status === 'OPEN' && n.dueDate && n.dueDate < new Date().toISOString().slice(0, 10),
  ).length;

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(board.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setNameDraft(board.name), [board.name]);
  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  function commitName() {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== board.name) renameBoard.mutate(trimmed);
    else setNameDraft(board.name);
  }

  const visibleMembers = activeMembers.slice(0, 3);
  const overflowCount = activeMembers.length - visibleMembers.length;

  // Only the Wand view is desktop-gated; the axis reorders both views, so it stays.
  const viewOptions = isDesktop ? VIEWS : VIEWS.filter((v) => v.value !== 'wand');

  return (
    <header className="z-header flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 border-b border-border bg-surface-alt px-5 py-3 lg:px-7">
      <div className="flex min-w-0 shrink-0 items-center gap-3">
        {/* Board mark: anchors the identity so the title is not the only thing holding the
            top-left corner. Petrol square with the board's initial. */}
        <span
          aria-hidden
          className="font-head hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-13 font-bold text-primary-foreground sm:flex"
        >
          {(board.name.trim()[0] ?? 'W').toUpperCase()}
        </span>

        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            {isOwner && editingName ? (
              <input
                ref={nameInputRef}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') {
                    setNameDraft(board.name);
                    setEditingName(false);
                  }
                }}
                aria-label="Name der Wand"
                className="font-head min-w-0 max-w-[280px] rounded-sm border-0 bg-transparent text-18 font-bold text-fg-1 outline-none ring-2 ring-[color:var(--ring-alpha)]"
              />
            ) : (
              <h1
                className={cn(
                  'font-head min-w-0 truncate text-18 font-bold text-fg-1',
                  isOwner &&
                    'cursor-text rounded-sm transition-colors duration-150 hover:text-[color:var(--petrol-mid)]',
                )}
                onClick={() => isOwner && setEditingName(true)}
                title={isOwner ? 'Name bearbeiten' : undefined}
              >
                {board.name}
              </h1>
            )}
            <BoardSwitcher boardId={boardId} />
          </div>

          <p className="flex items-center gap-1.5 text-12 text-fg-muted">
            <span className="tabular-nums">{openCount} offen</span>
            {overdueCount > 0 && (
              <>
                <span aria-hidden className="text-faint">
                  ·
                </span>
                <span className="font-semibold tabular-nums text-status-danger">{overdueCount} überfällig</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex flex-wrap items-center gap-2.5">
        {viewOptions.length > 1 && (
          <Segmented options={viewOptions} value={view} onChange={onSetView} aria-label="Ansicht" />
        )}

        {/* The axis groups notes in BOTH Wand and Liste, so it stays visible regardless of
            the selected view.
            A Select at every width rather than a segmented control on desktop: side by side
            with the view switch, five identically-styled pills encoded two unrelated things
            (which surface you are on, and how it is ordered) in one undifferentiated row.
            Naming the control and collapsing its options keeps the two apart, and the top
            bar now reads the same on a phone as on a desktop. */}
        <Select value={axis} onValueChange={(v) => onSetAxis(v as BoardAxis)}>
          <SelectTrigger
            aria-label="Organisation"
            className="h-9 w-[132px] rounded-lg border border-border bg-card px-3 text-13 [@media(pointer:coarse)]:h-11"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AXES.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-3 border-l border-border pl-4">
        {activeMembers.length > 0 && (
          <div
            className="hidden items-center sm:flex"
            aria-label={`${activeMembers.length} Mitglieder`}
          >
            {visibleMembers.map((m) => (
              <Avatar
                key={m.id}
                className="-ml-2 ring-2 ring-surface-alt transition-transform duration-150 ease-ds first:ml-0 hover:z-10 hover:-translate-y-0.5"
              >
                <AvatarFallback title={m.displayName ?? m.email}>
                  {initialsOf(m.displayName ?? m.email)}
                </AvatarFallback>
              </Avatar>
            ))}
            {overflowCount > 0 && (
              <span className="-ml-2 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-inset text-11 font-semibold tabular-nums text-fg-muted ring-2 ring-surface-alt">
                +{overflowCount}
              </span>
            )}
          </div>
        )}

        <ShareSheet boardId={boardId} ownerId={board.ownerId} isOwner={isOwner} isBelowTablet={isBelowTablet} />

        {canEdit && (
          <IconTooltip label="Neue Notiz">
            <Button
              variant="accent"
              size="icon"
              aria-label="Neue Notiz"
              onClick={() =>
                createNote.mutate(nextFreeNotePosition(notes), {
                  onSuccess: (n) => onOpenNote(n.id),
                })
              }
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
            </Button>
          </IconTooltip>
        )}
      </div>

      {/* Own divider: sitting directly beside the member avatars, the account avatar read
          as just another collaborator. */}
      <div className="flex items-center border-l border-border pl-4">
        <AccountMenu />
      </div>
    </header>
  );
}
