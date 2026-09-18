import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { NoteDto, WhiteboardDto } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IconTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { BoardAxis, BoardView } from './hooks/useBoardViewState';
import { useActiveMembers } from './hooks/useMembers';
import { useBoardRename } from './hooks/mutations/useBoardRename';
import { useCreateNote } from './hooks/mutations/useCreateNote';
import { initialsOf } from './util/noteDerived';
import { ShareSheet } from './Share/ShareSheet';

const AXES: { key: BoardAxis; label: string }[] = [
  { key: 'horizon', label: 'Horizont' },
  { key: 'priority', label: 'Priorität' },
  { key: 'free', label: 'Frei' },
];

const TAB_ACTIVE = 'text-13 font-semibold text-fg-1';
const TAB_INACTIVE = 'text-13 font-medium text-fg-muted hover:text-fg-1 transition-colors duration-150';

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
  const overdueCount = notes.filter((n) => n.status === 'OPEN' && n.dueDate && n.dueDate < new Date().toISOString().slice(0, 10)).length;
  const countLabel = overdueCount > 0 ? `${openCount} offen · ${overdueCount} überfällig` : `${openCount} offen`;

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

  return (
    <header className="z-header flex flex-wrap items-center gap-5 px-6 pb-3 pt-4">
      <div className="flex min-w-0 items-center gap-2.5">
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
            className="font-head min-w-0 max-w-[280px] border-0 border-b border-primary bg-transparent text-18 font-semibold text-fg-1 outline-none"
          />
        ) : (
          <h1
            className={cn('font-head min-w-0 truncate text-18 font-semibold tracking-[-0.015em] text-fg-1', isOwner && 'cursor-text')}
            onClick={() => isOwner && setEditingName(true)}
            title={isOwner ? 'Name bearbeiten' : undefined}
          >
            {board.name}
          </h1>
        )}
        <span className="whitespace-nowrap text-13 text-fg-3 tabular-nums">{countLabel}</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-4">
        {isDesktop && (
          <button type="button" className={view === 'wand' ? TAB_ACTIVE : TAB_INACTIVE} onClick={() => onSetView('wand')}>
            Wand
          </button>
        )}
        <button type="button" className={view === 'list' ? TAB_ACTIVE : TAB_INACTIVE} onClick={() => onSetView('list')}>
          Liste
        </button>
      </div>

      {/* Axis (Horizont/Priorität/Frei) groups notes in BOTH Wand and Liste — ListView
          groups by whatever axis is active too — so this stays visible regardless of
          which view tab is selected; only its form (inline tabs vs a Select) changes
          with the breakpoint. */}
      {isDesktop ? (
        <div className="flex items-center gap-4 border-l border-border pl-5">
          {AXES.map((a) => (
            <button key={a.key} type="button" className={axis === a.key ? TAB_ACTIVE : TAB_INACTIVE} onClick={() => onSetAxis(a.key)}>
              {a.label}
            </button>
          ))}
        </div>
      ) : (
        <Select value={axis} onValueChange={(v) => onSetAxis(v as BoardAxis)}>
          <SelectTrigger aria-label="Organisation" className="h-8 w-32 border-0 border-b border-border-input p-0 text-13">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AXES.map((a) => (
              <SelectItem key={a.key} value={a.key}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-3.5 border-l border-border pl-5">
        <div className="flex items-center" aria-label={`${activeMembers.length} Mitglieder`}>
          {visibleMembers.map((m) => (
            <Avatar key={m.id} className="-ml-1.5 border-2 border-background first:ml-0">
              <AvatarFallback title={m.displayName ?? m.email}>{initialsOf(m.displayName ?? m.email)}</AvatarFallback>
            </Avatar>
          ))}
          {overflowCount > 0 && (
            <span className="-ml-1.5 flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-background bg-inset text-[10px] font-semibold text-fg-muted">
              +{overflowCount}
            </span>
          )}
        </div>

        <ShareSheet boardId={boardId} ownerId={board.ownerId} isOwner={isOwner} isBelowTablet={isBelowTablet} />

        {canEdit && (
          <IconTooltip label="Neue Notiz">
            <Button
              variant="accent"
              size="icon"
              aria-label="Neue Notiz"
              onClick={() => createNote.mutate({}, { onSuccess: (n) => onOpenNote(n.id) })}
            >
              <Plus className="h-4 w-4" strokeWidth={1.8} />
            </Button>
          </IconTooltip>
        )}
      </div>
    </header>
  );
}
