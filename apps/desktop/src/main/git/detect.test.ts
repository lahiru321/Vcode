import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../testing';
import { detectGitRepository } from './detect';

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
    await expect(detectGitRepository(repo)).resolves.toEqual({ defaultBranch: 'develop' });
  });

  it("prefers origin's default branch", async () => {
    const repo = tempDir();
    write(repo, {
      '.git/HEAD': 'ref: refs/heads/feature/x\n',
      '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/main\n',
    });
    await expect(detectGitRepository(repo)).resolves.toEqual({ defaultBranch: 'main' });
  });

  it('keeps slashes in branch names', async () => {
    const repo = tempDir();
    write(repo, { '.git/HEAD': 'ref: refs/heads/release/2.0\n' });
    await expect(detectGitRepository(repo)).resolves.toEqual({ defaultBranch: 'release/2.0' });
  });

  it('returns a null branch for a detached HEAD', async () => {
    const repo = tempDir();
    write(repo, { '.git/HEAD': '3f2a9c1e0b7d4a5f6e8c9b0a1d2e3f4a5b6c7d8e\n' });
    await expect(detectGitRepository(repo)).resolves.toEqual({ defaultBranch: null });
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
    await expect(detectGitRepository(worktree)).resolves.toEqual({ defaultBranch: 'trunk' });
  });

  it('resolves a relative gitdir pointer', async () => {
    const root = tempDir();
    write(root, {
      'store/HEAD': 'ref: refs/heads/dev\n',
      'repo/.git': 'gitdir: ../store\n',
    });
    await expect(detectGitRepository(join(root, 'repo'))).resolves.toEqual({
      defaultBranch: 'dev',
    });
  });

  it('only detects a repository root, not a subfolder', async () => {
    const repo = tempDir();
    write(repo, { '.git/HEAD': 'ref: refs/heads/main\n', 'src/index.ts': '' });
    await expect(detectGitRepository(join(repo, 'src'))).resolves.toBeNull();
  });
});
