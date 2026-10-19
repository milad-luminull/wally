import { captureMutation, type MutationTicket } from '@/lib/mutationQueue';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Command, RotateCcw, PanelRight } from 'lucide-react';
import type { NoteDto, NoteVisibility, WhiteboardDto } from '@wally/shared';
import type { T } from '@/i18n/enumLabels';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router';
import { BrandMark } from '@/components/BrandMark';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
import { IconTooltip } from '@/components/ui/tooltip';
import { MOD_KEY, openCommandPalette } from '@/lib/shortcuts';
import type { BoardAxis, BoardView } from './hooks/useBoardViewState';
import { useBoardRename } from './hooks/mutations/useBoardRename';
import { BoardContributors } from './Share/BoardContributors';
import { ShareSheet } from './Share/ShareSheet';
import { AccountMenu } from './AccountMenu';
import { BoardSwitcher } from './BoardSwitcher';
import { BoardViewToggle } from './BoardViewToggle';
import { FilterBar, type FilterBarProps } from './FilterBar';

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

interface TopBarProps {
  filters?: Omit<FilterBarProps, 'displayControl'>;
  withRail?: boolean;
  board: WhiteboardDto;
  boardId: string;
  notes: NoteDto[];
  view: BoardView;
  axis: BoardAxis;
  isDesktop: boolean;
  isBelowTablet: boolean;
  /** What the New button would create — viewers, and "Only private", add private notes. */
  newNoteVisibility: NoteVisibility;
  isOwner: boolean;
  /** The view differs from the defaults, so "Reset view" has something to do. */
  isCustomized: boolean;
  onSetView: (view: BoardView) => void;
  onSetAxis: (axis: BoardAxis) => void;
  onResetView: () => void;
  onNewNote: () => void;
}

