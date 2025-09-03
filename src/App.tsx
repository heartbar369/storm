import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

// =====================
// Storm – minimal, stabil versjon (TypeScript)
// =====================
// Dette er en forenklet og stabil utgave UTEN innlogging/Firebase.
// Den gir: notater, tagger, topp-bjelke med søk, inline-redigering, + bildeopplasting (enkelt).
// Alt er strengt typet for å fjerne TS-feil i VS Code og ved build.

// ---------- Typer ----------
export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  image?: string;
  createdAt: number;
  updatedAt: number;
}

interface TagStat { count: number; lastUsed: number }

// ---------- Felles linjeskift-regex (fikser tidligere regex-feil) ----------
// Deler på CRLF (\r\n), LF (\n), CR (\r), samt Unicode LS (\u2028) og PS (\u2029)
const SPLIT_RE = /\r\n|\n|\r|\u2028|\u2029/;

// ---------- Enkle utils ----------
function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function computedTitleFromBody(body: string): string {
  const lines = (body || "").split(SPLIT_RE).map((l) => l.trim()).filter(Boolean);
  const first = lines[0] || "(uten tittel)";
  return first.slice(0, 120);
}

function bodyWithoutTitle(body: string): string {
  const ls = (body || "").split(SPLIT_RE);
  let i = 0;
  while (i < ls.length && ls[i].trim() === "") i++;
  if (i < ls.length) i++;
  return ls.slice(i).join("\n");
}

function unique<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

// ---------- Local storage helper ----------
const storage = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set<T>(k: string, v: T): void {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  },
};

// ---------- Tag-farger ----------
const TAG_PALETTE: string[] = [
  "#e6194B","#3cb44b","#4363d8","#f58231","#911eb4","#42d4f4",
  "#f032e6","#bfef45","#fabed4","#469990","#dcbeff","#9A6324",
  "#fffac8","#800000","#aaffc3","#808000","#ffd8b1","#000075",
];

const TAG_COLOR_KEY = "storm_tag_colors";
function getTagColors(): Record<string,string> { return storage.get(TAG_COLOR_KEY, {} as Record<string,string>); }
function setTagColors(map: Record<string,string>): void { storage.set(TAG_COLOR_KEY, map); }
function hash(s: string): number { let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; } return h; }
function assignColorIfMissing(tag: string): string {
  const map = getTagColors();
  if(!map[tag]){
    const used = new Set(Object.values(map));
    const free = TAG_PALETTE.filter(c => !used.has(c));
    const color = free.length ? free[Math.floor(Math.random()*free.length)] : TAG_PALETTE[Math.abs(hash(tag)) % TAG_PALETTE.length];
    map[tag] = color; setTagColors(map);
  }
  return map[tag];
}
function getTagColor(tag: string): string { const map = getTagColors(); return map[tag] || assignColorIfMissing(tag); }

function getContrastTextColor(hex: string): string {
  try{
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2),16)/255;
    const g = parseInt(h.substring(2,4),16)/255;
    const b = parseInt(h.substring(4,6),16)/255;
    const a = [r,g,b].map(v=> (v <= 0.03928) ? v/12.92 : Math.pow((v+0.055)/1.055,2.4));
    const L = 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
    return L > 0.55 ? '#111111' : '#ffffff';
  }catch{ return '#111111'; }
}
function tagFillColor(tag: string): string { return getTagColor(tag); }

