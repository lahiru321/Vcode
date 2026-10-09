import type { Project } from '@vcode/shared';
import {
  ArchiveRestore,
  Bot,
  FolderGit2,
  GitBranch,
  MoreHorizontal,
  Plus,
  TerminalSquare,
} from 'lucide-react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { useProjects } from '@renderer/features/projects/ProjectsProvider';
import { TerminalTabs } from '@renderer/features/terminals/TerminalTabs';
import { TerminalView } from '@renderer/features/terminals/TerminalView';
import {
  useProjectTerminals,
  type ProjectTerminals,
} from '@renderer/features/terminals/useProjectTerminals';

export function MainArea() {
  const { loaded, projects, selected } = useProjects();

  return (
    <main className="flex min-h-0 min-w-0 flex-col">
      {selected ? (
        <ProjectView key={selected.id} project={selected} />
      ) : (
        <>
          <header className="flex h-12 shrink-0 items-center border-b px-4">
            <span className="text-sm text-muted-foreground">No project selected</span>
          </header>
          {loaded && projects.length === 0 && <FirstProjectEmptyState />}
        </>
      )}
    </main>
  );
}

function ProjectView({ project }: { project: Project }) {
  const { setArchived, startRename } = useProjects();
  const terminals = useProjectTerminals(project);
  const isArchived = project.status === 'archived';

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1
            className="max-w-64 shrink-0 truncate text-sm font-semibold"
            title="Rename (F2 in the sidebar)"
            onDoubleClick={() => startRename(project)}
          >
            {project.name}
          </h1>
          {project.defaultBranch && (
            <Badge variant="secondary" className="shrink-0 gap-1 font-mono font-normal">
              <GitBranch />
              {project.defaultBranch}
            </Badge>
          )}
          {isArchived && (
            <Badge variant="outline" className="shrink-0 text-muted-foreground">
              Archived
            </Badge>
          )}
          <span
            className="hidden min-w-0 truncate font-mono text-xs text-muted-foreground lg:inline"
            title={project.rootPath}
          >
            {project.rootPath}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isArchived && (
            <Button size="sm" variant="outline" onClick={() => void setArchived(project, false)}>
              <ArchiveRestore />
              Restore
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={isArchived}
            title={isArchived ? 'Restore the project to open terminals' : undefined}
            onClick={() => void terminals.create()}
          >
            <TerminalSquare />
            New terminal
          </Button>
          <Button
            size="sm"
            disabled={isArchived}
            title={
              isArchived
                ? 'Restore the project to start agents'
                : "Run Claude Code in the project's folder"
            }
            onClick={() => void terminals.startClaude()}
          >
            <Bot />
            Start Claude Code
          </Button>
        </div>
      </header>

      {terminals.terminals.length > 0 ? (
        <TerminalsArea terminals={terminals} />
      ) : (
        terminals.loaded && <NoTerminalsEmptyState />
      )}
    </>
  );
}

function TerminalsArea({ terminals }: { terminals: ProjectTerminals }) {
  return (
    <>
      <TerminalTabs
        terminals={terminals.terminals}
        activeId={terminals.activeId}
        onActivate={terminals.activate}
        onCreate={() => void terminals.create()}
        onStop={(id) => void terminals.stop(id)}
        onRestart={(id) => void terminals.restart(id)}
        onClose={(id) => void terminals.close(id)}
      />
      <div className="relative min-h-0 flex-1 bg-[#0a0a0a]">
        {terminals.terminals.map((terminal) => (
          <TerminalView
            key={terminal.id}
            terminalId={terminal.id}
            active={terminal.id === terminals.activeId}
            onExit={(exitCode) => terminals.markExited(terminal.id, exitCode)}
          />
        ))}
      </div>
    </>
  );
}

function NoTerminalsEmptyState() {
  return (
    <>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl border bg-card text-muted-foreground">
            <TerminalSquare className="size-6" />
          </div>
          <h2 className="text-base font-semibold tracking-tight">No terminals open</h2>
          <p className="text-sm text-muted-foreground">
            Start Claude Code or open a terminal in this project's folder. Each runs in its own tab.
          </p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            Project actions are in the
            <MoreHorizontal className="size-3.5" aria-label="more" />
            menu next to its name in the sidebar.
          </p>
        </div>
      </div>
    </>
  );
}

function FirstProjectEmptyState() {
  const { startAdd } = useProjects();

  return (
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
        <Button onClick={() => void startAdd()}>
          <Plus />
          Add project
        </Button>
      </div>
    </div>
  );
}
