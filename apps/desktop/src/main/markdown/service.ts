import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';
import { IpcError, MAX_MARKDOWN_BYTES, type MarkdownFile } from '@vcode/shared';
import { isInsideFolder } from '../fs/folders';

// The Markdown viewer reads files only through here. A path the renderer names (a link in a
// terminal or in another Markdown file) must resolve inside the project folder once every link
// on the way is followed; a file the user picks in the native dialog may be anywhere.

export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'mdx'];

/** Whether `path` names a Markdown file, by its extension. */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(extname(path).slice(1).toLowerCase());
}

/** Real path of `path`; NOT_FOUND if it doesn't exist. */
async function real(path: string, shown: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw code === 'ENOENT' || code === 'ENOTDIR'
      ? new IpcError('NOT_FOUND', `File not found: ${shown}`)
      : new IpcError('INVALID_REQUEST', `Can't open ${shown} (${code ?? 'unknown error'}).`);
  }
}

/**
 * `input` (absolute, or relative to `baseDir` if that is absolute, else to the project root)
 * resolved to a real path that must be inside `projectRoot`.
 */
export async function resolveProjectMarkdown(
  projectRoot: string,
  input: string,
  baseDir?: string,
): Promise<string> {
  const root = await real(projectRoot, projectRoot);
  const base = baseDir && isAbsolute(baseDir) ? baseDir : root;
  const path = await real(resolve(base, input), input);
  if (!isInsideFolder(root, path)) {
    throw new IpcError(
      'INVALID_REQUEST',
      `Only files inside the project folder open here: ${input}`,
    );
  }
  return path;
}

/** Reads a Markdown file (a real, absolute path) for the viewer. */
export async function readMarkdownFile(path: string): Promise<MarkdownFile> {
  if (!isMarkdownPath(path)) {
    throw new IpcError('INVALID_REQUEST', `Not a Markdown file: ${path}`);
  }
  const stats = await stat(path);
  if (!stats.isFile()) {
    throw new IpcError('INVALID_REQUEST', `Not a file: ${path}`);
  }
  if (stats.size > MAX_MARKDOWN_BYTES) {
    throw new IpcError('INVALID_REQUEST', `Too large to show (over 2 MB): ${path}`);
  }
  return {
    path,
    content: await readFile(path, 'utf8'),
    modifiedAt: Math.floor(stats.mtimeMs),
  };
}
