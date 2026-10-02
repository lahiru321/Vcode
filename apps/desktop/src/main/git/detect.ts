import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Reads Git metadata files directly instead of running `git`: no dependency on Git being
// installed, and nothing in the repository's config (hooks, fsmonitor, …) gets executed
// for a folder the user has only just picked.

async function readTrimmed(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    return null;
  }
}

/** The repository's git dir: `<folder>/.git`, or where a `.git` file points (worktrees). */
async function findGitDir(folder: string): Promise<string | null> {
  const dotGit = join(folder, '.git');
  try {
    if ((await stat(dotGit)).isDirectory()) {
      return dotGit;
    }
  } catch {
    return null;
  }
  const pointer = await readTrimmed(dotGit);
  const match = pointer?.match(/^gitdir:\s*(.+)$/m);
  return match?.[1] ? resolve(folder, match[1].trim()) : null;
}

function branchFromRef(content: string | null, prefix: string): string | null {
  const match = content?.match(/^ref:\s*(\S+)$/);
  const ref = match?.[1];
  return ref?.startsWith(prefix) ? ref.slice(prefix.length) || null : null;
}

export interface GitInfo {
  /** origin's default branch if known, otherwise the checked-out branch; null if detached. */
  defaultBranch: string | null;
}

/** Git info for a repository rooted at `folder`, or null if `folder` isn't a repository root. */
export async function detectGitRepository(folder: string): Promise<GitInfo | null> {
  const gitDir = await findGitDir(folder);
  if (!gitDir) {
    return null;
  }
  // Linked worktrees keep shared refs (like origin/HEAD) in the main repository's git dir.
  const commonDir = await readTrimmed(join(gitDir, 'commondir'));
  const sharedDir = commonDir ? resolve(gitDir, commonDir) : gitDir;

  const originHead = await readTrimmed(join(sharedDir, 'refs', 'remotes', 'origin', 'HEAD'));
  const head = await readTrimmed(join(gitDir, 'HEAD'));
  if (head === null) {
    return null;
  }
  return {
    defaultBranch:
      branchFromRef(originHead, 'refs/remotes/origin/') ?? branchFromRef(head, 'refs/heads/'),
  };
}
