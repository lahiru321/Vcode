import { describe, expect, it, vi } from 'vitest';
import { isSafeExternalUrl } from './security';

vi.mock('electron', () => ({}));

describe('isSafeExternalUrl', () => {
  it.each(['https://example.com', 'http://localhost:3000/a?b=c#d', 'HTTPS://EXAMPLE.COM'])(
    'allows %s',
    (url) => {
      expect(isSafeExternalUrl(url)).toBe(true);
    },
  );

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vscode://file/c:/x',
    'ms-msdt:/id PCWDiagnostic',
    'smb://server/share',
    '//example.com',
    'example.com',
    '',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(false);
  });
});
