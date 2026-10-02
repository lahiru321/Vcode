import { FolderGit2, Plus, TerminalSquare } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';

export function MainArea() {
  return (
    <main className="flex min-h-0 min-w-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="text-sm text-muted-foreground">No project selected</span>
        <Button size="sm" variant="secondary" disabled>
          <TerminalSquare />
          New terminal
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl border bg-card text-muted-foreground">
            <FolderGit2 className="size-6" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight">Add your first project</h1>
            <p className="text-sm text-muted-foreground">
              Pick a local folder or Git repository. Then launch AI coding agents in their own
              terminals, side by side.
            </p>
          </div>
          <Button>
            <Plus />
            Add project
          </Button>
        </div>
      </div>
    </main>
  );
}
