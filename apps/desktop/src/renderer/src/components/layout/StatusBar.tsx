import type { AppInfo } from '@vcode/shared';
import { topStatus, useAgentActivity } from '@renderer/features/agents/AgentActivity';
import { AgentStatusDot } from '@renderer/features/agents/AgentStatusBadge';
import { invoke } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';
import { useEffect, useState } from 'react';

export function StatusBar({ className }: { className?: string }) {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    invoke('app:getInfo').then(setInfo, (error: unknown) => {
      console.error('Failed to load app info:', error);
    });
  }, []);

  return (
    <footer
      className={cn(
        'flex h-6 items-center justify-between border-t bg-sidebar px-3 text-[11px] text-muted-foreground',
        className,
      )}
    >
      <AgentSummary />
      {info && (
        <span className="font-mono">
          v{info.version} · Electron {info.versions.electron} · Node {info.versions.node}
        </span>
      )}
    </footer>
  );
}

/** How many agents run, in all projects, and how many seem to wait for the user (P5-07). */
function AgentSummary() {
  const runs = useAgentActivity();
  const status = topStatus(runs);
  if (!status) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-success" />
        Ready · No agents running
      </span>
    );
  }
  const waiting = runs.filter((s) => s.status === 'waiting').length;
  return (
    <span className="flex items-center gap-1.5" data-testid="agent-summary">
      <AgentStatusDot status={status} />
      {runs.length} agent{runs.length === 1 ? '' : 's'} running
      {waiting > 0 && <span className="text-warning">· {waiting} waiting for you</span>}
    </span>
  );
}
