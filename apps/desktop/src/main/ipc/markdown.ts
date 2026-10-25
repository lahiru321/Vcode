import { realpath } from 'node:fs/promises';
import { BrowserWindow, dialog } from 'electron';
import { getDatabase } from '../db';
import { getProject } from '../projects/service';
import { MARKDOWN_EXTENSIONS, readMarkdownFile, resolveProjectMarkdown } from '../markdown/service';
import { handle } from './registry';

/** Files the user picked in the dialog, which may be outside the project: they can be re-read. */
const picked = new Set<string>();

export function registerMarkdownHandlers(): void {
  handle('markdown:open', async ({ projectId, path, baseDir }, { sender }) => {
    const project = getProject(getDatabase(), projectId);
    if (path) {
      return readMarkdownFile(
        picked.has(path) ? path : await resolveProjectMarkdown(project.rootPath, path, baseDir),
      );
    }

    const options: Electron.OpenDialogOptions = {
      title: 'Open a Markdown file',
      defaultPath: project.rootPath,
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: MARKDOWN_EXTENSIONS }],
    };
    // Modal to the window that asked, so it can't be lost behind it.
    const window = BrowserWindow.fromWebContents(sender);
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const chosen = filePaths[0];
    if (canceled || !chosen) return null;
    const file = await readMarkdownFile(await realpath(chosen));
    picked.add(file.path);
    return file;
  });
}
