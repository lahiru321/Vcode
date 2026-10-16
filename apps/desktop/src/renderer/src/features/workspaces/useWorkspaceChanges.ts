import type { Workspace } from '@vcode/shared';
import { useEffect, useState } from 'react';
import { invoke } from '@renderer/lib/ipc';

/** Agents change files while the window stays focused, so focus alone isn't enough. */
const REFRESH_MS = 15_000;

/**
 * Uncommitted-change counts per workspace id (P6-06) for `projectId`'s `workspaces`, checked
 * whenever the list is loaded and every few seconds while the window is visible. Workspaces
 * that can't be checked (folder missing, not in a Git repository, git not installed) have no
 * entry.
 */
export function useWorkspaceChanges(
  projectId: string | null,
  workspaces: Workspace[],
): Record<string, number> {
  const [counts, setCounts] = useState<{ projectId: string | null; byId: Record<string, number> }>({
    projectId: null,
    byId: {},
  });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (document.hidden) return;
      const entries = await Promise.all(
        workspaces
          .filter((workspace) => workspace.status === 'ready')
          .map((workspace) =>
            invoke('workspaces:changes', { id: workspace.id }).then(
              (changes) => (changes ? ([workspace.id, changes.count] as const) : null),
              () => null,
            ),
          ),
      );
      if (!cancelled) {
        setCounts({ projectId, byId: Object.fromEntries(entries.filter((e) => e !== null)) });
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, workspaces]);

  // Counts for another project aren't shown while this one's are checked.
  return counts.projectId === projectId ? counts.byId : {};
}
