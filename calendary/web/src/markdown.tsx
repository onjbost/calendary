import { Fragment, type ReactNode } from 'react';

// Small, safe Markdown renderer for notes (React elements, never innerHTML).
// Blocks: # ## ### headings, paragraphs, - / * lists, 1. lists, - [ ] / - [x] checklists, > quotes, --- dividers,
// ``` code blocks; ```tab blocks are guitar tablature (monospace, no wrapping).
// Inline: **bold**, *italic*, ~~strike~~, `code`.

export type Block =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'check'; items: { text: string; done: boolean; line: number }[] }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }
  | { kind: 'code'; lang: string; text: string };

const CHECK_RE = /^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/;
const UL_RE = /^\s*[-*•]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;

export function parseBlocks(src: string): Block[] {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join('\n') });
    para = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = /^```\s*([\w-]*)\s*$/.exec(line.trim());
    if (fence) {
      flush();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== '```') body.push(lines[i++]);
      out.push({ kind: 'code', lang: fence[1].toLowerCase(), text: body.join('\n') });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ kind: 'h', level: h[1].length as 1 | 2 | 3, text: h[2] }); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push({ kind: 'hr' }); continue; }
    const c = CHECK_RE.exec(line);
    if (c) {
      flush();
      const last = out.at(-1);
      const item = { text: c[2], done: c[1] !== ' ', line: i };
      if (last?.kind === 'check') last.items.push(item);
      else out.push({ kind: 'check', items: [item] });
      continue;
    }
    const ul = UL_RE.exec(line);
    const ol = ul ? null : OL_RE.exec(line);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const last = out.at(-1);
      const text = (ul || ol)![1];
      if (last && last.kind === kind) last.items.push(text);
      else out.push({ kind, items: [text] });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flush();
      const last = out.at(-1);
      if (last?.kind === 'quote') last.text += `\n${q[1]}`;
      else out.push({ kind: 'quote', text: q[1] });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

/** **bold**, *italic*, ~~strike~~, `code` (no nesting inside code). */
export function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) parts.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) parts.push(<b key={k++}>{inline(t.slice(2, -2))}</b>);
    else if (t.startsWith('~~')) parts.push(<s key={k++}>{inline(t.slice(2, -2))}</s>);
    else parts.push(<i key={k++}>{inline(t.slice(1, -1))}</i>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

const withBreaks = (text: string) => text.split('\n').map((l, i, all) => (
  <Fragment key={i}>{inline(l)}{i < all.length - 1 && <br />}</Fragment>
));

/** Rendered note. `onToggle(line)` makes checklist items clickable (they flip "- [ ]" ↔ "- [x]" on that line). */
export function Markdown({ text, onToggle, className = '' }: { text: string; onToggle?: (line: number) => void; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={`md ${className}`}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h': {
            const H = (`h${b.level + 1}`) as 'h2' | 'h3' | 'h4'; // the note title is the h1/h2 of the page
            return <H key={i} className={`md-h md-h${b.level}`}>{inline(b.text)}</H>;
          }
          case 'p': return <p key={i}>{withBreaks(b.text)}</p>;
          case 'ul': return <ul key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>;
          case 'ol': return <ol key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>;
          case 'check':
            return (
              <ul key={i} className="md-check">
                {b.items.map((it) => (
                  <li key={it.line} className={it.done ? 'done' : ''}>
                    <button type="button" className="md-box" disabled={!onToggle}
                      onClick={(e) => { e.stopPropagation(); onToggle?.(it.line); }} aria-label={it.done ? 'Da fare' : 'Fatto'}>
                      {it.done ? '✓' : ''}
                    </button>
                    <span>{inline(it.text)}</span>
                  </li>
                ))}
              </ul>
            );
          case 'quote': return <blockquote key={i}>{withBreaks(b.text)}</blockquote>;
          case 'hr': return <hr key={i} />;
          case 'code':
            return <pre key={i} className={b.lang === 'tab' ? 'md-tab' : 'md-code'}>{b.lang === 'tab' && <span className="md-tab-label">TAB</span>}{b.text}</pre>;
          default: return null;
        }
      })}
    </div>
  );
}

/** Flips the checklist item on `line` ("- [ ]" ↔ "- [x]"). */
export function toggleCheck(text: string, line: number) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const m = CHECK_RE.exec(lines[line] || '');
  if (!m) return text;
  lines[line] = lines[line].replace(/\[( |x|X)\]/, m[1] === ' ' ? '[x]' : '[ ]');
  return lines.join('\n');
}

/** Checklist progress, for the card ("3/5"). */
export function checklistCount(text: string) {
  let total = 0;
  let done = 0;
  for (const line of String(text || '').split('\n')) {
    const m = CHECK_RE.exec(line);
    if (m) {
      total += 1;
      if (m[1] !== ' ') done += 1;
    }
  }
  return { total, done };
}

/** One-line plain text of a note (for compact lists). */
export function plainText(text: string) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(#{1,3}\s|[-*]\s\[[ xX]\]\s|[-*•]\s|\d+[.)]\s|>\s?)/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
