import type { CreateProjectRequest, Project } from '@vcode/shared';
import { FolderOpen, GitBranch } from 'lucide-react';
import { useState } from 'react';
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
import { Label } from '@renderer/components/ui/label';
import { FormError, useSubmit } from '@renderer/lib/form';

const MAX_NAME_LENGTH = 100;

/** Last segment of a Windows or POSIX path. */
function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function NameField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="project-name">Name</Label>
      <Input
        id="project-name"
        value={value}
        maxLength={MAX_NAME_LENGTH}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

// ── Add ──────────────────────────────────────────────────────────────────────────────────

interface AddProjectDialogProps {
  folder: string | null;
  onCreate: (request: CreateProjectRequest) => Promise<void>;
  onClose: () => void;
}

export function AddProjectDialog({ folder, onCreate, onClose }: AddProjectDialogProps) {
  return (
    <Dialog open={folder !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {folder && <AddProjectForm key={folder} folder={folder} onCreate={onCreate} />}
      </DialogContent>
    </Dialog>
  );
}

function AddProjectForm({
  folder,
  onCreate,
}: {
  folder: string;
  onCreate: AddProjectDialogProps['onCreate'];
}) {
  const [name, setName] = useState(() => folderName(folder).slice(0, MAX_NAME_LENGTH));
  const { pending, error, submit } = useSubmit(() =>
    onCreate({ rootPath: folder, name: name.trim() }),
  );

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add project</DialogTitle>
        <DialogDescription>
          Vcode keeps a reference to this folder. Nothing in it is changed.
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
        <FolderOpen className="mt-px size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono break-all">{folder}</span>
      </div>

      <NameField value={name} onChange={setName} />
      <FormError message={error} />

      <DialogFooter>
        <Button type="submit" disabled={pending || name.trim().length === 0}>
          {pending ? 'Adding…' : 'Add project'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Rename ───────────────────────────────────────────────────────────────────────────────

interface RenameProjectDialogProps {
  project: Project | null;
  onRename: (project: Project, name: string) => Promise<void>;
  onClose: () => void;
}

export function RenameProjectDialog({ project, onRename, onClose }: RenameProjectDialogProps) {
  return (
    <Dialog open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {project && <RenameProjectForm key={project.id} project={project} onRename={onRename} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameProjectForm({
  project,
  onRename,
}: {
  project: Project;
  onRename: RenameProjectDialogProps['onRename'];
}) {
  const [name, setName] = useState(project.name);
  const { pending, error, submit } = useSubmit(() => onRename(project, name.trim()));
  const unchanged = name.trim() === project.name;

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Rename project</DialogTitle>
        <DialogDescription>Only the name shown in Vcode changes, not the folder.</DialogDescription>
      </DialogHeader>
      <NameField value={name} onChange={setName} />
      <FormError message={error} />
      <DialogFooter>
        <Button type="submit" disabled={pending || unchanged || name.trim().length === 0}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Remove ───────────────────────────────────────────────────────────────────────────────

interface RemoveProjectDialogProps {
  project: Project | null;
  onRemove: (project: Project) => Promise<void>;
  onClose: () => void;
}

export function RemoveProjectDialog({ project, onRemove, onClose }: RemoveProjectDialogProps) {
  return (
    <AlertDialog open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        {project && <RemoveProjectBody key={project.id} project={project} onRemove={onRemove} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RemoveProjectBody({
  project,
  onRemove,
}: {
  project: Project;
  onRemove: RemoveProjectDialogProps['onRemove'];
}) {
  const { pending, error, submit } = useSubmit(() => onRemove(project));

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove “{project.name}” from Vcode?</AlertDialogTitle>
        <AlertDialogDescription>
          Its settings in Vcode are deleted. The folder and every file in it stay on disk.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="flex flex-col gap-1 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
        <span>{project.rootPath}</span>
        {project.defaultBranch && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <GitBranch className="size-3" />
            {project.defaultBranch}
          </span>
        )}
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
          {pending ? 'Removing…' : 'Remove project'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
