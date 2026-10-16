import {
  slugify,
  type CreateWorkspaceRequest,
  type Project,
  type Workspace,
  type WorkspaceChanges,
} from '@vcode/shared';
import { AlertTriangle, FolderOpen } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@renderer/components/ui/alert-dialog';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { NativeOption, NativeSelect } from '@renderer/components/ui/native-select';
import { errorMessage, Field, FormError, useSubmit } from '@renderer/lib/form';
import { invoke } from '@renderer/lib/ipc';

const MAX_NAME_LENGTH = 60;

/** `root` + segments, with the separator `root` already uses. */
function joinPath(root: string, ...segments: string[]): string {
  const sep = root.includes('\\') ? '\\' : '/';
  return [root.replace(/[\\/]+$/, ''), ...segments].join(sep);
}

/** A create request without the project, which the provider adds. */
export type NewWorkspace = CreateWorkspaceRequest extends infer Request
  ? Request extends CreateWorkspaceRequest
    ? Omit<Request, 'projectId'>
    : never
  : never;

// ── Create ───────────────────────────────────────────────────────────────────────────────

type Location = 'new' | 'existing' | 'worktree';

interface CreateWorkspaceDialogProps {
  open: boolean;
  project: Project | null;
  onCreate: (request: NewWorkspace) => Promise<void>;
  onClose: () => void;
}

export function CreateWorkspaceDialog({
  open,
  project,
  onCreate,
  onClose,
}: CreateWorkspaceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        {open && project && <CreateWorkspaceForm project={project} onCreate={onCreate} />}
      </DialogContent>
    </Dialog>
  );
}

