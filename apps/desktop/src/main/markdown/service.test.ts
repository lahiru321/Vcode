import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_MARKDOWN_BYTES } from '@vcode/shared';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../testing';
import { isMarkdownPath, readMarkdownFile, resolveProjectMarkdown } from './service';

describe('isMarkdownPath', () => {
  it('knows Markdown extensions, in any case', () => {
    expect(isMarkdownPath('README.md')).toBe(true);
    expect(isMarkdownPath('notes/PLAN.Markdown')).toBe(true);
    expect(isMarkdownPath('page.mdx')).toBe(true);
    expect(isMarkdownPath('secrets.env')).toBe(false);
    expect(isMarkdownPath('md')).toBe(false);
  });
});

describe('resolveProjectMarkdown', () => {
  it('resolves relative paths from the project root, or from baseDir', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'README.md'), '# Hi');
    writeFileSync(join(root, 'docs', 'plan.md'), '# Plan');
    await expect(resolveProjectMarkdown(root, 'README.md')).resolves.toBe(join(root, 'README.md'));
    await expect(resolveProjectMarkdown(root, 'plan.md', join(root, 'docs'))).resolves.toBe(
      join(root, 'docs', 'plan.md'),
    );
    await expect(resolveProjectMarkdown(root, '../README.md', join(root, 'docs'))).resolves.toBe(
      join(root, 'README.md'),
    );
  });

  it('refuses files outside the project, also through links', async () => {
    const outside = tempDir();
    writeFileSync(join(outside, 'other.md'), '# Other');
    const root = tempDir();
    symlinkSync(outside, join(root, 'link'), 'junction');
    for (const input of [join(outside, 'other.md'), join('link', 'other.md')]) {
      await expect(resolveProjectMarkdown(root, input)).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
    }
    await expect(resolveProjectMarkdown(root, 'other.md', outside)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('says NOT_FOUND for missing files', async () => {
    await expect(resolveProjectMarkdown(tempDir(), 'missing.md')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('readMarkdownFile', () => {
  it('reads the file', async () => {
    const path = join(tempDir(), 'README.md');
    writeFileSync(path, '# Hello\n');
    await expect(readMarkdownFile(path)).resolves.toMatchObject({ path, content: '# Hello\n' });
  });

  it('refuses other files, folders and large files', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'KEY=secret');
    mkdirSync(join(dir, 'folder.md'));
    writeFileSync(join(dir, 'big.md'), Buffer.alloc(MAX_MARKDOWN_BYTES + 1, 'a'));
    for (const name of ['.env', 'folder.md', 'big.md']) {
      await expect(readMarkdownFile(join(dir, name))).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
    }
  });
});
