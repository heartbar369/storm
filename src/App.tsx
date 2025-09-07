import { useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { Note } from './lib/types';
import { computedTitleFromBody } from './lib/text';
import { colorForTag, ensureContrastBgForWhite } from './lib/tags';
import { debounce, loadNotes, saveNotes } from './lib/storage';
import {
  directAndRelatedNotes,
  rankTopBarTags,
  tagBaseScores,
  buildTagIndex
} from './lib/rank';
import { Plus, Check, ImagePlus, X, Eraser, Trash, Info } from 'lucide-react';
import { VERSION } from './lib/version';

const LOGO_PATH = '/icons/icon-192.png';

/* ---------- utils ---------- */
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function useDebouncedSave(notes: Note[]) {
  const save = useMemo(() => debounce((ns: Note[]) => saveNotes(ns), 150), []);
  useEffect(() => { save(notes); }, [notes, save]);
}
function linkify(text: string) {
  const re = /https?:\/\/[^\s)]+/g;
  const parts: (string | JSX.Element)[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const url = m[0];
    parts.push(
      <a key={`${url}-${m.index}`} href={url} target="_blank" rel="noopener noreferrer" onClick={(e)=>e.stopPropagation()}>{url}</a>
    );
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
const STOP = new Set(['og','i','på','til','det','en','et','jeg','du','vi','dere','er','som','av','med','for','ikke','å','eller','men','de','der','den','the','a','an','of','in','on','to','is','are','be','as','at','by','for','and','or','not']);
function extractTokens(text: string): string[] {
  const m = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
  return Array.from(new Set(m.filter(w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w))));
}

/* ---- favicon/apple-touch for delt URL ---- */
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
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`
    ];
    for (const src of candidates) if (await probeImage(src)) return src;
  } catch {}
  return undefined;
}

/* ---------- UI ---------- */
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

/* ---------- TOP BAR ---------- */
function TopBar({
  notes, selected, setSelected, draftOpen, onAddTagToDraftAndFilter, onToggleInfo
}: {
  notes: Note[]; selected: string[]; setSelected: (tags: string[]) => void; draftOpen: boolean;
  onAddTagToDraftAndFilter: (t: string) => void; onToggleInfo: () => void;
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
    return [...prefix, ...contains].sort((a, b) => score(b) - score(a)).slice(0, 50);
  }, [input, allTags, baseScores]);

  function scrollBottom() {
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });
  }
  function toggleFilterTag(raw: string) {
    const t = raw.trim().toLowerCase();
    setSelected(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
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
          <button className="logo-btn" onClick={onToggleInfo} title="Info">
            <img className="logo-img" src={LOGO_PATH} alt="Storm" />
          </button>

          {selected.map(t => (
            <TagPill key={t} tag={t} onClick={() => toggleFilterTag(t)} onRemove={() => toggleFilterTag(t)} />
          ))}

          <input
            className="input"
            placeholder={draftOpen ? 'Legg til tagg i notat…' : 'Søk/velg tagg…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
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

/* ---------- LESEKORT ---------- */
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
        </div>
        {(note as any).imageUrl && <img className="thumb" src={(note as any).imageUrl} alt="" />}
        {note.image && !((note as any).imageUrl) && <img className="thumb" src={note.image} alt="" />}
      </div>
      <div className="small">Oppdatert: {new Date(note.updatedAt || note.createdAt).toLocaleString()}</div>
    </div>
  );
}

/* ---------- REDIGERINGSKORT ---------- */
function EditCard({
  note, allNotes, onSave, onSaveDraft, onDeleteReplace, onCancel, onAddFilterTag
}: {
  note: Note;
  allNotes: Note[];
  onSave: (n: Note) => void;
  onSaveDraft: (n: Note) => void;
  onDeleteReplace: (n: Note) => void;   // slett notatet, men hold editor åpen ved å erstatte med nytt
  onCancel: () => void;
  onAddFilterTag: (t: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState('');
  const [image, setImage] = useState<string | undefined>(note.image);
  const [imageUrl] = useState<string | undefined>((note as any).imageUrl);

  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number>(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // fokus + scroll ved åpning
  useEffect(() => {
    const el = wrapperRef.current;
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    const t = textRef.current;
    if (t) { setTimeout(() => { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, 0); }
  }, [note.id]);

  useEffect(() => { setBody(note.body); setTags(note.tags); setImage(note.image); }, [note.id]);
  const title = useMemo(() => computedTitleFromBody(body), [body]);

  const updateCaretRef = () => {
    const ta = textRef.current;
    if (ta && typeof ta.selectionStart === 'number') caretRef.current = ta.selectionStart;
  };

  function addTag(t: string) {
    const clean = t.trim().toLowerCase();
    if (!clean || tags.includes(clean)) return;
    const winY = window.scrollY;
    const caret = caretRef.current;
    setTags(prev => [...prev, clean]);
    setTagInput('');
    onAddFilterTag(clean); // speil i filteret
    setTimeout(() => {
      const ta = textRef.current;
      if (ta) { ta.focus(); try { ta.setSelectionRange(caret, caret); } catch {} }
      window.scrollTo({ top: winY });
    }, 0);
  }
  function removeTag(t: string) {
    const newTags = tags.filter(x => x !== t);
    setTags(newTags);
    // persister som utkast – og hold editor åpen
    onSaveDraft({ ...note, body, title, tags: newTags, image, updatedAt: Date.now() });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const winY = window.scrollY;
    const caret = caretRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result);
      setImage(data);
      onSaveDraft({ ...note, body, title, tags, image: data, updatedAt: Date.now() });
      setTimeout(() => {
        const ta = textRef.current;
        if (ta) { ta.focus(); try { ta.setSelectionRange(caret, caret); } catch {} }
        window.scrollTo({ top: winY });
      }, 0);
    };
    reader.onerror = () => {};
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  // autosave mens du skriver (drafter – ikke lukk)
  const debouncedDraft = useMemo(
    () => debounce((draft: Note) => onSaveDraft(draft), 250),
    [onSaveDraft]
  );
  useEffect(() => {
    debouncedDraft({ ...note, body, title, tags, image, updatedAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, tags, image, title]);

  /* ---- RELATERTE TAGGER (kun reelle samforekomster) ---- */
  const relatedSuggestions = useMemo(() => {
    if (tags.length === 0) return [] as string[];
    // Ta med "live" versjon av dette notatet i indeksen
    const notesWithCurrent = allNotes.map(n => n.id === note.id ? { ...n, tags } : n);
    const idx = buildTagIndex(notesWithCurrent); // tag -> Set(noteIds)

    // kandidater = alle tagger minus de allerede valgte
    const cand = new Set(Object.keys(idx));
    tags.forEach(t => cand.delete(t));

    // co-occurrence score = sum(|A∩B|) mot alle valgte tagger
    const scoreMap = new Map<string, number>();
    for (const u of cand) {
      let s = 0;
      for (const t of tags) {
        const A = idx[u], B = idx[t];
        if (!A || !B) continue;
        const small = A.size < B.size ? A : B;
        const large = A.size < B.size ? B : A;
        let inter = 0;
        small.forEach(id => { if (large.has(id)) inter++; });
        s += inter;
      }
      if (s > 0) scoreMap.set(u, s); // kun ekte relasjon (>0)
    }

    return [...scoreMap.entries()]
      .sort((a,b)=> b[1]-a[1])
      .slice(0, 40)
      .map(([u])=>u);
  }, [tags, allNotes, note.id]);

  /* ---- LIVE FRA TEKSTEN ---- */
  const textTokens = useMemo(() => extractTokens(body), [body]);
  const knownTagsSet = useMemo(() => {
    const s = new Set<string>();
    for (const n of allNotes) for (const t of n.tags) s.add(t);
    tags.forEach(t => s.delete(t));
    return s;
  }, [allNotes, tags]);

  // beregn frekvens for kjente tagger (antall notater som har taggen)
  const tagFreq: Record<string, number> = useMemo(() => {
    const f: Record<string, number> = {};
    const idx = buildTagIndex(allNotes);
    for (const t of Object.keys(idx)) f[t] = idx[t].size;
    return f;
  }, [allNotes]);

  // finn ord under markør (prefix-boost)
  const [cursorWord, setCursorWord] = useState<string | null>(null);
  function getWordAt(text: string, pos: number) {
    const left = text.slice(0, pos), right = text.slice(pos);
    const l = left.match(/[\p{L}\p{N}_-]+$/u)?.[0] || '';
    const r = right.match(/^[\p{L}\p{N}_-]+/u)?.[0] || '';
    return (l + r).trim();
  }
  function handleCaret() {
    const ta = textRef.current; if (!ta) return;
    const start = ta.selectionStart ?? 0;
    setCursorWord(getWordAt(ta.value, start) || null);
  }

  // tekstbaserte forslag: kjente tagger som matcher teksten først, deretter helt nye ord
  const textBasedSuggestions = useMemo(() => {
    const tokens = textTokens.filter(t => !tags.includes(t));
    const known = tokens.filter(t => knownTagsSet.has(t));
    const fresh = tokens.filter(t => !knownTagsSet.has(t));

    const w = (cursorWord || '').toLowerCase();
    const knownScore = (t: string) =>
      (tagFreq[t] || 0) + (w ? (t.startsWith(w) ? 2 : (t.includes(w) ? 0.5 : 0)) : 0);
    const freshScore = (t: string) =>
      (w ? (t.startsWith(w) ? 2 : (t.includes(w) ? 0.5 : 0)) : 0);

    const knownSorted = known.sort((a,b)=> knownScore(b)-knownScore(a));
    const freshSorted = fresh.sort((a,b)=> freshScore(b)-freshScore(a));

    return [...knownSorted, ...freshSorted].slice(0, 40);
  }, [textTokens, tags, knownTagsSet, tagFreq, cursorWord]);

  // slå sammen: relaterte først, så fra teksten – uten duplikater
  const finalSuggestions = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of relatedSuggestions) { if (!seen.has(t)) { out.push(t); seen.add(t); } }
    for (const t of textBasedSuggestions) { if (!seen.has(t)) { out.push(t); seen.add(t); } }
    return out.slice(0, 40);
  }, [relatedSuggestions, textBasedSuggestions]);

  return (
    <div ref={wrapperRef} className="editcard" onClick={(e) => e.stopPropagation()} role="group" aria-label="Rediger notat">
      {/* valgte tagger øverst */}
      <div className="tags">
        {tags.map(t => (<TagPill key={t} tag={t} onRemove={() => removeTag(t)} />))}
      </div>

      {(imageUrl || image) && <img src={imageUrl || image} alt="" style={{ width: '100%', height: 'auto', borderRadius: 12, border: '1px solid var(--muted)' }} />}

      <textarea
        ref={textRef}
        value={body}
        onChange={(e) => { setBody(e.target.value); handleCaret(); }}
        onClick={handleCaret}
        onKeyUp={handleCaret}
        placeholder="Skriv notat…"
      />

      {/* Konstant forslag-linje: Relaterte (fargede) + Fra teksten (kjent=farget, ny=nøytral) */}
      <div className="suggestion-fixed" style={{ marginTop: 6 }}>
        {finalSuggestions.map(t =>
          knownTagsSet.has(t)
            ? <TagPill key={t} tag={t} onClick={() => addTag(t)} />
            : <button key={t} className="suggestion-pill" onClick={() => addTag(t)}>{t}</button>
        )}
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
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
        />
        <button
          className="icon-btn"
          onClick={() => { updateCaretRef(); fileRef.current?.click(); }}
          title="Legg til bilde" aria-label="Legg til bilde"
        >
          <ImagePlus color="var(--iconB)" strokeWidth={2.5} />
        </button>
      </div>

      {/* Skjult fil-input */}
      <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} style={{ display: 'none' }} />

      <div className="edit-actions">
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" onClick={() => { updateCaretRef(); fileRef.current?.click(); }} title="Legg til bilde" aria-label="Legg til bilde">
            <ImagePlus color="var(--iconB)" strokeWidth={2.5} />
          </button>
          {/* Slett notat: erstatt med nytt tomt notat – lukk ikke editor */}
          <button className="icon-btn" onClick={() => onDeleteReplace({ ...note, body, title, tags, image })} title="Slett notat" aria-label="Slett notat">
            <Trash color="var(--iconB)" strokeWidth={2.5} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="icon-btn" onClick={onCancel} title="Lukk" aria-label="Lukk"><X color="var(--iconB)" strokeWidth={2.5} /></button>
          <button className="icon-btn" onClick={() => onSave({ ...note, body, title, tags, image, updatedAt: Date.now() })} title="Lagre" aria-label="Lagre"><Check color="var(--iconB)" strokeWidth={2.5} /></button>
        </div>
      </div>
    </div>
  );
}

/* ---------- APP ---------- */
export default function App() {
  const { notes, setNotes } = useNotes();
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const { direct, related } = useMemo(() => directAndRelatedNotes(notes, selected), [notes, selected]);

  // Eldst øverst → nyest nederst
  const baseAsc = useMemo(
    () => notes.slice().sort((a,b)=> (a.updatedAt||a.createdAt)-(b.updatedAt||b.createdAt)),
    [notes]
  );

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
      id: uid(),
      title: '',
      body: initial?.body ?? '',
      tags: (initial?.tags as string[])?.slice?.() ?? selected.slice(),
      image: initial?.image,
      // @ts-ignore
      imageUrl: (initial as any)?.imageUrl,
      createdAt: now,
      updatedAt: now
    };
    setNotes(prev => [...prev, n]);
    setEditingId(n.id);
  }

  function saveNote(n: Note) {
    setNotes(prev => prev.map(x => x.id === n.id ? n : x));
    setEditingId(null); // eksplisitt lagre lukker
  }
  function saveNoteDraft(n: Note) {
    setNotes(prev => prev.map(x => x.id === n.id ? n : x));
    // behold redigeringen åpen
  }

  // Slett notat men hold editor åpen ved å erstatte med nytt (tomt) notat seedet med samme tagger
  function deleteNoteReplace(n: Note) {
    const now = Date.now();
    const replacement: Note = {
      id: uid(),
      title: '',
      body: '',
      tags: n.tags.slice(),
      createdAt: now,
      updatedAt: now
    };
    setNotes(prev => {
      const filtered = prev.filter(x => x.id !== n.id);
      return [...filtered, replacement];
    });
    setEditingId(replacement.id);
  }

  function scrollBottom() {
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });
  }
  function onClickTagFilter(t: string) {
    const tag = t.trim().toLowerCase();
    setSelected(prev => prev.includes(tag) ? prev : [...prev, tag]);
    scrollBottom();
  }
  function addTagToDraftAndFilter(t: string) {
    const tag = t.trim().toLowerCase();
    if (editingId) {
      setNotes(prev => prev.map(n => n.id === editingId && !n.tags.includes(tag)
        ? { ...n, tags: [...n.tags, tag], updatedAt: Date.now() } : n));
    }
    setSelected(prev => prev.includes(tag) ? prev : [...prev, tag]);
    scrollBottom();
  }

  // SHARE TARGET (GET /share-target?...), opprett nytt notat
  useEffect(() => {
    const { pathname, search } = window.location;
    const p = pathname.replace(/\/+$/, '');
    if (!(p === '' || p === '/' || p === '/share-target')) return;

    const qs = new URLSearchParams(search);
    const url = qs.get('url') || '';
    const title = qs.get('title') || '';
    const text = qs.get('text') || '';

    if (!url && !title && !text) return;

    (async () => {
      const lines = (text || '').split(/\r\n|\n|\r|\u2028|\u2029/).map(s => s.trim()).filter(Boolean).slice(0, 5);
      const body = [title, lines.join('\n'), url].filter(Boolean).join('\n\n').trim();
      let imageUrl: string | undefined = undefined;
      if (url) imageUrl = await findSiteImage(url);
      // @ts-ignore
      addNote({ body, imageUrl });
      history.replaceState(null, '', '/');
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
        onToggleInfo={() => setShowInfo(v => !v)}
      />

      {showInfo && (
        <div className="infobox" onClick={() => setShowInfo(false)}>
          <div className="infobox-inner">
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <Info size={18} />
              <strong>Storm</strong>
              <span>v{VERSION}</span>
            </div>
            <div className="small" style={{ marginTop: 6 }}>Trykk hvor som helst for å lukke.</div>
          </div>
        </div>
      )}

      <div className="container">
        <div className="feed">
          {visible.map(n => (
            <div key={n.id} data-note-id={n.id}>
              {editingId === n.id ? (
                <EditCard
                  note={n}
                  allNotes={notes}
                  onSave={saveNote}
                  onSaveDraft={saveNoteDraft}
                  onDeleteReplace={deleteNoteReplace}
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
