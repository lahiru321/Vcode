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

/** A git config value: unquoted and unescaped, or with a trailing `#` / `;` comment dropped. */
function configValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const quoted = value.match(/^"((?:[^"\\]|\\.)*)"/);
    return (quoted?.[1] ?? value.slice(1)).replace(/\\(.)/g, '$1');
  }
  return value.replace(/\s*[#;].*$/, '');
}

/** `url` of each `[remote "name"]` section in a git config file, in file order. */
export function parseRemoteUrls(config: string): Map<string, string> {
  const urls = new Map<string, string>();
  let remote: string | null = null;
  for (const line of config.split(/\r?\n/)) {
    const section = line.match(/^\s*\[\s*([^\]\s"]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/);
    if (section) {
      remote = section[1]!.toLowerCase() === 'remote' ? (section[2] ?? null) : null;
      continue;
    }
    const entry = remote === null ? null : line.match(/^\s*url\s*=(.*)$/i);
    if (remote !== null && entry && !urls.has(remote)) {
      urls.set(remote, configValue(entry[1]!));
    }
  }
  return urls;
}

/**
 * A remote URL without its credentials: `https://user:token@host/…` → `https://host/…`. For
 * other schemes (ssh://git@host) the user name stays and only a password goes. scp-style
 * `git@host:path` has no password and is kept as is.
 */
export function stripCredentials(url: string): string {
  const match = url.match(/^([a-z][a-z0-9+.-]*:\/\/)([^/@]*)@(.*)$/i);
  if (!match) {
    return url;
  }
  const [, scheme, userInfo, rest] = match as unknown as [string, string, string, string];
  if (/^https?:\/\/$/i.test(scheme)) {
    return scheme + rest;
  }
  const user = userInfo.split(':')[0];
  return user ? `${scheme}${user}@${rest}` : scheme + rest;
}

export interface GitInfo {
  /** origin's default branch if known, otherwise the checked-out branch; null if detached. */
  defaultBranch: string | null;
  /** The checked-out branch; null if detached. */
  branch: string | null;
  /** origin's URL (another remote's if there's no origin) without credentials; null if none. */
  remoteUrl: string | null;
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
  const branch = branchFromRef(head, 'refs/heads/');
  const remotes = parseRemoteUrls((await readTrimmed(join(sharedDir, 'config'))) ?? '');
  const remoteUrl = remotes.get('origin') ?? remotes.values().next().value ?? null;
  return {
    defaultBranch: branchFromRef(originHead, 'refs/remotes/origin/') ?? branch,
    branch,
    remoteUrl: remoteUrl ? stripCredentials(remoteUrl) : null,
  };
}
