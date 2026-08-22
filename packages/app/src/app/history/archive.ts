import { Injectable, signal } from '@angular/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import * as z from 'zod';

/** Ten sessions of a long meeting is already a couple of hundred megabytes. */
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

  async save(session: SessionSummary, audio: Blob | null): Promise<void> {
    const db = await this.open();
    await db.put('sessions', session);
    if (audio) {
      await db.put('audio', audio, session.id);
    }

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
    const db = await this.open();
    await db.delete('sessions', id);
    await db.delete('audio', id);
    await this.refresh();
  }

  async clear(): Promise<void> {
    const db = await this.open();
    await db.clear('sessions');
    await db.clear('audio');
    await this.refresh();
  }

  private async prune(db: IDBPDatabase<Archive1>): Promise<void> {
    const ids = await db.getAllKeysFromIndex('sessions', 'by-date');
    for (const id of ids.slice(0, Math.max(0, ids.length - KEEP))) {
      await db.delete('sessions', id);
      await db.delete('audio', id);
    }
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
