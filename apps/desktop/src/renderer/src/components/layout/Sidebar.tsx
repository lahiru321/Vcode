import { useState, type ReactNode } from 'react';
import { APP_NAME } from '@vcode/shared';
import { FolderPlus, KeyRound, Layers, Plus, Settings } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { Separator } from '@renderer/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { AgentList } from '@renderer/features/agents/AgentList';
import { useAgents } from '@renderer/features/agents/AgentsProvider';
import { ApiKeysDialog } from '@renderer/features/credentials/ApiKeysDialog';
import { ProjectList } from '@renderer/features/projects/ProjectList';
import { useProjects } from '@renderer/features/projects/ProjectsProvider';

export function Sidebar() {
  const { startAdd, selected } = useProjects();
  const agents = useAgents();
  const [keysOpen, setKeysOpen] = useState(false);

  return (
    <aside className="flex min-h-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center gap-2 px-4">
        <div className="flex size-6 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <Layers className="size-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-tight">{APP_NAME}</span>
      </div>

      <Separator className="bg-sidebar-border" />

      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-5 p-3">
          <SidebarSection title="Projects" actionLabel="Add project" onAction={startAdd}>
            <ProjectList />
          </SidebarSection>
          <SidebarSection title="Agents" actionLabel="Add agent" onAction={agents.startAdd}>
            <AgentList />
          </SidebarSection>
          <SidebarSection title="Workspaces">
            <EmptyHint icon={<FolderPlus />}>
              {selected ? 'No workspaces yet' : 'Select a project first'}
            </EmptyHint>
          </SidebarSection>
        </nav>
      </ScrollArea>

      <Separator className="bg-sidebar-border" />

      <div className="flex flex-col gap-0.5 p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={() => setKeysOpen(true)}
        >
          <KeyRound />
          API keys
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
          <Settings />
          Settings
        </Button>
      </div>
      <ApiKeysDialog
        open={keysOpen}
        onClose={() => setKeysOpen(false)}
        onChanged={() => void agents.reload()}
      />
    </aside>
  );
}

interface SidebarSectionProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}

function SidebarSection({ title, actionLabel, onAction, children }: SidebarSectionProps) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex h-6 items-center justify-between pl-2">
        <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
        {actionLabel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground"
                aria-label={actionLabel}
                disabled={!onAction}
                onClick={onAction}
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{actionLabel}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
      {icon}
      {children}
    </div>
  );
}
