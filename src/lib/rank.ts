import type { Note, TagIndex } from './types';

export function buildTagIndex(notes: Note[]): TagIndex {
  const idx: TagIndex = {};
  for (const n of notes) {
    for (const t of n.tags) {
      if (!idx[t]) idx[t] = new Set();
      idx[t].add(n.id);
    }
  }
  return idx;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const v of s) if (l.has(v)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function normalize(nums: number[]): number[] {
  const max = Math.max(0, ...nums);
  if (max === 0) return nums.map(() => 0);
  return nums.map((x) => x / max);
}

export function tagBaseScores(notes: Note[]): Record<string, number> {
  const idx = buildTagIndex(notes);
  const tags = Object.keys(idx);
  const freqs = tags.map((t) => idx[t].size);
  const maxFreq = Math.max(1, ...freqs);
  const now = Date.now();
  const lastUsed: Record<string, number> = {};
  for (const n of notes) {
    for (const t of n.tags) {
      lastUsed[t] = Math.max(lastUsed[t] ?? 0, n.updatedAt || n.createdAt);
    }
  }
  const recencies = tags.map((t) => 1 - Math.min(1, (now - (lastUsed[t] || 0)) / (1000 * 60 * 60 * 24 * 30))); // 0..1 over ~30d
  const normFreq = normalize(freqs);

  const scores: Record<string, number> = {};
  tags.forEach((t, i) => {
    const base = normFreq[i] + 0.2 * recencies[i];
    scores[t] = base;
  });
  return scores;
}

export function tagSimilarityMatrix(idx: TagIndex): Record<string, Record<string, number>> {
  const tags = Object.keys(idx);
  const M: Record<string, Record<string, number>> = {};
  for (const a of tags) {
    M[a] = {} as Record<string, number>;
    for (const b of tags) {
      if (a === b) { M[a][b] = 1; continue; }
      M[a][b] = jaccard(idx[a], idx[b]);
    }
  }
  return M;
}

/** Maximal Marginal Relevance for tag list diversity */
export function rankDiverseTags(
  tags: string[],
  base: Record<string, number>,
  sim: Record<string, Record<string, number>>,
  lambda = 0.92,
  limit = Infinity
): string[] {
  const cand = new Set(tags);
  const out: string[] = [];
  while (cand.size && out.length < limit) {
    let bestTag: string | null = null;
    let bestScore = -Infinity;
    for (const t of cand) {
      const rel = base[t] ?? 0;
      let maxSim = 0;
      for (const s of out) maxSim = Math.max(maxSim, sim[t]?.[s] ?? 0);
      const score = lambda * rel - (1 - lambda) * maxSim;
      if (score > bestScore) { bestScore = score; bestTag = t; }
    }
    if (!bestTag) break;
    out.push(bestTag);
    cand.delete(bestTag);
  }
  return out;
}

export function rankTopBarTags(notes: Note[], selected: string[]): string[] {
  const idx = buildTagIndex(notes);
  const base = tagBaseScores(notes);
  const sim = tagSimilarityMatrix(idx);
  const all = Object.keys(idx);

  // Lock selected first
  const locked = selected.slice();
  const remaining = all.filter((t) => !selected.includes(t));

  if (selected.length === 0) {
    return rankDiverseTags(remaining, base, sim, 0.92, 50);
  }

  // Related-first when filter active
  // Compute relatedness to the selected set
  function relScore(tag: string): number {
    let s = 0;
    for (const sel of selected) s += (sim[tag]?.[sel] ?? 0);
    return s / selected.length;
  }

  const related = remaining.filter((t) => relScore(t) >= 0.2)
    .sort((a, b) => (relScore(b) + (base[b] ?? 0)) - (relScore(a) + (base[a] ?? 0)));

  const rest = remaining.filter((t) => !related.includes(t));
  const diversified = rankDiverseTags(rest, base, sim, 0.92, 50);

  return [...locked, ...related, ...diversified];
}

export function directAndRelatedNotes(notes: Note[], selected: string[]): { direct: Note[]; related: { note: Note; score: number }[] } {
  const idMap: Record<string, Note> = Object.fromEntries(notes.map(n => [n.id, n]));
  const tagIdx = buildTagIndex(notes);
  const sim = tagSimilarityMatrix(tagIdx);

  const selectedSet = new Set(selected);

  const direct = notes
    .filter(n => selected.every(t => n.tags.includes(t)))
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

  const rest = notes.filter(n => !direct.includes(n));

  const related = rest.map(n => {
    const overlap = n.tags.filter(t => selectedSet.has(t)).length; // overlapCount
    let co = 0;
    for (const st of selected) {
      for (const nt of n.tags) co += sim[st]?.[nt] ?? 0;
    }
    const now = Date.now();
    const rec = 1 - Math.min(1, (now - (n.updatedAt || n.createdAt)) / (1000 * 60 * 60 * 24 * 30));
    const freqBoost = n.tags.length * 0.1;
    const score = overlap * 5 + co + rec * 0.5 + freqBoost;
    return { note: idMap[n.id], score };
  }).sort((a, b) => b.score - a.score);

  return { direct, related };
}
