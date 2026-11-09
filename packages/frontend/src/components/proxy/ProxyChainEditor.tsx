import { useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowDown,
  ArrowUp,
  GraphHub,
  Globe,
  Plus,
  Split,
  Trash2,
  Waypoints,
  X,
} from 'lucide-react';
import { t } from '../../i18n/index.js';
import type {
  LineMode,
  LineNoSession,
  LineOnFailure,
  ProfileLineInput,
  ProxyView,
} from '../../services/api/proxies.js';
import { Badge, Button, IconButton } from '../ui.js';
import { MAX_LINES, isBalanced, moveItem, newLine } from './proxy-chain.js';

const MODES: LineMode[] = ['proxy', 'affinity', 'request', 'direct'];

/** Icon of a line mode: split (session affinity), graph-hub (per request). */
export function LineModeIcon({ mode, className }: { mode: LineMode; className?: string }) {
  const Icon =
    mode === 'affinity'
      ? Split
      : mode === 'request'
        ? GraphHub
        : mode === 'direct'
          ? Globe
          : Waypoints;
  return <Icon aria-hidden="true" className={className ?? 'size-4 shrink-0 text-muted'} />;
}

/**
 * Ordered lines of an outbound profile: a proxy, Direct, or several proxies
 * balanced by session affinity or per request. The first line is not Direct;
 * a proxy appears once in the whole profile.
 */
