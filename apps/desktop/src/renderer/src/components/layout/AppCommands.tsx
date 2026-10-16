import { useEffect } from 'react';
import { toast } from 'sonner';
import { useProjects } from '@renderer/features/projects/ProjectsProvider';
import { onEvent } from '@renderer/lib/ipc';
import { runShortcut } from '@renderer/lib/shortcuts';
import { requestTerminalFocus } from '@renderer/lib/terminal-focus';

/** Carries out `app:command`s from the tray and notification clicks. */
export function AppCommands() {
  const { select } = useProjects();
  useEffect(
    () =>
      onEvent('app:command', (command) => {
        switch (command.command) {
          case 'newTerminal':
            if (!runShortcut('newTerminalDialog')) {
              toast.info('Select an active project to open a terminal in it.');
            }
            break;
          case 'showTerminal':
            select(command.projectId);
            requestTerminalFocus(command.terminalId);
            break;
        }
      }),
    [select],
  );
  return null;
}
