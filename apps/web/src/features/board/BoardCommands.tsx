import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Columns3,
  Copy,
  Eye,
  EyeOff,
  Grid3x3,
  Grip,
  Keyboard,
  Languages,
  LayoutGrid,
  List,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Square,
  StickyNote,
  Sun,
  User,
  UserPlus,
} from 'lucide-react';
import type { NoteDto, NoteVisibility, ThemePreference } from '@wally/shared';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLanguage } from '@/i18n/LanguageProvider';
import { SUPPORTED_LOCALES, type AppLocale } from '@/i18n/locales';
import { useTheme } from '@/lib/theme';
import { useCanvasPattern } from '@/lib/preferences';
import {
  ALT_KEY,
  MOD_KEY,
  requestOpen,
  useKeyboardShortcuts,
  useOpenRequest,
  type Shortcut,
} from '@/lib/shortcuts';
import { useBoards } from './hooks/useBoards';
import type { BoardAxis, BoardView } from './hooks/useBoardViewState';
import { SEARCH_INPUT_ID } from './FilterBar';

const LANGUAGE_ENDONYMS: Record<AppLocale, string> = { de: 'Deutsch', en: 'English' };

const GROUP_LABEL_KEYS = {
  horizon: 'shortcuts.groupHorizon',
  priority: 'shortcuts.groupPriority',
  free: 'shortcuts.groupFree',
} as const;

interface BoardCommandsProps {
  boardId: string;
  notes: NoteDto[];
  view: BoardView;
  axis: BoardAxis;
  done: boolean;
  mine: boolean;
  isDesktop: boolean;
  /** What a new note becomes: viewers add private ones, and the New label says so. */
  newNoteVisibility: NoteVisibility;
  /** The open note is one this member may duplicate. */
  canDuplicateOpenNote: boolean;
  noteOpen: boolean;
  /** Leave full-screen note mode before targeting controls on the board. */
  onRevealBoard?: () => void;
  onNewNote: () => void;
  /** Duplicates the open note. */
  onDuplicateNote: () => void;
  onOpenNote: (id: string) => void;
  onCloseNote: () => void;
  onSetView: (view: BoardView) => void;
  onSetAxis: (axis: BoardAxis) => void;
  onSetDone: (done: boolean) => void;
  onSetMine: (mine: boolean) => void;
  onResetView: () => void;
  /** Wallybot can fill in on this board; gates the ⌘Z help row. */
  assistantEnabled: boolean;
  /**
   * Undoes the most recently kept Wallybot change still in its window, a note's fill-in or the
   * kept tidy batch, whichever was kept last (plan R7); false when there is none.
   */
  onUndoSuggestion: () => boolean;
}

function Kbd({ children }: { children: string }) {
  return <kbd className="kbd">{children}</kbd>;
}

/**
 * The board's keyboard layer: global shortcuts, the ⌘K command palette and the `?` sheet.
 * Rendered once by AppShell. Everything here also exists as a visible control — the palette
 * and the keys are accelerators, never the only way to do something.
 */
