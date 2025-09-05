import type { Note, TagColorMap } from './types';

const NOTES_KEY = 'storm_notes';
const TAG_COLORS_KEY = 'storm_tag_colors';

/* ---------------- seed-notater: behold og gjenopprett ---------------- */

type SeedSpec = { title: string; bodyLines: string[]; tags: string[]; key: string };

const SEEDS: SeedSpec[] = [
  {
    key: 'seed-welcome',
    title: 'Velkommen til Storm',
    bodyLines: [
      'Velkommen!',
      'Dette er Storm – hvor du kan lage ditt eget tankekart med tagger, ved å notere og linke.',
      'Noter, og få forslag til tagger som relaterer.'
    ],
    tags: ['storm','intro']
  },
  {
    key: 'seed-filter',
    title: 'Filtrér med tagger',
    bodyLines: [
      'Trykk på tagger i topplinja for å filtrere notater.',
      'Direkte treff vises nederst (nyeste nederst), relaterte over.'
    ],
    tags: ['storm','intro','filtre']
  },
  {
    key: 'seed-share',
    title: 'Del til Storm fra nettleseren',
    bodyLines: [
      'Del en artikkel fra nettleseren til Storm.',
      'Appen oppretter et notat med tittel, de første linjene og lenke.',
      'Prøv: Åpne en artikkel → Del → “Storm – Notater”.'
    ],
    tags: ['storm','del']
  },
  {
    key: 'seed-image',
    title: 'Legg til bilde i notat',
    bodyLines: [
      'Bruk bilde-ikonet når du redigerer for å legge til bilde. Bilder skaleres automatisk.'
    ],
    tags: ['storm','bilder']
  },
  {
    key: 'seed-suggest',
    title: 'Live tagg-forslag mens du skriver',
    bodyLines: [
      'Når du skriver, henter Storm forslag fra teksten. Kjente tagger fargekodes først; nye ord vises nøytralt.',
      'Tips: Trykk på en forslag-chip for å legge den til – du forblir i teksten.'
    ],
    tags: ['storm','forslag','tag']
  },
  {
    key: 'seed-pwa',
    title: 'WebApp og lagring',
    bodyLines: [
      'Installer som app/Legg til på startskjermen (Android/iOS). Notater lagres lokalt og bevares på tvers av oppdateringer.'
    ],
    tags: ['storm','pwa','lagring']
  },
  {
    key: 'seed-contact',
    title: 'Kontakt',
    bodyLines: [
      'Tilbakemeldinger mottas med skål. heartbar369@gmail.com'
    ],
    tags: ['storm','kontakt','feedback']
  }
];

function makeNoteFromSeed(seed: SeedSpec, createdAt: number): Note {
  const body = [seed.title, ...seed.bodyLines].join('\n');
  return {
    id: seed.key,
    title: seed.title,
    body,
    tags: seed.tags.map(t => t.toLowerCase()),
    createdAt,
    updatedAt: createdAt
  };
}

/** Legg til manglende seed-notater (matcher på tittel) uten å duplisere eksisterende. */
function ensureSeedNotesPresent(existing: Note[]): Note[] {
  const now = Date.now();
  const titles = new Set(existing.map(n => (n.title || '').trim()));
  const missing = SEEDS.filter(s => !titles.has(s.title));
  if (missing.length === 0) return existing;

  const added: Note[] = [];
  for (let i = 0; i < missing.length; i++) {
    const offsetMs = (missing.length - i) * 2000 + 1000;
    added.push(makeNoteFromSeed(missing[i], now - offsetMs));
  }
  return [...existing, ...added];
}

/* ---------------- basic storage utils ---------------- */

export function debounce<T extends (...args: any[]) => void>(fn: T, ms = 150) {
  let t: number | undefined;
  return (...args: Parameters<T>) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const arr = raw ? (JSON.parse(raw) as Note[]) : [];
    const merged = ensureSeedNotesPresent(Array.isArray(arr) ? arr : []);
    if (merged.length !== (arr?.length || 0)) {
      localStorage.setItem(NOTES_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch {
    const merged = ensureSeedNotesPresent([]);
    localStorage.setItem(NOTES_KEY, JSON.stringify(merged));
    return merged;
  }
}

export function saveNotes(notes: Note[]) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

export function loadTagColors(): TagColorMap {
  try {
    const raw = localStorage.getItem(TAG_COLORS_KEY);
    return raw ? (JSON.parse(raw) as TagColorMap) : {};
  } catch { return {}; }
}

export function saveTagColors(map: TagColorMap) {
  localStorage.setItem(TAG_COLORS_KEY, JSON.stringify(map));
}
