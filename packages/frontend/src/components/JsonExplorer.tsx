import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Copy } from 'lucide-react';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

type Path = Array<string | number>;

const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] =>
  !!v && typeof v === 'object';

function pathKey(path: Path): string {
  return path.map(String).join('\u0000');
}

/** `$.messages[2].content` style label for a path. */
export function formatPath(path: Path): string {
  return (
    '$' +
    path
      .map((p) =>
        typeof p === 'number' ? `[${p}]` : /^[A-Za-z_$][\w$]*$/.test(p) ? `.${p}` : `["${p}"]`,
      )
      .join('')
  );
}

function entriesOf(value: Record<string, unknown> | unknown[]): Array<[string | number, unknown]> {
  return Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
}

/** Paths of every node whose key or scalar value contains the query, plus their ancestors. */
function matchingPaths(root: unknown, query: string): { hits: Set<string>; open: Set<string> } {
  const hits = new Set<string>();
  const open = new Set<string>();
  const q = query.toLowerCase();
  const walk = (value: unknown, path: Path) => {
    const key = path[path.length - 1];
    const keyHit = key != null && String(key).toLowerCase().includes(q);
    const valueHit = !isContainer(value) && String(value).toLowerCase().includes(q);
    if (keyHit || valueHit) {
      hits.add(pathKey(path));
      for (let i = 0; i < path.length; i++) open.add(pathKey(path.slice(0, i)));
    }
    if (isContainer(value)) for (const [k, v] of entriesOf(value)) walk(v, [...path, k]);
  };
  walk(root, []);
  return { hits, open };
}

function copy(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="text-faint">null</span>;
  if (typeof value === 'string') {
    return <span className="whitespace-pre-wrap break-all text-ok">{JSON.stringify(value)}</span>;
  }
  if (typeof value === 'number') return <span className="text-info">{value}</span>;
  if (typeof value === 'boolean') return <span className="text-warn">{String(value)}</span>;
  return <span className="text-dim">{String(value)}</span>;
}

interface NodeProps {
  name: string | number | null;
  value: unknown;
  path: Path;
  depth: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
  hits: Set<string> | null;
  selected: string | null;
  onSelect: (path: Path, value: unknown) => void;
}

function Node({ name, value, path, depth, expanded, toggle, hits, selected, onSelect }: NodeProps) {
  const key = pathKey(path);
  const container = isContainer(value);
  const open = container && expanded.has(key);
  const count = container ? entriesOf(value).length : 0;
  const label: ReactNode =
    name == null ? null : (
      <span
        className={cx('font-mono', typeof name === 'number' ? 'text-faint' : 'text-accent-soft')}
      >
        {typeof name === 'number' ? name : JSON.stringify(name).slice(1, -1)}
        <span className="text-faint">: </span>
      </span>
    );

  return (
    <div>
      <div
        className={cx(
          'json-explorer__row flex cursor-pointer items-start gap-1 rounded-control py-0.5 pr-2 font-mono text-xs hover:bg-s2',
          hits?.has(key) && 'bg-warn-tint',
          selected === key && 'bg-accent-tint',
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => {
          onSelect(path, value);
          if (container) toggle(key);
        }}
      >
        <span className="inline-flex w-3.5 shrink-0 pt-0.5 text-faint">
          {container ? (
            <ChevronRight className={cx('size-3.5 transition-transform', open && 'rotate-90')} />
          ) : null}
        </span>
        <span className="min-w-0">
          {label}
          {container ? (
            <span className="text-muted">
              {Array.isArray(value) ? `[${count}]` : `{${count}}`}
              {!open && count > 0 ? (
                <span className="text-faint">
                  {' '}
                  {Array.isArray(value) ? '…' : Object.keys(value).slice(0, 4).join(', ')}
                </span>
              ) : null}
            </span>
          ) : (
            <Scalar value={value} />
          )}
        </span>
      </div>
      {open
        ? entriesOf(value).map(([k, v]) => (
            <Node
              key={String(k)}
              name={k}
              value={v}
              path={[...path, k]}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              hits={hits}
              selected={selected}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

function collectPaths(value: unknown, path: Path, out: Set<string>, maxDepth: number): void {
  if (!isContainer(value) || path.length > maxDepth) return;
  out.add(pathKey(path));
  for (const [k, v] of entriesOf(value)) collectPaths(v, [...path, k], out, maxDepth);
}

/**
 * Navigable JSON tree: expand and collapse nodes, search keys and values (hits
 * are highlighted and their ancestors opened), select a node to see its path
 * and copy its path or value.
 */
export default function JsonExplorer({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    collectPaths(value, [], initial, 1);
    return initial;
  });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ path: Path; value: unknown } | null>(null);
  const search = useMemo(
    () => (query.trim().length >= 2 ? matchingPaths(value, query.trim()) : null),
    [value, query],
  );
  const effectiveExpanded = useMemo(
    () => (search ? new Set([...expanded, ...search.open]) : expanded),
    [expanded, search],
  );

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(search ? effectiveExpanded : prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="json-explorer flex min-h-0 flex-1 flex-col">
      <div className="json-explorer__toolbar flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <input
          className="field h-7 w-56 text-xs"
          type="search"
          placeholder={t('messages.raw.search')}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        {search ? (
          <span className="text-xs text-muted">
            {t('messages.raw.matches', { count: search.hits.size })}
          </span>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          className="link-action text-xs"
          onClick={() => {
            const all = new Set<string>();
            collectPaths(value, [], all, 64);
            setExpanded(all);
          }}
        >
          {t('messages.raw.expandAll')}
        </button>
        <button
          type="button"
          className="link-action text-xs"
          onClick={() => setExpanded(new Set())}
        >
          {t('messages.raw.collapseAll')}
        </button>
        <button
          type="button"
          className="link-action inline-flex items-center gap-1 text-xs"
          onClick={() => copy(JSON.stringify(value, null, 2))}
        >
          <Copy className="size-3" />
          {t('messages.raw.copyAll')}
        </button>
      </div>
      {selected ? (
        <div className="json-explorer__selection flex flex-wrap items-center gap-2 border-b border-line bg-s2 px-3 py-1.5 text-xs">
          <code className="min-w-0 flex-1 truncate font-mono text-dim">
            {formatPath(selected.path)}
          </code>
          <button
            type="button"
            className="link-action text-xs"
            onClick={() => copy(formatPath(selected.path))}
          >
            {t('messages.raw.copyPath')}
          </button>
          <button
            type="button"
            className="link-action text-xs"
            onClick={() =>
              copy(
                typeof selected.value === 'string'
                  ? selected.value
                  : JSON.stringify(selected.value, null, 2),
              )
            }
          >
            {t('messages.raw.copyValue')}
          </button>
        </div>
      ) : null}
      <div className="json-explorer__tree min-h-0 flex-1 overflow-auto p-2">
        <Node
          name={null}
          value={value}
          path={[]}
          depth={0}
          expanded={effectiveExpanded}
          toggle={toggle}
          hits={search?.hits ?? null}
          selected={selected ? pathKey(selected.path) : null}
          onSelect={(path, v) => setSelected({ path, value: v })}
        />
      </div>
    </div>
  );
}
