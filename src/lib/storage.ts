import type { Note, TagColorMap } from './types';

const NOTES_KEY = 'storm_notes';
const TAG_COLORS_KEY = 'storm_tag_colors';
const SEED_VERSION_KEY = 'storm_seed_version';
const CURRENT_SEED_VERSION = '1';

export function debounce<T extends (...args: any[]) => void>(fn: T, ms = 150) {
  let t: number | undefined;
  return (...args: Parameters<T>) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
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

function makeSeedNotes(): Note[] {
  const now = Date.now();
  let step = 0;

  const mk = (bodyLines: string[], tags: string[]) => {
    const body = bodyLines.join('\n').trim();
    const title = (body.split(/\r\n|\n|\r|\u2028|\u2029/).find(l => l.trim().length > 0) || '').slice(0, 120);
    const createdAt = now - (bodyLines.length + step++) * 1000; // sikrer rekkefølge, eldst først
    return {
      id: Math.random().toString(36).slice(2) + createdAt.toString(36),
      title,
      body,
      tags: tags.map(t => t.trim().toLowerCase()),
      createdAt,
      updatedAt: createdAt
    } as Note;
  };

  // 1) Velkommen (først/eldst)
  const n1 = mk([
    'Velkommen til Storm',
    'Velkommen!',
    'Dette er Storm – hvor du kan lage ditt eget tankekart med tagger, ved å notere og linke.',
    'Noter, og få forslag til tagger som relaterer.'
  ], ['storm','intro']);

  // 2) Filtrér
  const n2 = mk([
    'Filtrér med tagger',
    'Trykk på tagger i topplinja for å filtrere notater.',
    'Direkte treff vises nederst (nyeste nederst), relaterte over.'
  ], ['storm','intro','filtre']);

  // 3) Del til Storm
  const n3 = mk([
    'Del til Storm fra nettleseren',
    'Del en artikkel fra nettleseren til Storm.',
    '(Virker kun på Android)',
    'Appen oppretter et notat med tittel, de første linjene og lenke.',
    'Prøv: Åpne en artikkel → Del → “Storm – Notater”.'
  ], ['storm','del']);

  // 4) Bilde
  const n4 = mk([
    'Legg til bilde i notat',
    'Bruk bilde-ikonet når du redigerer for å legge til bilde. Bilder skaleres automatisk.'
  ], ['storm','bilder']);

  // 5) Forslag
  const n5 = mk([
    'Live tagg-forslag mens du skriver',
    'Når du skriver, henter Storm forslag fra teksten. Kjente tagger fargekodes først; nye ord vises nøytralt.',
    'Tips: Trykk på en forslag-chip for å legge den til – du forblir i teksten.'
  ], ['storm','forslag','tag']);

  // 6) PWA/Lagring
  const n6 = mk([
    'WebApp og lagring',
    'Installer som app/Legg til på startskjermen (Android/iOS). Notater lagres lokalt og bevares på tvers av oppdateringer.'
  ], ['storm','pwa','lagring']);

  // 7) Kontakt
  const n7 = mk([
    'Kontakt',
    'Tilbakemeldinger mottas med skål. heartbar369@gmail.com'
  ], ['storm','kontakt','feedback']);

  return [n1,n2,n3,n4,n5,n6,n7];
}

/** Laster notater. Hvis tomt og seed ikke kjørt -> seeder standardnotater én gang. */
export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const arr = raw ? (JSON.parse(raw) as Note[]) : [];
    if (Array.isArray(arr) && arr.length > 0) return arr;

    // tomt: seed hvis ikke gjort før
    const ver = localStorage.getItem(SEED_VERSION_KEY);
    if (ver !== CURRENT_SEED_VERSION) {
      const seeded = makeSeedNotes();
      localStorage.setItem(NOTES_KEY, JSON.stringify(seeded));
      localStorage.setItem(SEED_VERSION_KEY, CURRENT_SEED_VERSION);
      return seeded;
    }
    return [];
  } catch {
    // fallback: seed
    const seeded = makeSeedNotes();
    localStorage.setItem(NOTES_KEY, JSON.stringify(seeded));
    localStorage.setItem(SEED_VERSION_KEY, CURRENT_SEED_VERSION);
    return seeded;
  }
}

export function saveNotes(notes: Note[]) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}
