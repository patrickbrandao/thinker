import { useMemo } from 'react';
import CopyButton from './CopyButton.js';
import { highlight } from '../services/syntax-highlight.js';

interface Props {
  code: string;
  language: string;
  copyText?: string;
}

/** Highlighted, wrapped code with a copy button in the corner. */
export default function CodeBlock({ code, language, copyText }: Props) {
  // highlight() escapes the source before wrapping tokens in spans.
  const html = useMemo(() => highlight(code, language), [code, language]);

  return (
    <div className="code-block relative">
      <CopyButton text={copyText ?? code} className="absolute right-1 top-1" />
      <pre className="code whitespace-pre-wrap break-all pr-10">
        <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
