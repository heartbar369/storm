import { useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { Note } from './lib/types';
import { computedTitleFromBody } from './lib/text';
import { colorForTag, ensureContrastBgForWhite } from './lib/tags';
import { debounce, loadNotes, saveNotes } from './lib/storage';
import { directAndRelatedNotes, rankTopBarTags, tagBaseScores } from './lib/rank';

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function useDebouncedSave(notes: Note[]) {
  const save = useMemo(() => debounce((ns: Note[]) => saveNotes(ns), 150), []);
  useEffect(() => { save(notes); }, [notes, save]);
}

/** Stopwords (no/en – enkel liste) */
const STOP = new Set([
  'og','i','på','til','det','en','et','jeg','du','vi','dere','er','som','av','med','for','ikke','å','eller','men','de','der','den','det','the','a','an','of','in','on','to','is','are','be','as','at','by','for','and','or','not'
]);

/** Tokenizer av brødtekst */
function extractTokens(text: string): string[] {
  const m = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
  return m.filter(w =>
    w.length >= 2 &&
    !STOP.has(w) &&
    !/^\d+$/.test(w)
  );
}

function TagPill({ tag, onClick, onRemove, asButton = true }: { tag: string; onClick?: () => void; onRemove?: () => void; asButton?: boolean }) {
  const bg = ensureContrastBgForWhite(colorForTag(tag));
  const El: any = asButton ? 'button' : 'span';
  return (
    <El className="tagpill" style={{ background: bg }} onClick={onClick}>
      <span>{tag}</span>
      {onRemove && <span className="x" onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</span>}
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
}: {
  notes: Note[]; selected: string[]; setSelected: (tags: string[]) => void; draftOpen: boolean; onAddTagToDraft: (t: string) => void;
}) {
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
          {/* Valgte filter-tagger */}
          {selected.map(t => (
            <TagPill key={t} tag={t} onClick={() => toggleFilterTag(t)} onRemove={() => toggleFilterTag(t)} />
          ))}

          {/* Lite ikon + søk/input */}
          <img className="logo" src="/icons/icon-192.png" alt="Storm" />
          <input
            className="input"
            placeholder={draftOpen ? 'Legg til tagg i notat…' : 'Søk/velg tagg…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
          />

          {selected.length > 0 && <button className="clear" onClick={() => setSelected([])}>Tøm</button>}
        </div>

        {input && (
          <div className="topbar-suggest-list">
            {typeahead.map(t => (
              <TagPill key={t} tag={t} onClick={() => { draftOpen ? onAddTagToDraft(t) : toggleFilterTag(t); setInput(''); }} />
            ))}
          </div>
        )}
        {!input && (
          <div className="topbar-suggest-list" style={{ marginTop: 8 }}>
            {ranked.slice(0, 24).map(t => (
              <TagPill key={t} tag={t} onClick={() => draftOpen ? onAddTagToDraft(t) : toggleFilterTag(t)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* Lesekort: tagger over innholdet */
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
        <button className="ghost" onClick={onEdit}>Rediger</button>
        <span className="small">Oppdatert: {new Date(note.updatedAt || note.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}

/* Redigeringskort: tagger over textarea + live forslag under */
function EditCard({
  note, onSave, onDelete, onCancel
}: { note: Note; onSave: (n: Note) => void; onDelete: (id: string) => void; onCancel: () => void; }) {
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState('');
  const [image, setImage] = useState<string | undefined>(note.image);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [cursorWord, setCursorWord] = useState<string | null>(null);

  useEffect(() => { setBody(note.body); setTags(note.tags); setImage(note.image); }, [note.id]);
  const title = useMemo(() => computedTitleFromBody(body), [body]);

  // Tidligere lagrede tagger (fra alle notater), minus de vi allerede har
  const knownTags = useMemo(() => {
    const s = new Set<string>();
    try {
      const raw = localStorage.getItem('storm_notes');
      if (raw) {
        (JSON.parse(raw) as Note[]).forEach(n => n.tags.forEach(t => s.add(t)));
      }
    } catch {}
    tags.forEach(t => s.delete(t));
    return s;
  }, [tags]);

  // Frekvens for kjent tag i alle notater (for boost)
  const knownFreq: Record<string, number> = useMemo(() => {
    const f: Record<string, number> = {};
    try {
      const raw = localStorage.getItem('storm_notes');
      if (raw) {
        (JSON.parse(raw) as Note[]).forEach(n => n.tags.forEach(t => { f[t] = (f[t] || 0) + 1; }));
      }
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
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setImage(String(reader.result)); };
    reader.onerror = () => {};
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  function persist() {
    onSave({ ...note, body, title, tags, image, updatedAt: Date.now() });
  }

  // Word ved markør / seleksjon → chip for "legg til tagg"
  function getWordAt(text: string, pos: number) {
    const left = text.slice(0, pos);
    const right = text.slice(pos);
    const leftMatch = left.match(/[\p{L}\p{N}_-]+$/u);
    const rightMatch = right.match(/^[\p{L}\p{N}_-]+/u);
    const word = ((leftMatch?.[0] || '') + (rightMatch?.[0] || '')) || '';
    return word.trim();
  }
  function handleSelectOrInput() {
    const ta = textRef.current; if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    if (end > start) {
      const sel = ta.value.slice(start, end).trim().replace(/^[#]+/, '').slice(0, 40);
      setSelectedWord(sel || null);
    } else {
      setSelectedWord(null);
      const w = getWordAt(ta.value, start);
      setCursorWord(w || null);
    }
  }

  // Live forslag: (1) smarte forslag fra brødtekst, (2) kontekst ved markøren, (3) eksplisitt input-boks
  const smartSuggestions = useMemo(() => {
    // Kandidater = ord i teksten + kjente tagger som overlapper ordene
    const fromText = Object.keys(tokenFreq);
    const set = new Set<string>(fromText);
    // inkluder kjente tagger
    knownTags.forEach(t => set.add(t));

    // score: freq i tekst + boost for eksisterende tagger + co-occurrence + liten lengdebonus
    const score = (t: string) =>
      (tokenFreq[t] || 0) * 1.0 +
      (knownFreq[t] ? 3 : 0) +
      coScore(t) * 2 +
      Math.min(0.4, Math.max(0, (t.length - 2)) * 0.02);

    const out = Array.from(set)
      .filter(t => !tags.includes(t))
      .sort((a,b) => score(b) - score(a))
      .slice(0, 10);
    return out;
  }, [tokenFreq, knownTags, knownFreq, tags]);

  const contextualSuggestions = useMemo(() => {
    const w = (cursorWord || '').toLowerCase();
    if (!w || w.length < 2) return [] as string[];
    const pool = Array.from(knownTags).filter(t => t.toLowerCase().includes(w));
    // Boost prefix
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
      {/* TAGGER OVER NOTATET */}
      <div className="tags">
        {tags.map(t => (<TagPill key={t} tag={t} onRemove={() => removeTag(t)} />))}
      </div>

      {/* BILDE */}
      {image && <img src={image} alt="" />}

      {/* TITTEL */}
      <div className="small">Tittel (auto):</div>
      <div style={{ fontWeight: 700, marginTop: 4 }}>{title || '(uten tittel)'}</div>

      {/* BODY */}
      <textarea
        ref={textRef}
        value={body}
        onChange={(e) => { setBody(e.target.value); handleSelectOrInput(); }}
        onSelect={handleSelectOrInput}
        onKeyUp={handleSelectOrInput}
        placeholder="Skriv notat…"
        style={{ width: '100%', minHeight: 180, padding: 10, borderRadius: 12 }}
      />

      {/* RASK CHIP PÅ MARKERT ORD */}
      {selectedWord && selectedWord.length > 0 && (
        <div className="suggestion-bar">
          <button className="suggestion-pill" onClick={() => { addTag(selectedWord); setSelectedWord(null); }}>
            Legg til tagg: {selectedWord}
          </button>
        </div>
      )}

      {/* LIVE FORSLAG RETT UNDER NOTATET (fra tekst + kjente tagger) */}
      {smartSuggestions.length > 0 && (
        <div className="suggestion-bar">
          {smartSuggestions.map(t => (
            <button key={t} className="suggestion-pill" onClick={() => addTag(t)}>{t}</button>
          ))}
        </div>
      )}

      {/* KONTEKST BASERT PÅ ORD VED MARKØREN */}
      {contextualSuggestions.length > 0 && (
        <div className="suggestion-bar">
          {contextualSuggestions.map(t => (
            <button key={t} className="suggestion-pill" onClick={() => addTag(t)}>{t}</button>
          ))}
        </div>
      )}

      {/* EKSPISITT INPUTBOKS FOR TAGG */}
      <div className="row" style={{ marginTop: 6 }}>
        <input className="input" placeholder="Legg til tagg…" value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addTag(tagInput); }} />
        <button className="ghost" onClick={() => addTag(tagInput)}>Legg til</button>
      </div>
      {inputSuggestions.length > 0 && (
        <div className="suggestion-bar">
          {inputSuggestions.map(t => (
            <button key={t} className="suggestion-pill" onClick={() => addTag(t)}>{t}</button>
          ))}
        </div>
      )}

      {/* BILDEVELGER */}
      <div className="row" style={{ marginTop: 8 }}>
        <input id="filepick" type="file" accept="image/*" onChange={onPickFile} />
      </div>

      {/* HANDLINGER */}
      <div className="edit-actions">
        <button className="ghost" onClick={() => onDelete(note.id)}>Slett</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ghost" onClick={onCancel}>Avbryt</button>
          <button className="primary" onClick={persist}>Lagre</button>
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

  function addNote() {
    const now = Date.now();
    const n: Note = { id: uid(), title: '', body: '', tags: selected.slice(), createdAt: now, updatedAt: now };
    setNotes([...notes, n]);        // nederst i feed
    setEditingId(n.id);
  }
  function saveNote(n: Note) {
    setNotes(notes.map(x => x.id === n.id ? n : x));
    setEditingId(null);
  }
  function deleteNote(id: string) {
    setNotes(notes.filter(n => n.id !== id));
    setEditingId(null);
  }
  function addTagToDraft(t: string) {
    if (!editingId) return;
    const tag = t.trim(); if (!tag) return;
    setNotes(notes.map(n => n.id === editingId && !n.tags.includes(tag) ? { ...n, tags: [...n.tags, tag], updatedAt: Date.now() } : n));
  }

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

      <button className="fab" title="Nytt notat" onClick={addNote}>+</button>
    </div>
  );
}
