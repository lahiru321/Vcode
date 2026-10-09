import { describe, expect, it, vi } from 'vitest';
import { ClaudeAdapter } from './claude';
import { parseVersion } from './cli-adapter';
import { getAdapter } from './registry';
import {
  AdapterError,
  type AdapterContext,
  type AgentConfig,
  type Executable,
  type RunResult,
} from './types';

const config = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  name: 'Claude',
  executable: '',
  args: [],
  env: {},
  model: null,
  role: null,
  instructions: null,
  ...overrides,
});

const exe: Executable = { path: '/bin/claude', kind: 'binary' };

function context(
  found: Executable | null = exe,
  result: Partial<RunResult> = {},
): AdapterContext & { resolveExecutable: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } {
  const resolveExecutable = vi.fn(async () => found);
  const run = vi.fn(async () => ({
    exitCode: 0,
    stdout: '2.1.3 (Claude Code)\n',
    stderr: '',
    timedOut: false,
    ...result,
  }));
  return {
    platform: {
      resolveExecutable,
      buildCommand: (executable, args) => ({
        file: executable.path,
        args,
        verbatimArguments: false,
      }),
    },
    run,
    resolveExecutable,
  };
}

const adapter = new ClaudeAdapter();

describe('parseVersion', () => {
  it('finds the version in CLI output', () => {
    expect(parseVersion('2.1.3 (Claude Code)')).toBe('2.1.3');
    expect(parseVersion('claude v1.0.0-beta.2\n')).toBe('1.0.0-beta.2');
    expect(parseVersion('no version here')).toBeNull();
  });
});

describe('ClaudeAdapter.validate', () => {
  it('looks up "claude" when no executable is set and runs --version', async () => {
    const ctx = context();
    const result = await adapter.validate(config(), ctx, { PATH: '/bin' });
    expect(result).toEqual({ status: 'ready', executable: exe, version: '2.1.3' });
    expect(ctx.resolveExecutable).toHaveBeenCalledWith('claude', { PATH: '/bin' });
    expect(ctx.run).toHaveBeenCalledWith(
      { file: '/bin/claude', args: ['--version'], verbatimArguments: false },
      { env: { PATH: '/bin' }, timeoutMs: 15_000 },
    );
  });

  it('uses the configured executable', async () => {
    const ctx = context();
    await adapter.validate(config({ executable: ' D:\\tools\\claude.exe ' }), ctx, {});
    expect(ctx.resolveExecutable).toHaveBeenCalledWith('D:\\tools\\claude.exe', {});
  });

  it('reports a missing CLI', async () => {
    const result = await adapter.validate(config(), context(null), {});
    expect(result.status).toBe('not_found');
  });

  it('reports a CLI that fails or hangs', async () => {
    const failed = await adapter.validate(
      config(),
      context(exe, { exitCode: 1, stdout: '', stderr: 'boom\nmore' }),
      {},
    );
    expect(failed).toEqual({
      status: 'error',
      executable: exe,
      message: 'Claude Code failed to start (exit code 1): boom',
    });
    const hung = await adapter.validate(
      config(),
      context(exe, { exitCode: null, timedOut: true }),
      {},
    );
    expect(hung.status).toBe('error');
  });
});

describe('ClaudeAdapter.buildCommand', () => {
  it('adds model and system prompt before the user arguments', async () => {
    const command = await adapter.buildCommand(
      config({
        model: 'opus',
        role: 'Backend agent',
        instructions: 'Only touch src/api.',
        args: ['--verbose'],
      }),
      context(),
      { env: { A: '1' }, cwd: '/project' },
    );
    expect(command).toEqual({
      file: '/bin/claude',
      args: [
        '--model',
        'opus',
        '--append-system-prompt',
        'Your role: Backend agent\n\nOnly touch src/api.',
        '--verbose',
      ],
      verbatimArguments: false,
      env: { A: '1' },
      cwd: '/project',
    });
  });

  it('adds nothing for an empty config', async () => {
    const command = await adapter.buildCommand(config({ model: '  ' }), context(), {
      env: {},
      cwd: '/p',
    });
    expect(command.args).toEqual([]);
  });

  it('throws AdapterError when the CLI is missing', async () => {
    await expect(
      adapter.buildCommand(config(), context(null), { env: {}, cwd: '/p' }),
    ).rejects.toBeInstanceOf(AdapterError);
  });
});

describe('ClaudeAdapter.prepareEnvironment', () => {
  it('adds the agent variables and drops the nested-session markers', () => {
    const env = adapter.prepareEnvironment(config({ env: { FOO: 'bar' } }), {
      PATH: '/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
    });
    expect(env).toEqual({ PATH: '/bin', FOO: 'bar' });
  });
});

describe('activity rules', () => {
  it('settles to ready, then works and waits', () => {
    expect(adapter.getStatus('starting', 'output')).toBeNull();
    expect(adapter.getStatus('starting', 'idle')).toBe('ready');
    expect(adapter.getStatus('ready', 'output')).toBe('working');
    expect(adapter.getStatus('working', 'output')).toBeNull();
    expect(adapter.getStatus('working', 'idle')).toBe('waiting');
    expect(adapter.getStatus('ready', 'idle')).toBeNull();
    expect(adapter.getStatus('working', 'bell')).toBe('waiting');
    expect(adapter.getStatus('waiting', 'output')).toBe('working');
  });
});

describe('lifecycle hooks', () => {
  it('stops by ending the process tree', async () => {
    const killTree = vi.fn(async () => {});
    await adapter.stop({ sessionId: 's', pid: 1, write: vi.fn(), killTree });
    expect(killTree).toHaveBeenCalledOnce();
  });
});

describe('getAdapter', () => {
  it('knows claude only, for now', () => {
    expect(getAdapter('claude')).toBeInstanceOf(ClaudeAdapter);
    expect(getAdapter('gemini')).toBeNull();
  });
});
