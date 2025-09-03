import { useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { Note } from './lib/types';
import { computedTitleFromBody } from './lib/text';
import { colorForTag, ensureContrastBgForWhite } from './lib/tags';
import { debounce, loadNotes, saveNotes } from './lib/storage';
import { directAndRelatedNotes, rankTopBarTags, tagBaseScores } from './lib/rank';
import { Plus, Check, ImagePlus, X, Eraser } from 'lucide-react';

const LOGO_PATH = '/icons/icon-192.png'; // Bytt om du har egen logo i /public

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function useDebouncedSave(notes: Note[]) {
  const save = useMemo(() => debounce((ns: Note[]) => saveNotes(ns), 150), []);
  useEffect(() => { save(notes); }, [notes, save]);
}

/** Enkle stopwords (no/en) */
const STOP = new Set([
  'og','i','på','til','det','en','et','jeg','du','vi','dere','er','som','av','med','for','ikke','å','eller','men','de','der','den',
  'the','a','an','of','in','on','to','is','are','be','as','at','by','for','and','or','not'
]);

/** Tokenizer av brødtekst → unike ord */
function extractTokens(text: string): string[] {
  const m = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
  return Array.from(new Set(m.filter(w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w))));
}

function TagPill({ tag, onClick, onRemove, asButton = true }: { tag: string; onClick?: () => void; onRemove?: () => void; asButton?: boolean }) {
  const bg = ensureContrastBgForWhite(colorForTag(tag));
  const El: any = asButton ? 'button' : 'span';
  return (
    <El className="tagpill" style={{ background: bg }} onClick={onClick} title={tag} aria-label={tag}>
      <span>{tag}</span>
      {onRemove && (
        <span className="x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Fjern ${tag}`}>×</span>
      )}
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
    return [...prefix, ...contains].sort((a, b) => score(b) - score(a)).slice(0, 20);
  }, [input, allTags, baseScores]);

  function scrollBottom() {
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });
  }
  function toggleFilterTag(t: string) {
    setSelected(selected.includes(t) ? selected.filter(x => x !== t) : [...selected, t]);
    scrollBottom(); // Vis nyeste direkte treff nederst
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

          {/* Logo (valgfri) + søk/input */}
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

        {/* ÉN linje – scroll horisontalt */}
        <div className="topbar-tags">
          {(input ? typeahead : ranked.slice(0, 50)).map(t => (
            <TagPill key={t} tag={t} onClick={() => { draftOpen ? onAddTagToDraft(t) : toggleFilterTag(t); if (input) setInput(''); }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* Lesekort – klikk hvor som helst for å redigere. Bilde til høyre. */
function ReadCard({ note, onEdit, onClickTag }: { note: Note; onEdit: () => void; onClickTag: (t: string) => void; }) {
  const bodyPreview = note.body.split(/\r\n|\n|\r|\u2028|\u2029/).join('\n');
  return (
    <div className="card" onClick={onEdit} role="button" aria-label="Rediger notat">
      <div className="tags" onClick={(e) => e.stopPropagation()}>
        {note.tags.map(t => (
          <span key={t} onClick={(e) => { e.stopPropagation(); onClickTag(t); }}>
            <TagPill tag={t} asButton={false} />
          </span>
        ))}
      </div>

      <div className="card-row">
        <div className="text">
          {note.title && <h3>{note.title}</h3>}
          {bodyPreview && <p>{bodyPreview}</p>}
        </div>
        {note.image && <img className="thumb" src={note.image} alt="" />}
      </div>

      {/* edit-knapp fjernet – hele kortet er klikkbart */}
      <div className="small">Oppdatert: {new Date(note.updatedAt || note.createdAt).toLocaleString()}</div>
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
  const caretRef = useRef<number>(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // oppdater caret-ref løpende
  const updateCaretRef = () => {
    const ta = textRef.current;
    if (ta && typeof ta.selectionStart === 'number') caretRef.current = ta.selectionStart;
  };

  useEffect(() => { setBody(note.body); setTags(note.tags); setImage(note.image); }, [note.id]);

  // Tittel beregnes, men ikke vist i UI
  const title = useMemo(() => computedTitleFromBody(body), [body]);

  // Kun foreslå ord som finnes i teksten (ikke historikk)
  const textTokens = useMemo(() => extractTokens(body), [body]);

  function addTag(t: string) {
    const clean = t.trim(); if (!clean) return;
    if (tags.includes(clean)) return;
    const winY = window.scrollY;
    const caret = caretRef.current;
    setTags(prev => [...prev, clean]);
    setTagInput('');
    // hold fokus/caret og scrollposisjon
    setTimeout(() => {
      const ta = textRef.current;
      if (ta) {
        ta.focus();
        try { ta.setSelectionRange(caret, caret); } catch {}
      }
      window.scrollTo({ top: winY });
    }, 0);
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

  // Autosave når bruker “forlater” appen
  useEffect(() => {
    const handler = () => { persist(); };
    const vis = () => { if (document.hidden) persist(); };
    window.addEventListener('beforeunload', handler);
    window.addEventListener('pagehide', handler);
    window.addEventListener('blur', handler);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('pagehide', handler);
      window.removeEventListener('blur', handler);
      document.removeEventListener('visibilitychange', vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, tags, image, title]);

  // Forslag kun fra tekst:
  // 1) Et ord markert/ved cursor gir presise forslag (prefix/contains).
  // 2) Inputfelt for tagg filtrerer tekst-ord.
  const [cursorWord, setCursorWord] = useState<string | null>(null);
  function getWordAt(text: string, pos: number) {
    const left = text.slice(0, pos), right = text.slice(pos);
    const leftMatch = left.match(/[\p{L}\p{N}_-]+$/u);
    const rightMatch = right.match(/^[\p{L}\p{N}_-]+/u);
    const word = ((leftMatch?.[0] || '') + (rightMatch?.[0] || '')) || '';
    return word.trim();
  }
  function handleSelectOrInput() {
    const ta = textRef.current; if (!ta) return;
    updateCaretRef();
    const start = ta.selectionStart ?? 0;
    const w = getWordAt(ta.value, start);
    setCursorWord(w || null);
  }

  const contextualSuggestions = useMemo(() => {
    const w = (cursorWord || '').toLowerCase();
    if (!w || w.length < 2) return [] as string[];
    const pool = textTokens.filter(t => !tags.includes(t) && (t.toLowerCase().startsWith(w) || t.toLowerCase().includes(w)));
    // prefiks først, deretter contains
    const score = (t: string) => (t.toLowerCase().startsWith(w) ? 2 : 0.5);
    return pool.sort((a,b)=> score(b)-score(a)).slice(0, 10);
  }, [cursorWord, textTokens, tags]);

  const inputSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [] as string[];
    const pool = textTokens.filter(t => !tags.includes(t) && (t.toLowerCase().startsWith(q) || t.toLowerCase().includes(q)));
    const score = (t: string) => (t.toLowerCase().startsWith(q) ? 2 : 0.5);
    return pool.sort((a,b)=> score(b)-score(a)).slice(0, 10);
  }, [tagInput, textTokens, tags]);

  return (
    <div className="editcard" onClick={(e) => e.stopPropagation()} role="group" aria-label="Rediger notat">
      {image && <img src={image} alt="" style={{ width: '100%', height: 'auto', borderRadius: 12, border: '1px solid var(--muted)' }} />}

      <textarea
        ref={textRef}
        value={body}
        onChange={(e) => { setBody(e.target.value); handleSelectOrInput(); }}
        onClick={handleSelectOrInput}
        onKeyUp={handleSelectOrInput}
        placeholder="Skriv notat…"
      />

      {/* Forslag fra ord ved markør */}
      {contextualSuggestions.length > 0 && (
        <div className="suggestion-bar">
          {contextualSuggestions.map(t => (
            <button key={t} className="suggestion-pill" onClick={() => addTag(t)}>{t}</button>
          ))}
        </div>
      )}

      {/* Tagger i notatet */}
      <div className="tags">
        {tags.map(t => (<TagPill key={t} tag={t} onRemove={() => removeTag(t)} />))}
      </div>

      {/* Manuell tagg-input (filtrerer kun ord som finnes i teksten) */}
      <div className="row" style={{ marginTop: 6 }}>
        <input className="input" placeholder="Legg til tagg…" value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addTag(tagInput); }}
          onBlur={updateCaretRef}
          onFocus={updateCaretRef}
        />
        <button className="icon-btn" onClick={() => addTag(tagInput)} title="Legg til tagg" aria-label="Legg til tagg">
          <Plus color="var(--iconB)" strokeWidth={2.5} />
        </button>
      </div>
      {inputSuggestions.length > 0 && (
        <div className="suggestion-bar">
          {inputSuggestions.map(t => (<button key={t} className="suggestion-pill" onClick={() => addTag(t)}>{t}</button>))}
        </div>
      )}

      {/* Skjult filinput + ImagePlus-knapp + Lukk + Lagre */}
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

  // Basisrekkefølge: eldst → nyest (nyeste nederst)
  const baseAsc = useMemo(
    () => notes.slice().sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt)),
    [notes]
  );

  // Ved filter: vis RELATERTE først (oppover), DIREKTE nederst (nyeste nederst)
  const visible = useMemo(() => {
    if (selected.length === 0) return baseAsc;
    const relatedAsc = related.map(x => x.note)
      .sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt));
    const directAsc = direct.slice()
      .sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt));
    return [...relatedAsc, ...directAsc];
  }, [baseAsc, direct, related, selected]);

  function addNote(initial?: Partial<Note>) {
    const now = Date.now();
    const n: Note = {
      id: uid(), title: '', body: initial?.body ?? '',
      tags: (initial?.tags as string[])?.slice?.() ?? selected.slice(),
      image: initial?.image, createdAt: now, updatedAt: now
    };
    setNotes(prev => [...prev, n]);  // nederst
    setEditingId(n.id);
  }
  function saveNote(n: Note) { setNotes(prev => prev.map(x => x.id === n.id ? n : x)); setEditingId(null); }
  function deleteNote(id: string) { setNotes(prev => prev.filter(n => n.id !== id)); setEditingId(null); }

  function scrollBottom() {
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });
  }

  function onClickTagFilter(t: string) {
    setSelected(prev => prev.includes(t) ? prev : [...prev, t]);
    scrollBottom();
  }

  function addTagToDraft(t: string) {
    if (!editingId) return;
    const tag = t.trim(); if (!tag) return;
    setNotes(prev => prev.map(n => n.id === editingId && !n.tags.includes(tag)
      ? { ...n, tags: [...n.tags, tag], updatedAt: Date.now() } : n));
  }

  return (
    <div className="app">
      <div className="top-placeholder"></div>
      <TopBar
        notes={notes}
        selected={selected}
        setSelected={setSelected}
        draftOpen={!!editingId}
        onAddTagToDraft={addTagToDraft}
      />

      <div className="container">
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
                  onClickTag={(t) => onClickTagFilter(t)}
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
