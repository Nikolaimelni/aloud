import { describe, expect, it } from 'vitest';
import { retry } from './retry';

describe('retry', () => {
  it('does not try twice when once was enough', async () => {
    let calls = 0;
    const value = await retry(async () => {
      calls++;
      return 'fine';
    });

    expect(value).toBe('fine');
    expect(calls).toBe(1);
  });

  it('gets there on the second go', async () => {
    let calls = 0;
    const value = await retry(
      async () => {
        calls++;
        if (calls === 1) throw new Error('connection reset');
        return 'fine';
      },
      { backoffMs: 1 },
    );

    expect(value).toBe('fine');
    expect(calls).toBe(2);
  });

  it('gives up with the last failure rather than a wrapper', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new Error(`no route, try ${calls}`);
        },
        { attempts: 3, backoffMs: 1 },
      ),
    ).rejects.toThrow('no route, try 3');

    expect(calls).toBe(3);
  });
});
