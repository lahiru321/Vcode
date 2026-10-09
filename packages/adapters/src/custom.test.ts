import { describe, expect, it, vi } from 'vitest';
import { CustomCliAdapter } from './custom';
import { AdapterError, type AdapterContext, type AgentConfig, type Executable } from './types';

const config = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  name: 'Aider',
  executable: 'aider',
  args: [],
  env: {},
  model: null,
  role: null,
  instructions: null,
  ...overrides,
});

function context(found: Executable | null) {
  const run = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }));
  const resolveExecutable = vi.fn(async () => found);
  const ctx: AdapterContext = {
    platform: {
      resolveExecutable,
      buildCommand: (executable, args) => ({
        file: executable.path,
        args,
        verbatimArguments: false,
      }),
    },
    run,
  };
  return { ctx, run, resolveExecutable };
}

const adapter = new CustomCliAdapter();
const aider: Executable = { path: '/bin/aider', kind: 'binary' };

describe('CustomCliAdapter', () => {
  it('only looks the command up: an unknown program is never run to check it', async () => {
    const { ctx, run, resolveExecutable } = context(aider);
    await expect(adapter.validate(config(), ctx, {})).resolves.toEqual({
      status: 'ready',
      executable: aider,
      version: null,
    });
    expect(resolveExecutable).toHaveBeenCalledWith('aider', {});
    expect(run).not.toHaveBeenCalled();
  });

  it('asks for a command when there is none, without looking anything up', async () => {
    const { ctx, resolveExecutable } = context(aider);
    await expect(adapter.validate(config({ executable: ' ' }), ctx, {})).resolves.toEqual({
      status: 'not_found',
      message: 'Enter the command to run.',
    });
    expect(resolveExecutable).not.toHaveBeenCalled();
    await expect(
      adapter.buildCommand(config({ executable: '' }), ctx, { env: {}, cwd: '/p' }),
    ).rejects.toBeInstanceOf(AdapterError);
  });

  it('reports a command that is not found', async () => {
    const { ctx } = context(null);
    const result = await adapter.validate(config(), ctx, {});
    expect(result).toEqual({
      status: 'not_found',
      message: '"aider" was not found. Enter a command on PATH or the full path to a program.',
    });
  });

  it('runs the command with exactly the user arguments; model, role, instructions unused', async () => {
    const { ctx } = context(aider);
    const command = await adapter.buildCommand(
      config({
        args: ['--model', 'sonnet', '--no-auto-commits'],
        model: 'ignored',
        role: 'ignored',
        instructions: 'ignored',
        env: { AIDER_DARK_MODE: '1' },
      }),
      ctx,
      { env: { A: '1' }, cwd: '/p' },
    );
    expect(command).toEqual({
      file: '/bin/aider',
      args: ['--model', 'sonnet', '--no-auto-commits'],
      verbatimArguments: false,
      env: { A: '1' },
      cwd: '/p',
    });
    expect(adapter.prepareEnvironment(config({ env: { B: '2' } }), { A: '1' })).toEqual({
      A: '1',
      B: '2',
    });
    expect([adapter.supportsModel, adapter.supportsInstructions, adapter.apiKeyEnv]).toEqual([
      false,
      false,
      null,
    ]);
  });
});
