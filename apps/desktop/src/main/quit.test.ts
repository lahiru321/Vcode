import { describe, expect, it, vi } from 'vitest';
import { quitPrompt } from './quit';

vi.mock('electron', () => ({
  app: {},
  dialog: {},
  Notification: class {},
  Menu: {},
  nativeImage: {},
  Tray: class {},
  shell: {},
}));
vi.mock('./ipc', () => ({ broadcastEvent: vi.fn() }));

describe('quitPrompt', () => {
  it('lists the running agents and defaults to Cancel', () => {
    const prompt = quitPrompt([
      { sessionId: 'a', agentName: 'Claude Code', projectName: 'shop', status: 'working' },
      { sessionId: 'b', agentName: 'Codex', projectName: 'blog', status: 'waiting' },
    ]);
    expect(prompt).toMatchObject({
      title: 'Quit Vcode?',
      message: '2 agents are still running. Quitting stops them.',
      detail: '• Claude Code in shop (working)\n• Codex in blog (waiting for input)',
      buttons: ['Quit and stop agents', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
  });

  it('speaks of one agent', () => {
    expect(
      quitPrompt([{ sessionId: 'a', agentName: 'Gemini', projectName: 'x', status: 'ready' }])
        .message,
    ).toBe('1 agent is still running. Quitting stops it.');
  });
});
