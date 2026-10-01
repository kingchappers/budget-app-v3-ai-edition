import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(function () { return { send: mockSend }; }),
  GetParameterCommand: vi.fn(function (input: unknown) { return { type: 'GetParameter', ...(input as object) }; }),
}));

import { loadVapid, resetVapidCache } from '../vapid';

const ENV = {
  VAPID_PUBLIC_KEY: 'public-key',
  VAPID_SUBJECT: 'https://budget.example',
  VAPID_PRIVATE_KEY_PARAMETER: '/budget-app/vapid-private-key',
};

beforeEach(() => {
  resetVapidCache();
  mockSend.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('loadVapid', () => {
  it('reads the private key from Parameter Store, decrypted', async () => {
    mockSend.mockResolvedValue({ Parameter: { Value: 'private-key' } });

    await expect(loadVapid(ENV)).resolves.toEqual({ subject: 'https://budget.example', publicKey: 'public-key', privateKey: 'private-key' });
    expect(mockSend.mock.calls[0][0]).toMatchObject({ Name: '/budget-app/vapid-private-key', WithDecryption: true });
  });

  it('asks only once, then keeps the answer in memory', async () => {
    mockSend.mockResolvedValue({ Parameter: { Value: 'private-key' } });
    await loadVapid(ENV);
    await loadVapid(ENV);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it.each(['VAPID_PUBLIC_KEY', 'VAPID_SUBJECT', 'VAPID_PRIVATE_KEY_PARAMETER'])('is "not set up" without %s, and never calls out', async name => {
    await expect(loadVapid({ ...ENV, [name]: '' })).resolves.toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('is "not set up" when the parameter does not exist yet, without throwing', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('Parameter /budget-app/vapid-private-key not found'), { name: 'ParameterNotFound' }));
    await expect(loadVapid(ENV)).resolves.toBeNull();
  });

  it('logs only the kind of error, never its message or the key', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSend.mockRejectedValue(Object.assign(new Error('secret parameter detail'), { name: 'AccessDeniedException' }));

    await loadVapid(ENV);

    expect(JSON.stringify(logged.mock.calls)).toContain('AccessDeniedException');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret parameter detail');
  });

  it('is "not set up" when the parameter is empty', async () => {
    mockSend.mockResolvedValue({ Parameter: { Value: '' } });
    await expect(loadVapid(ENV)).resolves.toBeNull();
  });
});
