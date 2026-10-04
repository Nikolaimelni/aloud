import { describe, expect, it } from 'vitest';
import { queued } from './queue';

describe('queued', () => {
  it('starts the next call only once the last one has finished', async () => {
    const log: string[] = [];
    const run = queued(async (name: string) => {
      log.push(`${name} in`);
      await new Promise((resolve) => setTimeout(resolve, name === 'slow' ? 20 : 0));
      log.push(`${name} out`);
    });

    await Promise.all([run('slow'), run('fast')]);

    expect(log).toEqual(['slow in', 'slow out', 'fast in', 'fast out']);
  });

  it('keeps going after a call fails, and hands the failure to its caller', async () => {
    const run = queued(async (fail: boolean) => {
      if (fail) throw new Error('bad request');
    });

    const failed = run(true);
    const next = run(false);

    await expect(failed).rejects.toThrow('bad request');
    await expect(next).resolves.toBeUndefined();
  });
});
