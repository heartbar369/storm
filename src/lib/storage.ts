import type { Note, TagColorMap } from './types';

const NOTES_KEY = 'storm_notes';
const TAG_COLORS_KEY = 'storm_tag_colors';

export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Note[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
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

export function debounce<T extends (...args: any[]) => void>(fn: T, ms = 150) {
  let t: number | undefined;
  return (...args: Parameters<T>) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}
