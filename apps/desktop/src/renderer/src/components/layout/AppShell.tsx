import { TooltipProvider } from '@renderer/components/ui/tooltip';
import { MainArea } from './MainArea';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

export function AppShell() {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="grid h-full grid-cols-[248px_1fr] grid-rows-[1fr_auto]">
        <Sidebar />
        <MainArea />
        <StatusBar className="col-span-2" />
      </div>
    </TooltipProvider>
  );
}
