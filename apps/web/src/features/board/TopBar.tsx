import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Columns3, List, Plus, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import type { NoteDto, WhiteboardDto } from '@wally/shared';
import type { T } from '@/i18n/enumLabels';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { BrandMark } from '@/components/BrandMark';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
import { IconTooltip } from '@/components/ui/tooltip';
import { MOD_KEY, openCommandPalette } from '@/lib/shortcuts';
import type { BoardAxis, BoardView } from './hooks/useBoardViewState';
import { useActiveMembers } from './hooks/useMembers';
import { useBoardRename } from './hooks/mutations/useBoardRename';
import { initialsOf } from './util/noteDerived';
import { ShareSheet } from './Share/ShareSheet';
import { AccountMenu } from './AccountMenu';
import { BoardSwitcher } from './BoardSwitcher';

/**
 * Built from `t` rather than declared at module scope: a module-level array would capture the
 * German labels once, at import time, and never re-evaluate on a language change.
 */
function buildAxisOptions(t: T): SegmentedOption<BoardAxis>[] {
  return [
    {
      value: 'horizon',
      label: t('board.topBar.axis.horizon.label'),
      hint: t('board.topBar.axis.horizon.hint'),
    },
    {
      value: 'priority',
      label: t('board.topBar.axis.priority.label'),
      hint: t('board.topBar.axis.priority.hint'),
    },
    {
      value: 'free',
      label: t('board.topBar.axis.free.label'),
      hint: t('board.topBar.axis.free.hint'),
    },
  ];
}

function buildViewOptions(t: T): SegmentedOption<BoardView>[] {
  return [
    {
      value: 'wand',
      label: t('board.topBar.view.wand'),
      icon: <Columns3 strokeWidth={1.75} aria-hidden />,
    },
    {
      value: 'list',
      label: t('board.topBar.view.list'),
      icon: <List strokeWidth={1.75} aria-hidden />,
    },
  ];
}

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
  /** The view differs from the defaults, so "Reset view" has something to do. */
  isCustomized: boolean;
  onSetView: (view: BoardView) => void;
  onSetAxis: (axis: BoardAxis) => void;
  onResetView: () => void;
  onNewNote: () => void;
}

/**
 * Layout and grouping, in one place. Both used to sit in the bar side by side — a segmented
 * control next to a select — and they read as one undifferentiated row of pills. Here they
 * are named, stacked, and remembered per board (see useBoardViewState).
 */
