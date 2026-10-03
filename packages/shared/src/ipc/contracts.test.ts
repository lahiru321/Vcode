import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from './channels';
import {
  CreateProjectRequest,
  eventContracts,
  invokeContracts,
  Project,
  SetSettingsRequest,
  SETTING_DEFAULTS,
  Settings,
  UpdateProjectRequest,
} from './contracts';

const ID = '7d0f8a4e-5b1c-4e2a-9f3d-6c8b7a9e0d1f';

describe('contracts', () => {
  it('cover exactly the declared channels', () => {
    expect(Object.keys(invokeContracts).sort()).toEqual([...INVOKE_CHANNELS].sort());
    expect(Object.keys(eventContracts).sort()).toEqual([...EVENT_CHANNELS].sort());
  });

  it('request schemas reject unknown keys', () => {
    expect(CreateProjectRequest.safeParse({ rootPath: '/x', extra: 1 }).success).toBe(false);
    expect(UpdateProjectRequest.safeParse({ id: ID, name: 'x', slug: 'y' }).success).toBe(false);
    expect(SetSettingsRequest.safeParse({ theme: 'dark' }).success).toBe(false);
  });

  it('response schemas strip unknown keys', () => {
    const project = Project.parse({
      id: ID,
      name: 'n',
      slug: 's',
      rootPath: '/p',
      defaultBranch: null,
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      secret: 'must not reach the renderer',
    });
    expect(project).not.toHaveProperty('secret');
  });

  it('CreateProjectRequest trims and requires a folder', () => {
    expect(CreateProjectRequest.parse({ rootPath: '  /x  ', name: ' App ' })).toEqual({
      rootPath: '/x',
      name: 'App',
    });
    expect(CreateProjectRequest.safeParse({ rootPath: '   ' }).success).toBe(false);
    expect(CreateProjectRequest.safeParse({ rootPath: '/x', name: ' ' }).success).toBe(false);
    expect(CreateProjectRequest.safeParse({ rootPath: '/x', name: 'a'.repeat(101) }).success).toBe(
      false,
    );
  });

  it('UpdateProjectRequest needs something to change', () => {
    expect(UpdateProjectRequest.safeParse({ id: ID }).success).toBe(false);
    expect(UpdateProjectRequest.safeParse({ id: ID, status: 'archived' }).success).toBe(true);
    expect(UpdateProjectRequest.safeParse({ id: ID, status: 'deleted' }).success).toBe(false);
    expect(UpdateProjectRequest.safeParse({ id: 'nope', name: 'x' }).success).toBe(false);
  });

  it('SetSettingsRequest is a non-empty partial of Settings', () => {
    expect(SetSettingsRequest.safeParse({}).success).toBe(false);
    expect(SetSettingsRequest.parse({ selectedProjectId: null })).toEqual({
      selectedProjectId: null,
    });
    expect(SetSettingsRequest.safeParse({ selectedProjectId: 'nope' }).success).toBe(false);
  });

  it('SETTING_DEFAULTS is a valid Settings value with every key', () => {
    expect(Settings.parse(SETTING_DEFAULTS)).toEqual(SETTING_DEFAULTS);
    expect(Object.keys(SETTING_DEFAULTS).sort()).toEqual(Object.keys(Settings.shape).sort());
  });
});
