import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { env } from './env';
import { loadFixtures } from './src/fixtures';
import { wordErrorRate } from './src/wer';
import type { RunConfig, RunResult } from './src/harness';

type Row = {
  fixture: string;
  language: string;
  mode: string;
  model: string;
  device: string;
  askedFor: string;
  audioSeconds: number;
  rtf: number;
  passes: number;
  lagP50: number | null;
  lagP90: number | null;
  wer: number | null;
  referenceWords: number | null;
  substitutions: number | null;
  deletions: number | null;
  insertions: number | null;
  text: string;
  error: string | null;
};

/**
 * Streaming runs play at real speed, so they cost what they are worth in seconds and only a
 * couple of fixtures get one. The minute of English is for the latency percentiles; the short
 * Russian clip is there because whisper-tiny runs away into a decoder loop on it, and the
 * difference between the two modes is the value of the stabiliser's loop trimming.
 */
const STREAM_FIXTURES = new Set(env.BENCH_STREAM);

/**
 * A configuration that cannot finish should cost one row, not the afternoon. Learned the hard
 * way: a model that would not load turned a five minute sweep into three and a half hours.
 */
const RUN_TIMEOUT_MS = env.BENCH_RUN_TIMEOUT;

const fixtures = loadFixtures();

test('measure', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));

  await page.goto('/');
  await page.waitForFunction(() => 'aloudBench' in globalThis);

  const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);

  // A runner without a graphics card should say so once, not fail every row.
  const hasWebgpu = await page.evaluate(async () => {
    if (!('gpu' in navigator)) return false;
    try {
      return (await navigator.gpu.requestAdapter()) !== null;
    } catch {
      return false;
    }
  });

  const devices = env.BENCH_DEVICES.filter((device) => device !== 'webgpu' || hasWebgpu);
  if (devices.length < env.BENCH_DEVICES.length) {
    console.log('webgpu is not available here, measuring what is left');
  }

  const rows: Row[] = [];
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  try {
    for (const model of env.BENCH_MODELS) {
      for (const device of devices) {
        for (const fixture of fixtures) {
          const modes: RunConfig['mode'][] = STREAM_FIXTURES.has(fixture.id)
            ? ['oneshot', 'stream']
            : ['oneshot'];

          for (const mode of modes) {
            const config: RunConfig = {
              url: fixture.url,
              model,
              device,
              dtype: 'q4',
              stepSeconds: env.BENCH_STEP,
              mode,
              realtime: mode === 'stream',
              ...(fixture.language ? { language: fixture.language } : {}),
            };

            let result: RunResult;
            try {
              result = await Promise.race([
                page.evaluate(
                  (input) =>
                    (
                      globalThis as unknown as {
                        aloudBench: { run(c: RunConfig): Promise<RunResult> };
                      }
                    ).aloudBench.run(input),
                  config,
                ),
                timeout(RUN_TIMEOUT_MS),
              ]);
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : String(cause);
              rows.push(blank(fixture.id, fixture.language, mode, model, device, message));
              console.log(`${fixture.id} ${model} ${device} ${mode}: ${message.slice(0, 90)}`);

              // The page may still be chewing on whatever hung. Start it again from scratch.
              await page.reload();
              await page.waitForFunction(() => 'aloudBench' in globalThis);
              continue;
            }

            const lag = [...result.lagSeconds].sort((a, b) => a - b);
            const scored = fixture.reference ? wordErrorRate(fixture.reference, result.text) : null;
            const rtf = round(result.computeMs / 1000 / Math.max(result.audioSeconds, 0.001), 3);

            rows.push({
              fixture: fixture.id,
              language: fixture.language,
              mode,
              model,
              device: result.device,
              askedFor: device,
              audioSeconds: round(result.audioSeconds, 1),
              rtf,
              passes: result.passes,
              lagP50: percentile(lag, 0.5),
              lagP90: percentile(lag, 0.9),
              wer: scored ? round(scored.wer, 4) : null,
              referenceWords: scored?.referenceWords ?? null,
              substitutions: scored?.substitutions ?? null,
              deletions: scored?.deletions ?? null,
              insertions: scored?.insertions ?? null,
              text: result.text,
              error: null,
            });

            console.log(
              `${fixture.id} ${model} ${result.device} ${mode}: rtf ${rtf}` +
                (scored ? ` wer ${(scored.wer * 100).toFixed(1)}%` : ''),
            );
          }
        }
      }
    }
  } finally {
    // The report is the point of the exercise; losing it because one row failed would be the
    // wrong way round.
    await mkdir('report', { recursive: true });
    await writeFile(
      `report/bench-${stamp}.json`,
      JSON.stringify(
        { ranAt: new Date().toISOString(), isolated, step: env.BENCH_STEP, rows },
        null,
        2,
      ),
    );
    await writeFile('report/latest.md', markdown(rows, isolated));
  }

  expect(failures, failures.join('\n')).toEqual([]);
  expect(rows.length).toBeGreaterThan(0);
  expect(
    rows.some((row) => row.error === null),
    'every configuration failed',
  ).toBe(true);
});

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`gave up after ${ms / 1000} s`)), ms),
  );
}

