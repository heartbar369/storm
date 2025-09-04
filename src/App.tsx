import { useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { Note } from './lib/types';
import { computedTitleFromBody } from './lib/text';
import { colorForTag, ensureContrastBgForWhite } from './lib/tags';
import { debounce, loadNotes, saveNotes } from './lib/storage';
import { directAndRelatedNotes, rankTopBarTags, tagBaseScores } from './lib/rank';
import { Plus, Check, ImagePlus, X, Eraser, Trash } from 'lucide-react';

const LOGO_PATH = '/icons/icon-192.png'; // bytt om du har egen logo i /public

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function useDebouncedSave(notes: Note[]) {
  const save = useMemo(() => debounce((ns: Note[]) => saveNotes(ns), 150), []);
  useEffect(() => { save(notes); }, [notes, save]);
}

/** Stopwords (no/en) */
const STOP = new Set([
  'og','i','på','til','det','en','et','jeg','du','vi','dere','er','som','av','med','for','ikke','å','eller','men','de','der','den',
  'the','a','an','of','in','on','to','is','are','be','as','at','by','for','and','or','not'
]);

/** Tokens (unik liste) fra tekst */
function extractTokens(text: string): string[] {
  const m = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
  return Array.from(new Set(m.filter(w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w))));
}

/** Best-effort henting av og:image som dataURL */
async function tryFetchOgImage(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return undefined;
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    const img = m?.[1];
    if (!img) return undefined;
    const ir = await fetch(img, { mode: 'cors' });
    if (!ir.ok) return undefined;
    const blob = await ir.blob();
    const fr = new FileReader();
    return await new Promise((resolve) => {
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(undefined);
      fr.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

/** Fargede tag-piller (kjente tagger). Ingen # prefiks. */
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

/* TOP BAR – én linje, horisontal scroll; valgte tagger låses først */
function TopBar({
  notes, selected, setSelected, draftOpen, onAddTagToDraftAndFilter
}: { notes: Note[]; selected: string[]; setSelected: (tags: string[]) => void; draftOpen: boolean; onAddTagToDraftAndFilter: (t: string) => void; }) {
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
    return [...prefix, ...contains].sort((a, b) => score(b) - score(a)).slice(0, 50);
  }, [input, allTags, baseScores]);

  function scrollBottom() {
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });
  }
  function toggleFilterTag(t: string) {
    setSelected(selected.includes(t) ? selected.filter(x => x !== t) : [...selected, t]);
    scrollBottom(); // vis direkte treff nederst
  }
  function onEnter() {
    const top = (typeahead[0] || input.trim());
    if (!top) return;
    if (draftOpen) onAddTagToDraftAndFilter(top); else toggleFilterTag(top);
    setInput('');
  }

  return (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="row" style={{ gap: 10 }}>
          {selected.map(t => (
            <TagPill key={t} tag={t} onClick={() => toggleFilterTag(t)} onRemove={() => toggleFilterTag(t)} />
          ))}

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

        {/* én linje – horisontal scroll */}
        <div className="topbar-tags">
          {(input ? typeahead : ranked).map(t => (
            <TagPill key={t} tag={t} onClick={() => {
              if (draftOpen) onAddTagToDraftAndFilter(t); else toggleFilterTag(t);
              if (input) setInput('');
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* LESEKORT – klikk hvor som helst for å redigere. Bilde til høyre. */
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

      <div className="small">Oppdatert: {new Date(note.updatedAt || note.createdAt).toLocaleString()}</div>
    </div>
  );
}

/* REDIGERINGSKORT */
function EditCard({
  note, onSave, onDelete, onCancel, onAddFilterTag
}: {
  note: Note;
  onSave: (n: Note) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
  onAddFilterTag: (t: string) => void; // legg samtidig til i top-filter
}) {
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState('');
  const [image, setImage] = useState<string | undefined>(note.image);

  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number>(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // sticky forslag – ikke forsvinne når teksten endres
  const [stickySuggestions, setStickySuggestions] = useState<string[]>([]);

  useEffect(() => { setBody(note.body); setTags(note.tags); setImage(note.image); }, [note.id]);

  // beregn tittel, men vis den ikke (plass)
  const title = useMemo(() => computedTitleFromBody(body), [body]);

  // tokens i teksten
  const textTokens = useMemo(() => extractTokens(body), [body]);

  // kjente tagger fra alle notater
  const knownTags = useMemo(() => {
    const s = new Set<string>();
    try {
      const raw = localStorage.getItem('storm_notes');
      if (raw) (JSON.parse(raw) as Note[]).forEach(n => n.tags.forEach(t => s.add(t)));
    } catch {}
    // fjern de som allerede er i notatet
    tags.forEach(t => s.delete(t));
    return s;
  }, [tags]);

  // caret-posisjon
  const updateCaretRef = () => {
    const ta = textRef.current;
    if (ta && typeof ta.selectionStart === 'number') caretRef.current = ta.selectionStart;
  };

  function addTag(t: string) {
    const clean = t.trim(); if (!clean) return;
    if (tags.includes(clean)) return;
    const winY = window.scrollY;
    const caret = caretRef.current;

    setTags(prev => [...prev, clean]);
    setTagInput('');

    // legg til i top-filter også
    onAddFilterTag(clean);

    // behold fokus/caret og scrollposisjon
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

  // autosave ved "forlat"
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

  // ord ved caret (for sortering)
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

  // **Kjente tagger som matcher teksten først**, så nye ord fra teksten
  const computedSuggestions = useMemo(() => {
    const tokens = textTokens.filter(t => !tags.includes(t));
    const known = tokens.filter(t => knownTags.has(t));
    const fresh = tokens.filter(t => !knownTags.has(t));

    const w = (cursorWord || tagInput).toLowerCase();
    const score = (t: string) => (w ? (t.toLowerCase().startsWith(w) ? 2 : (t.toLowerCase().includes(w) ? 0.5 : 0)) : 0);

    const knownSorted = known.sort((a,b)=> score(b)-score(a));
    const freshSorted = fresh.sort((a,b)=> score(b)-score(a));

    return [...knownSorted, ...freshSorted].slice(0, 40);
  }, [textTokens, tags, knownTags, cursorWord, tagInput]);

  // ikke la linja forsvinne helt
  useEffect(() => {
    if (computedSuggestions.length > 0) setStickySuggestions(computedSuggestions);
  }, [computedSuggestions]);

  const toShow = computedSuggestions.length > 0 ? computedSuggestions : stickySuggestions;

  return (
    <div className="editcard" onClick={(e) => e.stopPropagation()} role="group" aria-label="Rediger notat">
      {/* valgte tagger øverst */}
      <div className="tags">
        {tags.map(t => (<TagPill key={t} tag={t} onRemove={() => removeTag(t)} />))}
      </div>

      {image && <img src={image} alt="" style={{ width: '100%', height: 'auto', borderRadius: 12, border: '1px solid var(--muted)' }} />}

      <textarea
        ref={textRef}
        value={body}
        onChange={(e) => { setBody(e.target.value); handleSelectOrInput(); }}
        onClick={handleSelectOrInput}
        onKeyUp={handleSelectOrInput}
        placeholder="Skriv notat…"
      />

      {/* KONSTANT forslag-linje (horisontal scroll). Kjente (fargede) først, nye (hvite rammer) etterpå */}
      <div className="suggestion-fixed">
        {toShow.map(t => (
          knownTags.has(t)
            ? <TagPill key={t} tag={t} onClick={() => addTag(t)} />
            : <button key={t} className="suggestion-pill" onClick={() => addTag(t)}>{t}</button>
        ))}
      </div>

      {/* Manuell tagg-input (filtrerer kun tekstord via computedSuggestions) */}
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

      {/* Skjult filinput + actions */}
      <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} style={{ display: 'none' }} />
      <div className="edit-actions">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Legg til bilde" aria-label="Legg til bilde">
            <ImagePlus color="var(--iconB)" strokeWidth={2.5} />
          </button>
          <button className="icon-btn" onClick={() => onDelete(note.id)} title="Slett notat" aria-label="Slett notat">
            <Trash color="var(--iconB)" strokeWidth={2.5} />
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

  // eldst -> nyest (nyeste nederst)
  const baseAsc = useMemo(
    () => notes.slice().sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt)),
    [notes]
  );

  // Ved filter: relaterte først (oppover), direkte nederst (nyeste nederst)
  const visible = useMemo(() => {
    if (selected.length === 0) return baseAsc;
    const relatedAsc = related.map(x => x.note)
      .sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt));
    const directAsc = direct.slice()
      .sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt));
    return [...relatedAsc, ...directAsc];
  }, [baseAsc, direct, related, selected]);

  // Scroll til bunnen ved start (nyeste nederst)
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current) return;
    didInitialScroll.current = true;
    setTimeout(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    }, 0);
  }, []);

  function addNote(initial?: Partial<Note>) {
    const now = Date.now();
    const n: Note = {
      id: uid(), title: '', body: initial?.body ?? '',
      tags: (initial?.tags as string[])?.slice?.() ?? selected.slice(),
      image: initial?.image, createdAt: now, updatedAt: now
    };
    setNotes(prev => [...prev, n]); // nederst
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

  // Legg tagg i draft + i top-filter
  function addTagToDraftAndFilter(t: string) {
    const tag = t.trim(); if (!tag) return;
    if (editingId) {
      setNotes(prev => prev.map(n => n.id === editingId && !n.tags.includes(tag)
        ? { ...n, tags: [...n.tags, tag], updatedAt: Date.now() } : n));
    }
    setSelected(prev => prev.includes(tag) ? prev : [...prev, tag]);
    scrollBottom();
  }

  // IMPORT fra “Del til …” via GET /share-target?title=&text=&url=
  useEffect(() => {
    const { pathname, search } = window.location;
    if (!(pathname === '/share-target' || pathname === '/' || pathname === '')) return;

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
      // rens URL-en etter import så ikke samme notat lages igjen ved refresh
      history.replaceState(null, '', '/');
      // scroll ned til nytt notat
      scrollBottom();
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
        onAddTagToDraftAndFilter={addTagToDraftAndFilter}
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
                  onAddFilterTag={(t) => { setSelected(prev => prev.includes(t) ? prev : [...prev, t]); scrollBottom(); }}
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
