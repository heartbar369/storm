import { useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { Note } from './lib/types';
import { computedTitleFromBody } from './lib/text';
import { colorForTag, ensureContrastBgForWhite } from './lib/tags';
import { debounce, loadNotes, saveNotes } from './lib/storage';
import { directAndRelatedNotes, rankTopBarTags, tagBaseScores } from './lib/rank';
import { Plus, Check, ImagePlus, X, Eraser, Trash } from 'lucide-react';

const LOGO_PATH = '/icons/icon-192.png';

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function useDebouncedSave(notes: Note[]) {
  const save = useMemo(() => debounce((ns: Note[]) => saveNotes(ns), 150), []);
  useEffect(() => { save(notes); }, [notes, save]);
}

/* ---------- tekst / tags ---------- */

const STOP = new Set([
  'og','i','på','til','det','en','et','jeg','du','vi','dere','er','som','av','med','for','ikke','å','eller','men','de','der','den',
  'the','a','an','of','in','on','to','is','are','be','as','at','by','for','and','or','not'
]);

function extractTokens(text: string): string[] {
  const m = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
  return Array.from(new Set(m.filter(w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w))));
}

/** Gjør http(s)://… til klikkbare lenker (uten å trigge edit-click). */
function linkify(text: string) {
  const re = /https?:\/\/[^\s)]+/g;
  const parts: (string | JSX.Element)[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const url = m[0];
    parts.push(
      <a
        key={`${url}-${m.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/* ---------- bilde fra URL (favicon/apple-touch) ---------- */

/** Sjekk om et bilde-URL faktisk laster. */
function probeImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src + (src.includes('?') ? '&' : '?') + 'v=' + Date.now();
  });
}

/** Finn et greit representasjonsbilde for en nettside (ingen CORS-parse). */
async function findSiteImage(url: string): Promise<string | undefined> {
  try {
    const u = new URL(url);
    const origin = u.origin;
    const host = u.hostname;
    const candidates = [
      `${origin}/apple-touch-icon.png`,
      `${origin}/apple-touch-icon-precomposed.png`,
      `${origin}/favicon-196x196.png`,
      `${origin}/favicon-180x180.png`,
      `${origin}/favicon-152x152.png`,
      `${origin}/favicon-96x96.png`,
      `${origin}/favicon-32x32.png`,
      `${origin}/favicon.png`,
      `${origin}/favicon.ico`,
      // Siste utvei: Google favicon proxy
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`
    ];
    for (const src of candidates) {
      if (await probeImage(src)) return src;
    }
  } catch {}
  return undefined;
}

/* ---------- UI komponenter ---------- */

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