// Sørg for at tagg-bakgrunn har nok kontrast til HVIT tekst
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return { r, g, b };
}
function rgbToHex(r: number, g: number, b: number): string {
  const p = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return '#' + [p(r),p(g),p(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function relLumFromHex(hex: string): number {
  try{
    const {r,g,b} = hexToRgb(hex);
    const a = [r,g,b].map(v=>{
      const c = v/255;
      return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
    });
    return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
  }catch{ return 0; }
}
function contrastRatio(hex1: string, hex2: string): number {
  const L1 = relLumFromHex(hex1);
  const L2 = relLumFromHex(hex2);
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
function darkenHex(hex: string, factor = 0.88): string {
  const {r,g,b} = hexToRgb(hex);
  return rgbToHex(r*factor, g*factor, b*factor);
}
function ensureContrastBgForWhite(hex: string, min = 4.5): string {
  let c = hex;
  // Juster mot mørkere til kontrast mot hvit tekst er tilstrekkelig
  let guard = 0;
  while (contrastRatio(c, '#ffffff') < min && guard < 10) {
    c = darkenHex(c, 0.86);
    guard++;
  }
  return c;
}
function tagBgForWhite(tag: string): string { return ensureContrastBgForWhite(getTagColor(tag)); }

// ---------- Tag-statistikk ----------
function buildTagStats(notes: Note[]): Map<string, TagStat> {
  const stats = new Map<string, TagStat>();
  for(const n of notes){
    const ts = n.updatedAt || n.createdAt || 0;
    for(const t of (n.tags||[])){
      if(!t) continue;
      if(!stats.has(t)) stats.set(t, {count:0,lastUsed:0});
      const s = stats.get(t)!; s.count += 1; if (ts > s.lastUsed) s.lastUsed = ts;
    }
  }
  return stats;
}

// ---------- Tag -> Note index & diverse ranking ----------
function buildTagNoteIndex(notes: Note[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const n of notes) {
    for (const t of (n.tags || [])) {
      if (!idx.has(t)) idx.set(t, new Set<string>());
      idx.get(t)!.add(n.id);
    }
  }
  return idx;
}

function jaccardTagSim(a: string, b: string, idx: Map<string, Set<string>>): number {
  if (a === b) return 1;
  const A = idx.get(a); const B = idx.get(b);
  if (!A || !B || A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni > 0 ? inter / uni : 0;
}

function rankDiverseTags(
  candidates: string[],
  baseScore: (t: string) => number,
  sim: (a: string, b: string) => number,
  lambda = 0.9,
  limit?: number
): string[] {
  const rest = new Set(candidates);
  const picked: string[] = [];
  const lim = limit ?? candidates.length;
  while (picked.length < lim && rest.size) {
    let bestTag: string | null = null;
    let bestVal = -Infinity;
    for (const t of rest) {
      const simMax = picked.length ? Math.max(...picked.map(p => sim(t, p))) : 0;
      const val = baseScore(t) - lambda * simMax; // MMR
      if (val > bestVal) { bestVal = val; bestTag = t; }
    }
    if (bestTag == null) break;
    picked.push(bestTag);
    rest.delete(bestTag);
  }
  return picked;
}

function smoothAdjacency(
  order: string[],
  sim: (a: string, b: string) => number,
  locked = 0,
  threshold = 0.8
): string[] {
  const arr = order.slice();
  for (let i = Math.max(locked, 1); i < arr.length; i++) {
    const left = arr[i - 1];
    let j = i;
    while (j < arr.length && sim(arr[j], left) > threshold) j++;
    if (j < arr.length && j !== i) {
      const [item] = arr.splice(j, 1);
      arr.splice(i, 0, item);
    }
  }
  return arr;
}

function computeTopBarOrder(
  allTags: string[],
  stats: Map<string, TagStat>,
  idx: Map<string, Set<string>>,
  selected: string[]
): string[] {
  if (allTags.length === 0) return [];

  // base score = frequency + recency boost
  const counts = allTags.map(t => stats.get(t)?.count || 0);
  const maxC = Math.max(1, ...counts);
  const lastVals = allTags.map(t => stats.get(t)?.lastUsed || 0);
  const minL = Math.min(...lastVals);
  const maxL = Math.max(minL + 1, ...lastVals);
  const rec = (t: string) => (stats.get(t)?.lastUsed || 0);
  const base = (t: string) =>
    (stats.get(t)?.count || 0) / maxC + 0.2 * ((rec(t) - minL) / (maxL - minL));
  const sim = (a: string, b: string) => jaccardTagSim(a, b, idx);

  const selectedInAll = selected.filter(t => allTags.includes(t));
  const pool = allTags.filter(t => !selectedInAll.includes(t));

  if (selectedInAll.length === 0) {
    const ranked = rankDiverseTags(pool, base, sim, 0.95);
    return smoothAdjacency(ranked, sim, 0, 0.8);
  }

  // If user is filtering: show related-to-selection first, then diverse others.
  const REL_T = 0.2; // co-occur threshold
  const rel: {t: string; relScore: number}[] = [];
  const other: string[] = [];
  for (const t of pool) {
    const relScore = Math.max(...selectedInAll.map(s => sim(t, s)));
    if (relScore >= REL_T) rel.push({ t, relScore });
    else other.push(t);
  }
  rel.sort((a, b) => (b.relScore - a.relScore) || (base(b.t) - base(a.t)));
  const relTags = rel.map(x => x.t);
  const otherTags = rankDiverseTags(other, base, sim, 0.9);
  const combined = Array.from(new Set([...selectedInAll, ...relTags, ...otherTags]));
  return smoothAdjacency(combined, sim, selectedInAll.length, 0.85);
}

// ---------- Co-occurrence & relaterte notater ----------
function buildCooccurrence(notes: Note[]): Map<string, Map<string, number>> {
  const co = new Map<string, Map<string, number>>();
  for (const n of notes) {
    const tags = Array.from(new Set(n.tags || []));
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const a = tags[i], b = tags[j];
        if (!co.has(a)) co.set(a, new Map());
        if (!co.has(b)) co.set(b, new Map());
        co.get(a)!.set(b, (co.get(a)!.get(b) || 0) + 1);
        co.get(b)!.set(a, (co.get(b)!.get(a) || 0) + 1);
      }
    }
  }
  return co;
}

function rankRelatedNotes(
  notes: Note[],
  selectedTags: string[],
  stats: Map<string, TagStat>,
  co: Map<string, Map<string, number>>
): Note[] {
  if (selectedTags.length === 0) return [];
  const sel = new Set<string>(selectedTags);

  const times = notes.map(n => n.updatedAt || n.createdAt || 0);
  const minT = Math.min(...times);
  const maxT = Math.max(minT + 1, ...times);
  const recency = (n: Note) => ((n.updatedAt || n.createdAt || 0) - minT) / (maxT - minT);

  const scored = notes.map(n => {
    const ntags = n.tags || [];
    const overlap = ntags.filter(t => sel.has(t)).length; // direkte overlapp
    let coo = 0;
    for (const s of sel) {
      const row = co.get(s) || new Map<string, number>();
      for (const t of ntags) coo += (row.get(t) || 0);
    }
    const freqBoost = ntags.reduce((acc, t) => acc + (stats.get(t)?.count || 0), 0) / 10;
    const score = overlap * 5 + coo * 1 + recency(n) * 0.5 + freqBoost;
    return { n, score };
  });

  scored.sort((a, b) => b.score - a.score || (b.n.updatedAt - a.n.updatedAt));
  return scored.map(x => x.n);
}

// ---------- Bilde (enkel) ----------
async function fileToDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result||""));
    fr.onerror = (e) => reject(e);
    fr.readAsDataURL(f);
  });
}

