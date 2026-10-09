import { Credential, IpcError, SetCredentialRequest } from '@vcode/shared';
import { describe, expect, it } from 'vitest';
import { createAgent, getAgent, updateAgent } from '../agents/service';
import { credentials } from '../db/schema';
import { fakeSecretBox, testDatabase } from '../testing';
import {
  credentialEnvironment,
  deleteCredential,
  getCredential,
  listCredentials,
  setCredential,
} from './service';

const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const box = fakeSecretBox();
const anthropic = {
  name: 'Anthropic',
  provider: 'claude',
  envVar: 'ANTHROPIC_API_KEY',
  secret: SECRET,
} as const;

describe('setCredential', () => {
  it('stores the secret encrypted and returns metadata only', () => {
    const db = testDatabase();
    const created = setCredential(db, box, anthropic);
    expect(created).toEqual({
      id: expect.any(String),
      name: 'Anthropic',
      provider: 'claude',
      envVar: 'ANTHROPIC_API_KEY',
      status: 'active',
      agentCount: 0,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(JSON.stringify(created)).not.toContain(SECRET);
    expect(Credential.safeParse(created).success).toBe(true);
    // Not stored in the clear.
    const row = getCredential(db, created.id);
    expect(row.encryptedSecret.toString()).not.toContain(SECRET);
    expect(box.decrypt(row.encryptedSecret)).toBe(SECRET);
    expect(row.authType).toBe('api_key');
  });

  it('needs a secret to create; an edit without one keeps it', () => {
    const db = testDatabase();
    expect(() => setCredential(db, box, { ...anthropic, secret: undefined })).toThrow(
      /Enter the key/,
    );
    const created = setCredential(db, box, anthropic);
    const renamed = setCredential(db, box, {
      id: created.id,
      name: 'Work key',
      provider: 'claude',
      envVar: 'ANTHROPIC_API_KEY',
    });
    expect(renamed.name).toBe('Work key');
    expect(credentialEnvironment(db, box, created.id)).toEqual({ ANTHROPIC_API_KEY: SECRET });

    setCredential(db, box, { ...anthropic, id: created.id, secret: ' sk-new ' });
    expect(credentialEnvironment(db, box, created.id)).toEqual({ ANTHROPIC_API_KEY: 'sk-new' });
  });

  it('CONFLICT for a name in use; NOT_FOUND for an unknown id', () => {
    const db = testDatabase();
    setCredential(db, box, anthropic);
    expect(() => setCredential(db, box, anthropic)).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    expect(() => setCredential(db, box, { ...anthropic, id: MISSING_ID })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it("UNAVAILABLE when the OS can't encrypt; nothing is saved", () => {
    const db = testDatabase();
    expect(() => setCredential(db, fakeSecretBox(false), anthropic)).toThrow(
      expect.objectContaining({ code: 'UNAVAILABLE' }),
    );
    expect(listCredentials(db)).toEqual([]);
  });

  it('a new secret makes an unavailable credential active again', () => {
    const db = testDatabase();
    const created = setCredential(db, box, anthropic);
    db.update(credentials).set({ status: 'unavailable' }).run();
    // A rename alone doesn't make it decryptable.
    expect(setCredential(db, box, { ...anthropic, id: created.id, secret: undefined }).status).toBe(
      'unavailable',
    );
    expect(setCredential(db, box, { ...anthropic, id: created.id, secret: 'k2' }).status).toBe(
      'active',
    );
  });
});

describe('SetCredentialRequest', () => {
  it('validates the variable name and keeps keys on one line', () => {
    const base = { name: 'K', provider: 'claude', envVar: 'API_KEY', secret: 'x' };
    expect(SetCredentialRequest.safeParse(base).success).toBe(true);
    expect(SetCredentialRequest.safeParse({ ...base, envVar: 'API-KEY' }).success).toBe(false);
    expect(SetCredentialRequest.safeParse({ ...base, secret: 'a\nb' }).success).toBe(false);
    expect(SetCredentialRequest.safeParse({ ...base, secret: '   ' }).success).toBe(false);
    expect(SetCredentialRequest.safeParse({ ...base, value: 'x' }).success).toBe(false);
  });
});

describe('listCredentials / deleteCredential', () => {
  it('lists by name with how many agents use each', () => {
    const db = testDatabase();
    const b = setCredential(db, box, { ...anthropic, name: 'beta' });
    const a = setCredential(db, box, { ...anthropic, name: 'Alpha' });
    createAgent(db, { name: 'one', adapter: 'claude', credentialId: b.id });
    createAgent(db, { name: 'two', adapter: 'claude', credentialId: b.id });
    expect(listCredentials(db).map((c) => [c.name, c.agentCount])).toEqual([
      ['Alpha', 0],
      ['beta', 2],
    ]);
    expect(JSON.stringify(listCredentials(db))).not.toContain(SECRET);
    expect(a.id).not.toBe(b.id);
  });

  it("deleting one sends its agents back to the CLI's own login", () => {
    const db = testDatabase();
    const key = setCredential(db, box, anthropic);
    const agent = createAgent(db, { name: 'C', adapter: 'claude', credentialId: key.id });
    expect(deleteCredential(db, key.id)).toEqual({ id: key.id });
    expect(getAgent(db, agent.id).credentialId).toBeNull();
    expect(() => deleteCredential(db, key.id)).toThrow(IpcError);
  });
});

describe('agents and credentials', () => {
  it('an agent can use, change and drop a key; unknown keys are refused', () => {
    const db = testDatabase();
    const key = setCredential(db, box, anthropic);
    expect(() =>
      createAgent(db, { name: 'C', adapter: 'claude', credentialId: MISSING_ID }),
    ).toThrow(/not found/i);
    const agent = createAgent(db, { name: 'C', adapter: 'claude' });
    expect(updateAgent(db, { id: agent.id, credentialId: key.id }).credentialId).toBe(key.id);
    expect(updateAgent(db, { id: agent.id, name: 'Renamed' }).credentialId).toBe(key.id);
    expect(updateAgent(db, { id: agent.id, credentialId: null }).credentialId).toBeNull();
  });
});

describe('credentialEnvironment', () => {
  it("UNAVAILABLE and marks the key when it can't be decrypted", () => {
    const db = testDatabase();
    const key = setCredential(db, box, anthropic);
    db.update(credentials)
      .set({ encryptedSecret: Buffer.from('not ours') })
      .run();
    expect(() => credentialEnvironment(db, box, key.id)).toThrow(
      expect.objectContaining({ code: 'UNAVAILABLE' }),
    );
    expect(getCredential(db, key.id).status).toBe('unavailable');
  });
});
