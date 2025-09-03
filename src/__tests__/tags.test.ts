import { describe, it, expect } from 'vitest';
import { ensureContrastBgForWhite, contrastRatio } from '../lib/tags';

describe('tags color + contrast', () => {
  it('ensureContrastBgForWhite yields contrast ≥ 4.5', () => {
    const base = '#60a5fa'; // lightish blue
    const out = ensureContrastBgForWhite(base);
    const ratio = contrastRatio(out, '#ffffff');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
