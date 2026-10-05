/**
 * The model writes "Mr." where LibriSpeech references write "MISTER", and "50" where a
 * reference spells the number out. Both were counted as errors until this existed, and on the
 * seventeen word LibriSpeech clip one of them is six percent. A real evaluation uses the full
 * Whisper text normaliser; this is the short version, and the numbers it produces are only
 * comparable against each other.
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

/**
 * Said out loud a number is a word; written down by the model it is a digit. Both sides go
 * through the same table, so the only risk is being consistently odd.
 */
const NUMBERS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
  thousand: '1000',
};

/** Looked up in a Map: indexing the objects, "constructor" would find Object's own. */
const REPLACEMENTS = new Map([...Object.entries(SPELLED_OUT), ...Object.entries(NUMBERS)]);

export function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => REPLACEMENTS.get(word) ?? word);
}