/** Whether the project is a Git repository (null while checking). */
function useIsRepository(projectId: string): boolean | null {
  const [isRepository, setIsRepository] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    invoke('repositories:get', { projectId }).then(
      (repository) => !cancelled && setIsRepository(repository !== null),
      () => !cancelled && setIsRepository(false),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return isRepository;
}

function CreateWorkspaceForm({
  project,
  onCreate,
}: {
  project: Project;
  onCreate: CreateWorkspaceDialogProps['onCreate'];
}) {
  const ids = useId();
  const isRepository = useIsRepository(project.id);
  const [name, setName] = useState('');
  const [location, setLocation] = useState<Location>('new');
  const [folder, setFolder] = useState<string | null>(null);
  // Follows the name until it's edited.
  const [branch, setBranch] = useState<string | null>(null);
  const [startPoint, setStartPoint] = useState('');
  const [pickError, setPickError] = useState<string | null>(null);
  const branchName = branch ?? slugify(name, '');
  const { pending, error, submit } = useSubmit(() =>
    onCreate(
      location === 'worktree'
        ? {
            name: name.trim(),
            kind: 'worktree',
            branch: branchName.trim(),
            startPoint: startPoint.trim() || undefined,
          }
        : {
            name: name.trim(),
            kind: 'folder',
            path: location === 'existing' ? (folder ?? undefined) : undefined,
          },
    ),
  );

  const pick = async () => {
    setPickError(null);
    try {
      const { path } = await invoke('dialog:pickFolder');
      if (path) {
        setFolder(path);
        // Named after the folder until a name is typed.
        if (!name.trim()) setName(path.split(/[\\/]/).filter(Boolean).pop() ?? '');
      }
    } catch (err) {
      setPickError(errorMessage(err));
    }
  };

  const newFolder = joinPath(project.rootPath, 'workspaces', slugify(name, 'workspace'));
  const ready =
    name.trim().length > 0 &&
    (location === 'new' ||
      (location === 'existing' && folder !== null) ||
      (location === 'worktree' && branchName.trim().length > 0));
  const locationHint = {
    new: `${newFolder} (created if it doesn't exist)`,
    existing: 'Must be inside the project folder.',
    worktree: `${newFolder}, with its own branch checked out (git worktree).`,
  }[location];

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New workspace</DialogTitle>
        <DialogDescription>
          A folder inside “{project.name}” that terminals and agents can work in, apart from the
          main folder.
        </DialogDescription>
      </DialogHeader>

      <Field label="Name" htmlFor={`${ids}-name`}>
        <Input
          id={`${ids}-name`}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="e.g. Claude backend"
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field label="Folder" htmlFor={`${ids}-location`} hint={locationHint}>
        <NativeSelect
          id={`${ids}-location`}
          value={location}
          onChange={(event) => setLocation(event.target.value as Location)}
        >
          <NativeOption value="new">New folder in workspaces/</NativeOption>
          <NativeOption value="existing">A folder already in the project…</NativeOption>
          <NativeOption value="worktree" disabled={isRepository !== true}>
            {isRepository === false
              ? 'Git worktree (the project isn’t a Git repository)'
              : 'Git worktree on its own branch'}
          </NativeOption>
        </NativeSelect>
      </Field>

      {location === 'existing' && (
        <div className="flex items-center gap-2">
          <div className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono break-all">{folder ?? 'No folder chosen'}</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void pick()}>
            Browse…
          </Button>
        </div>
      )}

      {location === 'worktree' && (
        <>
          <Field
            label="Branch"
            htmlFor={`${ids}-branch`}
            hint="Created if it doesn't exist; an existing branch is checked out as it is."
          >
            <Input
              id={`${ids}-branch`}
              value={branchName}
              maxLength={200}
              placeholder="e.g. claude/backend"
              className="font-mono"
              onChange={(event) => setBranch(event.target.value)}
            />
          </Field>
          <Field
            label="Start from"
            htmlFor={`${ids}-start`}
            hint="For a new branch: a branch, tag or commit. Empty: what the main folder has checked out."
          >
            <Input
              id={`${ids}-start`}
              value={startPoint}
              maxLength={200}
              placeholder={project.defaultBranch ?? 'HEAD'}
              className="font-mono"
              onChange={(event) => setStartPoint(event.target.value)}
            />
          </Field>
        </>
      )}

      <FormError message={pickError ?? error} />

      <DialogFooter>
        <Button type="submit" disabled={pending || !ready}>
          {pending ? 'Adding…' : 'Add workspace'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Delete ───────────────────────────────────────────────────────────────────────────────

interface DeleteWorkspaceDialogProps {
  workspace: Workspace | null;
  /** `force`: a worktree goes even with uncommitted changes. */
  onDelete: (workspace: Workspace, force: boolean) => Promise<void>;
  onClose: () => void;
}

export function DeleteWorkspaceDialog({
  workspace,
  onDelete,
  onClose,
}: DeleteWorkspaceDialogProps) {
  return (
    <AlertDialog open={workspace !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        {workspace && (
          <DeleteWorkspaceBody key={workspace.id} workspace={workspace} onDelete={onDelete} />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A worktree's uncommitted changes, checked when the dialog opens. */
function useChanges(workspace: Workspace) {
  const checks = workspace.kind === 'worktree' && workspace.status === 'ready';
  const [state, setState] = useState<{ changes: WorkspaceChanges | null; error: string | null }>({
    changes: null,
    error: null,
  });
  useEffect(() => {
    if (!checks) return;
    let cancelled = false;
    invoke('workspaces:changes', { id: workspace.id }).then(
      (changes) => !cancelled && setState({ changes, error: null }),
      (error: unknown) => !cancelled && setState({ changes: null, error: errorMessage(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [checks, workspace.id]);
  return { checks, ...state };
}

function DeleteWorkspaceBody({
  workspace,
  onDelete,
}: {
  workspace: Workspace;
  onDelete: DeleteWorkspaceDialogProps['onDelete'];
}) {
  const { checks, changes, error: changesError } = useChanges(workspace);
  const dirty = (changes?.count ?? 0) > 0;
  const { pending, error, submit } = useSubmit(() => onDelete(workspace, dirty));
  const checking = checks && changes === null && changesError === null;

  let description: string;
  if (workspace.kind !== 'worktree') {
    description =
      'It is removed from Vcode, with the history of terminals that ran in it. The folder and every file in it stay on disk.';
  } else if (workspace.status === 'ready') {
    description = `Its worktree folder is removed with git, along with the history of terminals that ran in it. ${
      workspace.branch
        ? `The branch “${workspace.branch}” stays, with everything committed to it.`
        : 'Commits stay in the repository.'
    }`;
  } else {
    description =
      'It is removed from Vcode, with the history of terminals that ran in it. Its folder isn’t where it should be, so nothing on disk is touched.';
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete workspace “{workspace.name}”?</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
        {workspace.path}
      </div>
      {dirty && changes && (
        <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {changes.count === 1
              ? '1 uncommitted change will be lost'
              : `${changes.count} uncommitted changes will be lost`}
          </p>
          <ul className="max-h-32 overflow-y-auto font-mono text-xs text-muted-foreground">
            {changes.files.map((file) => (
              <li key={file} className="truncate" title={file}>
                {file}
              </li>
            ))}
            {changes.count > changes.files.length && (
              <li>…and {changes.count - changes.files.length} more</li>
            )}
          </ul>
        </div>
      )}
      <FormError message={changesError ?? error} />
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          disabled={pending || checking || changesError !== null}
          onClick={(event) => {
            // Keep the dialog open until the delete has finished (or failed).
            event.preventDefault();
            void submit();
          }}
        >
          {pending
            ? 'Deleting…'
            : checking
              ? 'Checking for changes…'
              : dirty
                ? 'Delete anyway'
                : 'Delete workspace'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
