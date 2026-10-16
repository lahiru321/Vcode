import type { Workspace, WorkspaceKind } from '@vcode/shared';
import {
  AlertTriangle,
  Folder,
  FolderGit2,
  FolderRoot,
  MoreHorizontal,
  RotateCw,
  SquareTerminal,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { useWorkspaces } from './WorkspacesProvider';

// Workspace rows for the sidebar's Workspaces section (P6-02): the selected project's `main`
// folder, then its other workspaces. Click opens the New terminal dialog there; ▶ a shell.

const KIND_ICON: Record<WorkspaceKind, typeof Folder> = {
  main: FolderRoot,
  folder: Folder,
  worktree: FolderGit2,
};

const PROBLEM: Partial<Record<Workspace['status'], string>> = {
  missing: 'Folder missing',
  error: 'Folder is no longer inside the project',
};

export function WorkspaceList() {
  const { workspaces, loaded, loadError, reload } = useWorkspaces();

  if (loadError) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 text-xs">
        <span className="text-destructive">Couldn’t load workspaces.</span>
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
  return (
    <div className="flex flex-col gap-0.5">
      {workspaces.map((workspace) => (
        <WorkspaceRow key={workspace.id} workspace={workspace} />
      ))}
    </div>
  );
}

function WorkspaceRow({ workspace }: { workspace: Workspace }) {
  const { launcher, startDelete, changes } = useWorkspaces();
  const changed = changes[workspace.id] ?? 0;
  const changedLabel = changed === 1 ? '1 uncommitted change' : `${changed} uncommitted changes`;
  const Icon = KIND_ICON[workspace.kind];
  const problem = PROBLEM[workspace.status];
  const usable = launcher !== null && !problem;
  const deletable = workspace.kind !== 'main';
  const shellHint = !launcher
    ? 'Select an active project to open terminals'
    : problem
      ? problem
      : `Open a shell in ${workspace.name}`;

  return (
    <div className="group/row relative flex h-8 items-center rounded-md text-sm hover:bg-sidebar-accent/50">
      <button
        type="button"
        title={[workspace.path, workspace.branch, changed > 0 && changedLabel, problem]
          .filter(Boolean)
          .join(' · ')}
        disabled={!usable}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-14 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:cursor-default"
        onClick={() => launcher?.openDialog(workspace)}
        onKeyDown={(event) => {
          if (event.key === 'Delete' && deletable) {
            event.preventDefault();
            startDelete(workspace);
          }
        }}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{workspace.name}</span>
        {workspace.branch && (
          <span className="min-w-0 shrink truncate font-mono text-[11px] text-muted-foreground">
            {workspace.branch}
          </span>
        )}
        {changed > 0 && (
          <span
            aria-label={changedLabel}
            className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-warning"
          >
            <span className="size-1.5 rounded-full bg-warning" />
            {changed}
          </span>
        )}
        {problem && (
          <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label={problem} />
        )}
      </button>

      <div className="absolute right-1 flex items-center">
        <Button
          variant="ghost"
          size="icon"
          aria-label={shellHint}
          title={shellHint}
          disabled={!usable}
          className="size-6 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          onClick={() => void launcher?.openShell(workspace)}
        >
          <SquareTerminal className="size-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${workspace.name}`}
              className="size-6 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-52">
            <DropdownMenuItem
              disabled={!usable}
              onSelect={() => void launcher?.openShell(workspace)}
            >
              <SquareTerminal />
              Open shell here
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!usable} onSelect={() => launcher?.openDialog(workspace)}>
              <TerminalSquare />
              New terminal here…
            </DropdownMenuItem>
            {deletable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => startDelete(workspace)}>
                  <Trash2 />
                  Delete…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
