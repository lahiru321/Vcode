import type { Project } from '@vcode/shared';
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Folder,
  FolderGit2,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { cn } from '@renderer/lib/utils';
import { useProjects } from './ProjectsProvider';

/** Project rows for the sidebar's Projects section. */
export function ProjectList() {
  const { projects, loaded, loadError, reload } = useProjects();
  const [showArchived, setShowArchived] = useState(false);

  if (loadError) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 text-xs">
        <span className="text-destructive">Couldn’t load projects.</span>
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

  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status === 'archived');

  return (
    <div className="flex flex-col gap-0.5">
      {active.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {archived.length > 0 ? 'All projects are archived' : 'No projects yet'}
        </p>
      )}
      {active.map((project) => (
        <ProjectRow key={project.id} project={project} />
      ))}

      {archived.length > 0 && (
        <>
          <button
            type="button"
            className="mt-1 flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((open) => !open)}
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', showArchived && 'rotate-90')}
            />
            Archived ({archived.length})
          </button>
          {showArchived &&
            archived.map((project) => <ProjectRow key={project.id} project={project} />)}
        </>
      )}
    </div>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const { selected, select, startRename, startRemove, setArchived } = useProjects();
  const isSelected = selected?.id === project.id;
  const isArchived = project.status === 'archived';
  const Icon = project.defaultBranch ? FolderGit2 : Folder;

  return (
    <div
      className={cn(
        'group/row relative flex h-8 items-center rounded-md text-sm',
        isSelected
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'hover:bg-sidebar-accent/50',
        isArchived && 'text-muted-foreground',
      )}
    >
      <button
        type="button"
        title={project.rootPath}
        aria-current={isSelected ? 'page' : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-8 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        onClick={() => select(project.id)}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            startRename(project);
          } else if (event.key === 'Delete') {
            event.preventDefault();
            startRemove(project);
          }
        }}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{project.name}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${project.name}`}
            className={cn(
              'absolute right-1 size-6 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
              isSelected && 'opacity-100',
            )}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-52">
          <DropdownMenuItem onSelect={() => startRename(project)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void setArchived(project, !isArchived)}>
            {isArchived ? <ArchiveRestore /> : <Archive />}
            {isArchived ? 'Restore' : 'Archive'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => startRemove(project)}>
            <Trash2 />
            Remove from Vcode…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
