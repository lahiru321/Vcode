// Markdown file paths in plain text (terminal output) and in links inside Markdown files. Main
// checks every path again before it reads anything (main/markdown/service.ts).

const EXTENSIONS = 'md|markdown|mdown|mkd|mdx';

/** `docs/plan.md`, `./README.md`, `C:\repo\NOTES.md`, … ; not part of a longer word or URL. */
const PATH_PATTERN = new RegExp(
  String.raw`(?:[A-Za-z]:)?[\w.~@+\-/\\]*[\w~@+\-]\.(?:${EXTENSIONS})(?![\w-])`,
  'gi',
);

export interface FoundPath {
  /** Index of the first character in the line. */
  start: number;
  text: string;
}

/** Markdown file paths in one line of text, in order. URLs are left to the web links. */
export function findMarkdownPaths(line: string): FoundPath[] {
  const found: FoundPath[] = [];
  for (const match of line.matchAll(PATH_PATTERN)) {
    const before = line.slice(0, match.index);
    // Part of a URL (https://host/README.md, where "s:" looks like a drive) or file:README.md.
    if (match[0].startsWith('//') || match[0].includes('://') || /[\w:]$/.test(before)) continue;
    found.push({ start: match.index, text: match[0] });
  }
  return found;
}

/** Whether `path` names a Markdown file, by its extension. */
export function isMarkdownPath(path: string): boolean {
  return new RegExp(String.raw`\.(?:${EXTENSIONS})$`, 'i').test(path);
}

/** The folder part of `path` (either separator). */
export function folderOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '');
}

/** `path` relative to `root` when it is inside it, else `path` as it is. */
export function displayPath(root: string, path: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  const prefix = root.endsWith(sep) ? root : root + sep;
  return path.toLowerCase().startsWith(prefix.toLowerCase()) ? path.slice(prefix.length) : path;
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces as hyphens. */
export function headingId(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
