import { BrowserWindow, dialog } from 'electron';
import { handle } from './registry';

export function registerDialogHandlers(): void {
  handle('dialog:pickFolder', async (_request, { sender }) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    // Modal to the window that asked, so it can't be lost behind it.
    const window = BrowserWindow.fromWebContents(sender);
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return { path: canceled ? null : (filePaths[0] ?? null) };
  });
}
