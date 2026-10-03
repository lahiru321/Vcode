import type { TerminalSession } from '@vcode/shared';
import { cn } from '@renderer/lib/utils';
import { Plus, TerminalSquare } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';

interface TerminalTabsProps {
  terminals: TerminalSession[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onCreate: () => void;
}

/** One tab per terminal, until the panel grid arrives in P5. */
export function TerminalTabs({ terminals, activeId, onActivate, onCreate }: TerminalTabsProps) {
  return (
    <div role="tablist" className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
      {terminals.map((terminal) => {
        const running = terminal.status === 'running';
        const active = terminal.id === activeId;
        return (
          <button
            key={terminal.id}
            role="tab"
            aria-selected={active}
            title={
              running
                ? terminal.cwd
                : `Ended${terminal.exitCode !== null ? ` (exit code ${terminal.exitCode})` : ''}`
            }
            onClick={() => onActivate(terminal.id)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              active && 'bg-accent text-foreground',
            )}
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
        );
      })}
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        onClick={onCreate}
        aria-label="New terminal"
        title="New terminal"
      >
        <Plus />
      </Button>
    </div>
  );
}
