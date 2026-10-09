import type { AgentSessionStatus } from '@vcode/shared';
import { cn } from '@renderer/lib/utils';

// An agent session's status (V1 doc §13). READY / WORKING / WAITING are best-effort guesses
// from terminal activity, so the tooltip says so.

const STATUS: Record<AgentSessionStatus, { label: string; dot: string; hint: string }> = {
  created: { label: 'Starting', dot: 'bg-muted-foreground animate-pulse', hint: 'Starting' },
  starting: { label: 'Starting', dot: 'bg-muted-foreground animate-pulse', hint: 'Starting' },
  ready: { label: 'Ready', dot: 'bg-success', hint: 'Ready for your first message' },
  working: { label: 'Working', dot: 'bg-sky-400 animate-pulse', hint: 'Printing output' },
  waiting: { label: 'Waiting', dot: 'bg-warning', hint: 'Quiet: probably waiting for you' },
  stopped: { label: 'Stopped', dot: 'bg-muted-foreground/50', hint: 'Stopped' },
  completed: { label: 'Done', dot: 'bg-muted-foreground/50', hint: 'Exited normally' },
  failed: { label: 'Failed', dot: 'bg-destructive', hint: 'Exited with an error' },
};

const GUESSED: AgentSessionStatus[] = ['ready', 'working', 'waiting'];

export function AgentStatusBadge({
  status,
  className,
}: {
  status: AgentSessionStatus;
  className?: string;
}) {
  const { label, dot, hint } = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] leading-none font-medium text-muted-foreground',
        className,
      )}
      title={GUESSED.includes(status) ? `${hint} (best guess from terminal activity)` : hint}
    >
      <span className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  );
}
