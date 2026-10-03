import type { CreateProjectRequest, Project } from '@vcode/shared';
import { invoke } from '@renderer/lib/ipc';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { AddProjectDialog, RemoveProjectDialog, RenameProjectDialog } from './ProjectDialogs';

type DialogState =
  | { kind: 'add'; folder: string }
  | { kind: 'rename'; project: Project }
  | { kind: 'remove'; project: Project }
  | null;

interface ProjectsContextValue {
  projects: Project[];
  /** Null until the first load finishes. */
  loaded: boolean;
  loadError: string | null;
  selected: Project | null;
  select: (id: string) => void;
  reload: () => Promise<void>;
  /** Opens the folder picker, then the Add project dialog. */
  startAdd: () => Promise<void>;
  startRename: (project: Project) => void;
  startRemove: (project: Project) => void;
  setArchived: (project: Project, archived: boolean) => Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function useProjects(): ProjectsContextValue {
  const value = useContext(ProjectsContext);
  if (!value) {
    throw new Error('useProjects must be used inside <ProjectsProvider>');
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The first active project, or else the first one at all. */
function defaultSelection(projects: Project[]): string | null {
  return (projects.find((p) => p.status === 'active') ?? projects[0])?.id ?? null;
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  /** `savedId`: the selection from the last session, used if nothing is selected yet. */
  const applyList = useCallback((list: Project[], savedId: string | null = null) => {
    setProjects(list);
    setLoadError(null);
    setLoaded(true);
    setSelectedId((current) => {
      const wanted = current ?? savedId;
      return wanted && list.some((p) => p.id === wanted) ? wanted : defaultSelection(list);
    });
  }, []);

  const applyLoadError = useCallback((error: unknown) => {
    setLoadError(errorMessage(error));
    setLoaded(true);
  }, []);

  const reload = useCallback(
    () => invoke('projects:list').then(applyList, applyLoadError),
    [applyList, applyLoadError],
  );

  useEffect(() => {
    // A settings failure only loses the remembered selection, so it doesn't block the list.
    const savedId = invoke('settings:get').then(
      (settings) => settings.selectedProjectId,
      () => null,
    );
    Promise.all([invoke('projects:list'), savedId]).then(
      ([list, id]) => applyList(list, id),
      applyLoadError,
    );
  }, [applyList, applyLoadError]);

  // Remember the selection for the next launch. Skipped until the list has loaded, so the
  // saved value isn't overwritten by the initial empty selection.
  useEffect(() => {
    if (!loaded || loadError) {
      return;
    }
    invoke('settings:set', { selectedProjectId: selectedId }).catch((error: unknown) => {
      console.warn('Could not save the selected project:', errorMessage(error));
    });
  }, [loaded, loadError, selectedId]);

  const startAdd = useCallback(async () => {
    try {
      const { path } = await invoke('dialog:pickFolder');
      if (path) {
        setDialog({ kind: 'add', folder: path });
      }
    } catch (error) {
      toast.error('Could not open the folder picker', { description: errorMessage(error) });
    }
  }, []);

  const create = useCallback(
    async (request: CreateProjectRequest) => {
      const project = await invoke('projects:create', request);
      await reload();
      setSelectedId(project.id);
      setDialog(null);
    },
    [reload],
  );

  const rename = useCallback(
    async (project: Project, name: string) => {
      await invoke('projects:update', { id: project.id, name });
      await reload();
      setDialog(null);
    },
    [reload],
  );

  const remove = useCallback(
    async (project: Project) => {
      await invoke('projects:delete', { id: project.id });
      setSelectedId((current) => (current === project.id ? null : current));
      await reload();
      setDialog(null);
      toast.success(`Removed “${project.name}”`, { description: 'The folder is still on disk.' });
    },
    [reload],
  );

  const setArchived = useCallback(
    async (project: Project, archived: boolean) => {
      try {
        await invoke('projects:update', {
          id: project.id,
          status: archived ? 'archived' : 'active',
        });
        await reload();
      } catch (error) {
        toast.error(`Could not ${archived ? 'archive' : 'restore'} “${project.name}”`, {
          description: errorMessage(error),
        });
      }
    },
    [reload],
  );

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      loaded,
      loadError,
      selected: projects.find((p) => p.id === selectedId) ?? null,
      select: setSelectedId,
      reload,
      startAdd,
      startRename: (project) => setDialog({ kind: 'rename', project }),
      startRemove: (project) => setDialog({ kind: 'remove', project }),
      setArchived,
    }),
    [projects, loaded, loadError, selectedId, reload, startAdd, setArchived],
  );

  const close = () => setDialog(null);

  return (
    <ProjectsContext.Provider value={value}>
      {children}
      <AddProjectDialog
        folder={dialog?.kind === 'add' ? dialog.folder : null}
        onCreate={create}
        onClose={close}
      />
      <RenameProjectDialog
        project={dialog?.kind === 'rename' ? dialog.project : null}
        onRename={rename}
        onClose={close}
      />
      <RemoveProjectDialog
        project={dialog?.kind === 'remove' ? dialog.project : null}
        onRemove={remove}
        onClose={close}
      />
    </ProjectsContext.Provider>
  );
}
