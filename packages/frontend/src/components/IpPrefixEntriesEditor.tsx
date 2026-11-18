import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, IconButton, cx } from './ui.js';
import { formatPrefixLines, isValidPrefix, parsePrefixLines } from '../services/ip-prefix.js';
import { t } from '../i18n/index.js';

export interface EntryRow {
  prefix: string;
  label: string;
}

export const MAX_ENTRIES = 1000;

/** Rows that carry something (a prefix or a label); blank rows are dropped on save. */
export function filledRows(rows: EntryRow[]): EntryRow[] {
  return rows.filter((r) => r.prefix.trim() || r.label.trim());
}

/** The first entry error in words, or null when every filled row is valid. */
export function entriesError(rows: EntryRow[]): string | null {
  const filled = filledRows(rows);
  if (filled.length > MAX_ENTRIES) return t('ipLists.form.errors.tooMany', { max: MAX_ENTRIES });
  const bad = filled.find((r) => !isValidPrefix(r.prefix));
  return bad ? `${bad.prefix || '—'}: ${t('ipLists.form.errors.prefix')}` : null;
}

/**
 * Entries of an IP prefix list, edited as rows (prefix + label) or as text
 * (one prefix per line, an optional label after a space or `#`). Both views
 * edit the same rows: the text is parsed on every change.
 */
export default function IpPrefixEntriesEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: EntryRow[];
  onChange: (rows: EntryRow[]) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<'rows' | 'text'>('rows');
  const [text, setText] = useState('');

  const toText = () => {
    setText(
      formatPrefixLines(
        filledRows(rows).map((r) => ({ prefix: r.prefix.trim(), label: r.label.trim() || null })),
      ),
    );
    setMode('text');
  };
  const toRows = () => {
    if (rows.length === 0) onChange([{ prefix: '', label: '' }]);
    setMode('rows');
  };
  const editText = (value: string) => {
    setText(value);
    onChange(parsePrefixLines(value).map((p) => ({ prefix: p.prefix, label: p.label ?? '' })));
  };
  const patchRow = (i: number, patch: Partial<EntryRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const badLines = mode === 'text' ? parsePrefixLines(text).filter((p) => !p.valid) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="segmented w-fit" role="radiogroup" aria-label={t('ipLists.form.entries')}>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'rows'}
            aria-pressed={mode === 'rows'}
            onClick={() => mode !== 'rows' && toRows()}
          >
            {t('ipLists.form.rows')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'text'}
            aria-pressed={mode === 'text'}
            onClick={() => mode !== 'text' && toText()}
          >
            {t('ipLists.form.text')}
          </button>
        </div>
        <span className="text-xs text-muted">
          {t('ipLists.form.entriesCount', { count: filledRows(rows).length })}
        </span>
      </div>

      {mode === 'text' ? (
        <>
          <textarea
            className="field min-h-[220px] font-mono text-xs"
            aria-label={t('ipLists.form.entries')}
            spellCheck={false}
            placeholder={t('ipLists.form.textPlaceholder')}
            value={text}
            disabled={disabled}
            onChange={(e) => editText(e.currentTarget.value)}
          />
          <p className="hint m-0">{t('ipLists.form.textHint')}</p>
          {badLines.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-danger" role="alert">
              {badLines.slice(0, 10).map((p) => (
                <li key={p.line}>
                  {t('ipLists.form.errors.line', { line: p.line, prefix: p.prefix })}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => {
              const invalid = !!row.prefix.trim() && !isValidPrefix(row.prefix);
              return (
                <div key={i} className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                      <input
                        className={cx('field font-mono', invalid && 'border-danger')}
                        aria-label={t('ipLists.form.prefix')}
                        aria-invalid={invalid || undefined}
                        // i18n-ignore
                        placeholder="203.0.113.0/24"
                        spellCheck={false}
                        autoComplete="off"
                        value={row.prefix}
                        disabled={disabled}
                        onChange={(e) => patchRow(i, { prefix: e.currentTarget.value })}
                      />
                      {invalid ? (
                        <p className="hint m-0 text-danger">{t('ipLists.form.errors.prefix')}</p>
                      ) : null}
                    </div>
                    <input
                      className="field"
                      aria-label={t('ipLists.form.label')}
                      placeholder={t('ipLists.form.labelPlaceholder')}
                      maxLength={100}
                      value={row.label}
                      disabled={disabled}
                      onChange={(e) => patchRow(i, { label: e.currentTarget.value })}
                    />
                  </div>
                  <IconButton
                    label={t('ipLists.form.removeRow', { prefix: row.prefix || String(i + 1) })}
                    disabled={disabled}
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden="true" />
                  </IconButton>
                </div>
              );
            })}
          </div>
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || rows.length >= MAX_ENTRIES}
              onClick={() => onChange([...rows, { prefix: '', label: '' }])}
            >
              <Plus aria-hidden="true" />
              {t('ipLists.form.addRow')}
            </Button>
          </div>
        </>
      )}
      <p className="hint m-0">{t('ipLists.form.hint')}</p>
    </div>
  );
}
