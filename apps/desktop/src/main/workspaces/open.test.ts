import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { platform } from '../platform';
import { createProject } from '../projects/service';
import { tempDir, testDatabase } from '../testing';
import { findVsCode } from './open';
import { createWorkspace, getWorkspaceFolder, listWorkspaces } from './service';

vi.mock('electron', () => ({ shell: {} }));

const isWindows = platform.name === 'win32';

describe('getWorkspaceFolder', () => {
  it("gives the workspace's folder, and refuses one that now links out of the project", async () => {
    const db = testDatabase();
    const root = join(tempDir(), 'shop');
    mkdirSync(root);
    const project = await createProject(db, { rootPath: root });
    const [main] = await listWorkspaces(db, project.id);
    const docs = await createWorkspace(db, { projectId: project.id, name: 'docs', kind: 'folder' });

    expect(await getWorkspaceFolder(db, main!.id)).toBe(root);
    expect(await getWorkspaceFolder(db, docs.id)).toBe(docs.path);

    rmSync(docs.path, { recursive: true });
    symlinkSync(tempDir(), docs.path, 'junction');
    await expect(getWorkspaceFolder(db, docs.id)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});

describe.runIf(isWindows)('findVsCode (Windows)', () => {
  function env(overrides: Record<string, string> = {}) {
    const empty = tempDir();
    return { PATH: empty, LOCALAPPDATA: empty, ProgramFiles: empty, ...overrides };
  }

  it('is null when VS Code is neither on PATH nor installed in the default folders', async () => {
    expect(await findVsCode(env())).toBeNull();
  });

  it('finds code.cmd on PATH first, then in the user and system install folders', async () => {
    const onPath = tempDir();
    writeFileSync(join(onPath, 'code.cmd'), '');
    const user = tempDir();
    const userBin = join(user, 'Programs', 'Microsoft VS Code', 'bin');
    mkdirSync(userBin, { recursive: true });
    writeFileSync(join(userBin, 'code.cmd'), '');
    const system = tempDir();
    const systemBin = join(system, 'Microsoft VS Code', 'bin');
    mkdirSync(systemBin, { recursive: true });
    writeFileSync(join(systemBin, 'code.cmd'), '');

    expect(
      await findVsCode(env({ PATH: onPath, LOCALAPPDATA: user, ProgramFiles: system })),
    ).toMatchObject({ path: join(onPath, 'code.cmd'), kind: 'batch' });
    expect(await findVsCode(env({ LOCALAPPDATA: user, ProgramFiles: system }))).toMatchObject({
      path: join(userBin, 'code.cmd'),
    });
    expect(await findVsCode(env({ ProgramFiles: system }))).toMatchObject({
      path: join(systemBin, 'code.cmd'),
    });
  });
});
