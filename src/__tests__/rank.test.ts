import { describe, it, expect } from 'vitest';
import { jaccard, rankDiverseTags, directAndRelatedNotes } from '../lib/rank';
import type { Note } from '../lib/types';

function note(id: string, tags: string[], t = 0): Note {
  return { id, title: id, body: '', tags, createdAt: t, updatedAt: t };
}

describe('ranking + similarity', () => {
  it('jaccard similarity works', () => {
    const a = new Set(['1','2','3']);
    const b = new Set(['2','3','4']);
    expect(jaccard(a,b)).toBeCloseTo(2/4, 5);
  });

  it('rankDiverseTags prefers high score but diversifies', () => {
    const tags = ['red','blue','green','cyan'];
    const base: Record<string, number> = { red: 1.0, blue: 0.9, green: 0.8, cyan: 0.7 };
    const sim: any = {
      red:   { red:1, blue:0.8, green:0.1, cyan:0.1 },
      blue:  { red:0.8, blue:1, green:0.1, cyan:0.1 },
      green: { red:0.1, blue:0.1, green:1, cyan:0.6 },
      cyan:  { red:0.1, blue:0.1, green:0.6, cyan:1 },
    };
    const out = rankDiverseTags(tags, base, sim, 0.9, 3);
    expect(out[0]).toBe('red');
    // ensure diversity shows at least one of the less similar tags
    expect(out.includes('green') || out.includes('cyan')).toBe(true);
  });

  it('directAndRelatedNotes scores overlap + recency', () => {
    const now = Date.now();
    const notes: Note[] = [
      note('a', ['x','y'], now - 1000),
      note('b', ['x'], now - 5000),
      note('c', ['y','z'], now - 2000),
      note('d', ['w'], now - 10000)
    ];
    const { direct, related } = directAndRelatedNotes(notes, ['x','y']);
    expect(direct.map(n => n.id)).toEqual(['a']);
    expect(related[0].note.id).toBeDefined();
  });
});
