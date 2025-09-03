import { describe, it, expect } from 'vitest';
import { SPLIT_RE, computedTitleFromBody, bodyWithoutTitle } from '../lib/text';

describe('text helpers', () => {
  it('SPLIT_RE splits by standard + unicode linebreaks', () => {
    const s = 'a\n b\r c\u2028 d\u2029 e';
    expect(s.split(SPLIT_RE).length).toBe(5);
  });

  it('computedTitleFromBody picks first non-empty line and trims to 120', () => {
    const title = computedTitleFromBody("\n\n  Hello world  \nNext line");
    expect(title).toBe('Hello world');
    const long = 'x'.repeat(200);
    expect(computedTitleFromBody(long)).toHaveLength(120);
  });

  it('bodyWithoutTitle removes the title line', () => {
    const body = 'Title line\nOther\nLines';
    expect(bodyWithoutTitle(body)).toBe('Other\nLines');
  });
});
