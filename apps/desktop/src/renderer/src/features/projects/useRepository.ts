import type { Project, Repository } from '@vcode/shared';
import { useEffect, useState } from 'react';
import { invoke } from '@renderer/lib/ipc';
import { useProjects } from './ProjectsProvider';

/**
 * The project's Git repository, detected again each time the project opens (the folder may have
 * become a repository, or changed branch, since it was added). Null while loading and for a
 * plain folder. When the default branch changed, the project list is reloaded so the sidebar
 * and header show the new one.
 */
export function useRepository(project: Project): Repository | null {
  const { reload } = useProjects();
  const [repository, setRepository] = useState<Repository | null>(null);
  const { id, defaultBranch } = project;

  useEffect(() => {
    let cancelled = false;
    invoke('repositories:get', { projectId: id }).then(
      (detected) => {
        if (cancelled) return;
        setRepository(detected);
        if ((detected?.defaultBranch ?? null) !== defaultBranch) void reload();
      },
      (error: unknown) => console.warn('Could not detect the repository', error),
    );
    return () => {
      cancelled = true;
    };
  }, [id, defaultBranch, reload]);

  return repository;
}