export function BoardCommands(props: BoardCommandsProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { isDesktop } = props;

  useOpenRequest('palette', () => setPaletteOpen(true));
  useOpenRequest('shortcuts', () => setHelpOpen(true));

  const focusSearch = () => {
    props.onRevealBoard?.();
    // Let React remove inert before moving focus into the board.
    requestAnimationFrame(() => document.getElementById(SEARCH_INPUT_ID)?.focus());
  };
  const shortcuts: Shortcut[] = [
    { keys: 'mod+k', allowInInputs: true, handler: () => setPaletteOpen((open) => !open) },
    { keys: '?', handler: () => setHelpOpen(true) },
    { keys: '/', handler: focusSearch },
    { keys: 'n', handler: () => props.onNewNote() },
    {
      // Works from inside the title or description too: duplicating what you are writing
      // is the common case. Without an open note it still swallows the key, so the
      // browser's bookmark dialog never opens on the board.
      keys: 'mod+d',
      allowInInputs: true,
      handler: () => props.noteOpen && props.canDuplicateOpenNote && props.onDuplicateNote(),
    },
    {
      keys: 'v',
      handler: () => isDesktop && props.onSetView(props.view === 'wand' ? 'list' : 'wand'),
    },
    { keys: 'g h', handler: () => props.onSetAxis('horizon') },
    { keys: 'g p', handler: () => props.onSetAxis('priority') },
    { keys: 'g f', handler: () => props.onSetAxis('free') },
    {
      keys: 'mod+enter',
      allowInInputs: true,
      handler: () => {
        if (!props.noteOpen) return;
        (document.activeElement as HTMLElement | null)?.blur();
        props.onCloseNote();
      },
    },
    {
      // Not in a field, where ⌘Z is the field's own undo; with nothing to undo here the key
      // is left to the browser. The chord matcher ignores Shift, and ⌘⇧Z is redo.
      keys: 'mod+z',
      handlerOwnsDefault: true,
      handler: (event) => {
        if (!event.shiftKey && props.onUndoSuggestion()) event.preventDefault();
      },
    },
  ];
  useKeyboardShortcuts(shortcuts);

  return (
    <>
      <CommandPalette
        {...props}
        onSearch={focusSearch}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
      <ShortcutsDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        assistantEnabled={props.assistantEnabled}
      />
    </>
  );
}

