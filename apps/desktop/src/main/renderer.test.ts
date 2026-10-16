import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRendererUrl, RENDERER_URL, rendererFile } from './renderer';

// Absolute on every OS: the current drive's /app on Windows, /app elsewhere.
const root = resolve('/app/out/renderer');

describe('rendererFile', () => {
  it('maps app://vcode/ URLs to files under the renderer folder', () => {
    expect(rendererFile(root, 'app://vcode/index.html')).toBe(join(root, 'index.html'));
    expect(rendererFile(root, 'app://vcode/assets/index-abc.js?v=1#x')).toBe(
      join(root, 'assets', 'index-abc.js'),
    );
    expect(rendererFile(root, 'app://vcode/assets/a%20b.png')).toBe(
      join(root, 'assets', 'a b.png'),
    );
  });

  it('keeps dot segments inside, plain or %2e-encoded (the URL parser removes them)', () => {
    expect(rendererFile(root, 'app://vcode/../main/index.js')).toBe(join(root, 'main', 'index.js'));
    expect(rendererFile(root, 'app://vcode/%2e%2e/main/index.js')).toBe(
      join(root, 'main', 'index.js'),
    );
  });

  it('refuses encoded slashes that climb out, other hosts and other schemes', () => {
    for (const url of [
      'app://vcode/..%2f..%2fsecret.txt',
      'app://vcode/..%5c..%5csecret.txt',
      'app://vcode/',
      'app://other/index.html',
      'file:///C:/app/out/renderer/index.html',
      'not a url',
    ]) {
      expect(rendererFile(root, url), url).toBeNull();
    }
  });
});

describe('isRendererUrl (built app)', () => {
  it('accepts only the app page itself', () => {
    expect(isRendererUrl(RENDERER_URL)).toBe(true);
    expect(isRendererUrl(`${RENDERER_URL}#/projects`)).toBe(true);
    expect(isRendererUrl('app://vcode/assets/index.js')).toBe(false);
    expect(isRendererUrl('app://evil/index.html')).toBe(false);
    expect(isRendererUrl('file:///C:/app/out/renderer/index.html')).toBe(false);
    expect(isRendererUrl('https://vcode/index.html')).toBe(false);
  });
});
