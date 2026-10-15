import type { TerminalSession } from '@vcode/shared';
import { Button } from '@renderer/components/ui/button';
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
import { Bot, Plus, RotateCw, Square, TerminalSquare, X } from 'lucide-react';
import { createContext, use, useEffect, useRef, useState } from 'react';
import { TerminalView } from './TerminalView';
import type { ProjectTerminals } from './useProjectTerminals';

// The project's terminals as panels in a dockview grid (P5-01). The terminal list in
// useProjectTerminals says which terminals exist; dockview owns where each one is shown and
// which is active. Panel ids are terminal ids.

interface PanelParams {
  terminalId: string;
}

interface GridContext {
  terminals: ReadonlyMap<string, TerminalSession>;
  actions: ProjectTerminals;
  /** Opens a new terminal as a tab of `group`. */
  createIn: (group: DockviewGroupPanel) => void;
}

const GridContext = createContext<GridContext | null>(null);

function useGrid(): GridContext {
  const context = use(GridContext);
  if (!context) throw new Error('useGrid() outside <TerminalGrid>');
  return context;
}

/** The groups on screen, as rows from top to bottom, each sorted left to right. */
function gridRows(api: DockviewApi): DockviewGroupPanel[][] {
  const placed = api.groups.map((group) => ({
    group,
    rect: group.element.getBoundingClientRect(),
  }));
  placed.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  const rows: { top: number; groups: { group: DockviewGroupPanel; left: number }[] }[] = [];
  for (const { group, rect } of placed) {
    const row = rows.find((r) => Math.abs(r.top - rect.top) < 4);
    if (row) row.groups.push({ group, left: rect.left });
    else rows.push({ top: rect.top, groups: [{ group, left: rect.left }] });
  }
  return rows.map((r) => r.groups.sort((a, b) => a.left - b.left).map((g) => g.group));
}

/**
 * Where a new group goes so the grid stays balanced, filled row by row: up to
 * ceil(sqrt(groups)) per row, so 2 → side by side, 4 → 2 × 2, 6 → 3 × 2, 9 → 3 × 3.
 */
function nextCell(api: DockviewApi): AddPanelPositionOptions | undefined {
  const rows = gridRows(api);
  if (rows.length === 0) return undefined;
  const columns = Math.ceil(Math.sqrt(api.groups.length + 1));
  const row = rows.find((r) => r.length < columns);
  const last = row?.at(-1);
  return last ? { referenceGroup: last, direction: 'right' } : { direction: 'below' };
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
 * (a restart) takes that panel's place. New terminals join `targetGroup` as tabs if it is
 * given, else get a cell of their own in the balanced grid (`nextCell`). Returns whether a new
 * terminal was placed.
 */
function syncPanels(
  api: DockviewApi,
  terminals: TerminalSession[],
  previousIds: readonly string[],
  targetGroup: DockviewGroupPanel | null,
): boolean {
  let placed = false;
  let newCells = false;
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
    if (targetGroup && api.groups.includes(targetGroup)) {
      api.addPanel({ ...base, position: { referenceGroup: targetGroup, direction: 'within' } });
    } else {
      newCells = true;
      const position = nextCell(api);
      api.addPanel(position ? { ...base, position } : base);
    }
  });

  for (const id of gone) {
    const panel = api.getPanel(id);
    if (panel) api.removePanel(panel);
  }
  if (newCells) evenOut(api);
  return placed;
}

export function TerminalGrid({ terminals }: { terminals: ProjectTerminals }) {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const previousIds = useRef<readonly string[]>([]);
  // Set by a group's "+" while its terminal is being created; the new panel joins that group.
  const targetGroup = useRef<DockviewGroupPanel | null>(null);

  const list = terminals.terminals;
  useEffect(() => {
    if (!api) return;
    if (syncPanels(api, list, previousIds.current, targetGroup.current)) {
      targetGroup.current = null;
    }
    previousIds.current = list.map((t) => t.id);
  }, [api, list]);

  const context: GridContext = {
    terminals: new Map(list.map((t) => [t.id, t])),
    actions: terminals,
    createIn: (group) => {
      targetGroup.current = group;
      void terminals.create().then((created) => {
        if (!created) targetGroup.current = null;
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

function TerminalTab({ api, params }: IDockviewPanelHeaderProps<PanelParams>) {
  const { terminals, actions } = useGrid();
  const terminal = terminals.get(params.terminalId);
  const [selected, setSelected] = useState(api.isVisible);

  useEffect(() => {
    const subscription = api.onDidVisibilityChange((event) => setSelected(event.isVisible));
    return () => subscription.dispose();
  }, [api]);

  if (!terminal) return null;
  const running = terminal.status === 'running';
  const close = (): void => void actions.close(terminal.id);

  return (
    <div
      className="group flex h-full items-center gap-1.5 pr-1 pl-2.5 text-xs"
      title={running ? terminal.cwd : endedLabel(terminal)}
      onAuxClick={(event) => {
        if (event.button === 1) close(); // middle click, like browser tabs
      }}
    >
      {terminal.agent ? <Bot className="size-3.5" /> : <TerminalSquare className="size-3.5" />}
      <span className="max-w-40 truncate">{terminal.title}</span>
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
          close();
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
    </div>
  );
}

function NewTerminalAction({ group }: IDockviewHeaderActionsProps) {
  const { createIn } = useGrid();
  return (
    <div className="flex h-full items-center px-1">
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        onClick={() => createIn(group)}
        aria-label="New terminal"
        title="New terminal in this group"
      >
        <Plus />
      </Button>
    </div>
  );
}

function GroupActions({ activePanel }: IDockviewHeaderActionsProps) {
  const { terminals, actions } = useGrid();
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
    </div>
  );
}

const COMPONENTS = { terminal: TerminalPanel };
const TAB_COMPONENTS = { terminal: TerminalTab };
