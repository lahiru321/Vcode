import { describe, expect, it, vi } from 'vitest';
import { REDACTED, redactingStream, redactSecrets } from './redact';

describe('redactSecrets', () => {
  it.each([
    ['Anthropic', 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_xyz'],
    ['OpenAI project', 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'],
    ['OpenAI legacy', 'sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd'],
    ['Google', 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'],
    ['GitHub', 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'],
    ['GitHub fine-grained', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop'],
    ['Slack', 'xoxb-1234567890-abcdefghij'],
    ['AWS', 'AKIAIOSFODNN7EXAMPLE'],
    [
      'JWT',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    ],
  ])('redacts %s keys anywhere in the text', (_name, secret) => {
    const text = `failed to start: key ${secret} was rejected`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain(secret);
    expect(redacted).toBe(`failed to start: key ${REDACTED} was rejected`);
  });

  it('keeps the name of secret-looking variables and the auth scheme', () => {
    expect(redactSecrets('env ANTHROPIC_API_KEY=abc123 GEMINI_API_KEY=x9 PATH=/bin')).toBe(
      `env ANTHROPIC_API_KEY=${REDACTED} GEMINI_API_KEY=${REDACTED} PATH=/bin`,
    );
    expect(redactSecrets('{"MY_TOKEN":"a\\"b","name":"ok","DB_PASSWORD": "hunter2"}')).toBe(
      `{"MY_TOKEN":"${REDACTED}","name":"ok","DB_PASSWORD": "${REDACTED}"}`,
    );
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123')).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
  });

  it('leaves ordinary text alone', () => {
    const text =
      'spawned C:\\Users\\me\\.local\\bin\\claude.exe --model opus (pid 4242); task-runner ok; skip-ant';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('redactingStream', () => {
  it('redacts each line and passes flush / end through', () => {
    const write = vi.fn();
    const flushSync = vi.fn();
    const end = vi.fn();
    const stream = redactingStream({ write, flushSync, end });
    stream.write('{"msg":"key sk-ant-api03-secretsecretsecret"}\n');
    expect(write).toHaveBeenCalledWith(`{"msg":"key ${REDACTED}"}\n`);
    stream.flushSync?.();
    stream.end?.();
    expect(flushSync).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    // A stream without flushSync / end.
    const bare = redactingStream({ write });
    expect(bare.flushSync).toBeUndefined();
    expect(() => bare.end?.()).not.toThrow();
  });
});
