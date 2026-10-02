import type { ReactNode } from 'react';
import { APP_NAME } from '@vcode/shared';
import { Bot, FolderGit2, FolderPlus, Layers, Plus, Settings } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { Separator } from '@renderer/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';

export function Sidebar() {
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
          <SidebarSection title="Projects" actionLabel="Add project">
            <EmptyHint icon={<FolderGit2 />}>No projects yet</EmptyHint>
          </SidebarSection>
          <SidebarSection title="Agents" actionLabel="Add agent">
            <EmptyHint icon={<Bot />}>No agents configured</EmptyHint>
          </SidebarSection>
          <SidebarSection title="Workspaces">
            <EmptyHint icon={<FolderPlus />}>Select a project first</EmptyHint>
          </SidebarSection>
        </nav>
      </ScrollArea>

      <Separator className="bg-sidebar-border" />

      <div className="p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
          <Settings />
          Settings
        </Button>
      </div>
    </aside>
  );
}

interface SidebarSectionProps {
  title: string;
  actionLabel?: string;
  children: ReactNode;
}

function SidebarSection({ title, actionLabel, children }: SidebarSectionProps) {
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
