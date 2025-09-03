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

function TagPill({ tag, onClick, onRemove, asButton = true }: { tag: string; onClick?: () => void; onRemove?: () => void; asButton?: boolean }) {
  const bg = ensureContrastBgForWhite(colorForTag(tag));
  const El: any = asButton ? 'button' : 'span';
  return (
    <El className="tagpill" style={{ background: bg }} onClick={onClick}>
      <span>#{tag}</span>
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
  notes,
  selected,
  setSelected,
  draftOpen,
  onAddTagToDraft
}: {
  notes: Note[];
  selected: string[];
  setSelected: (tags: string[]) => void;
  draftOpen: boolean;
  onAddTagToDraft: (t: string) => void;
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
    if (draftOpen) onAddTagToDraft(top);
    else toggleFilterTag(top);
    setInput('');
  }

  return (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="row" style={{ gap: 10 }}>
          {selected.map(t => (
            <TagPill key={t} tag={t} onClick={() => toggleFilterTag(t)} onRemove={() => toggleFilterTag(t)} />
          ))}
          <input className="input" placeholder={draftOpen ? 'Legg til tagg i notat…' : 'Søk/velg tagg…'} value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }} />
          {selected.length > 0 && (
            <button className="clear" onClick={() => setSelected([])}>Tøm</button>
          )}
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

