import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { IpcError } from '@vcode/shared';
import { git, runGit } from './cli';

// Git worktree workspaces (P6-04, V1 doc §17): a branch checked out in its own folder under the
// project's `workspaces/`. Every command goes through `runGit`, so no repository hooks run.

/** Checking out a big repository (or LFS files) can take a while. */
const ADD_TIMEOUT_MS = 5 * 60_000;

/** True if git accepts `name` as a new branch name. */
export async function isValidBranchName(repository: string, name: string): Promise<boolean> {
  if (name.startsWith('-')) {
    return false;
  }
  return (await runGit(repository, ['check-ref-format', '--branch', name])).code === 0;
}

export async function branchExists(repository: string, name: string): Promise<boolean> {
  const result = await runGit(repository, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${name}`,
  ]);
  return result.code === 0;
}

/**
 * Checks out `branch` in a new worktree at `folder`: the existing branch as it is, or a new one
 * from `startPoint` (default: what `repository` has checked out).
 */
export async function addWorktree(
  repository: string,
  folder: string,
  branch: string,
  startPoint?: string,
): Promise<{ created: boolean }> {
  if (!(await isValidBranchName(repository, branch))) {
    throw new IpcError('INVALID_REQUEST', `“${branch}” isn't a valid branch name.`);
  }
  const created = !(await branchExists(repository, branch));
  const args = created
    ? ['worktree', 'add', '-b', branch, '--', folder, ...(startPoint ? [startPoint] : [])]
    : ['worktree', 'add', '--', folder, branch];
  await git(repository, args, { timeoutMs: ADD_TIMEOUT_MS });
  return { created };
}

/**
 * Uncommitted changes in a worktree, as `git status --porcelain` lines (untracked files
 * included, ignored ones not).
 */
export async function uncommittedChanges(folder: string): Promise<string[]> {
  const output = await git(folder, ['status', '--porcelain=v1', '--untracked-files=normal']);
  return output.split(/\r?\n/).filter(Boolean);
}

/** Removes the worktree at `folder` (its branch stays). Without `force`, git refuses if it isn't clean. */
export async function removeWorktree(
  repository: string,
  folder: string,
  force: boolean,
): Promise<void> {
  await git(repository, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', folder]);
}

/** Forgets worktrees whose folders are gone. */
export async function pruneWorktrees(repository: string): Promise<void> {
  await git(repository, ['worktree', 'prune']);
}

/**
 * Adds `/<folder>/` to the repository's `info/exclude` (local, never committed), so worktrees
 * inside the project don't show up as untracked files in the main folder.
 */
export async function excludeFolder(repository: string, folder: string): Promise<void> {
  const commonDir = (await git(repository, ['rev-parse', '--git-common-dir'])).trim();
  const exclude = join(resolve(repository, commonDir), 'info', 'exclude');
  const pattern = `/${folder}/`;
  let content = '';
  try {
    content = await readFile(exclude, 'utf8');
  } catch {
    // No exclude file yet.
  }
  if (content.split(/\r?\n/).some((line) => line.trim() === pattern)) {
    return;
  }
  await mkdir(dirname(exclude), { recursive: true });
  const separator = content === '' || content.endsWith('\n') ? '' : '\n';
  await appendFile(exclude, `${separator}${pattern}\n`);
}
