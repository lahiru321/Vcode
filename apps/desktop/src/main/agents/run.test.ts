import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeAdapter, CodexAdapter } from '@vcode/adapters';
import { describe, expect, it } from 'vitest';
import { platform, toEnvironment } from '../platform';
import { tempDir } from '../testing';
import { adapterContext, runCommand } from './run';

const env = toEnvironment(process.env);
const node = { file: process.execPath, verbatimArguments: false };

describe('runCommand', () => {
  it('returns the output of a command that succeeds', async () => {
    const result = await runCommand(
      { ...node, args: ['-e', 'console.log("hi"); console.error("err")'] },
      { env, timeoutMs: 10_000 },
    );
    expect(result).toEqual({ exitCode: 0, stdout: 'hi\n', stderr: 'err\n', timedOut: false });
  });

  it('returns the exit code of a command that fails', async () => {
    const result = await runCommand(
      { ...node, args: ['-e', 'process.exit(3)'] },
      { env, timeoutMs: 10_000 },
    );
    expect(result).toMatchObject({ exitCode: 3, timedOut: false });
  });

  it('kills a command that takes too long', async () => {
    const result = await runCommand(
      { ...node, args: ['-e', 'setTimeout(() => {}, 60000)'] },
      { env, timeoutMs: 300 },
    );
    expect(result).toMatchObject({ exitCode: null, timedOut: true });
  });

  it('reports a command that cannot start', async () => {
    const result = await runCommand(
      { file: join(tempDir(), 'missing'), args: [], verbatimArguments: false },
      { env, timeoutMs: 10_000 },
    );
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toMatch(/ENOENT/);
  });
});

describe('ClaudeAdapter with the real platform layer', () => {
  it('validates a CLI behind an npm-style .cmd shim (Windows) or script (macOS)', async () => {
    const dir = tempDir();
    const script = join(dir, 'fake-claude.js');
    writeFileSync(script, 'console.log("2.1.99 (Claude Code)")');
    let executable: string;
    if (platform.name === 'win32') {
      executable = join(dir, 'claude.cmd');
      writeFileSync(executable, `@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      executable = join(dir, 'claude');
      writeFileSync(executable, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, {
        mode: 0o755,
      });
    }
    const result = await new ClaudeAdapter().validate(
      {
        name: 'Claude',
        executable,
        args: [],
        env: {},
        model: null,
        role: null,
        instructions: null,
      },
      adapterContext,
      env,
    );
    expect(result).toMatchObject({ status: 'ready', version: '2.1.99' });
  });
});

describe('CodexAdapter with the real platform layer', () => {
  it('multi-line instructions with quotes reach the CLI intact through a shim', async () => {
    const dir = tempDir();
    const script = join(dir, 'fake-codex.js');
    writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))');
    let executable: string;
    if (platform.name === 'win32') {
      executable = join(dir, 'codex.cmd');
      writeFileSync(executable, `@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      executable = join(dir, 'codex');
      writeFileSync(executable, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, {
        mode: 0o755,
      });
    }
    const instructions = 'Say "done" & stop at 100%.\nSecond line <b>.';
    const command = await new CodexAdapter().buildCommand(
      { name: 'Codex', executable, args: [], env: {}, model: null, role: null, instructions },
      adapterContext,
      { env, cwd: dir },
    );
    const result = await runCommand(command, { env, timeoutMs: 15_000 });
    const [flag, setting = ''] = JSON.parse(result.stdout) as string[];
    expect(flag).toBe('-c');
    const key = setting.slice(0, setting.indexOf('='));
    const value = setting.slice(setting.indexOf('=') + 1);
    expect(key).toBe('developer_instructions');
    // The value is a TOML basic string (a JSON string is one); line breaks survive escaped.
    expect(JSON.parse(value)).toBe(instructions);
  });
});