function ReadCard({ note, onEdit, onClickTag }: { note: Note; onEdit: () => void; onClickTag: (t: string) => void; }) {
  const bodyPreview = note.body.split(/\r\n|\n|\r|\u2028|\u2029/).join('\n');
  return (
    <div className="card">
      {note.image && <img src={note.image} alt="" />}
      <h3>{note.title || '(uten tittel)'}</h3>
      <p>{bodyPreview}</p>
      <div className="tags">
        {note.tags.map(t => (
          <span key={t} onClick={(e) => { e.stopPropagation(); onClickTag(t); }}>
            <TagPill tag={t} asButton={false} />
          </span>
        ))}
      </div>
      <div className="edit-actions">
        <button className="ghost" onClick={onEdit}>Rediger</button>
        <span className="small">Oppdatert: {new Date(note.updatedAt || note.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}

function EditCard({
  note,
  onSave,
  onDelete,
  onCancel
}: {
  note: Note;
  onSave: (n: Note) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState('');
  const [image, setImage] = useState<string | undefined>(note.image);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [cursorWord, setCursorWord] = useState<string | null>(null);

  useEffect(() => { setBody(note.body); setTags(note.tags); setImage(note.image); }, [note.id]);

  const title = useMemo(() => computedTitleFromBody(body), [body]);

  // All tags in storage (for suggestions)
  const candidateTags = useMemo(() => {
    const all = new Set<string>();
    try {
      const raw = localStorage.getItem('storm_notes');
      if (raw) {
        const arr = JSON.parse(raw) as Note[];
        for (const n of arr) for (const t of n.tags) all.add(t);
      }
    } catch {}
    return Array.from(all).filter(t => !tags.includes(t));
  }, [tags]);

  // Frequency map
  const freq: Record<string, number> = useMemo(() => {
    const f: Record<string, number> = {};
    try {
      const raw = localStorage.getItem('storm_notes');
      if (raw) {
        const arr = JSON.parse(raw) as Note[];
        for (const n of arr) for (const t of n.tags) f[t] = (f[t] || 0) + 1;
      }
    } catch {}
    return f;
  }, []);

  // Simple co-occurrence proxy to current tags
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

  // Extract word at cursor
  function getWordAt(text: string, pos: number) {
    const left = text.slice(0, pos);
    const right = text.slice(pos);
    const leftMatch = left.match(/[\p{L}\p{N}_-]+$/u);
    const rightMatch = right.match(/^[\p{L}\p{N}_-]+/u);
    const word = ((leftMatch?.[0] || '') + (rightMatch?.[0] || '')) || '';
    return word.trim();
  }

  function handleSelectOrInput() {
    const ta = textRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    if (end > start) {
      const sel = ta.value.slice(start, end).trim();
      const clean = sel.replace(/^[#]+/, '').slice(0, 40);
      setSelectedWord(clean || null);
    } else {
      setSelectedWord(null);
      const w = getWordAt(ta.value, start);
      setCursorWord(w || null);
    }
  }

  // Suggestions from tagInput box (explicit) + contextual based on cursorWord
  const inputSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [] as string[];
    const score = (t: string) => (freq[t] || 0) + 3 * coScore(t) + (t.toLowerCase().startsWith(q) ? 2 : (t.toLowerCase().includes(q) ? 0.5 : 0));
    const pool = candidateTags.filter(t => t.toLowerCase().includes(q));
    return pool.sort((a,b)=> score(b)-score(a)).slice(0, 10);
  }, [tagInput, candidateTags, freq, tags]);

  const contextualSuggestions = useMemo(() => {
    const w = (cursorWord || '').toLowerCase();
    if (!w || w.length < 2) return [] as string[];
    const score = (t: string) => (freq[t] || 0) + 2 * coScore(t) + (t.toLowerCase().startsWith(w) ? 2 : (t.toLowerCase().includes(w) ? 0.5 : 0));
    const pool = candidateTags.filter(t => t.toLowerCase().includes(w));
    return pool.sort((a,b)=> score(b)-score(a)).slice(0, 8);
  }, [cursorWord, candidateTags, freq, tags]);

  return (
    <div className="editcard">
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
        style={{ width: '100%', minHeight: 160, padding: 10, borderRadius: 10 }}
      />

      {/* Quick action when selecting a word */}
      {selectedWord && selectedWord.length > 0 && (
        <div className="suggestion-bar">
          <button className="suggestion-pill" onClick={() => { addTag(selectedWord); setSelectedWord(null); }}>Legg til tagg: {selectedWord}</button>
        </div>
      )}

      {/* Contextual suggestions while typing */}
      {contextualSuggestions.length > 0 && (
        <div className="suggestion-bar">
          {contextualSuggestions.map(t => (
            <button key={t} className="suggestion-pill" onClick={() => addTag(t)}>#{t}</button>
          ))}
        </div>
      )}

      <div className="small">Tagger</div>
      <div className="tag-suggestion-list">
        {tags.map(t => (
          <TagPill key={t} tag={t} onRemove={() => removeTag(t)} />
        ))}
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <input className="input" placeholder="Legg til tagg…" value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addTag(tagInput); }} />
        <button className="ghost" onClick={() => addTag(tagInput)}>Legg til</button>
      </div>
      {inputSuggestions.length > 0 && (
        <div className="tag-suggestion-list">
          {inputSuggestions.map(t => (
            <TagPill key={t} tag={t} onClick={() => addTag(t)} />
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <input id="filepick" type="file" accept="image/*" onChange={onPickFile} />
      </div>

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

  // Feed order: oldest -> newest (newest at the bottom)
  const baseOrder = useMemo(() => notes.slice().sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt)), [notes]);

  const visible = useMemo(() => {
    if (selected.length === 0) return baseOrder;
    const rel = related.map(x => x.note);
    const ordered = [...direct, ...rel];
    return ordered.sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt));
  }, [baseOrder, direct, related, selected]);

  function addNote() {
    const now = Date.now();
    const n: Note = { id: uid(), title: '', body: '', tags: selected.slice(), createdAt: now, updatedAt: now };
    // push to the end (newest at bottom)
    setNotes([...notes, n]);
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
      <TopBar notes={notes} selected={selected} setSelected={setSelected} draftOpen={!!editingId} onAddTagToDraft={addTagToDraft} />

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
                <EditCard note={n} onSave={saveNote} onDelete={deleteNote} onCancel={() => setEditingId(null)} />
              ) : (
                <ReadCard note={n} onEdit={() => setEditingId(n.id)} onClickTag={(t) => setSelected(prev => prev.includes(t) ? prev : [...prev, t])} />
              )}
            </div>
          ))}
        </div>
      </div>

      <button className="fab" title="Nytt notat" onClick={addNote}>+</button>
    </div>
  );
}
