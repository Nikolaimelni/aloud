/**
 * Whisper writes "Mr." where LibriSpeech references write "MISTER", and that single
 * difference was a sixth of the error rate on a seventeen word clip. A real evaluation uses
 * the full Whisper text normaliser; this is the short version, and the numbers it produces
 * are only comparable against each other.
 */
const SPELLED_OUT: Record<string, string> = {
  mr: 'mister',
  mrs: 'missus',
  ms: 'miss',
  dr: 'doctor',
  prof: 'professor',
  st: 'saint',
  jr: 'junior',
  sr: 'senior',
};

export function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => SPELLED_OUT[word] ?? word);
}
