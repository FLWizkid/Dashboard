import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+|\*[^*\s][^*]*\*)/g;

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={key} className="rounded bg-raised px-1 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2]);
      return href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-primary-600 underline-offset-2 hover:underline dark:text-primary-400">{link[1]}</a> : <Fragment key={key}>{link[1]}</Fragment>;
    }
    if (/^https?:\/\//i.test(part)) return <a key={key} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-primary-600 underline-offset-2 hover:underline dark:text-primary-400">{part}</a>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    return <Fragment key={key}>{part}</Fragment>;
  });
}

const splitRow = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isTableDivider = (line: string | undefined) => !!line && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim()) { i++; continue; }

    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(<pre key={k} className="overflow-x-auto rounded-md border border-line bg-raised p-3 font-mono text-xs leading-relaxed">{code.join('\n')}</pre>);
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? 'text-xl font-semibold' : level === 2 ? 'text-lg font-semibold' : 'text-base font-semibold';
      out.push(<p key={k} role="heading" aria-level={level} className={cn(cls, 'pt-2 leading-tight')}>{inline(h[2], k)}</p>);
      i++;
      continue;
    }

    if (line.includes('|') && isTableDivider(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      out.push(
        <div key={k} className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-sm">
            <thead className="bg-raised text-left"><tr>{head.map((c, j) => <th key={j} className="px-2 py-1.5 font-medium">{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-line">{r.map((c, j) => <td key={j} className="px-2 py-1.5 align-top">{inline(c, `${k}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={k} className={cn('space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc')}>
          {items.map((it, j) => {
            const task = /^\[( |x|X)\]\s+(.*)$/.exec(it);
            return <li key={j}>{task ? <><span aria-hidden>{task[1] === ' ' ? '\u2610 ' : '\u2611 '}</span>{inline(task[2], `${k}i${j}`)}</> : inline(it, `${k}i${j}`)}</li>;
          })}
        </List>,
      );
      continue;
    }

    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={k} className="border-l-2 border-primary-300 pl-3 text-muted dark:border-primary-700">{inline(quote.join(' '), k)}</blockquote>);
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push(<hr key={k} className="border-line" />); i++; continue; }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]) && !(lines[i].includes('|') && isTableDivider(lines[i + 1]))) para.push(lines[i++]);
    out.push(<p key={k}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `${k}p${j}`)}</Fragment>)}</p>);
  }
  return <div className={cn('space-y-3 text-sm leading-relaxed', className)}>{out}</div>;
}
