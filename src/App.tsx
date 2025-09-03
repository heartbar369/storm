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

function Card({ note, onOpen, onClickTag }: { note: Note; onOpen: () => void; onClickTag: (t: string) => void; }) {
  const bodyPreview = note.body.split(/\\r\\n|\\n|\\r|\\u2028|\\u2029/).slice(0, 6).join('\\n');
  return (
    <div className="card" onClick={onOpen}>
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
    </div>
  );
}

function Draft({
  note,
  onClose,
  onSave,
  onDelete
}: {
  note: Note;
  onClose: () => void;
  onSave: (n: Note) => void;
  onDelete: (id: string) => void;
}) {
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState('');
  const [image, setImage] = useState<string | undefined>(note.image);

  useEffect(() => { setBody(note.body); setTags(note.tags); setImage(note.image); }, [note.id]);

  const title = useMemo(() => computedTitleFromBody(body), [body]);

  const allTags = useMemo(() => Array.from(new Set((note.tags.concat(tags)))) , [note.tags, tags]);

  const candidateTags = useMemo(() => {
    // From *all* tags in storage (from other notes)
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

  const suggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    // Score: freq + 3×co-occurrence + prefix boost + contains boost
    const freq: Record<string, number> = {};
    try {
      const raw = localStorage.getItem('storm_notes');
      if (raw) {
        const arr = JSON.parse(raw) as Note[];
        for (const n of arr) for (const t of n.tags) freq[t] = (freq[t] || 0) + 1;
      }
    } catch {}

    const co: Record<string, number> = {};
    for (const t of candidateTags) {
      let c = 0;
      for (const exist of tags) { if (t === exist) continue; if (exist && t) c += 1; }
      co[t] = c; // simple co-occurrence proxy
    }

    const score = (t: string) => {
      const base = (freq[t] || 0) + 3 * (co[t] || 0);
      const str = t.toLowerCase();
      const prefix = q && str.startsWith(q) ? 2 : 0;
      const contains = q && str.includes(q) ? 0.5 : 0;
      return base + prefix + contains;
    };

    const pool = q ? candidateTags.filter(t => t.toLowerCase().includes(q)) : candidateTags;
    return pool.sort((a, b) => score(b) - score(a)).slice(0, 10);
  }, [candidateTags, tags, tagInput]);

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
    reader.onerror = () => { /* ignore */ };
    reader.readAsDataURL(f);
    // clear input
    e.target.value = '';
  }

  function persist() {
    onSave({ ...note, body, title, tags, image, updatedAt: Date.now() });
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Skriv notat…" />
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <div className="small">Tittel (auto):</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{title || '(uten tittel)'}</div>
            <hr className="hr" />
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
            {suggestions.length > 0 && (
              <div className="tag-suggestion-list">
                {suggestions.map(t => (
                  <TagPill key={t} tag={t} onClick={() => addTag(t)} />
                ))}
              </div>
            )}
          </div>
          <div style={{ width: 260 }}>
            <div className="small">Bilde</div>
            {image ? (
              <img src={image} alt="" />
            ) : (
              <div className="small" style={{ opacity: .8 }}>Ingen bilde valgt</div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <input id="filepick" type="file" accept="image/*" onChange={onPickFile} />
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => onDelete(note.id)}>Slett</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ghost" onClick={onClose}>Lukk</button>
            <button className="primary" onClick={persist}>Lagre</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { notes, setNotes } = useNotes();
  const [selected, setSelected] = useState<string[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);

  const draft = useMemo(() => notes.find(n => n.id === draftId) || null, [draftId, notes]);

  const { direct, related } = useMemo(() => directAndRelatedNotes(notes, selected), [notes, selected]);
  const visible = useMemo(() => {
    if (selected.length === 0) return notes.slice().sort((a,b)=> (b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt));
    const rel = related.map(x => x.note);
    return [...direct, ...rel];
  }, [notes, direct, related, selected]);

  function openDraft(id: string) { setDraftId(id); }

  function addNote() {
    const now = Date.now();
    const n: Note = {
      id: uid(),
      title: '',
      body: '',
      tags: selected.slice(),
      createdAt: now,
      updatedAt: now,
    };
    setNotes([n, ...notes]);
    setDraftId(n.id);
  }

  function saveNote(n: Note) {
    setNotes(notes.map(x => x.id === n.id ? n : x));
  }

  function deleteNote(id: string) {
    setNotes(notes.filter(n => n.id !== id));
    setDraftId(null);
  }

  function addTagToDraft(t: string) {
    if (!draft) return;
    const tag = t.trim(); if (!tag) return;
    if (draft.tags.includes(tag)) return;
    saveNote({ ...draft, tags: [...draft.tags, tag], updatedAt: Date.now() });
  }

  return (
    <div className="app">
      <TopBar notes={notes} selected={selected} setSelected={setSelected} draftOpen={!!draft} onAddTagToDraft={addTagToDraft} />

      <div className="container">
        {selected.length > 0 && (
          <div className="small" style={{ margin: '6px 0 12px' }}>
            Direkte treff først. Deretter relaterte notater.
          </div>
        )}
        <div className="feed">
          {visible.map(n => (
            <Card key={n.id} note={n} onOpen={() => openDraft(n.id)} onClickTag={(t) => setSelected(prev => prev.includes(t) ? prev : [...prev, t])} />
          ))}
        </div>
      </div>

      <button className="fab" title="Nytt notat" onClick={addNote}>+</button>

      {draft && (
        <Draft note={draft} onClose={() => setDraftId(null)} onSave={saveNote} onDelete={deleteNote} />
      )}
    </div>
  );
}
