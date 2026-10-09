import type { Agent, AgentStatus } from '@vcode/shared';
import { Bot, MoreHorizontal, Pencil, Play, RotateCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { cn } from '@renderer/lib/utils';
import { useAgents } from './AgentsProvider';

// Agent rows for the sidebar's Agents section: start, edit, check, delete (P4-02).

const STATUS: Record<AgentStatus, { dot: string; hint: string }> = {
  unvalidated: { dot: 'bg-muted-foreground/50', hint: 'Not checked yet' },
  ready: { dot: 'bg-success', hint: 'CLI found' },
  not_found: { dot: 'bg-warning', hint: 'CLI not found' },
  error: { dot: 'bg-destructive', hint: 'CLI failed to start' },
};

export function AgentList() {
  const { agents, loaded, loadError, reload } = useAgents();

  if (loadError) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 text-xs">
        <span className="text-destructive">Couldn’t load agents.</span>
        <span className="text-muted-foreground">{loadError}</span>
        <Button variant="outline" size="sm" className="h-7 w-fit" onClick={() => void reload()}>
          <RotateCw />
          Retry
        </Button>
      </div>
    );
  }
  if (!loaded) {
    return null;
  }
  if (agents.length === 0) {
    return (
      <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
        <Bot className="size-3.5 shrink-0" />
        No agents configured
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {agents.map((agent) => (
        <AgentRow key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const { start, canStart, startEdit, startDelete, validate } = useAgents();
  const status = STATUS[agent.status];
  const startHint = canStart ? `Start ${agent.name}` : 'Select an active project to start agents';

  return (
    <div className="group/row relative flex h-8 items-center rounded-md text-sm hover:bg-sidebar-accent/50">
      <button
        type="button"
        title={`${agent.executable} · ${status.hint}`}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-14 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        onClick={() => startEdit(agent)}
        onKeyDown={(event) => {
          if (event.key === 'Delete') {
            event.preventDefault();
            startDelete(agent);
          }
        }}
      >
        <Bot className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{agent.name}</span>
        {agent.projectId && (
          <span className="shrink-0 text-[11px] text-muted-foreground">project</span>
        )}
        <span
          role="img"
          className={cn('size-1.5 shrink-0 rounded-full', status.dot)}
          aria-label={status.hint}
        />
      </button>

      <div className="absolute right-1 flex items-center">
        <Button
          variant="ghost"
          size="icon"
          aria-label={startHint}
          title={startHint}
          disabled={!canStart}
          className="size-6 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          onClick={() => void start(agent)}
        >
          <Play className="size-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${agent.name}`}
              className="size-6 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-52">
            <DropdownMenuItem disabled={!canStart} onSelect={() => void start(agent)}>
              <Play />
              Start
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startEdit(agent)}>
              <Pencil />
              Edit…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void validate(agent)}>
              <ShieldCheck />
              Check CLI
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => startDelete(agent)}>
              <Trash2 />
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
