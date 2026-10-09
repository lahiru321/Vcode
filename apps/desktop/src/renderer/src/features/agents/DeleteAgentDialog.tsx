import type { Agent } from '@vcode/shared';
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
import { FormError, useSubmit } from '@renderer/lib/form';

interface DeleteAgentDialogProps {
  agent: Agent | null;
  onDelete: (agent: Agent) => Promise<void>;
  onClose: () => void;
}

export function DeleteAgentDialog({ agent, onDelete, onClose }: DeleteAgentDialogProps) {
  return (
    <AlertDialog open={agent !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        {agent && <DeleteAgentBody key={agent.id} agent={agent} onDelete={onDelete} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteAgentBody({
  agent,
  onDelete,
}: {
  agent: Agent;
  onDelete: DeleteAgentDialogProps['onDelete'];
}) {
  const { pending, error, submit } = useSubmit(() => onDelete(agent));

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{agent.name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          {agent.projectId
            ? 'Its settings are removed from this project.'
            : 'Its settings are removed from every project.'}{' '}
          The CLI itself stays installed.
        </AlertDialogDescription>
      </AlertDialogHeader>
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
          {pending ? 'Deleting…' : 'Delete agent'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
