import type { TerminalSession } from '@vcode/shared';
import { Button } from '@renderer/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/components/ui/context-menu';
import { AgentStatusBadge } from '@renderer/features/agents/AgentStatusBadge';
import { cn } from '@renderer/lib/utils';
import {
  DockviewReact,
  themeDark,
  type AddPanelPositionOptions,
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import {
  ArrowDownToLine,
  ArrowRightToLine,
  Bot,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RotateCw,
  Rows2,
  Columns2,
  Square,
  TerminalSquare,
  X,
} from 'lucide-react';
import { createContext, use, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { TerminalView } from './TerminalView';
import type { ProjectTerminals } from './useProjectTerminals';

// The project's terminals as panels in a dockview grid (P5-01). The terminal list in
// useProjectTerminals says which terminals exist; dockview owns where each one is shown and
// which is active. Panel ids are terminal ids. Each tab has a right-click menu (P5-03): rename,
// split, move to a new group, maximize, close.

interface PanelParams {
  terminalId: string;
}

/** Where the next new terminal goes: a tab of `group`, or a new group beside it. */
interface Target {
  group: DockviewGroupPanel;
  direction: 'within' | 'right' | 'below';
}

interface GridContext {
  terminals: ReadonlyMap<string, TerminalSession>;
  actions: ProjectTerminals;
  /** Opens a new shell as a tab of `group`, or in a new group to its right or below it. */
  createAt: (group: DockviewGroupPanel, direction: Target['direction']) => void;
}

const GridContext = createContext<GridContext | null>(null);

function useGrid(): GridContext {
  const context = use(GridContext);
  if (!context) throw new Error('useGrid() outside <TerminalGrid>');
  return context;
}

interface Cell {
  group: DockviewGroupPanel;
  rect: DOMRect;
}

/** The groups on screen, as rows (same top) from top to bottom, each sorted left to right. */
function measureRows(api: DockviewApi): Cell[][] {
  const cells = api.groups.map((group) => ({ group, rect: group.element.getBoundingClientRect() }));
  cells.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  const rows: Cell[][] = [];
  for (const cell of cells) {
    const row = rows.find((r) => Math.abs(r[0]!.rect.top - cell.rect.top) < 4);
    if (row) row.push(cell);
    else rows.push([cell]);
  }
  return rows;
}

function gridRows(api: DockviewApi): DockviewGroupPanel[][] {
  return measureRows(api).map((row) => row.map((cell) => cell.group));
}

/**
 * Whether the groups form plain rows: each row spans the full width, and its groups are equally
 * tall. Not so once panels were split or moved by hand (e.g. a column of groups beside one).
 */
function isRowGrid(rows: Cell[][], width: number): boolean {
  return rows.every((row) => {
    const { height } = row[0]!.rect;
    const total = row.reduce((sum, cell) => sum + cell.rect.width, 0);
    return (
      row.every((cell) => Math.abs(cell.rect.height - height) < 4) &&
      Math.abs(total - width) < 4 * row.length
    );
  });
}

/**
 * Where a new group goes. In a plain row grid it stays balanced, filled row by row: up to
 * ceil(sqrt(groups)) per row, so 2 → side by side, 4 → 2 × 2, 6 → 3 × 2, 9 → 3 × 3. A layout
 * arranged by hand is left as it is, and the largest group is split along its longer side.
 * `balanced`: whether the grid should be evened out afterwards.
 */
function nextCell(api: DockviewApi): { position?: AddPanelPositionOptions; balanced: boolean } {
  const rows = measureRows(api);
  if (rows.length === 0) return { balanced: true };
  if (!isRowGrid(rows, api.width)) {
    const largest = rows
      .flat()
      .reduce((a, b) => (b.rect.width * b.rect.height > a.rect.width * a.rect.height ? b : a));
    const direction = largest.rect.width >= largest.rect.height ? 'right' : 'below';
    return { position: { referenceGroup: largest.group, direction }, balanced: false };
  }
  const columns = Math.ceil(Math.sqrt(api.groups.length + 1));
  const row = rows.find((r) => r.length < columns);
  const last = row?.at(-1)?.group;
  return {
    position: last ? { referenceGroup: last, direction: 'right' } : { direction: 'below' },
    balanced: true,
  };
}

/** Gives every row the same height and every group in a row the same width. */
function evenOut(api: DockviewApi): void {
  const rows = gridRows(api);
  const height = api.height / rows.length;
  for (const row of rows) {
    const width = api.width / row.length;
    // Twice: resizing one group takes the space from its neighbours.
    for (let pass = 0; pass < 2; pass++) {
      for (const group of row) group.api.setSize({ width, height });
    }
  }
}

function endedLabel(terminal: TerminalSession): string {
  const what = terminal.status === 'stopped' ? 'Stopped' : 'Ended';
  return terminal.exitCode !== null ? `${what} (exit code ${terminal.exitCode})` : what;
}

/**
 * Brings the grid in line with `terminals`: adds a panel for each new terminal and removes
 * the panels of terminals that are gone. A terminal that took the list slot of a removed one
 * (a restart) takes that panel's place. New terminals go where `target` says if it is given,
 * else get a cell of their own (`nextCell`). Returns whether a new terminal was placed.
 */
function syncPanels(
  api: DockviewApi,
  terminals: TerminalSession[],
  previousIds: readonly string[],
  target: Target | null,
): boolean {
  let placed = false;
  // null: no new cells; false once any of them went into a layout arranged by hand.
  let evenOutAfter: boolean | null = null;
  const ids = new Set(terminals.map((t) => t.id));
  const gone = new Set(api.panels.filter((p) => !ids.has(p.id)).map((p) => p.id));

  terminals.forEach((terminal, index) => {
    if (api.getPanel(terminal.id)) return;
    const base = {
      id: terminal.id,
      component: 'terminal',
      tabComponent: 'terminal',
      title: terminal.title,
      params: { terminalId: terminal.id } satisfies PanelParams,
      renderer: 'always' as const, // keep xterm attached to the page while its tab is hidden
    };

    const replaced = previousIds[index];
    const old = replaced && gone.has(replaced) ? api.getPanel(replaced) : undefined;
    if (old) {
      api.addPanel({
        ...base,
        position: {
          referencePanel: old,
          direction: 'within',
          index: old.group.panels.indexOf(old),
        },
      });
      return;
    }

    placed = true;
    if (target && api.groups.includes(target.group)) {
      const { group, direction } = target;
      api.addPanel({ ...base, position: { referenceGroup: group, direction } });
    } else {
      // The grid is measured from what's on screen, so show all of it first.
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      const { position, balanced } = nextCell(api);
      evenOutAfter = balanced && evenOutAfter !== false;
      api.addPanel(position ? { ...base, position } : base);
    }
  });

  for (const id of gone) {
    const panel = api.getPanel(id);
    if (panel) api.removePanel(panel);
  }
  if (evenOutAfter) evenOut(api);
  return placed;
}

export function TerminalGrid({ terminals }: { terminals: ProjectTerminals }) {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const previousIds = useRef<readonly string[]>([]);
  // Set by a group's "+" or a split while its terminal is being created.
  const target = useRef<Target | null>(null);

  const list = terminals.terminals;
  useEffect(() => {
    if (!api) return;
    if (syncPanels(api, list, previousIds.current, target.current)) {
      target.current = null;
    }
    previousIds.current = list.map((t) => t.id);
  }, [api, list]);

  const context: GridContext = {
    terminals: new Map(list.map((t) => [t.id, t])),
    actions: terminals,
    createAt: (group, direction) => {
      target.current = { group, direction };
      void terminals.create().then((created) => {
        if (!created) target.current = null;
      });
    },
  };

  return (
    <GridContext value={context}>
      <DockviewReact
        className="min-h-0 flex-1"
        theme={themeDark}
        components={COMPONENTS}
        tabComponents={TAB_COMPONENTS}
        leftHeaderActionsComponent={NewTerminalAction}
        rightHeaderActionsComponent={GroupActions}
        disableFloatingGroups
        onReady={(event: DockviewReadyEvent) => setApi(event.api)}
      />
    </GridContext>
  );
}

function TerminalPanel({ api, params }: IDockviewPanelProps<PanelParams>) {
  const { actions } = useGrid();
  const [visible, setVisible] = useState(api.isVisible);
  const [active, setActive] = useState(api.isActive);

  useEffect(() => {
    const subscriptions = [
      api.onDidVisibilityChange((event) => setVisible(event.isVisible)),
      api.onDidActiveChange((event) => setActive(event.isActive)),
    ];
    return () => subscriptions.forEach((s) => s.dispose());
  }, [api]);

  const { markExited } = actions;
  return (
    <TerminalView
      terminalId={params.terminalId}
      visible={visible}
      focused={active}
      onExit={(exitCode) => markExited(params.terminalId, exitCode)}
    />
  );
}

/** Whether `group` fills the grid; follows maximize / restore from anywhere. */
function useMaximized(containerApi: DockviewApi, group: DockviewGroupPanel): boolean {
  const [maximized, setMaximized] = useState(() => group.api.isMaximized());
  useEffect(() => {
    const subscription = containerApi.onDidMaximizedGroupChange(() =>
      setMaximized(group.api.isMaximized()),
    );
    return () => subscription.dispose();
  }, [containerApi, group]);
  return maximized;
}

function toggleMaximized(group: DockviewGroupPanel): void {
  if (group.api.isMaximized()) group.api.exitMaximized();
  else group.api.maximize();
}

function TerminalTab({ api, containerApi, params }: IDockviewPanelHeaderProps<PanelParams>) {
  const { terminals, actions, createAt } = useGrid();
  const terminal = terminals.get(params.terminalId);
  const [selected, setSelected] = useState(api.isVisible);
  const [renaming, setRenaming] = useState(false);
  const group = api.group;
  const maximized = useMaximized(containerApi, group);

  useEffect(() => {
    const subscription = api.onDidVisibilityChange((event) => setSelected(event.isVisible));
    return () => subscription.dispose();
  }, [api]);

  if (!terminal) return null;
  const running = terminal.status === 'running';
  const close = (): void => void actions.close(terminal.id);
  // Moving the only tab of a group out of it would leave the layout as it was.
  const canMove = group.panels.length > 1;
  const moveOut = (position: 'right' | 'bottom') => api.moveTo({ group, position });

  const rename = async (title: string) => {
    setRenaming(false);
    const trimmed = title.trim();
    if (!trimmed || trimmed === terminal.title) return;
    if (await actions.rename(terminal.id, trimmed)) api.setTitle(trimmed);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group flex h-full items-center gap-1.5 pr-1 pl-2.5 text-xs"
          title={running ? terminal.cwd : endedLabel(terminal)}
          onAuxClick={(event) => {
            if (event.button === 1) close(); // middle click, like browser tabs
          }}
        >
          <TabContent
            terminal={terminal}
            running={running}
            selected={selected}
            renaming={renaming}
            onStartRename={() => setRenaming(true)}
            onRename={(title) => void rename(title)}
            onClose={close}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-52"
        // Not back to the tab: Rename puts it in the title field, and the rest leave it be.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ContextMenuItem onSelect={() => setRenaming(true)}>
          <Pencil />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => createAt(group, 'right')}>
          <Columns2 />
          Split right
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => createAt(group, 'below')}>
          <Rows2 />
          Split down
        </ContextMenuItem>
        <ContextMenuItem disabled={!canMove} onSelect={() => moveOut('right')}>
          <ArrowRightToLine />
          Move to the right
        </ContextMenuItem>
        <ContextMenuItem disabled={!canMove} onSelect={() => moveOut('bottom')}>
          <ArrowDownToLine />
          Move down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            api.setActive();
            toggleMaximized(group);
          }}
        >
          {maximized ? <Minimize2 /> : <Maximize2 />}
          {maximized ? 'Restore' : 'Maximize'}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={close}>
          <X />
          {running ? 'Close (stops the process)' : 'Close'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TabContent({
  terminal,
  running,
  selected,
  renaming,
  onStartRename,
  onRename,
  onClose,
}: {
  terminal: TerminalSession;
  running: boolean;
  selected: boolean;
  renaming: boolean;
  onStartRename: () => void;
  onRename: (title: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      {terminal.agent ? <Bot className="size-3.5" /> : <TerminalSquare className="size-3.5" />}
      {renaming ? (
        <TitleInput initial={terminal.title} onDone={onRename} />
      ) : (
        <span
          className="max-w-40 truncate"
          title="Double-click to rename"
          onDoubleClick={(event) => {
            event.stopPropagation();
            onStartRename();
          }}
        >
          {terminal.title}
        </span>
      )}
      {terminal.agent ? (
        <AgentStatusBadge status={terminal.agent.status} />
      ) : (
        <span
          className={cn('size-1.5 rounded-full', running ? 'bg-success' : 'bg-muted-foreground/50')}
          aria-label={running ? 'running' : 'ended'}
        />
      )}
      <button
        // Not a drag start, and not a tab click either.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${terminal.title}`}
        title={running ? 'Close (stops the process)' : 'Close'}
        className={cn(
          'flex size-5 items-center justify-center rounded-sm opacity-0 hover:bg-foreground/10 focus-visible:opacity-100 group-hover:opacity-100',
          selected && 'opacity-100',
        )}
      >
        <X className="size-3" />
      </button>
    </>
  );
}

/** Inline title editor: Enter or leaving the field saves, Escape cancels. */
function TitleInput({ initial, onDone }: { initial: string; onDone: (title: string) => void }) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (title: string) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };

  // A tab click makes its panel active, and the terminal then takes focus on the next frame
  // (TerminalView); take it back after that.
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => input.current?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <input
      ref={input}
      aria-label="Terminal title"
      value={value}
      maxLength={100}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      // Keep clicks and keys away from the tab (drag start, dockview's key handling).
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(value);
        if (event.key === 'Escape') finish(initial);
      }}
      className="h-5 w-32 rounded-sm border border-ring bg-background px-1 text-xs outline-none"
    />
  );
}