// ---------- Små egen-tester (kjøres rolig og logges i dev) ----------
function runSelfTests(): void {
  // Test linjesplitt + tittel
  const t1 = computedTitleFromBody("Hei\nVerden");
  if (t1 !== "Hei") console.warn("TEST: computedTitleFromBody feilet", t1);
  const b1 = bodyWithoutTitle("Tittel\nLinje1\rLinje2\u2028Linje3");
  if (b1 !== "Linje1\nLinje2\nLinje3") console.warn("TEST: bodyWithoutTitle feilet", JSON.stringify(b1));
  // Tag-stat
  const stats = buildTagStats([{id:"1",title:"a",body:"",tags:["x","y"],createdAt:1,updatedAt:2}]);
  if ((stats.get("x")?.count||0)!==1) console.warn("TEST: buildTagStats count feil");
}

// ---------- App ----------
export default function App() {
  useEffect(()=>{
    // Registrer SW hvis finnes – rolig fallback
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(()=>{});
    }
    try { runSelfTests(); } catch(e) { console.warn('Self-tests error', e); }
  },[]);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <main className="max-w-3xl mx-auto px-4 py-4">
        <NotesPanel />
      </main>
      <AddNoteFAB />
    </div>
  );
}

// ---------- NotesPanel ----------
function NotesPanel() {
  const [notes, setNotes] = useState<Note[]>(()=>{
    const raw = storage.get<Partial<Note>[]>("storm_notes", []);
    return raw.map((n)=>{
      const tags = Array.isArray(n.tags) ? (n.tags as string[]) : [];
      tags.forEach(assignColorIfMissing);
      const body = String(n.body||"");
      return {
        id: String(n.id||uid("note")),
        title: String(n.title||computedTitleFromBody(body)),
        body,
        tags,
        image: n.image ? String(n.image) : undefined,
        createdAt: Number(n.createdAt||Date.now()),
        updatedAt: Number(n.updatedAt||Date.now()),
      } as Note;
    });
  });

  // Persist lokalt (debounced)
  useEffect(()=>{ const t = setTimeout(()=>storage.set("storm_notes", notes), 150); return ()=>clearTimeout(t); }, [notes]);

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState<string>("");
  const [draftId, setDraftId] = useState<string|null>(null);
  const draftRef = useRef<HTMLTextAreaElement|null>(null);
  const fileRef = useRef<HTMLInputElement|null>(null);
  const [pendingImgFor, setPendingImgFor] = useState<string|null>(null);

  const allTags = useMemo(()=> Array.from(new Set(notes.flatMap(n=>n.tags||[]))), [notes]);
  const tagStats = useMemo(()=> buildTagStats(notes), [notes]);
  const tagIndex = useMemo(()=> buildTagNoteIndex(notes), [notes]);
  const cooc = useMemo(()=> buildCooccurrence(notes), [notes]);

  const topBarTags = useMemo(()=>{
    return computeTopBarOrder(allTags, tagStats, tagIndex, selectedTags);
  }, [allTags, tagStats, tagIndex, selectedTags]);

  const filteredTopBarTags = useMemo(()=>{
    const q = tagQuery.trim().toLowerCase();
    return q ? topBarTags.filter(t=>t.toLowerCase().includes(q)) : topBarTags;
  }, [topBarTags, tagQuery]);

  const draftNote = useMemo(()=> notes.find(n=>n.id===draftId) || null, [notes, draftId]);

  const onTopTagClick = (t: string) => {
    if (draftNote) {
      assignColorIfMissing(t);
      setNotes(arr => arr.map(n => n.id===draftNote.id ? { ...n, tags: unique([...(n.tags||[]), t]) } : n));
    } else {
      setSelectedTags(sel => sel.includes(t) ? sel.filter(x=>x!==t) : [...sel, t]);
    }
  };

  const clearFilter = () => setSelectedTags([]);

  const selectTagFromFeed = (noteId: string, t: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (draftId === noteId) return;
    setSelectedTags((sel) => sel.includes(t) ? sel : [...sel, t]);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  };

  const createNewNote = useCallback(() => {
    const now = Date.now();
    const seededTags = [...selectedTags];
    seededTags.forEach(assignColorIfMissing);
    const note: Note = {
      id: uid("note"),
      title: "(uten tittel)",
      body: "",
      tags: seededTags,
      image: undefined,
      createdAt: now,
      updatedAt: now,
    };
    setNotes(arr => [note, ...arr]);
    setDraftId(note.id);
    setTimeout(() => draftRef.current?.focus(), 0);
  }, [selectedTags]);

  // Lytt på globalt + (FAB) og opprett notat
  useEffect(() => {
    const onCreate = () => createNewNote();
    document.addEventListener('storm:intent-create', onCreate);
    return () => document.removeEventListener('storm:intent-create', onCreate);
  }, [createNewNote]);

  const openNote = (id: string) => { setDraftId(id); setTimeout(()=> draftRef.current?.focus(), 0); };
  const closeDraft = () => setDraftId(null);

  const onBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if(!draftNote) return;
    const body = e.target.value;
    setNotes(arr => arr.map(n => n.id===draftNote.id ? { ...n, body, title: computedTitleFromBody(body), updatedAt: Date.now() } : n));
  };

  const addTagToDraft = (t: string) => {
    if(!draftNote) return;
    const tt = t.trim(); if(!tt) return;
    assignColorIfMissing(tt);
    setNotes(arr => arr.map(n => n.id===draftNote.id ? { ...n, tags: unique([...(n.tags||[]), tt]), updatedAt: Date.now() } : n));
  };
  const removeTagFromDraft = (t: string) => {
    if(!draftNote) return;
    setNotes(arr => arr.map(n => n.id===draftNote.id ? { ...n, tags: (n.tags||[]).filter(x=>x!==t), updatedAt: Date.now() } : n));
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.currentTarget.files?.[0];
    if(!f || !pendingImgFor) return;
    try{
      const dataUrl = await fileToDataURL(f);
      setNotes(arr => arr.map(n => n.id===pendingImgFor ? { ...n, image: dataUrl, updatedAt: Date.now() } : n));
    } finally {
      setPendingImgFor(null);
      if(fileRef.current) fileRef.current.value = '';
    }
  };

  const onChooseImage = (id: string) => { setPendingImgFor(id); fileRef.current?.click(); };

  // --- Direkte & Relaterte ---
  const byNewest = useCallback((a: Note,b: Note)=> (b.createdAt - a.createdAt), []);

  const directNotes = useMemo(()=>{
    return (selectedTags.length===0)
      ? [...notes].sort(byNewest)
      : notes.filter(n => selectedTags.every(t => (n.tags||[]).includes(t))).sort(byNewest);
  }, [notes, selectedTags, byNewest]);

  const relatedNotes = useMemo(()=>{
    if (selectedTags.length===0) return [] as Note[];
    const ranked = rankRelatedNotes(notes, selectedTags, tagStats, cooc);
    const directIds = new Set(directNotes.map(n=>n.id));
    return ranked.filter(n => !directIds.has(n.id));
  }, [notes, selectedTags, tagStats, cooc, directNotes]);

  // Felles renderer for ett notat (draft/lesemodus)
  const renderNote = (n: Note) => {
    
    if (draftNote && draftNote.id === n.id) {
      return (
        <article id={`note-${n.id}`} key={n.id} className="py-4">
          {(n.tags||[]).length>0 && (
            <div className="mb-2 text-sm">
              {(n.tags||[]).map((t)=> (
                <span
                  key={t}
                  role="button"
                  tabIndex={0}
                  className="mr-2 inline-flex items-center gap-1 px-2 py-1 rounded-full text-white cursor-default"
                  style={{ background: tagBgForWhite(t) }}
                  title="Tagg for dette notatet"
                >
                  {t}
                  <button
                    className="ml-1 text-xs leading-none opacity-70 hover:opacity-100"
                    title={`Fjern tagg ${t}`}
                    onClick={(e)=>{ e.stopPropagation(); removeTagFromDraft(t); }}
                    aria-label={`Fjern tagg ${t}`}
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {n.image && (
            <img src={n.image} alt="Vedlagt" className="mb-2 w-full rounded-xl border" />
          )}

          <textarea
            ref={draftRef}
            value={n.body}
            onChange={onBodyChange}
            className="w-full min-h-[160px] px-3 py-2 rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900"
            placeholder="Skriv notatet ditt…"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Legg til tagg og Enter"
              onKeyDown={(e)=>{ if(e.key==="Enter"){ const v=(e.currentTarget.value||"").trim(); if(v){ addTagToDraft(v); e.currentTarget.value=""; } } }}
              className="px-3 py-1.5 rounded-full border text-sm"
            />
            <button onClick={()=>onChooseImage(n.id)} className="px-3 py-1.5 rounded-full border text-sm" type="button">Legg til bilde</button>
            <button onClick={closeDraft} className="px-3 py-1.5 rounded-full border text-sm" type="button">Ferdig</button>
          </div>
        </article>
      );
    }

    // Lesemodus
    return (
      <article key={n.id} className="rounded-2xl border overflow-hidden cursor-pointer" onClick={()=>openNote(n.id)}>
        <header className="px-4 py-3 border-b">
          <h3 className="font-semibold leading-tight">{n.title}</h3>
          {(n.tags||[]).length>0 && (
            <div className="mt-2 text-xs opacity-90">
              {(n.tags||[]).map((t)=> (
                <span
                  key={t}
                  onClick={(e)=>selectTagFromFeed(n.id, t, e)}
                  role="button"
                  tabIndex={0}
                  className="mr-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white hover:opacity-90"
                  style={{ background: tagBgForWhite(t) }}
                  title="Filtrer på tagg"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </header>
        {n.image && (
          <img src={n.image} alt="Vedlagt" className="w-full max-h-[360px] object-cover" />
        )}
        <div className="p-4 text-sm text-neutral-700 whitespace-pre-wrap">{bodyWithoutTitle(n.body)}</div>
      </article>
    );
  };

  return (
    <section>
      {/* TOPP: taggsøk + tagger */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/75 py-4 -mx-4 px-4 border-b">
        <div className="flex items-center gap-3">
          <div className="overflow-x-auto overflow-y-visible no-scrollbar whitespace-nowrap flex-1 py-1">
            <div className="relative inline-flex items-center mr-2 align-middle">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500">
                <path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.471 6.471 0 001.57-4.23 6.5 6.5 0 10-6.5 6.5 6.471 6.471 0 004.23-1.57l.27.28v.79l4.25 4.25 1.5-1.5L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                value={tagQuery}
                onChange={(e)=>setTagQuery(e.target.value)}
                placeholder="Søk tagger…"
                className="inline-block align-middle px-3 py-1.5 rounded-full border bg-white text-sm w-32 focus:w-44 transition-all pl-7 pr-6"
              />
              {tagQuery && (
                <button
                  onClick={()=>setTagQuery("")}
                  aria-label="Tøm søk"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-neutral-600 hover:text-black hover:bg-neutral-100"
                  type="button"
                >
                  ×
                </button>
              )}
            </div>
            {filteredTopBarTags.slice(0,120).map((t)=> (
              <button
                key={t}
                onClick={()=>onTopTagClick(t)}
                className={"inline-flex items-center gap-2 text-sm mr-2 px-3 py-1.5 rounded-full transition text-white "+(selectedTags.includes(t)?"ring-2 ring-neutral-900 ring-offset-2 ring-offset-white":"hover:opacity-90")}
                style={{ background: tagBgForWhite(t) }}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {selectedTags.length>0 && (
              <button onClick={clearFilter} className="text-xs px-2 py-1 rounded-full border">Tøm</button>
            )}
          </div>
        </div>
      </div>

      {/* Skjult file input */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFilePicked} />

      {/* Notatstrøm */}
      <div className="mt-2 space-y-4">
        {/* Direkte treff først */}
        {directNotes.map(renderNote)}

        {/* Relaterte etterpå, kun når noen tagger er valgt */}
        {selectedTags.length>0 && relatedNotes.length>0 && (
          <div className="pt-2">
            <div className="text-xs uppercase tracking-wide text-neutral-500 px-1">Relaterte notater</div>
            <div className="mt-2 space-y-4">
              {relatedNotes.map(renderNote)}
            </div>
          </div>
        )}

        {directNotes.length===0 && selectedTags.length===0 && (
          <p className="text-neutral-500 text-sm">Ingen notater enda. Klikk + nede til høyre for å begynne.</p>
        )}
        {directNotes.length===0 && selectedTags.length>0 && relatedNotes.length===0 && (
          <p className="text-neutral-500 text-sm">Ingen notater matcher disse taggene.</p>
        )}
      </div>
    </section>
  );
}

// ---------- + Floating Action Button ----------
function AddNoteFAB() {
  const click = () => {
    const ev = new Event('storm:intent-create');
    document.dispatchEvent(ev);
  };
  return (
    <button
      onClick={click}
      className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg bg-neutral-900 text-white text-2xl leading-none flex items-center justify-center hover:scale-105 transition"
      aria-label="Nytt notat"
      type="button"
    >
      +
    </button>
  );
}
