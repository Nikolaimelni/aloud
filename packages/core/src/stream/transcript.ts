import type { Word } from './stabilize';

export type Segment = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

export type SegmentOptions = {
  /** A pause longer than this starts a new line. */
  readonly gapSeconds?: number;
  /** Hard ceiling, so someone who never pauses does not become one paragraph. */
  readonly maxSeconds?: number;
};

const GAP = 0.8;
const MAX = 18;

/**
 * Words into readable lines. Pauses do most of the work, because that is where a person
 * would have put a line break anyway.
 */
export function toSegments(words: readonly Word[], options: SegmentOptions = {}): Segment[] {
  const gap = options.gapSeconds ?? GAP;
  const max = options.maxSeconds ?? MAX;

  const segments: Segment[] = [];
  let current: Word[] = [];

  const close = () => {
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return;

    segments.push({
      start: first.start,
      end: last.end,
      text: current
        .map((word) => word.text)
        .join('')
        .trim(),
    });
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    const opened = current[0];
    if (previous && opened && (word.start - previous.end > gap || word.end - opened.start > max)) {
      close();
    }
    current.push(word);
  }
  close();

  return segments;
}

export type MarkdownOptions = {
  readonly title?: string;
  readonly recordedAt?: Date;
  readonly language?: string;
  readonly translated?: boolean;
  /** Lines the summary picked out, if anyone asked for one. */
  readonly highlights?: readonly Segment[];
};

export function toMarkdown(segments: readonly Segment[], options: MarkdownOptions = {}): string {
  const lines: string[] = [`# ${options.title ?? 'Transcript'}`, ''];

  const facts: string[] = [];
  if (options.recordedAt) {
    facts.push(`Recorded ${options.recordedAt.toISOString().slice(0, 16).replace('T', ' ')}`);
  }
  const last = segments[segments.length - 1];
  if (last) {
    facts.push(`${clock(last.end)} long`);
  }
  if (options.translated) {
    facts.push('Translated to English');
  } else if (options.language) {
    facts.push(`Language: ${options.language}`);
  }
  facts.push('Transcribed on device with Whisper, so expect mistakes');

  if (facts.length > 0) {
    lines.push(facts.join('. ') + '.', '');
  }

  const highlights = options.highlights ?? [];
  if (highlights.length > 0) {
    lines.push('## The gist', '');
    for (const segment of highlights) {
      lines.push(`- **${clock(segment.start)}** ${segment.text}`);
    }
    lines.push('', 'Picked out of the transcript by sentence similarity, not rewritten.', '');
    lines.push('## Transcript', '');
  }

  for (const segment of segments) {
    lines.push(`**${clock(segment.start)}** ${segment.text}`, '');
  }

  return lines.join('\n').trimEnd() + '\n';
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;

  if (minutes < 60) {
    return `${pad(minutes)}:${pad(rest)}`;
  }
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(rest)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
