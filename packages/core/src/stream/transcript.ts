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
  /** IANA zone for the recording time. Left out, wherever the code is running. */
  readonly timeZone?: string;
  readonly language?: string;
  readonly translated?: boolean;
  /** Lines the summary picked out, if anyone asked for one. */
  readonly highlights?: readonly Segment[];
};

export type LocalStamp = {
  /** 2026-09-21 */
  readonly date: string;
  /** 15:00 */
  readonly time: string;
  /** GMT+3, UTC */
  readonly zone: string;
};

/**
 * Wall-clock time in a zone, split so a file name and a heading can both use it. toISOString
 * would give UTC with nothing to say so, which puts every recording three hours early in Moscow.
 */
export function localStamp(at: Date, timeZone?: string): LocalStamp {
  const parts = new Map(
    new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
      ...(timeZone ? { timeZone } : {}),
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`,
    time: `${parts.get('hour')}:${parts.get('minute')}`,
    zone: parts.get('timeZoneName') ?? '',
  };
}

export function toMarkdown(segments: readonly Segment[], options: MarkdownOptions = {}): string {
  const lines: string[] = [`# ${options.title ?? 'Transcript'}`, ''];

  const facts: string[] = [];
  if (options.recordedAt) {
    const { date, time, zone } = localStamp(options.recordedAt, options.timeZone);
    facts.push(`Recorded ${date} ${time} ${zone}`);
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
  lines.push(facts.join('. ') + '.', '');

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

export type TextPart = {
  readonly text: string;
  readonly hit: boolean;
};

/**
 * Case-insensitive, with positions in the text as given. Searching a lowercased copy would
 * shift every match after a character that lowercases to two, such as 'İ'.
 */
function pattern(needle: string): RegExp {
  return new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
}

/** Whether a line matches the search, by the same rule the highlighting uses. */
export function contains(text: string, needle: string): boolean {
  return !needle || pattern(needle).test(text);
}

/**
 * Splits a line around every occurrence of a search term, so the view can mark the matches
 * without putting markup into the transcript itself.
 */
export function highlight(text: string, needle: string): TextPart[] {
  if (!needle) {
    return [{ text, hit: false }];
  }

  const parts: TextPart[] = [];
  let at = 0;

  for (const match of text.matchAll(pattern(needle))) {
    if (match.index > at) {
      parts.push({ text: text.slice(at, match.index), hit: false });
    }
    parts.push({ text: match[0], hit: true });
    at = match.index + match[0].length;
  }

  if (at < text.length) {
    parts.push({ text: text.slice(at), hit: false });
  }
  return parts;
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
