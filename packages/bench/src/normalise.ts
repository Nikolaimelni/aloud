/**
 * Whisper writes "Mr." where LibriSpeech references write "MISTER", and "50" where a Russian
 * reference writes "пятьдесят". Both were counted as errors until this existed, and on a
 * fifteen word clip one of them is seven percent. A real evaluation uses the full Whisper
 * text normaliser; this is the short version, and the numbers it produces are only comparable
 * against each other.
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
 * through the same table, so the only risk is being consistently odd. Russian numerals
 * decline and only the nominative is here, which covers how people usually say a round number.
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
  ноль: '0',
  один: '1',
  одна: '1',
  два: '2',
  две: '2',
  три: '3',
  четыре: '4',
  пять: '5',
  шесть: '6',
  семь: '7',
  восемь: '8',
  девять: '9',
  десять: '10',
  одиннадцать: '11',
  двенадцать: '12',
  тринадцать: '13',
  четырнадцать: '14',
  пятнадцать: '15',
  шестнадцать: '16',
  семнадцать: '17',
  восемнадцать: '18',
  девятнадцать: '19',
  двадцать: '20',
  тридцать: '30',
  сорок: '40',
  пятьдесят: '50',
  шестьдесят: '60',
  семьдесят: '70',
  восемьдесят: '80',
  девяносто: '90',
  сто: '100',
  тысяча: '1000',
};

export function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => SPELLED_OUT[word] ?? NUMBERS[word] ?? word);
}
