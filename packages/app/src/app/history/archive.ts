import { Injectable, signal } from '@angular/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import * as z from 'zod';

/** An hour of 16 kHz audio is about 115 MB, so ten long meetings already run to a gigabyte. */
const KEEP = 10;

const segment = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});

const summary = z.object({
  id: z.string(),
  startedAt: z.number(),
  seconds: z.number(),
  bytes: z.number(),
  translated: z.boolean(),
  language: z.string(),
  model: z.string(),
  segments: z.array(segment),
});

export type SessionSummary = z.infer<typeof summary>;

export type SavedSession = SessionSummary & {
  readonly audio: Blob | null;
};

// The one interface in the repo: idb resolves its generics through declaration merging.
interface Archive1 extends DBSchema {
  sessions: {
    key: string;
    value: SessionSummary;
    indexes: { 'by-date': number };
  };
  audio: {
    key: string;
    value: Blob;
  };
}

/**
 * Transcripts and their audio, kept in the browser and nowhere else. Rows are parsed on the
 * way out: a schema that changed under an old tab would otherwise surface as a blank screen
 * three components later.
 */
@Injectable({ providedIn: 'root' })
export class Archive {
  private db: Promise<IDBPDatabase<Archive1>> | null = null;

  readonly sessions = signal<readonly SessionSummary[]>([]);

  async refresh(): Promise<void> {
    const db = await this.open();
    const rows = await db.getAllFromIndex('sessions', 'by-date');

    const parsed: SessionSummary[] = [];
    for (const row of rows) {
      const result = summary.safeParse(row);
      if (result.success) parsed.push(result.data);
    }

    this.sessions.set(parsed.reverse());
  }

  /** Transcript and audio in one transaction, so a full disk cannot keep one without the other. */
  async save(session: SessionSummary, audio: Blob | null): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['sessions', 'audio'], 'readwrite');
    await Promise.all([
      tx.objectStore('sessions').put(session),
      audio ? tx.objectStore('audio').put(audio, session.id) : null,
      tx.done,
    ]);

    await this.prune(db);
    await this.refresh();
  }

  async load(id: string): Promise<SavedSession | null> {
    const db = await this.open();
    const row = await db.get('sessions', id);
    const result = summary.safeParse(row);
    if (!result.success) return null;

    const audio = (await db.get('audio', id)) ?? null;
    return { ...result.data, audio };
  }

  async remove(id: string): Promise<void> {
    await this.drop(await this.open(), [id]);
    await this.refresh();
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['sessions', 'audio'], 'readwrite');
    await Promise.all([
      tx.objectStore('sessions').clear(),
      tx.objectStore('audio').clear(),
      tx.done,
    ]);
    await this.refresh();
  }

  private async prune(db: IDBPDatabase<Archive1>): Promise<void> {
    const ids = await db.getAllKeysFromIndex('sessions', 'by-date');
    await this.drop(db, ids.slice(0, Math.max(0, ids.length - KEEP)));
  }

  private async drop(db: IDBPDatabase<Archive1>, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;

    const tx = db.transaction(['sessions', 'audio'], 'readwrite');
    await Promise.all([
      ...ids.flatMap((id) => [
        tx.objectStore('sessions').delete(id),
        tx.objectStore('audio').delete(id),
      ]),
      tx.done,
    ]);
  }

  private open(): Promise<IDBPDatabase<Archive1>> {
    this.db ??= openDB<Archive1>('aloud', 1, {
      upgrade(db) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('by-date', 'startedAt');
        db.createObjectStore('audio');
      },
    });
    return this.db;
  }
}
