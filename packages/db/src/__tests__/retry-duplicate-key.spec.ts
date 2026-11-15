import { describe, expect, it, vi } from 'vitest';
import { retryOnDuplicateKey } from '../retry-duplicate-key.js';

const duplicate = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

describe('retryOnDuplicateKey (REV-201)', () => {
  it('returns the first result when the operation succeeds', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    await expect(retryOnDuplicateKey(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('runs the operation once more after a duplicate-key error', async () => {
    const op = vi.fn().mockRejectedValueOnce(duplicate()).mockResolvedValue('ok');
    await expect(retryOnDuplicateKey(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second duplicate-key error', async () => {
    const op = vi.fn().mockRejectedValue(duplicate());
    await expect(retryOnDuplicateKey(op)).rejects.toMatchObject({ code: 11000 });
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('does not retry any other error', async () => {
    const op = vi.fn().mockRejectedValue(new Error('network'));
    await expect(retryOnDuplicateKey(op)).rejects.toThrow('network');
    expect(op).toHaveBeenCalledTimes(1);
  });
});
