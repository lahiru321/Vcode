import type { Workspace } from '@vcode/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { useProjects } from '@renderer/features/projects/ProjectsProvider';
import { errorMessage } from '@renderer/lib/form';
import { invoke } from '@renderer/lib/ipc';
import {
  CreateWorkspaceDialog,
  DeleteWorkspaceDialog,
  type NewWorkspace,
} from './WorkspaceDialogs';

// The workspace manager (P6-02, V1 doc §17): the selected project's workspaces in the sidebar,
// with create, delete, and opening a terminal in one.

/** How the project view opens terminals in a workspace; it registers itself while shown. */
export interface WorkspaceLauncher {
  /** A plain shell in the workspace, in a new panel. */
  openShell: (workspace: Workspace) => Promise<void>;
  /** The New terminal dialog, with the workspace chosen. */
  openDialog: (workspace: Workspace) => void;
}

interface WorkspacesContextValue {
  workspaces: Workspace[];
  loaded: boolean;
  loadError: string | null;
  reload: () => Promise<void>;
  startCreate: () => void;
  startDelete: (workspace: Workspace) => void;
  /** Null when no active project is on screen. */
  launcher: WorkspaceLauncher | null;
  registerLauncher: (launcher: WorkspaceLauncher) => () => void;
}

type DialogState = { kind: 'create' } | { kind: 'delete'; workspace: Workspace } | null;

const WorkspacesContext = createContext<WorkspacesContextValue | null>(null);

export function useWorkspaces(): WorkspacesContextValue {
  const value = useContext(WorkspacesContext);
  if (!value) {
    throw new Error('useWorkspaces must be used inside <WorkspacesProvider>');
  }
  return value;
}

export function WorkspacesProvider({ children }: { children: ReactNode }) {
  const { selected } = useProjects();
  const projectId = selected?.id ?? null;
  const [list, setList] = useState<{ projectId: string | null; workspaces: Workspace[] }>({
    projectId: null,
    workspaces: [],
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [launcher, setLauncher] = useState<WorkspaceLauncher | null>(null);
  const latest = useRef(projectId);
  useEffect(() => {
    latest.current = projectId;
  }, [projectId]);

  const reload = useCallback(
    () =>
      projectId === null
        ? Promise.resolve()
        : invoke('workspaces:list', { projectId }).then(
            (workspaces) => {
              // A slow answer for a project that is no longer selected is dropped.
              if (latest.current !== projectId) return;
              setList({ projectId, workspaces });
              setLoadError(null);
            },
            (error: unknown) => {
              if (latest.current === projectId) setLoadError(errorMessage(error));
            },
          ),
    [projectId],
  );

  // Folders can disappear while the app is in the background; check again on focus.
  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const create = useCallback(
    async (request: NewWorkspace) => {
      if (!projectId) return;
      const workspace = await invoke('workspaces:create', { projectId, ...request });
      await reload();
      setDialog(null);
      toast.success(`Added workspace “${workspace.name}”`, { description: workspace.path });
    },
    [projectId, reload],
  );

  const remove = useCallback(
    async (workspace: Workspace, force: boolean) => {
      const { removedFolder } = await invoke('workspaces:delete', {
        id: workspace.id,
        ...(force ? { force } : {}),
      });
      await reload();
      setDialog(null);
      toast.success(`Deleted workspace “${workspace.name}”`, {
        description: !removedFolder
          ? 'Its folder is still on disk.'
          : workspace.branch
            ? `Worktree folder removed; the branch “${workspace.branch}” is kept.`
            : 'Worktree folder removed.',
      });
    },
    [reload],
  );

  const registerLauncher = useCallback((next: WorkspaceLauncher) => {
    setLauncher(() => next);
    return () => setLauncher((current) => (current === next ? null : current));
  }, []);

  const loaded = projectId !== null && list.projectId === projectId;
  const value = useMemo<WorkspacesContextValue>(
    () => ({
      workspaces: loaded ? list.workspaces : [],
      loaded,
      loadError,
      reload,
      startCreate: () => setDialog({ kind: 'create' }),
      startDelete: (workspace) => setDialog({ kind: 'delete', workspace }),
      launcher,
      registerLauncher,
    }),
    [loaded, list, loadError, reload, launcher, registerLauncher],
  );

  const close = () => setDialog(null);

  return (
    <WorkspacesContext.Provider value={value}>
      {children}
      <CreateWorkspaceDialog
        open={dialog?.kind === 'create' && selected !== null}
        project={selected}
        onCreate={create}
        onClose={close}
      />
      <DeleteWorkspaceDialog
        workspace={dialog?.kind === 'delete' ? dialog.workspace : null}
        onDelete={remove}
        onClose={close}
      />
    </WorkspacesContext.Provider>
  );
}
