import { describe, expect, it, vi } from 'vitest';
import { CodexAdapter } from './codex';
import { CustomCliAdapter } from './custom';
import { GeminiAdapter } from './gemini';
import { getAdapter, listAdapters } from './registry';
import type { AdapterContext, AgentConfig, Executable } from './types';

const config = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  name: 'Agent',
  executable: '',
  args: [],
  env: {},
  model: null,
  role: null,
  instructions: null,
  ...overrides,
});

function context(stdout: string) {
  const resolveExecutable = vi.fn(async (command: string): Promise<Executable> => ({
    path: `/bin/${command}`,
    kind: 'binary',
  }));
  const ctx: AdapterContext = {
    platform: {
      resolveExecutable,
      buildCommand: (executable, args) => ({
        file: executable.path,
        args,
        verbatimArguments: false,
      }),
    },
    run: async () => ({ exitCode: 0, stdout, stderr: '', timedOut: false }),
  };
  return { ctx, resolveExecutable };
}

const options = { env: { A: '1' }, cwd: '/project' };

describe('GeminiAdapter', () => {
  const adapter = new GeminiAdapter();

  it('looks up "gemini" and reads its version', async () => {
    const { ctx, resolveExecutable } = context('0.9.0\n');
    await expect(adapter.validate(config(), ctx, {})).resolves.toMatchObject({
      status: 'ready',
      version: '0.9.0',
    });
    expect(resolveExecutable).toHaveBeenCalledWith('gemini', {});
  });

  it('passes the model, then the user arguments; never the role or instructions', async () => {
    const { ctx } = context('');
    const command = await adapter.buildCommand(
      config({
        model: 'flash',
        role: 'Reviewer',
        instructions: 'Be brief.',
        args: ['--approval-mode', 'auto_edit'],
      }),
      ctx,
      options,
    );
    expect(command).toEqual({
      file: '/bin/gemini',
      args: ['--model', 'flash', '--approval-mode', 'auto_edit'],
      verbatimArguments: false,
      ...options,
    });
    expect(adapter.supportsInstructions).toBe(false);
  });

  it('keeps the environment as it is, plus the agent variables', () => {
    expect(adapter.prepareEnvironment(config({ env: { B: '2' } }), { A: '1' })).toEqual({
      A: '1',
      B: '2',
    });
  });
});

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  it('looks up "codex" and reads its version', async () => {
    const { ctx, resolveExecutable } = context('codex-cli 0.46.0\n');
    await expect(adapter.validate(config(), ctx, {})).resolves.toMatchObject({
      status: 'ready',
      version: '0.46.0',
    });
    expect(resolveExecutable).toHaveBeenCalledWith('codex', {});
  });

  it('passes the model and the role + instructions as developer_instructions', async () => {
    const { ctx } = context('');
    const command = await adapter.buildCommand(
      config({
        model: 'gpt-5-codex',
        role: 'Reviewer',
        instructions: 'Say "done"\nwhen finished.',
        args: ['--full-auto'],
      }),
      ctx,
      options,
    );
    expect(command.args).toEqual([
      '--model',
      'gpt-5-codex',
      '-c',
      'developer_instructions="Your role: Reviewer\\n\\nSay \\"done\\"\\nwhen finished."',
      '--full-auto',
    ]);
    // One line: no raw line breaks reach the command line.
    expect(command.args.some((arg) => /[\r\n]/.test(arg))).toBe(false);
  });

  it('adds nothing for an empty config', async () => {
    const { ctx } = context('');
    const command = await adapter.buildCommand(config({ model: ' ', role: ' ' }), ctx, options);
    expect(command.args).toEqual([]);
  });
});

describe('registry', () => {
  it('has Claude Code, Gemini CLI, Codex CLI and Custom CLI, in that order', () => {
    expect(listAdapters().map((a) => a.id)).toEqual(['claude', 'gemini', 'codex', 'custom']);
    expect(getAdapter('gemini')).toBeInstanceOf(GeminiAdapter);
    expect(getAdapter('codex')).toBeInstanceOf(CodexAdapter);
    expect(getAdapter('custom')).toBeInstanceOf(CustomCliAdapter);
    expect(getAdapter('other')).toBeNull();
  });
});