function NewTerminalAction({ group }: IDockviewHeaderActionsProps) {
  const { createAt } = useGrid();
  return (
    <div className="flex h-full items-center px-1">
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        onClick={() => createAt(group, 'within')}
        aria-label="New terminal"
        title="New terminal in this group"
      >
        <Plus />
      </Button>
    </div>
  );
}

function GroupActions({ activePanel, group, containerApi }: IDockviewHeaderActionsProps) {
  const { terminals, actions } = useGrid();
  const maximized = useMaximized(containerApi, group);
  const terminal = activePanel ? terminals.get(activePanel.id) : undefined;
  if (!terminal) return null;

  return (
    <div className="flex h-full items-center gap-1 px-1">
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        onClick={() => void actions.restart(terminal.id)}
        aria-label="Restart terminal"
        title="Restart"
      >
        <RotateCw />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        disabled={terminal.status !== 'running'}
        onClick={() => void actions.stop(terminal.id)}
        aria-label="Stop terminal"
        title="Stop (ends the process and everything it started)"
      >
        <Square />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        onClick={() => toggleMaximized(group)}
        aria-label={maximized ? 'Restore panel' : 'Maximize panel'}
        title={maximized ? 'Restore (show all panels)' : 'Maximize'}
      >
        {maximized ? <Minimize2 /> : <Maximize2 />}
      </Button>
    </div>
  );
}

const COMPONENTS = { terminal: TerminalPanel };
const TAB_COMPONENTS = { terminal: TerminalTab };
