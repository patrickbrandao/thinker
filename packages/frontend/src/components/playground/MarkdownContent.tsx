import { useEffect, useMemo, useState } from 'react';
import type { Tokens } from 'marked';
import { highlight, isSupported } from '../../services/syntax-highlight.js';
import { cx } from '../ui.jsx';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// marked's fenced-code renderer. Supported languages get highlighted with the
// slim hljs core; everything else (and unlabelled blocks) is escaped to plain
// text. Both paths keep the `hljs` class so styles/syntax-highlight.css applies.
function renderCodeBlock({ text, lang }: Tokens.Code): string {
  if (lang && isSupported(lang)) {
    return `<pre><code class="hljs language-${lang}">${highlight(text, lang)}</code></pre>`;
  }
  return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>`;
}

type MarkdownRenderer = (text: string) => string;

// `marked` (~70 KB) + `dompurify` (~50 KB) are only needed once an assistant
// message renders, so load them lazily and once. The module-level promise also
// guarantees `marked.use()` runs a single time no matter how many
// MarkdownContent instances mount.
let rendererPromise: Promise<MarkdownRenderer> | null = null;
// Set once loaded, so instances mounted later render HTML on the first paint.
let loadedRenderer: MarkdownRenderer | null = null;

function loadRenderer(): Promise<MarkdownRenderer> {
  if (!rendererPromise) {
    rendererPromise = Promise.all([import('marked'), import('dompurify')]).then(
      ([{ marked }, { default: DOMPurify }]) => {
        marked.use({
          async: false,
          gfm: true,
          breaks: true,
          renderer: { code: renderCodeBlock },
        });
        // Any anchor that opens a new tab must carry rel="noopener noreferrer"
        // so links inside untrusted model output can't reverse-tabnab the app.
        DOMPurify.addHook('afterSanitizeAttributes', (node) => {
          if (node.tagName === 'A' && node.hasAttribute('target')) {
            node.setAttribute('rel', 'noopener noreferrer');
          }
        });
        const render: MarkdownRenderer = (text) =>
          DOMPurify.sanitize(marked.parse(text) as string, {
            ALLOWED_ATTR: ['href', 'title', 'class', 'target', 'rel'],
            FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'script'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'style'],
          });
        loadedRenderer = render;
        return render;
      },
    );
  }
  return rendererPromise;
}

/**
 * Typography for sanitized model output (Tailwind's preflight strips the
 * browser defaults for headings, lists and code). Colors only from tokens.
 */
const PROSE = cx(
  'text-sm leading-relaxed text-dim break-words',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-ink',
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink',
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h3]:text-ink',
  '[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-semibold [&_h4]:text-ink',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
  '[&_a]:text-accent [&_a]:underline [&_strong]:font-semibold [&_strong]:text-ink',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted',
  '[&_hr]:my-3 [&_hr]:border-line',
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-s3 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.85em]',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:border [&_pre]:border-line [&_pre]:bg-sunken [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs',
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs',
  '[&_th]:border [&_th]:border-line [&_th]:bg-s2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1',
);

interface Props {
  text: string;
  className?: string;
}

/** Renders untrusted model output as sanitized Markdown (marked + DOMPurify). */
export default function MarkdownContent({ text, className }: Props) {
  const [render, setRender] = useState<MarkdownRenderer | null>(() => loadedRenderer);

  useEffect(() => {
    if (render) return;
    let alive = true;
    void loadRenderer().then((fn) => {
      if (alive) setRender(() => fn);
    });
    return () => {
      alive = false;
    };
  }, [render]);

  const html = useMemo(() => (render ? render(text ?? '') : null), [render, text]);

  if (html == null) {
    // Raw text until the chunk arrives (avoids a layout flash).
    return (
      <pre className={cx(className, 'markdown-loading whitespace-pre-wrap font-sans text-sm')}>
        {text}
      </pre>
    );
  }
  return <div className={cx(PROSE, className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
