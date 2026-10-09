import { Toaster } from '@renderer/components/ui/sonner';
import { TooltipProvider } from '@renderer/components/ui/tooltip';
import { AgentsProvider } from '@renderer/features/agents/AgentsProvider';
import { ProjectsProvider } from '@renderer/features/projects/ProjectsProvider';
import { AppNotices } from './AppNotices';
import { MainArea } from './MainArea';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

export function AppShell() {
  return (
    <TooltipProvider delayDuration={300}>
      <ProjectsProvider>
        <AgentsProvider>
          <div className="grid h-full grid-cols-[248px_1fr] grid-rows-[1fr_auto]">
            <Sidebar />
            <MainArea />
            <StatusBar className="col-span-2" />
          </div>
        </AgentsProvider>
      </ProjectsProvider>
      <Toaster position="bottom-right" />
      <AppNotices />
    </TooltipProvider>
  );
}
