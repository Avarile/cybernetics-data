import { shouldResetFieldValue } from './utils';

describe('shouldResetFieldValue', () => {
  it('treats isExactly as an array operator like core does', () => {
    // array -> array keeps the selection
    expect(shouldResetFieldValue('isExactly', 'hasAnyOf')).toBe(false);
    expect(shouldResetFieldValue('hasAllOf', 'isExactly')).toBe(false);
    expect(shouldResetFieldValue('isNotExactly', 'isExactly')).toBe(false);
    // array <-> single value resets
    expect(shouldResetFieldValue('contains', 'isExactly')).toBe(true);
    expect(shouldResetFieldValue('isExactly', 'contains')).toBe(true);
  });

  it('resets when switching to or from an empty operator', () => {
    expect(shouldResetFieldValue('isEmpty', 'isExactly')).toBe(true);
    expect(shouldResetFieldValue('is', 'isNotEmpty')).toBe(true);
  });

  it('keeps the value between single value operators', () => {
    expect(shouldResetFieldValue('is', 'isNot')).toBe(false);
  });
});
