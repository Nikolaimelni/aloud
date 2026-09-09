import { describe, expect, it } from 'vitest';
import { whisperLanguage } from './languages';

describe('whisperLanguage', () => {
  it('takes a code or a name, in any case', () => {
    expect(whisperLanguage('ru')).toBe('ru');
    expect(whisperLanguage(' Russian ')).toBe('ru');
    expect(whisperLanguage('haw')).toBe('haw');
    expect(whisperLanguage('castilian')).toBe('es');
  });

  it('leaves an empty field to the model', () => {
    expect(whisperLanguage('   ')).toBe('');
  });

  it('turns down what Whisper would throw on', () => {
    expect(whisperLanguage('rusian')).toBeNull();
    expect(whisperLanguage('constructor')).toBeNull();
  });
});
