import type { TerminalSession } from '@vcode/shared';
import { cn } from '@renderer/lib/utils';
import { Plus, RotateCw, Square, TerminalSquare, X } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';

interface TerminalTabsProps {
  terminals: TerminalSession[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onCreate: () => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onClose: (id: string) => void;
}

function endedLabel(terminal: TerminalSession): string {
  const what = terminal.status === 'stopped' ? 'Stopped' : 'Ended';
  return terminal.exitCode !== null ? `${what} (exit code ${terminal.exitCode})` : what;
}

/** One tab per terminal, until the panel grid arrives in P5. */
export function TerminalTabs({
  terminals,
  activeId,
  onActivate,
  onCreate,
  onStop,
  onRestart,
  onClose,
}: TerminalTabsProps) {
  const active = terminals.find((t) => t.id === activeId);

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
      <div role="tablist" className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {terminals.map((terminal) => {
          const running = terminal.status === 'running';
          const selected = terminal.id === activeId;
          return (
            <div
              key={terminal.id}
              className={cn(
                'group flex h-7 shrink-0 items-center rounded-md text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                selected && 'bg-accent text-foreground',
              )}
            >
              <button
                role="tab"
                aria-selected={selected}
                title={running ? terminal.cwd : endedLabel(terminal)}
                onClick={() => onActivate(terminal.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) onClose(terminal.id); // middle click, like browser tabs
                }}
                className="flex h-full items-center gap-1.5 pl-2.5 pr-1"
              >
                <TerminalSquare className="size-3.5" />
                <span className="max-w-40 truncate">{terminal.title}</span>
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    running ? 'bg-success' : 'bg-muted-foreground/50',
                  )}
                  aria-label={running ? 'running' : 'ended'}
                />
              </button>
              <button
                onClick={() => onClose(terminal.id)}
                aria-label={`Close ${terminal.title}`}
                title={running ? 'Close (stops the process)' : 'Close'}
                className={cn(
                  'mr-1 flex size-5 items-center justify-center rounded-sm opacity-0 hover:bg-foreground/10 focus-visible:opacity-100 group-hover:opacity-100',
                  selected && 'opacity-100',
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0"
        onClick={onCreate}
        aria-label="New terminal"
        title="New terminal"
      >
        <Plus />
      </Button>

      {active && (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => onRestart(active.id)}
            aria-label="Restart terminal"
            title="Restart"
          >
            <RotateCw />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={active.status !== 'running'}
            onClick={() => onStop(active.id)}
            aria-label="Stop terminal"
            title="Stop (ends the process and everything it started)"
          >
            <Square />
          </Button>
        </div>
      )}
    </div>
  );
}
