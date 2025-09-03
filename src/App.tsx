import { useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { Note } from './lib/types';
import { computedTitleFromBody } from './lib/text';
import { colorForTag, ensureContrastBgForWhite } from './lib/tags';
import { debounce, loadNotes, saveNotes } from './lib/storage';
import { directAndRelatedNotes, rankTopBarTags, tagBaseScores } from './lib/rank';
import { Plus, Check, ImagePlus, X, Pencil, Eraser } from 'lucide-react';

const LOGO_PATH = '/icons/icon-192.png';

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function useDebouncedSave(notes: Note[]) {
  const save = useMemo(() => debounce((ns: Note[]) => saveNotes(ns), 150), []);
  useEffect(() => { save(notes); }, [notes, save]);
}

/** Stopwords (no/en – enkel liste) */
const STOP = new Set([
  'og','i','på','til','det','en','et','jeg','du','vi','dere','er','som','av','med','for','ikke','å','eller','men','de','der','den',
  'the','a','an','of','in','on','to','is','are','be','as','at','by','for','and','or','not'
]);

/** Tokenizer av brødtekst */
function extractTokens(text: string): string[] {
  const m = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
  return m.filter(w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Best-effort henting av og:image som dataURL (ignorér feil/CORS) */
async function tryFetchOgImage(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return undefined;
    const html = await res.text();
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    const imgUrl = match?.[1]; if (!imgUrl) return undefined;
    const imgRes = await fetch(imgUrl, { mode: 'cors' });
    if (!imgRes.ok) return undefined;
    const blob = await imgRes.blob();
    const fr = new FileReader();
    return await new Promise((resolve) => {
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(undefined);
      fr.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

function TagPill({ tag, onClick, onRemove, asButton = true }: { tag: string; onClick?: () => void; onRemove?: () => void; asButton?: boolean }) {
  const bg = ensureContrastBgForWhite(colorForTag(tag));
  const El: any = asButton ? 'button' : 'span';
  return (
    <El className="tagpill" style={{ background: bg }} onClick={onClick} title={tag} aria-label={tag}>
      <span>{tag}</span>
      {onRemove && <span className="x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Fjern ${tag}`}>×</span>}
    </El>
  );
}

function useNotes() {
  const [notes, setNotes] = useState<Note[]>(() => loadNotes());
  useDebouncedSave(notes);
  return { notes, setNotes } as const;
}

function TopBar({
  notes, selected, setSelected, draftOpen, onAddTagToDraft
}: { notes: Note[]; selected: string[]; setSelected: (tags: string[]) => void; draftOpen: boolean; onAddTagToDraft: (t: string) => void; }) {
  const [input, setInput] = useState('');
  const baseScores = useMemo(() => tagBaseScores(notes), [notes]);
  const allTags = useMemo(() => Object.keys(baseScores), [baseScores]);
  const ranked = useMemo(() => rankTopBarTags(notes, selected), [notes, selected]);

  const typeahead = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [] as string[];
    const prefix = allTags.filter(t => t.toLowerCase().startsWith(q));
    const contains = allTags.filter(t => !prefix.includes(t) && t.toLowerCase().includes(q));
    const score = (t: string) => (baseScores[t] || 0) + (t.toLowerCase().startsWith(q) ? 1.5 : (t.toLowerCase().includes(q) ? 0.3 : 0));
    return [...prefix, ...contains].sort((a, b) => score(b) - score(a)).slice(0, 12);
  }, [input, allTags, baseScores]);

  function toggleFilterTag(t: string) {
    setSelected(selected.includes(t) ? selected.filter(x => x !== t) : [...selected, t]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function onEnter() {
    const top = (typeahead[0] || input.trim());
    if (!top) return;
    if (draftOpen) onAddTagToDraft(top); else toggleFilterTag(top);
    setInput('');
  }

  return (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="row" style={{ gap: 10 }}>
          {selected.map(t => (
            <TagPill key={t} tag={t} onClick={() => toggleFilterTag(t)} onRemove={() => toggleFilterTag(t)} />
          ))}

          {/* App-logo fra /public */}
          <img className="logo-img" src={LOGO_PATH} alt="Storm" />

          <input
            className="input"
            placeholder={draftOpen ? 'Legg til tagg i notat…' : 'Søk/velg tagg…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
          />

          {selected.length > 0 && (
            <button className="icon-btn" onClick={() => setSelected([])} title="Tøm filter" aria-label="Tøm filter">
              <Eraser color="var(--iconB)" strokeWidth={2.5} />
            </button>
          )}
        </div>

        {input ? (
          <div className="suggestion-bar">
            {typeahead.map(t => (
              <TagPill key={t} tag={t} onClick={() => { draftOpen ? onAddTagToDraft(t) : toggleFilterTag(t); setInput(''); }} />
            ))}
          </div>
        ) : (
          <div className="suggestion-bar">
            {ranked.slice(0, 24).map(t => (
              <TagPill key={t} tag={t} onClick={() => draftOpen ? onAddTagToDraft(t) : toggleFilterTag(t)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* Lesekort */
function ReadCard({ note, onEdit, onClickTag }: { note: Note; onEdit: () => void; onClickTag: (t: string) => void; }) {
  const bodyPreview = note.body.split(/\r\n|\n|\r|\u2028|\u2029/).join('\n');
  return (
    <div className="card">
      <div className="tags">
        {note.tags.map(t => (
          <span key={t} onClick={(e) => { e.stopPropagation(); onClickTag(t); }}>
            <TagPill tag={t} asButton={false} />
          </span>
        ))}
      </div>
      {note.image && <img src={note.image} alt="" />}
      <h3>{note.title || '(uten tittel)'}</h3>
      <p>{bodyPreview}</p>
      <div className="edit-actions">
        <button className="icon-btn" onClick={onEdit} title="Rediger" aria-label="Rediger">
          <Pencil color="var(--iconB)" strokeWidth={2.5} />
        </button>
        <span className="small">Oppdatert: {new Date(note.updatedAt || note.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}

/* Redigeringskort */
function EditCard({ note, onSave, onDelete, onCancel }:
  { note: Note; onSave: (n: Note) => void; onDelete: (id: string) => void; onCancel: () => void; }) {
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState('');
  const [image, setImage] = useState<string | undefined>(note.image);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [cursorWord, setCursorWord] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setBody(note.body); setTags(note.tags); setImage(note.image); }, [note.id]);
  const title = useMemo(() => computedTitleFromBody(body), [body]);

  // Kjente tagger
  const knownTags = useMemo(() => {
    const s = new Set<string>();
    try {
      const raw = localStorage.getItem('storm_notes');
      if (raw) (JSON.parse(raw) as Note[]).forEach(n => n.tags.forEach(t => s.add(t)));
    } catch {}
    tags.forEach(t => s.delete(t));
    return s;
  }, [tags]);

  const knownFreq: Record<string, number> = useMemo(() => {
    const f: Record<string, number> = {};
    try {
      const raw = localStorage.getItem('storm_notes');
      if (raw) (JSON.parse(raw) as Note[]).forEach(n => n.tags.forEach(t => { f[t] = (f[t] || 0) + 1; }));
    } catch {}
    return f;
  }, []);

  const tokens = useMemo(() => extractTokens(body), [body]);
  const tokenFreq: Record<string, number> = useMemo(() => {
    const f: Record<string, number> = {};
    for (const w of tokens) f[w] = (f[w] || 0) + 1;
    return f;
  }, [tokens]);

  const coScore = (t: string) => tags.reduce((s, ex) => s + (ex && t ? 1 : 0), 0);

  function addTag(t: string) {
    const clean = t.trim(); if (!clean) return;
    if (tags.includes(clean)) return;
    setTags([...tags, clean]);
    setTagInput('');
  }
  function removeTag(t: string) { setTags(tags.filter(x => x !== t)); }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setImage(String(reader.result)); };
    reader.onerror = () => {};
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  function persist() {
    onSave({ ...note, body, title, tags, image, updatedAt: Date.now() });
  }

  function getWordAt(text: string, pos: number) {
    const left = text.slice(0, pos), right = text.slice(pos);
    const leftMatch = left.match(/[\p{L}\p{N}_-]+$/u);
    const rightMatch = right.match(/^[\p{L}\p{N}_-]+/u);
    const word = ((leftMatch?.[0] || '') + (rightMatch?.[0] || '')) || '';
    return word.trim();
  }
  function handleSelectOrInput() {
    const ta = textRef.current; if (!ta) return;
    const start = ta.selectionStart ?? 0, end = ta.selectionEnd ?? 0;
    if (end > start) {
      const sel = ta.value.slice(start, end).trim().replace(/^[#]+/, '').slice(0, 40);
      setSelectedWord(sel || null);
    } else {
      setSelectedWord(null);
      const w = getWordAt(ta.value, start);
      setCursorWord(w || null);
    }
  }

  const smartSuggestions = useMemo(() => {
    const fromText = Object.keys(tokenFreq);
    const set = new Set<string>(fromText);
    knownTags.forEach(t => set.add(t));
    const score = (t: string) =>
      (tokenFreq[t] || 0) * 1.0 + (knownFreq[t] ? 3 : 0) + coScore(t) * 2 + Math.min(0.4, Math.max(0, (t.length - 2)) * 0.02);
    return Array.from(set).filter(t => !tags.includes(t)).sort((a,b)=> score(b)-score(a)).slice(0, 10);
  }, [tokenFreq, knownTags, knownFreq, tags]);

  const contextualSuggestions = useMemo(() => {
    const w = (cursorWord || '').toLowerCase();
    if (!w || w.length < 2) return [] as string[];
    const pool = Array.from(knownTags).filter(t => t.toLowerCase().includes(w));
    const score = (t: string) => (knownFreq[t] || 0) + (t.toLowerCase().startsWith(w) ? 2 : (t.toLowerCase().includes(w) ? 0.5 : 0)) + coScore(t);
    return pool.sort((a,b)=> score(b)-score(a)).slice(0, 8);
  }, [cursorWord, knownTags, knownFreq, tags]);

  const inputSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [] as string[];
    const pool = Array.from(knownTags).filter(t => t.toLowerCase().includes(q));
    const score = (t: string) => (knownFreq[t] || 0) + 3 * coScore(t) + (t.toLowerCase().startsWith(q) ? 2 : (t.toLowerCase().includes(q) ? 0.5 : 0));
    return pool.sort((a,b)=> score(b)-score(a)).slice(0, 10);
  }, [tagInput, knownTags, knownFreq, tags]);

  return (
    <div className="editcard">
      {/* Tagger over notatet */}
      <div className="tags">
        {tags.map(t => (<TagPill key={t} tag={t} onRemove={() => removeTag(t)} />))}
      </div>

      {image && <img src={image} alt="" />}

      <div className="small">Tittel (auto):</div>
      <div style={{ fontWeight: 700, marginTop: 4 }}>{title || '(uten tittel)'}</div>

      <textarea
        ref={textRef}
        value={body}
        onChange={(e) => { setBody(e.target.value); handleSelectOrInput(); }}
        onSelect={handleSelectOrInput}
        onKeyUp={handleSelectOrInput}
        placeholder="Skriv notat…"
        style={{ width: '100%', minHeight: 180, padding: 10, borderRadius: 12 }}
      />

      {/* Hurtig-chip ved markert ord */}
      {selectedWord && selectedWord.length > 0 && (
        <div className="suggestion-bar">
          <button className="suggestion-pill" onClick={() => { addTag(selectedWord); setSelectedWord(null); }}>
            {selectedWord}
          </button>
        </div>
      )}

      {/* Live forslag fra tekst + kjente tagger */}
      {smartSuggestions.length > 0 && (
        <div className="suggestion-bar">
          {smartSuggestions.map(t => (
            Array.from(knownTags).includes(t)
              ? <TagPill key={t} tag={t} onClick={() => addTag(t)} />
              : <button key={t} className="suggestion-pill" onClick={() => addTag(t)}>{t}</button>
          ))}
        </div>
      )}

      {/* Kontekstuelle forslag */}
      {contextualSuggestions.length > 0 && (
        <div className="suggestion-bar">
          {contextualSuggestions.map(t => (<TagPill key={t} tag={t} onClick={() => addTag(t)} />))}
        </div>
      )}

      {/* Manuell tagg-input */}
      <div className="row" style={{ marginTop: 6 }}>
        <input className="input" placeholder="Legg til tagg…" value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { addTag(tagInput); } }} />
        <button className="icon-btn" onClick={() => addTag(tagInput)} title="Legg til tagg" aria-label="Legg til tagg">
          <Plus color="var(--iconB)" strokeWidth={2.5} />
        </button>
      </div>
      {inputSuggestions.length > 0 && (
        <div className="suggestion-bar">
          {inputSuggestions.map(t => (<TagPill key={t} tag={t} onClick={() => addTag(t)} />))}
        </div>
      )}

      {/* Skjult filinput + ImagePlus-knapp */}
      <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} style={{ display: 'none' }} />
      <div className="edit-actions">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Legg til bilde" aria-label="Legg til bilde">
            <ImagePlus color="var(--iconB)" strokeWidth={2.5} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" onClick={onCancel} title="Lukk" aria-label="Lukk"><X color="var(--iconB)" strokeWidth={2.5} /></button>
          <button className="icon-btn" onClick={persist} title="Lagre" aria-label="Lagre"><Check color="var(--iconB)" strokeWidth={2.5} /></button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { notes, setNotes } = useNotes();
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { direct, related } = useMemo(() => directAndRelatedNotes(notes, selected), [notes, selected]);

  // Feed: eldst øverst → nyest nederst
  const baseOrder = useMemo(
    () => notes.slice().sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt)),
    [notes]
  );

  const visible = useMemo(() => {
    if (selected.length === 0) return baseOrder;
    const rel = related.map(x => x.note);
    const ordered = [...direct, ...rel];
    return ordered.sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt));
  }, [baseOrder, direct, related, selected]);

  function addNote(initial?: Partial<Note>) {
    const now = Date.now();
    const n: Note = {
      id: uid(),
      title: '',
      body: initial?.body ?? '',
      tags: (initial?.tags as string[])?.slice?.() ?? selected.slice(),
      image: initial?.image,
      createdAt: now,
      updatedAt: now
    };
    setNotes(prev => [...prev, n]);  // nederst i feed
    setEditingId(n.id);
  }
  function saveNote(n: Note) {
    setNotes(prev => prev.map(x => x.id === n.id ? n : x));
    setEditingId(null);
  }
  function deleteNote(id: string) {
    setNotes(prev => prev.filter(n => n.id !== id));
    setEditingId(null);
  }
  function addTagToDraft(t: string) {
    if (!editingId) return;
    const tag = t.trim(); if (!tag) return;
    setNotes(prev => prev.map(n => n.id === editingId && !n.tags.includes(tag)
      ? { ...n, tags: [...n.tags, tag], updatedAt: Date.now() } : n));
  }

  // IMPORT via Web Share Target (Android) eller /?url=...
  useEffect(() => {
    const { pathname, search } = window.location;
    const isShare = pathname === '/share' || pathname === '/share-target' || pathname === '/' || pathname === '';
    if (!isShare) return;

    const p = new URLSearchParams(search);
    const url = p.get('url') || '';
    const title = p.get('title') || '';
    const text = p.get('text') || '';

    if (!url && !title && !text) return;

    (async () => {
      let image: string | undefined = undefined;
      if (url) image = await tryFetchOgImage(url);
      const body = [title, text, url].filter(Boolean).join('\n\n').trim();
      addNote({ body, image });
      history.replaceState(null, '', '/');
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <TopBar
        notes={notes}
        selected={selected}
        setSelected={setSelected}
        draftOpen={!!editingId}
        onAddTagToDraft={addTagToDraft}
      />

      <div className="container">
        {selected.length > 0 && (
          <div className="small" style={{ margin: '6px 0 12px' }}>
            Direkte treff først. Deretter relaterte notater. (Nyeste nederst)
          </div>
        )}
        <div className="feed">
          {visible.map(n => (
            <div key={n.id}>
              {editingId === n.id ? (
                <EditCard
                  note={n}
                  onSave={saveNote}
                  onDelete={deleteNote}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <ReadCard
                  note={n}
                  onEdit={() => setEditingId(n.id)}
                  onClickTag={(t) => setSelected(prev => prev.includes(t) ? prev : [...prev, t])}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <button className="fab" title="Nytt notat" aria-label="Nytt notat" onClick={() => addNote()}>
        <Plus color="var(--iconB)" strokeWidth={3} />
      </button>
    </div>
  );
}
