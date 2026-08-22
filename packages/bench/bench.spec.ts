import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
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
  substitutions: number | null;
  deletions: number | null;
  insertions: number | null;
  text: string;
  error: string | null;
};

const MODELS = (process.env['BENCH_MODELS'] ?? 'tiny,base')
  .split(',')
  .map((name) => `onnx-community/whisper-${name.trim()}_timestamped`);

const DEVICES = (process.env['BENCH_DEVICES'] ?? 'wasm,webgpu').split(',').map((d) => d.trim());
const STEP = Number(process.env['BENCH_STEP'] ?? 1.5);

/** One minute of audio at real speed per streaming run, so only one fixture gets that. */
const LATENCY_FIXTURE = 'ted-60s';

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

  const devices = DEVICES.filter((device) => device !== 'webgpu' || hasWebgpu);
  if (devices.length < DEVICES.length) {
    console.log('webgpu is not available here, measuring what is left');
  }

  const rows: Row[] = [];

  for (const model of MODELS) {
    for (const device of devices) {
      for (const fixture of fixtures) {
        const modes: RunConfig['mode'][] =
          fixture.id === LATENCY_FIXTURE ? ['oneshot', 'stream'] : ['oneshot'];

        for (const mode of modes) {
          const config: RunConfig = {
            url: fixture.url,
            model,
            device: device as RunConfig['device'],
            dtype: 'q4',
            stepSeconds: STEP,
            mode,
            realtime: mode === 'stream',
            ...(fixture.language ? { language: fixture.language } : {}),
          };

          let result: RunResult;
          try {
            result = await page.evaluate(
              (input) =>
                (
                  globalThis as unknown as { aloudBench: { run(c: RunConfig): Promise<RunResult> } }
                ).aloudBench.run(input),
              config,
            );
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            rows.push(blank(fixture.id, fixture.language, mode, short(model), device, message));
            console.log(`${fixture.id} ${short(model)} ${device} ${mode}: failed`);
            continue;
          }

          const lag = [...result.lagSeconds].sort((a, b) => a - b);
          const scored = fixture.reference ? wordErrorRate(fixture.reference, result.text) : null;

          rows.push({
            fixture: fixture.id,
            language: fixture.language,
            mode,
            model: short(model),
            device: result.device,
            askedFor: device,
            audioSeconds: round(result.audioSeconds, 1),
            rtf: round(result.computeMs / 1000 / Math.max(result.audioSeconds, 0.001), 3),
            passes: result.passes,
            lagP50: percentile(lag, 0.5),
            lagP90: percentile(lag, 0.9),
            wer: scored ? round(scored.wer, 4) : null,
            substitutions: scored?.substitutions ?? null,
            deletions: scored?.deletions ?? null,
            insertions: scored?.insertions ?? null,
            text: result.text,
            error: null,
          });

          console.log(
            `${fixture.id} ${short(model)} ${result.device} ${mode}: rtf ${round(result.computeMs / 1000 / Math.max(result.audioSeconds, 0.001), 2)}` +
              (scored ? ` wer ${(scored.wer * 100).toFixed(1)}%` : ''),
          );
        }
      }
    }
  }

  expect(failures, failures.join('\n')).toEqual([]);
  expect(rows.length).toBeGreaterThan(0);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  await mkdir('report', { recursive: true });
  await writeFile(
    `report/bench-${stamp}.json`,
    JSON.stringify({ ranAt: new Date().toISOString(), isolated, step: STEP, rows }, null, 2),
  );
  await writeFile('report/latest.md', markdown(rows, isolated));
});

function markdown(rows: readonly Row[], isolated: boolean): string {
  const lines = [
    '# Benchmark',
    '',
    `Run ${new Date().toISOString().slice(0, 10)}. Cross-origin isolated: ${isolated ? 'yes' : 'no'}.`,
    'One pass over the whole file unless the mode says stream, in which case the file is played',
    'at real speed through the live pipeline.',
    '',
    '| Fixture | Model | Backend | Mode | Audio | RTF | WER | Lag p50 | Lag p90 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    if (row.error) {
      lines.push(`| ${row.fixture} | ${row.model} | ${row.device} | ${row.mode} | | | | | |`);
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
    substitutions: null,
    deletions: null,
    insertions: null,
    text: '',
    error,
  };
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

function short(model: string): string {
  return (model.split('/').pop() ?? model).replace('_timestamped', '').replace('whisper-', '');
}
