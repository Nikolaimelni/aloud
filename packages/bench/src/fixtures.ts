import { readFileSync } from 'node:fs';
import * as z from 'zod';

const fixture = z.object({
  id: z.string(),
  /** A stable remote file, or a path under `public/` for the few clips worth committing. */
  url: z.union([z.url(), z.string().regex(/^\/[\w./-]+$/)]),
  language: z.string(),
  note: z.string(),
  source: z.string(),
  /** Null means this clip is timed but not scored. */
  reference: z.string().nullable(),
});

const manifest = z.object({
  note: z.string(),
  fixtures: z.array(fixture).min(1),
});

export type Fixture = z.infer<typeof fixture>;

/** Hand-edited file, so it is parsed rather than trusted. A typo should say where. */
export function loadFixtures(): Fixture[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../fixtures.json', import.meta.url), 'utf8'),
  );
  return manifest.parse(raw).fixtures;
}
