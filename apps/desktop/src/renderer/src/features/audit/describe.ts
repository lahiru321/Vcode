import type { AuditEntry } from '@vcode/shared';

// One line per audit entry, in plain words (P7-05).

function text(entry: AuditEntry, key: string): string {
  const value = entry.metadata[key];
  return value === null || value === undefined ? '' : String(value);
}

function quoted(entry: AuditEntry, key: string): string {
  const value = text(entry, key);
  return value ? `“${value}”` : '';
}

/** " in <workspace>" when known, but not for the main workspace (that's just the project). */
function inWorkspace(entry: AuditEntry): string {
  const workspace = text(entry, 'workspace');
  return workspace && workspace !== 'main' ? ` in workspace ${workspace}` : '';
}

const ENDED: Record<string, string> = {
  completed: 'finished',
  failed: 'failed',
  stopped: 'was stopped',
};

export function describeAudit(entry: AuditEntry): string {
  const restarted = entry.metadata['restarted'] === true;
  switch (entry.action) {
    case 'project.create':
      return `Added project ${quoted(entry, 'name')}`;
    case 'project.delete':
      return `Removed project ${quoted(entry, 'name')} (files kept)`;
    case 'terminal.start':
      return `${restarted ? 'Restarted' : 'Opened'} shell ${quoted(entry, 'title')}${inWorkspace(entry)}`;
    case 'terminal.stop':
      return `Stopped shell ${quoted(entry, 'title')}${inWorkspace(entry)}`;
    case 'agent.start':
      return `${restarted ? 'Restarted' : 'Started'} agent ${quoted(entry, 'agent')}${inWorkspace(entry)}`;
    case 'agent.end': {
      const status = text(entry, 'status');
      const code = entry.metadata['exitCode'];
      const exit = status === 'failed' && typeof code === 'number' ? ` (exit code ${code})` : '';
      return `Agent ${quoted(entry, 'agent')} ${ENDED[status] ?? status}${exit}`;
    }
    case 'agent.create':
      return `Added agent ${quoted(entry, 'name')} (${text(entry, 'adapter')})`;
    case 'agent.update': {
      const changed = text(entry, 'changed');
      return `Changed agent ${quoted(entry, 'name')}${changed ? `: ${changed}` : ''}`;
    }
    case 'agent.delete':
      return `Deleted agent ${quoted(entry, 'name')}`;
    case 'credential.create':
      return `Added API key ${quoted(entry, 'name')}`;
    case 'credential.update':
      return `Changed API key ${quoted(entry, 'name')}${entry.metadata['newKey'] === true ? ' (new key saved)' : ''}`;
    case 'credential.delete':
      return `Deleted API key ${quoted(entry, 'name')}`;
    case 'workspace.create':
      return `Added ${text(entry, 'kind') === 'worktree' ? 'worktree' : 'folder'} workspace ${quoted(entry, 'name')}`;
    case 'workspace.delete':
      return `Deleted workspace ${quoted(entry, 'name')}${entry.metadata['removedFolder'] === true ? ' and its worktree folder' : ''}`;
  }
}
