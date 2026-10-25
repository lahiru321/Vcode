import { describe, expect, it } from 'vitest';
import { displayPath, findMarkdownPaths, folderOf, headingId, isMarkdownPath } from './paths';

describe('findMarkdownPaths', () => {
  const texts = (line: string) => findMarkdownPaths(line).map((path) => path.text);

  it('finds relative and absolute paths, with their positions', () => {
    expect(findMarkdownPaths('Wrote docs/plan.md and ./README.md')).toEqual([
      { start: 6, text: 'docs/plan.md' },
      { start: 23, text: './README.md' },
    ]);
    expect(texts('Saved C:\\repo\\NOTES.markdown.')).toEqual(['C:\\repo\\NOTES.markdown']);
    expect(texts('see `CHANGELOG.md`, (plan.mdx)')).toEqual(['CHANGELOG.md', 'plan.mdx']);
    expect(texts('Update(ROADMAP.md:12)')).toEqual(['ROADMAP.md']);
  });

  it('skips URLs, other extensions and longer words', () => {
    expect(texts('https://github.com/x/y/README.md')).toEqual([]);
    expect(texts('file:README.md')).toEqual([]);
    expect(texts('notes.md5 index.mdl script.ts .md')).toEqual([]);
  });
});

describe('helpers', () => {
  it('isMarkdownPath', () => {
    expect(isMarkdownPath('a/B.MD')).toBe(true);
    expect(isMarkdownPath('a/b.txt')).toBe(false);
  });

  it('folderOf', () => {
    expect(folderOf('C:\\repo\\docs\\plan.md')).toBe('C:\\repo\\docs');
    expect(folderOf('/repo/README.md')).toBe('/repo');
  });

  it('displayPath', () => {
    expect(displayPath('C:\\Repo', 'C:\\repo\\docs\\plan.md')).toBe('docs\\plan.md');
    expect(displayPath('/repo', '/other/README.md')).toBe('/other/README.md');
  });

  it('headingId', () => {
    expect(headingId('P1 — Foundation')).toBe('p1--foundation');
    expect(headingId('How to use this file?')).toBe('how-to-use-this-file');
  });
});
