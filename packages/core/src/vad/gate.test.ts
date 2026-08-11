import { describe, expect, it } from 'vitest';
import { SpeechGate } from './gate';

/** Silero sees 512 samples at 16 kHz at a time. */
const BLOCK_MS = 32;

describe('SpeechGate', () => {
  it('starts closed', () => {
    expect(new SpeechGate().speaking).toBe(false);
  });

  it('opens as soon as the model is confident', () => {
    const gate = new SpeechGate();
    expect(gate.update(0.9, BLOCK_MS)).toBe(true);
  });

  it('holds through the gap between two words', () => {
    const gate = new SpeechGate({ hangoverMs: 250 });
    gate.update(0.9, BLOCK_MS);

    // Five blocks of silence is 160 ms, shorter than the hangover.
    for (let i = 0; i < 5; i++) {
      expect(gate.update(0.02, BLOCK_MS)).toBe(true);
    }
  });

  it('closes once the silence outlasts the hangover', () => {
    const gate = new SpeechGate({ hangoverMs: 250 });
    gate.update(0.9, BLOCK_MS);

    let speaking = true;
    for (let i = 0; i < 10; i++) {
      speaking = gate.update(0.02, BLOCK_MS);
    }

    expect(speaking).toBe(false);
  });

  it('does not chatter in the band between the thresholds', () => {
    const gate = new SpeechGate({ enter: 0.5, exit: 0.35, hangoverMs: 100 });
    gate.update(0.9, BLOCK_MS);

    for (let i = 0; i < 20; i++) {
      expect(gate.update(0.42, BLOCK_MS)).toBe(true);
    }
  });

  it('needs the full threshold again after closing', () => {
    const gate = new SpeechGate({ hangoverMs: 32 });
    gate.update(0.9, BLOCK_MS);
    gate.update(0.01, BLOCK_MS);
    gate.update(0.01, BLOCK_MS);
    expect(gate.speaking).toBe(false);

    expect(gate.update(0.4, BLOCK_MS)).toBe(false);
    expect(gate.update(0.6, BLOCK_MS)).toBe(true);
  });
});