function DisplayMenu({
  view,
  axis,
  isDesktop,
  isCustomized,
  onSetView,
  onSetAxis,
  onResetView,
}: Pick<
  TopBarProps,
  'view' | 'axis' | 'isDesktop' | 'isCustomized' | 'onSetView' | 'onSetAxis' | 'onResetView'
>) {
  const { t } = useTranslation();
  const AXES = useMemo(() => buildAxisOptions(t), [t]);
  const VIEWS = useMemo(() => buildViewOptions(t), [t]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" aria-label={t('board.topBar.display.label')}>
          <SlidersHorizontal strokeWidth={1.75} />
          <span className="hidden md:inline">{t('board.topBar.display.label')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-overlay flex w-72 flex-col gap-3 p-3">
        {/* Only the wall is desktop-gated; grouping reorders both views, so it stays. */}
        {isDesktop && (
          <div className="flex flex-col gap-1.5">
            <p className="text-12 font-medium text-fg-3">{t('board.topBar.view.ariaLabel')}</p>
            <Segmented
              options={VIEWS}
              value={view}
              onChange={onSetView}
              aria-label={t('board.topBar.view.ariaLabel')}
              className="grid w-full grid-cols-2 [&>button]:justify-center"
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <p className="text-12 font-medium text-fg-3">{t('board.topBar.axis.ariaLabel')}</p>
          <Segmented
            options={AXES}
            value={axis}
            onChange={onSetAxis}
            aria-label={t('board.topBar.axis.ariaLabel')}
            className="grid w-full grid-cols-3 [&>button]:justify-center"
          />
        </div>
        <div className="-mx-3 h-px bg-border-subtle" />
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-12 text-fg-3">{t('board.topBar.display.remembered')}</p>
          <Button variant="ghost" size="sm" onClick={onResetView} disabled={!isCustomized}>
            <RotateCcw strokeWidth={1.75} />
            {t('board.topBar.display.reset')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
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
  isCustomized,
  onSetView,
  onSetAxis,
  onResetView,
  onNewNote,
}: TopBarProps) {
  const { t } = useTranslation();
  const { activeMembers } = useActiveMembers(boardId);
  const renameBoard = useBoardRename(boardId);

  const openCount = notes.filter((n) => n.status === 'OPEN').length;
  const overdueCount = notes.filter(
    (n) => n.status === 'OPEN' && n.dueDate && n.dueDate < new Date().toISOString().slice(0, 10),
  ).length;

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(board.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setNameDraft(board.name), [board.name]);
  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
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
    <header className="z-header flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-surface px-3 lg:px-4 [@media(pointer:coarse)]:h-14">
      <div className="flex min-w-0 items-center gap-2">
        <BrandMark size={20} className="shrink-0" />
        <span aria-hidden className="text-16 font-light text-fg-faint">
          /
        </span>

        <div className="flex min-w-0 items-center gap-0.5">
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
              aria-label={t('board.topBar.boardNameAria')}
              className="h-7 min-w-0 max-w-[260px] rounded-md border border-border-strong bg-surface px-1.5 text-14 font-medium text-fg-1 outline-none ring-2 ring-[color:var(--ring-alpha)]"
            />
          ) : (
            <h1 className="min-w-0 text-14 font-medium text-fg-1">
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  title={t('board.topBar.renameTitle')}
                  className="block h-7 max-w-[260px] truncate rounded-md px-1.5 text-left transition-colors duration-100 hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
                >
                  {board.name}
                </button>
              ) : (
                <span className="block max-w-[260px] truncate px-1.5">{board.name}</span>
              )}
            </h1>
          )}
          <BoardSwitcher boardId={boardId} />
        </div>

        <p className="ml-1 hidden items-center gap-1.5 whitespace-nowrap text-12 text-fg-3 sm:flex">
          <span className="tabular-nums">{t('board.topBar.open', { count: openCount })}</span>
          {overdueCount > 0 && (
            <>
              <span aria-hidden className="text-fg-faint">
                ·
              </span>
              {/* Weight, not colour. Status colour lives in a note's due-date line and
                  nowhere else, so a red count up here would be a badge by another name. */}
              <span className="font-medium tabular-nums text-fg-1">
                {t('board.topBar.overdue', { count: overdueCount })}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex-1" />

      <Button
        variant="ghost"
        onClick={openCommandPalette}
        aria-label={t('palette.aria')}
        className="text-fg-3"
      >
        <Search strokeWidth={1.75} />
        <span className="hidden lg:inline">{t('palette.trigger')}</span>
        <kbd aria-hidden className="kbd ml-1 hidden lg:inline-flex">
          {MOD_KEY}K
        </kbd>
      </Button>

      <DisplayMenu
        view={view}
        axis={axis}
        isDesktop={isDesktop}
        isCustomized={isCustomized}
        onSetView={onSetView}
        onSetAxis={onSetAxis}
        onResetView={onResetView}
      />

      {activeMembers.length > 0 && (
        <div
          className="ml-1 hidden items-center sm:flex"
          aria-label={t('board.topBar.membersAria', { count: activeMembers.length })}
        >
          {visibleMembers.map((m) => (
            <Avatar
              key={m.id}
              className="-ml-1.5 ring-2 ring-surface first:ml-0"
              title={m.displayName ?? m.email}
            >
              <AvatarFallback>{initialsOf(m.displayName ?? m.email)}</AvatarFallback>
            </Avatar>
          ))}
          {overflowCount > 0 && (
            <span className="-ml-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-inset px-1 text-[10px] font-semibold tabular-nums text-fg-3 ring-2 ring-surface">
              +{overflowCount}
            </span>
          )}
        </div>
      )}

      <ShareSheet
        boardId={boardId}
        ownerId={board.ownerId}
        isOwner={isOwner}
        isBelowTablet={isBelowTablet}
      />

      {canEdit && (
        <IconTooltip label={t('board.topBar.newNote')} shortcut={['N']}>
          <Button variant="accent" aria-label={t('board.topBar.newNote')} onClick={onNewNote}>
            <Plus strokeWidth={2} />
            <span className="hidden md:inline">{t('board.topBar.newNote')}</span>
          </Button>
        </IconTooltip>
      )}

      <div className="ml-1 flex items-center border-l border-border-subtle pl-2.5">
        <AccountMenu />
      </div>
    </header>
  );
}
