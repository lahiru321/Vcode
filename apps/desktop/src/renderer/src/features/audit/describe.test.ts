import type { AuditAction, AuditEntry } from '@vcode/shared';
import { describe, expect, it } from 'vitest';
import { describeAudit } from './describe';

function entry(action: AuditAction, metadata: AuditEntry['metadata']): AuditEntry {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    projectId: null,
    projectName: null,
    action,
    resourceType: 'x',
    resourceId: null,
    metadata,
    createdAt: 0,
  };
}

describe('describeAudit', () => {
  it('says what happened in plain words', () => {
    expect(describeAudit(entry('agent.start', { agent: 'Claude Code', workspace: 'main' }))).toBe(
      'Started agent “Claude Code”',
    );
    expect(
      describeAudit(
        entry('agent.start', { agent: 'Claude Code', workspace: 'api', restarted: true }),
      ),
    ).toBe('Restarted agent “Claude Code” in workspace api');
    expect(
      describeAudit(entry('agent.end', { agent: 'Codex', status: 'failed', exitCode: 2 })),
    ).toBe('Agent “Codex” failed (exit code 2)');
    expect(describeAudit(entry('agent.end', { agent: 'Codex', status: 'completed' }))).toBe(
      'Agent “Codex” finished',
    );
    expect(describeAudit(entry('terminal.stop', { title: 'pwsh', workspace: 'main' }))).toBe(
      'Stopped shell “pwsh”',
    );
    expect(describeAudit(entry('agent.update', { name: 'Gemini', changed: 'args, model' }))).toBe(
      'Changed agent “Gemini”: args, model',
    );
    expect(describeAudit(entry('credential.update', { name: 'Work key', newKey: true }))).toBe(
      'Changed API key “Work key” (new key saved)',
    );
    expect(describeAudit(entry('workspace.create', { name: 'Agent', kind: 'worktree' }))).toBe(
      'Added worktree workspace “Agent”',
    );
    expect(describeAudit(entry('workspace.delete', { name: 'Agent', removedFolder: true }))).toBe(
      'Deleted workspace “Agent” and its worktree folder',
    );
    expect(describeAudit(entry('project.delete', { name: 'shop' }))).toBe(
      'Removed project “shop” (files kept)',
    );
  });
});
