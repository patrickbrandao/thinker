import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { t } from '../../i18n/index.js';
import type { ProxyView } from '../../services/api/proxies.js';
import { Badge, Button, IconButton } from '../ui.js';
import { DIRECT, MAX_CHAIN, moveItem } from './proxy-chain.js';

/**
 * Ordered chain of an outbound profile: a proxy first, then up to 5
 * fallbacks (proxies or Direct).
 */
export default function ProxyChainEditor({
  value,
  onChange,
  proxies,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  proxies: ProxyView[];
}) {
  const [pick, setPick] = useState('');
  const byId = new Map(proxies.map((p) => [p.id, p]));
  const options = proxies.filter((p) => !value.includes(p.id));
  const canAddDirect = value.length > 0 && !value.includes(DIRECT);
  const full = value.length >= MAX_CHAIN;
  const nameOf = (item: string) =>
    item === DIRECT ? t('proxies.egress.direct') : (byId.get(item)?.name ?? item);

  const add = () => {
    const next = pick || (options[0]?.id ?? (canAddDirect ? DIRECT : ''));
    if (!next || full) return;
    onChange([...value, next]);
    setPick('');
  };

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('proxies.binding.emptyOwn')}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {value.map((item, i) => {
            const info = item === DIRECT ? null : byId.get(item);
            return (
              <li
                key={item}
                className="flex items-center gap-2 rounded-control border border-line px-2.5 py-1.5 text-sm"
              >
                <span className="w-5 font-mono text-xs text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{nameOf(item)}</span>
                {i > 0 ? <Badge>{t('proxies.binding.fallback')}</Badge> : null}
                {info && !info.enabled ? (
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
                  label={t('proxies.binding.remove', { name: nameOf(item) })}
                  className="hover:text-danger"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden="true" />
                </IconButton>
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
            value={pick}
            disabled={full}
            onChange={(e) => setPick(e.currentTarget.value)}
          >
            <option value="">{t('proxies.binding.pick')}</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.enabled ? p.name : t('proxies.binding.disabledOption', { name: p.name })}
              </option>
            ))}
            {canAddDirect ? <option value={DIRECT}>{t('proxies.egress.direct')}</option> : null}
          </select>
          <Button
            variant="ghost"
            size="sm"
            disabled={full || (!pick && options.length === 0 && !canAddDirect)}
            onClick={add}
          >
            <Plus aria-hidden="true" />
            {t('proxies.binding.add')}
          </Button>
          {full ? <span className="hint m-0">{t('proxies.binding.full')}</span> : null}
        </div>
      )}
    </div>
  );
}
