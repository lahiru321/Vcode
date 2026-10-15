import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../testing';
import { detectGitRepository, parseRemoteUrls, stripCredentials } from './detect';

/** Writes `files` (path → content) under `root`, creating folders as needed. */
function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }
}

describe('detectGitRepository', () => {
  it('returns null for a plain folder', async () => {
    await expect(detectGitRepository(tempDir())).resolves.toBeNull();
  });

  it('uses the checked-out branch when origin has no HEAD', async () => {
    const repo = tempDir();
    write(repo, { '.git/HEAD': 'ref: refs/heads/develop\n' });
    await expect(detectGitRepository(repo)).resolves.toEqual({
      defaultBranch: 'develop',
      branch: 'develop',
      remoteUrl: null,
    });
  });

  it("prefers origin's default branch", async () => {
    const repo = tempDir();
    write(repo, {
      '.git/HEAD': 'ref: refs/heads/feature/x\n',
      '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/main\n',
    });
    await expect(detectGitRepository(repo)).resolves.toMatchObject({
      defaultBranch: 'main',
      branch: 'feature/x',
    });
  });

  it('keeps slashes in branch names', async () => {
    const repo = tempDir();
    write(repo, { '.git/HEAD': 'ref: refs/heads/release/2.0\n' });
    await expect(detectGitRepository(repo)).resolves.toMatchObject({
      defaultBranch: 'release/2.0',
      branch: 'release/2.0',
    });
  });

  it('returns a null branch for a detached HEAD', async () => {
    const repo = tempDir();
    write(repo, { '.git/HEAD': '3f2a9c1e0b7d4a5f6e8c9b0a1d2e3f4a5b6c7d8e\n' });
    await expect(detectGitRepository(repo)).resolves.toMatchObject({
      defaultBranch: null,
      branch: null,
    });
  });

  it('returns null when .git has no HEAD', async () => {
    const repo = tempDir();
    mkdirSync(join(repo, '.git'));
    await expect(detectGitRepository(repo)).resolves.toBeNull();
  });

  it('follows a linked worktree to the main repository', async () => {
    const root = tempDir();
    const main = join(root, 'main');
    const worktree = join(root, 'wt');
    write(main, {
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/trunk\n',
      '.git/worktrees/wt/HEAD': 'ref: refs/heads/feature\n',
      '.git/worktrees/wt/commondir': '../..\n',
    });
    write(worktree, { '.git': `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n` });
    // origin/HEAD lives in the shared git dir, not the worktree's own.
    await expect(detectGitRepository(worktree)).resolves.toMatchObject({
      defaultBranch: 'trunk',
      branch: 'feature',
    });
  });

  it('resolves a relative gitdir pointer', async () => {
    const root = tempDir();
    write(root, {
      'store/HEAD': 'ref: refs/heads/dev\n',
      'repo/.git': 'gitdir: ../store\n',
    });
    await expect(detectGitRepository(join(root, 'repo'))).resolves.toMatchObject({
      defaultBranch: 'dev',
    });
  });

  it('only detects a repository root, not a subfolder', async () => {
    const repo = tempDir();
    write(repo, { '.git/HEAD': 'ref: refs/heads/main\n', 'src/index.ts': '' });
    await expect(detectGitRepository(join(repo, 'src'))).resolves.toBeNull();
  });
});

describe('remote URL', () => {
  it("reads origin's URL from the shared config, without credentials", async () => {
    const root = tempDir();
    const main = join(root, 'main');
    write(main, {
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.git/config': [
        '[core]',
        '\turl = not-a-remote',
        '[remote "upstream"]',
        '\turl = https://github.com/other/repo.git',
        '[remote "origin"]',
        '\turl = https://me:ghp_secret@github.com/me/repo.git',
        '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      ].join('\n'),
      '.git/worktrees/wt/HEAD': 'ref: refs/heads/wt\n',
      '.git/worktrees/wt/commondir': '../..\n',
    });
    write(root, { 'wt/.git': `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n` });
    // A linked worktree has no config of its own: the main repository's is read.
    for (const folder of [main, join(root, 'wt')]) {
      await expect(detectGitRepository(folder)).resolves.toMatchObject({
        remoteUrl: 'https://github.com/me/repo.git',
      });
    }
  });

  it('uses another remote when there is no origin, and null with none', async () => {
    const repo = tempDir();
    write(repo, {
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.git/config': '[remote "fork"]\n\turl = git@github.com:me/repo.git\n',
    });
    await expect(detectGitRepository(repo)).resolves.toMatchObject({
      remoteUrl: 'git@github.com:me/repo.git',
    });
    write(repo, { '.git/config': '[core]\n\tbare = false\n' });
    await expect(detectGitRepository(repo)).resolves.toMatchObject({ remoteUrl: null });
  });

  it('parses quoting, comments, case and CRLF', () => {
    const config = [
      '[Remote "origin"]',
      '  URL = "C:\\\\repos\\\\my \\"repo\\"" ; comment',
      '[remote "b"] ',
      '\turl=https://example.com/b.git # comment',
      '\turl=https://example.com/second-url-ignored.git',
      '[remote "c"]',
    ].join('\r\n');
    expect([...parseRemoteUrls(config)]).toEqual([
      ['origin', 'C:\\repos\\my "repo"'],
      ['b', 'https://example.com/b.git'],
    ]);
  });

  it.each([
    ['https://user:token@github.com/a/b.git', 'https://github.com/a/b.git'],
    ['https://ghp_token@github.com/a/b.git', 'https://github.com/a/b.git'],
    ['HTTP://u:p@host/x', 'HTTP://host/x'],
    ['ssh://git:pw@host/x.git', 'ssh://git@host/x.git'],
    ['ssh://git@host/x.git', 'ssh://git@host/x.git'],
    ['git@github.com:a/b.git', 'git@github.com:a/b.git'],
    ['https://github.com/a/b.git', 'https://github.com/a/b.git'],
    ['/srv/repos/b.git', '/srv/repos/b.git'],
  ])('strips credentials from %s', (url, expected) => {
    expect(stripCredentials(url)).toBe(expected);
  });
});
