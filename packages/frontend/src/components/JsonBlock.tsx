import { highlight } from '../services/syntax-highlight.js';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

const MAX_HIGHLIGHT_BYTES = 50_000;

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface Props {
  value: unknown;
  /** Extra class for the wrapper (kept from the Solid contract). */
  class?: string;
  className?: string;
}

/** Pretty-printed JSON; highlighting is skipped above 50 KB to keep the page responsive. */
export default function JsonBlock(props: Props) {
  const json = serialize(props.value);
  const tooLarge = json.length > MAX_HIGHLIGHT_BYTES;
  // highlight() escapes the source before wrapping tokens in spans.
  const html = tooLarge ? null : highlight(json, 'json');
  const kb = Math.round(json.length / 1024);

  return (
    <div className={cx('json-block-wrap', props.class, props.className)}>
      {tooLarge ? <div className="hint mb-1.5">{t('messages.json.tooLarge', { kb })}</div> : null}
      <pre className="code json-block max-h-[480px] whitespace-pre-wrap break-all">
        {html != null ? (
          <code className="hljs language-json" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className="hljs">{json}</code>
        )}
      </pre>
    </div>
  );
}
