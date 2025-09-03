import { loadTagColors, saveTagColors } from './storage';

// Pleasant palette (no Tailwind required), will be darkened as needed for contrast.
const PALETTE = [
  '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#f97316', '#06b6d4', '#84cc16', '#f43f5e',
  '#8b5cf6', '#10b981', '#e11d48', '#0ea5e9', '#f59e0b', '#b91c1c', '#047857', '#7c3aed', '#ea580c', '#4338ca'
];

function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hexToRgb(hex: string) {
  const s = hex.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const srgb = [r, g, b].map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

export function contrastRatio(hexA: string, hexB: string): number {
  const L1 = luminance(hexA);
  const L2 = luminance(hexB);
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  let h = 0, s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case R: h = (G - B) / d + (G < B ? 6 : 1); break;
      case G: h = (B - R) / d + 3; break;
      case B: h = (R - G) / d + 5; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = clamp01(s); l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return '#' + [R, G, B].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Ensure contrast ≥ 4.5:1 against white text */
export function ensureContrastBgForWhite(hex: string): string {
  const WHITE = '#ffffff';
  let bg = hex;
  let { h, s, l } = hexToHsl(bg);
  for (let i = 0; i < 60; i++) {
    const ratio = contrastRatio(bg, WHITE);
    if (ratio >= 4.5) return bg;
    // Darken and slightly boost saturation for punch
    l = Math.max(0, l - 0.03);
    s = clamp01(s + 0.01);
    bg = hslToHex(h, s, l);
  }
  return bg;
}

export function colorForTag(tag: string): string {
  const map = loadTagColors();
  if (map[tag]) return map[tag];
  const idx = hash(tag) % PALETTE.length;
  const base = PALETTE[idx];
  const ensured = ensureContrastBgForWhite(base);
  map[tag] = ensured;
  saveTagColors(map);
  return ensured;
}
