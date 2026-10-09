import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { invokeContracts, type InvokeChannel } from '@vcode/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  createAgent,
  detectAgent,
  listAgents,
  listProviders,
  toAgent,
  toAgentValidation,
  updateAgent,
  validateAgent,
  type AgentDeps,
} from './agents/service';
import {
  deleteCredential,
  getCredential,
  listCredentials,
  setCredential,
} from './credentials/service';
import { createProject } from './projects/service';
import {
  createTerminal,
  endActiveSessions,
  listTerminals,
  stopTerminal,
  withAgents,
  type TerminalDeps,
} from './terminals/service';
import { fakeSecretBox, tempDir, testDatabase } from './testing';

// P4-07 (V1 doc §16, acceptance criterion 15): API keys never reach the renderer. Everything the
// renderer can ask about agents, keys and terminals is run with a key saved, and each response
// goes through its channel's real contract, as the IPC layer sends it.

const SECRET = 'sk-ant-api03-NEVER-IN-THE-RENDERER-0123456789abcdef';

function respond<C extends InvokeChannel>(channel: C, value: unknown): string {
  const contract: { response: { parse(value: unknown): unknown } } = invokeContracts[channel];
  return JSON.stringify(contract.response.parse(value));
}

describe('secrets never appear in IPC responses', () => {
  it('for every agent, credential and terminal response', async () => {
    const db = testDatabase();
    const box = fakeSecretBox();
    const adapters: AgentDeps['adapters'] = {
      platform: {
        resolveExecutable: async (command) => ({ path: `/bin/${command}`, kind: 'binary' }),
        buildCommand: (executable, args) => ({
          file: executable.path,
          args,
          verbatimArguments: false,
        }),
      },
      run: async () => ({ exitCode: 0, stdout: '2.1.0', stderr: '', timedOut: false }),
    };
    const agentDeps: AgentDeps = { db, adapters, environment: async () => ({ PATH: '/bin' }) };
    const spawn = vi.fn(async () => ({ pid: 4242 }));
    const terminalDeps: TerminalDeps = {
      db,
      host: { request: spawn as never },
      environment: async () => ({ PATH: '/bin' }),
      resolveShell: async () => ({
        shell: '/bin/sh',
        command: { file: '/bin/sh', args: [], verbatimArguments: false },
      }),
      killProcessTree: async () => {},
      adapters,
      secrets: box,
    };

    const dir = join(tempDir(), 'app');
    mkdirSync(dir);
    const project = await createProject(db, { rootPath: dir });
    const responses: string[] = [];

    // Credentials.
    const key = setCredential(db, box, {
      name: 'Anthropic',
      provider: 'claude',
      envVar: 'ANTHROPIC_API_KEY',
      secret: SECRET,
    });
    responses.push(respond('credentials:set', key));
    responses.push(
      respond(
        'credentials:set',
        setCredential(db, box, { ...key, id: key.id, name: 'Work', secret: SECRET }),
      ),
    );
    responses.push(respond('credentials:list', listCredentials(db)));

    // Agents that use it.
    const agent = createAgent(db, { name: 'Claude', adapter: 'claude', credentialId: key.id });
    responses.push(respond('agents:create', toAgent(agent)));
    responses.push(
      respond('agents:update', toAgent(updateAgent(db, { id: agent.id, model: 'opus' }))),
    );
    responses.push(respond('agents:list', listAgents(db, project.id).map(toAgent)));
    responses.push(
      respond('agents:validate', toAgentValidation(await validateAgent(agentDeps, agent.id))),
    );
    responses.push(respond('agents:detect', await detectAgent(agentDeps, { adapter: 'claude' })));
    responses.push(respond('agents:providers', listProviders()));

    // Running it: the key goes to the process, and only there.
    const terminal = await createTerminal(terminalDeps, {
      projectId: project.id,
      agentId: agent.id,
      cols: 80,
      rows: 24,
    });
    expect(spawn).toHaveBeenCalledWith(
      'spawn',
      expect.objectContaining({ env: expect.objectContaining({ ANTHROPIC_API_KEY: SECRET }) }),
    );
    responses.push(respond('terminals:create', withAgents(db, [terminal])[0]));
    responses.push(respond('terminals:list', withAgents(db, listTerminals(db, project.id))));
    const stopped = await stopTerminal(terminalDeps, terminal.id);
    responses.push(respond('terminals:stop', withAgents(db, [stopped])[0]));
    endActiveSessions(db, 'stopped');

    responses.push(respond('credentials:delete', deleteCredential(db, key.id)));

    const encrypted = box.encrypt(SECRET);
    for (const response of responses) {
      expect(response).not.toContain(SECRET);
      expect(response).not.toContain(encrypted.toString());
      expect(response).not.toContain(encrypted.toString('base64'));
      expect(response).not.toMatch(/encrypted|secret/i);
    }
  });

  it('the Credential contract strips a secret even if a service returned one', () => {
    const db = testDatabase();
    const key = setCredential(db, fakeSecretBox(), {
      name: 'K',
      provider: 'gemini',
      envVar: 'GEMINI_API_KEY',
      secret: SECRET,
    });
    // A row straight from the table, plus a plain-text field a bug might add.
    const leaky = { ...key, ...getCredential(db, key.id), secret: SECRET, agentCount: 0 };
    const sent = respond('credentials:list', [leaky]);
    expect(sent).not.toContain(SECRET);
    expect(JSON.parse(sent)[0]).not.toHaveProperty('encryptedSecret');
  });
});