function CommandPalette({
  boardId,
  notes,
  view,
  axis,
  done,
  mine,
  isDesktop,
  newNoteVisibility,
  canDuplicateOpenNote,
  noteOpen,
  onNewNote,
  onRevealBoard,
  onSearch,
  onDuplicateNote,
  onOpenNote,
  onSetView,
  onSetAxis,
  onSetDone,
  onSetMine,
  onResetView,
  open,
  onOpenChange,
}: BoardCommandsProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: boards = [] } = useBoards();
  const { theme, setTheme } = useTheme();
  const [canvasPattern, setCanvasPattern] = useCanvasPattern();
  const { language, setLanguage } = useLanguage();
  const { signOut } = useAuth();
  const [query, setQuery] = useState('');

  // Notes only show once the user types — an unfiltered list of every note would bury the
  // actions, which are what an empty palette is for.
  const matchingNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return notes.filter((n) => (n.title || '').toLowerCase().includes(q)).slice(0, 8);
  }, [notes, query]);

  function run(action: () => void) {
    onOpenChange(false);
    setQuery('');
    // After the dialog has let go of focus, so the action's own focus handling wins.
    requestAnimationFrame(action);
  }

  const themeOptions: { value: ThemePreference; icon: ReactElement }[] = [
    { value: 'system', icon: <Monitor /> },
    { value: 'light', icon: <Sun /> },
    { value: 'dark', icon: <Moon /> },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
    >
      <DialogContent
        hideClose
        aria-describedby={undefined}
        className="left-0 right-0 top-[14vh] mx-auto w-[calc(100%-32px)] max-w-[560px] translate-x-0 translate-y-0 overflow-hidden p-0 data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in"
      >
        <DialogTitle className="sr-only">{t('palette.aria')}</DialogTitle>
        <Command loop label={t('palette.aria')}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('palette.placeholder')}
          />
          <CommandList>
            <CommandEmpty>{t('palette.empty')}</CommandEmpty>

            {matchingNotes.length > 0 && (
              <CommandGroup heading={t('palette.groups.notes')}>
                {matchingNotes.map((note) => (
                  <CommandItem
                    key={note.id}
                    value={`note ${note.id} ${note.title}`}
                    onSelect={() => run(() => onOpenNote(note.id))}
                  >
                    <StickyNote strokeWidth={1.75} />
                    <span className="truncate">{note.title || t('common.untitled')}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup heading={t('palette.groups.actions')}>
              <CommandItem value="new note" onSelect={() => run(onNewNote)}>
                <Plus strokeWidth={1.75} />
                <span className="flex-1">
                  {t(
                    newNoteVisibility === 'PRIVATE'
                      ? 'board.topBar.newPrivateNote'
                      : 'board.topBar.newNote',
                  )}
                </span>
                <Kbd>N</Kbd>
              </CommandItem>
              {noteOpen && canDuplicateOpenNote && (
                <CommandItem value="duplicate copy note" onSelect={() => run(onDuplicateNote)}>
                  <Copy strokeWidth={1.75} />
                  <span className="flex-1">{t('palette.duplicateNote')}</span>
                  <span className="flex gap-0.5">
                    <Kbd>{MOD_KEY}</Kbd>
                    <Kbd>D</Kbd>
                  </span>
                </CommandItem>
              )}
              <CommandItem value="search filter notes" onSelect={() => run(onSearch)}>
                <Search strokeWidth={1.75} />
                <span className="flex-1">{t('palette.focusSearch')}</span>
                <Kbd>/</Kbd>
              </CommandItem>
              <CommandItem
                value="share invite"
                onSelect={() =>
                  run(() => {
                    onRevealBoard?.();
                    requestOpen('share');
                  })
                }
              >
                <UserPlus strokeWidth={1.75} />
                <span className="flex-1">{t('palette.share')}</span>
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading={t('palette.groups.view')}>
              {isDesktop && (
                <CommandItem
                  value="toggle view wall list"
                  onSelect={() => run(() => onSetView(view === 'wand' ? 'list' : 'wand'))}
                >
                  {view === 'wand' ? <List strokeWidth={1.75} /> : <Columns3 strokeWidth={1.75} />}
                  <span className="flex-1">
                    {view === 'wand' ? t('palette.viewList') : t('palette.viewWall')}
                  </span>
                  <Kbd>V</Kbd>
                </CommandItem>
              )}
              {(['horizon', 'priority', 'free'] as const).map((value) => (
                <CommandItem
                  key={value}
                  value={`group ${value}`}
                  onSelect={() => run(() => onSetAxis(value))}
                >
                  <LayoutGrid strokeWidth={1.75} />
                  <span className="flex-1">{t(GROUP_LABEL_KEYS[value])}</span>
                  {axis === value ? (
                    <Check strokeWidth={2} />
                  ) : (
                    <span className="flex gap-0.5">
                      <Kbd>G</Kbd>
                      <Kbd>{value[0]!.toUpperCase()}</Kbd>
                    </span>
                  )}
                </CommandItem>
              ))}
              <CommandItem
                value="toggle done completed"
                onSelect={() => run(() => onSetDone(!done))}
              >
                {done ? <EyeOff strokeWidth={1.75} /> : <Eye strokeWidth={1.75} />}
                <span className="flex-1">
                  {done ? t('palette.hideDone') : t('palette.showDone')}
                </span>
              </CommandItem>
              <CommandItem value="toggle mine" onSelect={() => run(() => onSetMine(!mine))}>
                <User strokeWidth={1.75} />
                <span className="flex-1">
                  {mine ? t('palette.allNotes') : t('palette.onlyMine')}
                </span>
              </CommandItem>
              <CommandItem value="reset view" onSelect={() => run(onResetView)}>
                <RotateCcw strokeWidth={1.75} />
                <span className="flex-1">{t('palette.resetView')}</span>
              </CommandItem>
            </CommandGroup>

            {boards.length > 1 && (
              <CommandGroup heading={t('palette.groups.boards')}>
                {boards
                  .filter((b) => b.id !== boardId)
                  .map((b) => (
                    <CommandItem
                      key={b.id}
                      value={`board ${b.id} ${b.name}`}
                      onSelect={() => run(() => navigate(`/boards/${b.id}`))}
                    >
                      <LayoutGrid strokeWidth={1.75} />
                      <span className="truncate">{t('palette.switchBoard', { name: b.name })}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            )}

            <CommandGroup heading={t('palette.groups.settings')}>
              {themeOptions.map(({ value, icon }) => (
                <CommandItem
                  key={value}
                  value={`theme ${value}`}
                  onSelect={() => run(() => setTheme(value))}
                >
                  {icon}
                  <span className="flex-1">
                    {t('palette.theme', { label: t(`account.theme.${value}`) })}
                  </span>
                  {theme === value && <Check strokeWidth={2} />}
                </CommandItem>
              ))}
              {(['dots', 'grid', 'none'] as const).map((value) => (
                <CommandItem
                  key={value}
                  value={`canvas background ${value}`}
                  onSelect={() => run(() => setCanvasPattern(value))}
                >
                  {value === 'grid' ? (
                    <Grid3x3 strokeWidth={1.75} />
                  ) : value === 'dots' ? (
                    <Grip strokeWidth={1.75} />
                  ) : (
                    <Square strokeWidth={1.75} />
                  )}
                  <span className="flex-1">
                    {t('palette.canvas', { label: t(`account.canvas.${value}`) })}
                  </span>
                  {canvasPattern === value && <Check strokeWidth={2} />}
                </CommandItem>
              ))}
              {SUPPORTED_LOCALES.map((locale) => (
                <CommandItem
                  key={locale}
                  value={`language ${locale} ${LANGUAGE_ENDONYMS[locale]}`}
                  onSelect={() => run(() => setLanguage(locale))}
                >
                  <Languages strokeWidth={1.75} />
                  <span className="flex-1" lang={locale}>
                    {t('palette.language', { label: LANGUAGE_ENDONYMS[locale] })}
                  </span>
                  {language === locale && <Check strokeWidth={2} />}
                </CommandItem>
              ))}
              <CommandItem
                value="keyboard shortcuts help"
                onSelect={() => run(() => requestOpen('shortcuts'))}
              >
                <Keyboard strokeWidth={1.75} />
                <span className="flex-1">{t('account.shortcuts')}</span>
                <Kbd>?</Kbd>
              </CommandItem>
              <CommandItem value="sign out log out" onSelect={() => run(() => void signOut())}>
                <LogOut strokeWidth={1.75} />
                <span className="flex-1">{t('account.signOut')}</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutsDialog({
  open,
  onOpenChange,
  assistantEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistantEnabled: boolean;
}) {
  const { t } = useTranslation();
  const rows: { keys: string[]; label: string }[] = [
    { keys: [MOD_KEY, 'K'], label: t('shortcuts.palette') },
    { keys: ['N'], label: t('shortcuts.newNote') },
    { keys: [MOD_KEY, 'D'], label: t('shortcuts.duplicateNote') },
    ...(assistantEnabled
      ? [
          // Only where Wallybot can fill in is there a kept change to undo.
          { keys: [MOD_KEY, 'Z'], label: t('shortcuts.undoSuggestion') },
        ]
      : []),
    { keys: [ALT_KEY], label: t('shortcuts.copyDrag') },
    { keys: ['/'], label: t('shortcuts.search') },
    { keys: ['V'], label: t('shortcuts.toggleView') },
    { keys: ['G', 'H'], label: t('shortcuts.groupHorizon') },
    { keys: ['G', 'P'], label: t('shortcuts.groupPriority') },
    { keys: ['G', 'F'], label: t('shortcuts.groupFree') },
    { keys: ['Esc'], label: t('shortcuts.closePanel') },
    { keys: [MOD_KEY, '↵'], label: t('shortcuts.closePanel') },
    { keys: ['?'], label: t('shortcuts.help') },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <DialogTitle className="mb-3">{t('shortcuts.title')}</DialogTitle>
        <ul className="-mx-1 flex flex-col">
          {rows.map((row) => (
            <li
              key={row.keys.join('+') + row.label}
              className="flex h-9 items-center justify-between gap-4 rounded-md px-1 text-13 text-fg-2"
            >
              {row.label}
              <span className="flex items-center gap-1">
                {row.keys.map((key, i) => (
                  <span key={key} className="flex items-center gap-1">
                    {i > 0 && row.keys[0] === 'G' && (
                      <span className="text-12 text-fg-faint">{t('shortcuts.then')}</span>
                    )}
                    <Kbd>{key}</Kbd>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