function markdown(rows: readonly Row[], isolated: boolean): string {
  const lines = [
    '# Benchmark',
    '',
    `Run ${new Date().toISOString().slice(0, 10)}. Cross-origin isolated: ${isolated ? 'yes' : 'no'}.`,
    'One pass over the whole file unless the mode says stream, in which case the file is played',
    'at real speed through the live pipeline.',
    '',
    ...summary(rows),
    '## Every run',
    '',
    '| Fixture | Model | Backend | Mode | Audio | RTF | WER | Lag p50 | Lag p90 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    if (row.error) {
      lines.push(
        `| ${row.fixture} | ${row.model} | ${row.device} | ${row.mode} | ${row.error.slice(0, 50)} | | | | |`,
      );
      continue;
    }
    lines.push(
      `| ${row.fixture} | ${row.model} | ${row.device} | ${row.mode} | ${row.audioSeconds} s | ${row.rtf} | ${
        row.wer === null ? '' : `${(row.wer * 100).toFixed(1)}%`
      } | ${row.lagP50 === null ? '' : `${row.lagP50} s`} | ${
        row.lagP90 === null ? '' : `${row.lagP90} s`
      } |`,
    );
  }

  lines.push('', 'Fixtures without a reference transcript are measured for speed only.', '');
  return lines.join('\n');
}

/**
 * Pooled across clips: total errors over total reference words, not the mean of the per-clip
 * rates. A fifteen word clip should not weigh the same as a sixty word one.
 *
 * One pass per clip only, and one row per backend. A streamed run of a clip is the same audio
 * again, and it costs several times more, so pooling it in counts the clip twice and drags the
 * mean cost up with it.
 */
function summary(rows: readonly Row[]): string[] {
  const groups = new Map<
    string,
    { clips: number; words: number; errors: number; rtf: number; rates: number[] }
  >();

  for (const row of rows) {
    if (row.error || row.mode !== 'oneshot' || row.wer === null || row.referenceWords === null) {
      continue;
    }

    const key = `${row.language}|${row.model}|${row.device}`;
    const group = groups.get(key) ?? { clips: 0, words: 0, errors: 0, rtf: 0, rates: [] };
    group.clips++;
    group.words += row.referenceWords;
    group.errors += (row.substitutions ?? 0) + (row.deletions ?? 0) + (row.insertions ?? 0);
    group.rtf += row.rtf;
    group.rates.push(row.wer);
    groups.set(key, group);
  }

  if (groups.size === 0) return [];

  const lines = [
    '## Pooled',
    '',
    '| Language | Model | Backend | Clips | Reference words | WER | Median WER | Mean RTF |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const [key, group] of [...groups].sort()) {
    const [language, model, device] = key.split('|');
    lines.push(
      `| ${language} | ${model} | ${device} | ${group.clips} | ${group.words} | ${(
        (group.errors / Math.max(group.words, 1)) *
        100
      ).toFixed(1)}% | ${(median(group.rates) * 100).toFixed(1)}% | ${round(
        group.rtf / group.clips,
        2,
      )} |`,
    );
  }

  return [...lines, ''];
}

function blank(
  fixture: string,
  language: string,
  mode: string,
  model: string,
  device: string,
  error: string,
): Row {
  return {
    fixture,
    language,
    mode,
    model,
    device,
    askedFor: device,
    audioSeconds: 0,
    rtf: 0,
    passes: 0,
    lagP50: null,
    lagP90: null,
    wer: null,
    referenceWords: null,
    substitutions: null,
    deletions: null,
    insertions: null,
    text: '',
    error,
  };
}

/** One clip that ran away into a decoder loop should not decide what the typical clip looks like. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function percentile(sorted: readonly number[], at: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(at * sorted.length));
  return round(sorted[index]!, 2);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