/** Grouping and reset remain available on small screens; layout has its own toolbar toggle. */
function DisplayMenu({
  axis,
  isCustomized,
  onSetAxis,
  onResetView,
  compact = false,
}: { compact?: boolean } & Pick<
  TopBarProps,
  'axis' | 'isCustomized' | 'onSetAxis' | 'onResetView'
>) {
  const { t } = useTranslation();
  const AXES = useMemo(() => buildAxisOptions(t), [t]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label={t('board.topBar.display.label')}
          className={compact ? 'board-tool' : PHONE_ICON_BUTTON}
          title={t('board.topBar.display.label')}
        >
          <PanelRight strokeWidth={1.9} />
          {!compact && <span className="hidden md:inline">{t('board.topBar.display.label')}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-overlay flex w-72 flex-col gap-3 p-3">
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

/*
 * A 375px phone has to hold the home mark, the board name, its switcher and four controls
 * (Display, Share, New, account). On a coarse pointer every button grows to px-4, which
 * left the name no room at all, so below md the icon-only buttons drop to px-3 — 40px wide,
 * the coarse-pointer floor in docs/BRAND.md. From md up the shared button sizes apply
 * unchanged.
 */
const PHONE_ICON_BUTTON = 'max-md:[@media(pointer:coarse)]:px-3';

export function TopBar({
  board,
  boardId,
  notes,
  view,
  axis,
  isDesktop,
  isBelowTablet,
  newNoteVisibility,
  isOwner,
  isCustomized,
  onSetView,
  onSetAxis,
  onResetView,
  onNewNote,
  withRail = false,
  filters,
}: TopBarProps) {
  const { t } = useTranslation();
  const newNoteLabel = t(
    newNoteVisibility === 'PRIVATE' ? 'board.topBar.newPrivateNote' : 'board.topBar.newNote',
  );
  const renameBoard = useBoardRename(boardId);

  const openCount = notes.filter((n) => n.status === 'OPEN').length;
  const overdueCount = notes.filter(
    (n) => n.status === 'OPEN' && n.dueDate && n.dueDate < new Date().toISOString().slice(0, 10),
  ).length;

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(board.name);
  const nameTicket = useRef<MutationTicket | undefined>(undefined);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingName) setNameDraft(board.name);
  }, [board.name, editingName]);
  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  function commitName() {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== board.name)
      renameBoard.mutate({
        name: trimmed,
        ticket:
          nameTicket.current ?? captureMutation(`board:${boardId}`, { revision: board.revision }),
      });
    else setNameDraft(board.name);
  }

  const boardActions = (
    <div className="board-toolbar-tools flex shrink-0 items-center gap-1 md:gap-1.5">
      {/* Commands, not search: the filter row's field is the board's one search box. Hidden
            on small screens, where there is no keyboard to make the palette worth it. */}
      <IconTooltip label={t('palette.trigger')} shortcut={[MOD_KEY, 'K']}>
        <Button
          variant="ghost"
          onClick={openCommandPalette}
          aria-label={t('palette.trigger')}
          className="hidden text-fg-3 md:inline-flex"
        >
          <Command strokeWidth={1.75} />
          <kbd aria-hidden className="kbd hidden lg:inline-flex">
            {MOD_KEY}K
          </kbd>
        </Button>
      </IconTooltip>

      {!withRail && (
        <>
          {isDesktop && <BoardViewToggle view={view} onSetView={onSetView} />}
          <DisplayMenu
            axis={axis}
            isCustomized={isCustomized}
            onSetAxis={onSetAxis}
            onResetView={onResetView}
          />
        </>
      )}

      <BoardContributors boardId={boardId} />

      <ShareSheet
        boardId={boardId}
        boardName={board.name}
        ownerId={board.ownerId}
        isOwner={isOwner}
        isBelowTablet={isBelowTablet}
        triggerClassName={PHONE_ICON_BUTTON}
      />

      {!withRail && (
        <IconTooltip label={newNoteLabel} shortcut={['N']}>
          <Button
            variant="accent"
            aria-label={newNoteLabel}
            onClick={onNewNote}
            className={PHONE_ICON_BUTTON}
          >
            <Plus strokeWidth={2} />
            <span className="hidden md:inline">{newNoteLabel}</span>
          </Button>
        </IconTooltip>
      )}

      {/* The divider is a desktop nicety; on a phone its 15px go to the board name. */}
      {!withRail && (
        <div className="flex items-center md:ml-1 md:border-l md:border-border-subtle md:pl-2.5">
          <AccountMenu />
        </div>
      )}
    </div>
  );

  return (
    <header className="board-toolbar z-header flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-3 md:gap-1.5 lg:px-4 [@media(pointer:coarse)]:h-14">
      {/* The one part of the bar that gives way: it takes the free space and, when there is
          none, shrinks until the board name truncates. The controls on the right never do. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 md:gap-2">
        {!withRail && (
          <>
            <Link
              to="/boards"
              aria-label={t('board.topBar.home')}
              title={t('board.topBar.home')}
              className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
            >
              <BrandMark size={20} />
            </Link>
            {/* Decoration only: on a phone its width goes to the name instead. */}
            <span
              aria-hidden
              className="hidden shrink-0 text-16 font-light text-fg-faint sm:inline"
            >
              /
            </span>
          </>
        )}

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
            /* The cap sits here, and the button is max-w-full: a block button sizes to its
               content rather than to its parent, so a cap on the button alone let a long
               name spill out of a zero-width heading and under the controls. */
            <h1 className="min-w-0 max-w-[260px] text-14 font-medium text-fg-1">
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => {
                    nameTicket.current = captureMutation(`board:${boardId}`, {
                      revision: board.revision,
                    });
                    setEditingName(true);
                  }}
                  title={t('board.topBar.renameTitle')}
                  className="block h-7 max-w-full truncate rounded-md px-1.5 text-left transition-colors duration-100 hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
                >
                  {board.name}
                </button>
              ) : (
                <span className="block max-w-full truncate px-1.5">{board.name}</span>
              )}
            </h1>
          )}
          {!withRail && <BoardSwitcher boardId={boardId} />}
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

      {!withRail && boardActions}
      {withRail && filters && (
        <FilterBar
          {...filters}
          actions={boardActions}
          displayControl={
            <>
              <BoardViewToggle view={view} onSetView={onSetView} />
              <DisplayMenu
                compact
                axis={axis}
                isCustomized={isCustomized}
                onSetAxis={onSetAxis}
                onResetView={onResetView}
              />
            </>
          }
        />
      )}
    </header>
  );
}
