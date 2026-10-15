import { slugify, type CreateWorkspaceRequest, type Project, type Workspace } from '@vcode/shared';
import { FolderOpen } from 'lucide-react';
import { useId, useState } from 'react';
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

// ── Create ───────────────────────────────────────────────────────────────────────────────

type Location = 'new' | 'existing';

interface CreateWorkspaceDialogProps {
  open: boolean;
  project: Project | null;
  onCreate: (request: Omit<CreateWorkspaceRequest, 'projectId'>) => Promise<void>;
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

function CreateWorkspaceForm({
  project,
  onCreate,
}: {
  project: Project;
  onCreate: CreateWorkspaceDialogProps['onCreate'];
}) {
  const ids = useId();
  const [name, setName] = useState('');
  const [location, setLocation] = useState<Location>('new');
  const [folder, setFolder] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const { pending, error, submit } = useSubmit(() =>
    onCreate({
      name: name.trim(),
      kind: 'folder',
      path: location === 'existing' ? (folder ?? undefined) : undefined,
    }),
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
  const ready = name.trim().length > 0 && (location === 'new' || folder !== null);

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

      <Field
        label="Folder"
        htmlFor={`${ids}-location`}
        hint={
          location === 'new'
            ? `${newFolder} (created if it doesn't exist)`
            : 'Must be inside the project folder.'
        }
      >
        <NativeSelect
          id={`${ids}-location`}
          value={location}
          onChange={(event) => setLocation(event.target.value as Location)}
        >
          <NativeOption value="new">New folder in workspaces/</NativeOption>
          <NativeOption value="existing">A folder already in the project…</NativeOption>
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
  onDelete: (workspace: Workspace) => Promise<void>;
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

function DeleteWorkspaceBody({
  workspace,
  onDelete,
}: {
  workspace: Workspace;
  onDelete: DeleteWorkspaceDialogProps['onDelete'];
}) {
  const { pending, error, submit } = useSubmit(() => onDelete(workspace));

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete workspace “{workspace.name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          It is removed from Vcode, with the history of terminals that ran in it. The folder and
          every file in it stay on disk.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
        {workspace.path}
      </div>
      <FormError message={error} />
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          disabled={pending}
          onClick={(event) => {
            // Keep the dialog open until the delete has finished (or failed).
            event.preventDefault();
            void submit();
          }}
        >
          {pending ? 'Deleting…' : 'Delete workspace'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