/* TopBar (én linje, horisontal scroll) */
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
    scrollBottom();
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
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />

          {selected.length > 0 && (
            <button className="icon-btn" onClick={() => setSelected([])} title="Tøm filter" aria-label="Tøm filter">
              <Eraser color="var(--iconB)" strokeWidth={2.5} />
            </button>
          )}
        </div>

        <div className="topbar-tags">
          {(input ? typeahead : ranked).map(t => (
            <TagPill key={t} tag={t} onClick={() => { draftOpen ? onAddTagToDraftAndFilter(t) : toggleFilterTag(t); if (input) setInput(''); }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* Lesekort – klikk åpner redigering. */
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
          {bodyPreview && <p>{linkify(bodyPreview)}</p>}
          {/* Ekstern lenke (hvis ikke allerede i body) */}
          {note.body && /\bhttps?:\/\//.test(note.body) ? null : (note.imageUrl ? null : null)}
        </div>
        {(note.imageUrl || note.image) && (
          <img className="thumb" src={note.imageUrl || note.image!} alt="" />
        )}
      </div>

      <div className="small">Oppdatert: {new Date(note.updatedAt || note.createdAt).toLocaleString()}</div>
    </div>
  );
}

/* Redigeringskort */
function EditCard({
  note, onSave, onDelete, onCancel, onAddFilterTag
}: {
  note: Note; onSave: (n: Note) => void; onDelete: (id: string) => void; onCancel: () => void; onAddFilterTag: (t: string) => void;
}) {
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState('');
  const [image, setImage] = useState<string | undefined>(note.image);
  const [imageUrl] = useState<string | undefined>(note.imageUrl);

  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number>(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [stickySuggestions, setStickySuggestions] = useState<string[]>([]);

  useEffect(() => { setBody(note.body); setTags(note.tags); setImage(note.image); }, [note.id]);

  const title = useMemo(() => computedTitleFromBody(body), [body]);
  const textTokens = useMemo(() => extractTokens(body), [body]);

  const knownTags = useMemo(() => {
    const s = new Set<string>();
    try {
      const raw = localStorage.getItem('storm_notes');
      if (raw) (JSON.parse(raw) as Note[]).forEach(n => n.tags.forEach(t => s.add(t)));
    } catch {}
    tags.forEach(t => s.delete(t));
    return s;
  }, [tags]);

  const updateCaretRef = () => {
    const ta = textRef.current;
    if (ta && typeof ta.selectionStart === 'number') caretRef.current = ta.selectionStart;
  };

  function addTag(t: string) {
    const clean = t.trim().toLowerCase(); // <-- normaliser til lowercase
    if (!clean) return;
    if (tags.includes(clean)) return;
    const winY = window.scrollY;
    const caret = caretRef.current;
    setTags(prev => [...prev, clean]);
    setTagInput('');
    onAddFilterTag(clean);
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
    onSave({ ...note, body, title, tags, image, imageUrl, updatedAt: Date.now() });
  }

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

      {(imageUrl || image) && <img src={imageUrl || image} alt="" style={{ width: '100%', height: 'auto', borderRadius: 12, border: '1px solid var(--muted)' }} />}

      <textarea
        ref={textRef}
        value={body}
        onChange={(e) => { setBody(e.target.value); handleSelectOrInput(); }}
        onClick={handleSelectOrInput}
        onKeyUp={handleSelectOrInput}
        placeholder="Skriv notat…"
      />

      {/* Konstant forslag-linje */}
      <div className="suggestion-fixed">
        {toShow.map(t => (
          knownTags.has(t)
            ? <TagPill key={t} tag={t} onClick={() => addTag(t)} />
            : <button key={t} className="suggestion-pill" onClick={() => addTag(t)}>{t}</button>
        ))}
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <input
          className="input"
          placeholder="Legg til tagg…"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addTag(tagInput); } }}
          onBlur={updateCaretRef}
          onFocus={updateCaretRef}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="icon-btn" onClick={() => addTag(tagInput)} title="Legg til tagg" aria-label="Legg til tagg">
          <Plus color="var(--iconB)" strokeWidth={2.5} />
        </button>
      </div>

      {/* Fil + actions */}
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

/* ---------- App ---------- */

export default function App() {
  const { notes, setNotes } = useNotes();
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { direct, related } = useMemo(() => directAndRelatedNotes(notes, selected), [notes, selected]);

  // eldst -> nyest (nyest nederst)
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

  // scroll nederst ved start
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
      image: initial?.image, imageUrl: initial?.imageUrl,
      createdAt: now, updatedAt: now
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

  function addTagToDraftAndFilter(t: string) {
    const tag = t.trim().toLowerCase(); // normaliser til lowercase
    if (editingId) {
      setNotes(prev => prev.map(n => n.id === editingId && !n.tags.includes(tag)
        ? { ...n, tags: [...n.tags, tag], updatedAt: Date.now() } : n));
    }
    setSelected(prev => prev.includes(tag) ? prev : [...prev, tag]);
    scrollBottom();
  }

  /* SHARE TARGET: opprett nytt notat.
     - Tekst: behold første 5 ikke-tomme linjer.
     - Lenke: beholdes; vises klikkbar via linkify().
     - Bilde: finn favicon/apple-touch (ingen CORS). */
  useEffect(() => {
    const { pathname, search } = window.location;
    const p = pathname.replace(/\/+$/, ''); // trim trailing slash
    if (!(p === '' || p === '/' || p === '/share-target')) return;

    const qs = new URLSearchParams(search);
    const url = qs.get('url') || '';
    const title = qs.get('title') || '';
    const text = qs.get('text') || '';

    if (!url && !title && !text) return;

    (async () => {
      // Første 5 linjer fra tekst
      const lines = (text || '').split(/\r\n|\n|\r|\u2028|\u2029/).map(s => s.trim()).filter(Boolean).slice(0, 5);
      const body = [title, lines.join('\n'), url].filter(Boolean).join('\n\n').trim();

      let imageUrl: string | undefined = undefined;
      if (url) imageUrl = await findSiteImage(url);

      addNote({ body, imageUrl });
      history.replaceState(null, '', '/'); // ikke repeter ved refresh
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
                  onAddFilterTag={(t) => { const tag = t.toLowerCase(); setSelected(prev => prev.includes(tag) ? prev : [...prev, tag]); scrollBottom(); }}
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
