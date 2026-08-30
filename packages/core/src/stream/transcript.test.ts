import { describe, expect, it } from 'vitest';
import { clock, highlight, toMarkdown, toSegments } from './transcript';
import type { Word } from './stabilize';

function word(text: string, start: number, end: number): Word {
  return { text: ` ${text}`, start, end };
}

describe('toSegments', () => {
  it('keeps words that run together on one line', () => {
    const segments = toSegments([
      word('we', 0, 0.3),
      word('ship', 0.3, 0.7),
      word('friday', 0.8, 1.3),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: 0, end: 1.3, text: 'we ship friday' });
  });

  it('breaks where someone stopped to breathe', () => {
    const segments = toSegments([
      word('we', 0, 0.3),
      word('ship', 0.3, 0.7),
      word('actually', 2.0, 2.5),
      word('no', 2.5, 2.8),
    ]);

    expect(segments.map((segment) => segment.text)).toEqual(['we ship', 'actually no']);
  });

  it('breaks a monologue at the ceiling even with no pause', () => {
    const words: Word[] = [];
    for (let i = 0; i < 60; i++) {
      words.push(word(`w${i}`, i * 0.4, i * 0.4 + 0.35));
    }

    const segments = toSegments(words, { maxSeconds: 6 });

    expect(segments.length).toBeGreaterThan(3);
    for (const segment of segments) {
      expect(segment.end - segment.start).toBeLessThanOrEqual(6.5);
    }
  });

  it('has nothing to say about nothing', () => {
    expect(toSegments([])).toEqual([]);
  });
});

describe('clock', () => {
  it('counts in minutes until it has to count in hours', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(9.7)).toBe('00:09');
    expect(clock(61)).toBe('01:01');
    expect(clock(3725)).toBe('1:02:05');
  });
});

describe('toMarkdown', () => {
  it('writes something a colleague could read', () => {
    const markdown = toMarkdown(
      [
        { start: 0, end: 4, text: 'So the deploy goes out Wednesday.' },
        { start: 6.5, end: 9, text: 'And we roll back by hand if it breaks.' },
      ],
      { title: 'Standup', recordedAt: new Date('2026-09-12T09:30:00Z') },
    );

    expect(markdown).toContain('# Standup');
    expect(markdown).toContain('Recorded 2026-09-12 09:30');
    expect(markdown).toContain('**00:00** So the deploy goes out Wednesday.');
    expect(markdown).toContain('**00:06** And we roll back by hand if it breaks.');
    expect(markdown.endsWith('\n')).toBe(true);
  });

  it('says when the text has been translated', () => {
    const markdown = toMarkdown([{ start: 0, end: 1, text: 'Hello.' }], { translated: true });
    expect(markdown).toContain('Translated to English');
  });
});

describe('highlight', () => {
  it('hands back the whole line when nothing is being searched for', () => {
    expect(highlight('we ship on friday', '')).toEqual([{ text: 'we ship on friday', hit: false }]);
  });

  it('marks every occurrence and keeps the original spelling', () => {
    expect(highlight('Friday, and then friday again', 'friday')).toEqual([
      { text: 'Friday', hit: true },
      { text: ', and then ', hit: false },
      { text: 'friday', hit: true },
      { text: ' again', hit: false },
    ]);
  });

  it('loses nothing: the parts always put the line back together', () => {
    const line = 'so the deploy goes out on wednesday, deploy again on friday';

    for (const needle of ['deploy', 'o', 'wednesday', 'zzz', 'so']) {
      expect(
        highlight(line, needle)
          .map((part) => part.text)
          .join(''),
      ).toBe(line);
    }
  });

  it('says nothing matched rather than inventing an empty part', () => {
    expect(highlight('nothing here', 'friday')).toEqual([{ text: 'nothing here', hit: false }]);
  });
});