export default function ProxyChainEditor({
  value,
  onChange,
  proxies,
}: {
  value: ProfileLineInput[];
  onChange: (next: ProfileLineInput[]) => void;
  proxies: ProxyView[];
}) {
  const [addMode, setAddMode] = useState<LineMode>('proxy');
  const byId = new Map(proxies.map((p) => [p.id, p]));
  const used = new Set(value.flatMap((l) => (l.mode === 'direct' ? [] : l.proxies)));
  const free = proxies.filter((p) => !used.has(p.id));
  const hasDirect = value.some((l) => l.mode === 'direct');
  const full = value.length >= MAX_LINES;
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const update = (i: number, line: ProfileLineInput) =>
    onChange(value.map((l, j) => (j === i ? line : l)));
  const modeAllowed = (mode: LineMode, index: number) =>
    mode !== 'direct' || (index > 0 && (!hasDirect || value[index]?.mode === 'direct'));

  const addModes = MODES.filter((m) => modeAllowed(m, value.length));
  const adding = addModes.includes(addMode) ? addMode : 'proxy';

  const add = () => {
    if (full) return;
    if (adding === 'direct') {
      onChange([...value, newLine('direct')]);
      return;
    }
    const first = free[0]?.id;
    onChange([...value, newLine(adding, first ? [first] : [])]);
  };

  const changeMode = (i: number, mode: LineMode) => {
    const line = value[i]!;
    if (mode === 'direct') return update(i, { ...line, mode, proxies: [] });
    const proxiesOf =
      line.mode === 'direct'
        ? free[0]
          ? [free[0].id]
          : []
        : mode === 'proxy'
          ? line.proxies.slice(0, 1)
          : line.proxies;
    update(i, { ...line, mode, proxies: proxiesOf });
  };

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('proxies.binding.emptyOwn')}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {value.map((line, i) => {
            const balanced = isBalanced(line.mode);
            const options = (keep: string | null) =>
              proxies.filter((p) => p.id === keep || !used.has(p.id));
            return (
              <li
                key={i}
                className="flex flex-col gap-2 rounded-control border border-line px-2.5 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-5 font-mono text-xs text-faint">{i + 1}</span>
                  <LineModeIcon mode={line.mode} />
                  <select
                    className="field w-auto max-w-full"
                    aria-label={t('proxies.lines.modeLabel', { n: i + 1 })}
                    value={line.mode}
                    onChange={(e) => changeMode(i, e.currentTarget.value as LineMode)}
                  >
                    {MODES.filter((m) => m === line.mode || modeAllowed(m, i)).map((m) => (
                      <option key={m} value={m}>
                        {t(`proxies.lines.modes.${m}`)}
                      </option>
                    ))}
                  </select>
                  {line.mode === 'proxy' ? (
                    <select
                      className="field w-auto min-w-[180px]"
                      aria-label={t('proxies.lines.proxyLabel', { n: i + 1 })}
                      value={line.proxies[0] ?? ''}
                      onChange={(e) => update(i, { ...line, proxies: [e.currentTarget.value] })}
                    >
                      {line.proxies[0] ? null : (
                        <option value="">{t('proxies.lines.pickProxy')}</option>
                      )}
                      {options(line.proxies[0] ?? null).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.enabled
                            ? p.name
                            : t('proxies.binding.disabledOption', { name: p.name })}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <span className="flex-1" />
                  {i > 0 ? <Badge>{t('proxies.binding.fallback')}</Badge> : null}
                  {line.proxies.some((id) => byId.get(id) && !byId.get(id)!.enabled) ? (
                    <Badge tone="warn">{t('proxies.binding.disabledProxy')}</Badge>
                  ) : null}
                  <IconButton
                    label={t('proxies.binding.moveUp')}
                    disabled={i === 0}
                    onClick={() => onChange(moveItem(value, i, -1))}
                  >
                    <ArrowUp aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={t('proxies.binding.moveDown')}
                    disabled={i === value.length - 1}
                    onClick={() => onChange(moveItem(value, i, 1))}
                  >
                    <ArrowDown aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={t('proxies.lines.removeLine', { n: i + 1 })}
                    className="hover:text-danger"
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </div>

                {balanced ? (
                  <div className="flex flex-col gap-2 pl-7">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {line.proxies.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-control border border-line px-2 py-0.5 text-ink"
                        >
                          {nameOf(id)}
                          <button
                            type="button"
                            className="text-faint hover:text-danger"
                            aria-label={t('proxies.binding.remove', { name: nameOf(id) })}
                            onClick={() =>
                              update(i, { ...line, proxies: line.proxies.filter((x) => x !== id) })
                            }
                          >
                            <X aria-hidden="true" className="size-3.5" />
                          </button>
                        </span>
                      ))}
                      {free.length > 0 ? (
                        <select
                          className="field w-auto max-w-full"
                          aria-label={t('proxies.lines.addMember', { n: i + 1 })}
                          value=""
                          onChange={(e) => {
                            const id = e.currentTarget.value;
                            if (id) update(i, { ...line, proxies: [...line.proxies, id] });
                          }}
                        >
                          <option value="">{t('proxies.lines.addMemberOption')}</option>
                          {free.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.enabled
                                ? p.name
                                : t('proxies.binding.disabledOption', { name: p.name })}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex max-w-full flex-wrap items-center gap-1.5 text-dim">
                        {t('proxies.lines.onFailure')}
                        <select
                          className="field w-auto max-w-full"
                          value={line.on_failure}
                          onChange={(e) =>
                            update(i, {
                              ...line,
                              on_failure: e.currentTarget.value as LineOnFailure,
                            })
                          }
                        >
                          <option value="next_member">
                            {t('proxies.lines.onFailureOptions.next_member')}
                          </option>
                          <option value="next_line">
                            {t('proxies.lines.onFailureOptions.next_line')}
                          </option>
                        </select>
                      </label>
                      {line.mode === 'affinity' ? (
                        <label className="inline-flex max-w-full flex-wrap items-center gap-1.5 text-dim">
                          {t('proxies.lines.noSession')}
                          <select
                            className="field w-auto max-w-full"
                            value={line.no_session}
                            onChange={(e) =>
                              update(i, {
                                ...line,
                                no_session: e.currentTarget.value as LineNoSession,
                              })
                            }
                          >
                            <option value="request">
                              {t('proxies.lines.noSessionOptions.request')}
                            </option>
                            <option value="agent">
                              {t('proxies.lines.noSessionOptions.agent')}
                            </option>
                            <option value="first">
                              {t('proxies.lines.noSessionOptions.first')}
                            </option>
                          </select>
                        </label>
                      ) : null}
                    </div>
                    <p className="hint m-0">
                      {t(
                        line.mode === 'affinity'
                          ? 'proxies.lines.hints.affinity'
                          : 'proxies.lines.hints.request',
                      )}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {proxies.length === 0 ? (
        <p className="hint m-0">
          {t('proxies.binding.noProxies')}{' '}
          <Link to="/proxy-servers/new" className="link-action">
            {t('proxies.binding.manageProxies')}
          </Link>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="field w-auto min-w-[200px]"
            aria-label={t('proxies.binding.addLabel')}
            value={adding}
            disabled={full}
            onChange={(e) => setAddMode(e.currentTarget.value as LineMode)}
          >
            {addModes.map((m) => (
              <option key={m} value={m}>
                {t(`proxies.lines.modes.${m}`)}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            disabled={full || (adding !== 'direct' && free.length === 0)}
            onClick={add}
          >
            <Plus aria-hidden="true" />
            {t('proxies.lines.addLine')}
          </Button>
          {full ? <span className="hint m-0">{t('proxies.binding.full')}</span> : null}
        </div>
      )}
    </div>
  );
}
