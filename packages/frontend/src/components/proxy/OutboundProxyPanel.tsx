import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowUp, Network, Plus, Trash2 } from 'lucide-react';
import { t } from '../../i18n/index.js';
import { useResource } from '../../lib/use-resource.js';
import {
  getProxyBinding,
  listProxies,
  setProxyBinding,
  type ChainItem,
  type ProxyBinding,
  type ProxyTargetType,
} from '../../services/api/proxies.js';
import { toast } from '../../services/toast-store.js';
import { Badge, Button, IconButton, Panel } from '../ui.js';
import { DIRECT, MAX_CHAIN, moveItem, validateChain } from './proxy-chain.js';

const chainIds = (chain: ChainItem[] | undefined) =>
  (chain ?? []).map((item) => (item.kind === 'direct' ? DIRECT : (item.proxy_id ?? '')));

function chainText(chain: ChainItem[]): string {
  return chain
    .map((item) => (item.kind === 'direct' ? t('proxies.egress.direct') : item.name))
    .join(' → ');
}

/** "Effective: own chain (A → B)" / "provider chain" / "global proxy" / "direct". */
export function EffectiveProxyBadge({ binding }: { binding: ProxyBinding }) {
  const { source, chain } = binding.effective;
  const label =
    source === 'global'
      ? t('proxies.binding.effective.global')
      : source === 'direct'
        ? t('proxies.binding.effective.direct')
        : source === 'provider' && binding.target_type === 'connection'
          ? t('proxies.binding.effective.provider', { chain: chainText(chain) })
          : t('proxies.binding.effective.own', { chain: chainText(chain) });
  const tone = source === 'direct' ? 'neutral' : source === 'global' ? 'info' : 'accent';
  return (
    <Badge tone={tone} title={binding.effective.global}>
      {label}
    </Badge>
  );
}

/**
 * "Outbound proxy" section for a provider, a connection or a trigger: the
 * ordered chain (first a proxy, then up to 5 fallbacks, proxies or Direct).
 * A connection can inherit the provider's chain or keep its own.
 */
export default function OutboundProxyPanel({
  targetType,
  targetId,
  title,
  description,
  canManage,
  bare,
  version,
  onSaved,
}: {
  targetType: ProxyTargetType;
  targetId: string;
  title?: string;
  description?: string;
  canManage: boolean;
  /** Render without the panel frame (inside a dialog). */
  bare?: boolean;
  /** Bump to reload (e.g. after the provider chain changed). */
  version?: number;
  onSaved?: () => void;
}) {
  const binding = useResource(async () => {
    const res = await getProxyBinding(targetType, targetId);
    // Anything but a binding (older backend, unexpected payload) hides the section.
    if (!res || !Array.isArray(res.chain) || !res.effective) throw new Error('bad binding');
    return res;
  }, [targetType, targetId, version]);
  const proxies = useResource(async () => {
    const list = (await listProxies())?.proxies;
    return Array.isArray(list) ? list : [];
  }, []);
  const [draft, setDraft] = useState<string[]>([]);
  const [own, setOwn] = useState(true);
  const [pick, setPick] = useState('');
  const [saving, setSaving] = useState(false);
  const isConnection = targetType === 'connection';

  useEffect(() => {
    if (!binding.data) return;
    setDraft(chainIds(binding.data.chain));
    setOwn(!isConnection || binding.data.mode === 'own');
  }, [binding.data, isConnection]);

  const names = useMemo(() => {
    const map = new Map<string, { name: string; enabled: boolean }>();
    for (const item of [...(binding.data?.chain ?? []), ...(binding.data?.inherited_chain ?? [])]) {
      if (item.proxy_id) map.set(item.proxy_id, { name: item.name, enabled: item.enabled });
    }
    for (const p of proxies.data ?? []) map.set(p.id, { name: p.name, enabled: p.enabled });
    return map;
  }, [binding.data, proxies.data]);

  if (binding.error) return null;

  const saved = chainIds(binding.data?.chain);
  const target = own ? draft : [];
  const dirty = JSON.stringify(target) !== JSON.stringify(saved);
  const ruleError = validateChain(target);
  const emptyOwn = isConnection && own && draft.length === 0;
  const errorText = emptyOwn
    ? t('proxies.binding.errors.empty')
    : ruleError
      ? t(`proxies.binding.errors.${ruleError}`)
      : null;

  const options = (proxies.data ?? []).filter((p) => !draft.includes(p.id));
  const canAddDirect = draft.length > 0 && !draft.includes(DIRECT);
  const full = draft.length >= MAX_CHAIN;

  const add = () => {
    const value = pick || (options[0]?.id ?? (canAddDirect ? DIRECT : ''));
    if (!value || full) return;
    setDraft((d) => [...d, value]);
    setPick('');
  };

  const save = async (chain: string[]) => {
    setSaving(true);
    try {
      const next = await setProxyBinding(targetType, targetId, chain);
      binding.setData(next);
      onSaved?.();
      toast.success(t('proxies.binding.saved'));
    } catch {
      // toasted
    } finally {
      setSaving(false);
    }
  };

  const nameOf = (value: string) =>
    value === DIRECT ? t('proxies.egress.direct') : (names.get(value)?.name ?? value);

  const body = (
    <div className="flex flex-col gap-3">
      {description ? <p className="m-0 text-sm text-muted">{description}</p> : null}
      {binding.data ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t('proxies.binding.effectiveLabel')}</span>
          <EffectiveProxyBadge binding={binding.data} />
        </div>
      ) : (
        <p className="m-0 text-sm text-muted">{t('common.loading')}</p>
      )}

      {isConnection && binding.data ? (
        <div className="segmented w-fit" role="radiogroup" aria-label={t('proxies.binding.mode')}>
          <button
            type="button"
            role="radio"
            aria-checked={!own}
            aria-pressed={!own}
            disabled={!canManage}
            onClick={() => setOwn(false)}
          >
            {t('proxies.binding.inherit')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={own}
            aria-pressed={own}
            disabled={!canManage}
            onClick={() => setOwn(true)}
          >
            {t('proxies.binding.own')}
          </button>
        </div>
      ) : null}

      {isConnection && !own && binding.data ? (
        <p className="m-0 text-sm text-dim">
          {binding.data.inherited_chain?.length
            ? t('proxies.binding.inheritedChain', {
                chain: chainText(binding.data.inherited_chain),
              })
            : t('proxies.binding.inheritedNone')}
        </p>
      ) : null}

      {own && binding.data ? (
        <>
          {draft.length === 0 ? (
            <p className="m-0 text-sm text-muted">
              {isConnection ? t('proxies.binding.emptyOwn') : t('proxies.binding.empty')}
            </p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
              {draft.map((value, i) => {
                const info = value === DIRECT ? null : names.get(value);
                return (
                  <li
                    key={value}
                    className="flex items-center gap-2 rounded-control border border-line px-2.5 py-1.5 text-sm"
                  >
                    <span className="w-5 font-mono text-xs text-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{nameOf(value)}</span>
                    {i > 0 ? <Badge>{t('proxies.binding.fallback')}</Badge> : null}
                    {info && !info.enabled ? (
                      <Badge tone="warn">{t('proxies.binding.disabledProxy')}</Badge>
                    ) : null}
                    {canManage ? (
                      <>
                        <IconButton
                          label={t('proxies.binding.moveUp')}
                          disabled={i === 0}
                          onClick={() => setDraft((d) => moveItem(d, i, -1))}
                        >
                          <ArrowUp aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={t('proxies.binding.moveDown')}
                          disabled={i === draft.length - 1}
                          onClick={() => setDraft((d) => moveItem(d, i, 1))}
                        >
                          <ArrowDown aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={t('proxies.binding.remove', { name: nameOf(value) })}
                          className="hover:text-danger"
                          onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                        >
                          <Trash2 aria-hidden="true" />
                        </IconButton>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}

          {canManage ? (
            (proxies.data ?? []).length === 0 ? (
              <p className="hint m-0">
                {t('proxies.binding.noProxies')}{' '}
                <Link to="/proxy-servers" className="link-action">
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
                  {canAddDirect ? (
                    <option value={DIRECT}>{t('proxies.egress.direct')}</option>
                  ) : null}
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
            )
          ) : null}
        </>
      ) : null}

      {errorText && dirty ? (
        <p className="hint m-0" style={{ color: 'var(--danger)' }}>
          {errorText}
        </p>
      ) : null}

      {canManage && binding.data ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            busy={saving}
            disabled={!dirty || !!errorText}
            onClick={() => void save(target)}
          >
            {t('common.save')}
          </Button>
          {dirty ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(saved);
                setOwn(!isConnection || binding.data?.mode === 'own');
              }}
            >
              {t('common.cancel')}
            </Button>
          ) : null}
          {!isConnection && saved.length > 0 && !dirty ? (
            <Button variant="ghost" size="sm" busy={saving} onClick={() => void save([])}>
              {t('proxies.binding.clear')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (bare) {
    return (
      <div>
        <span className="label">{title ?? t('proxies.binding.title')}</span>
        {body}
      </div>
    );
  }
  return (
    <Panel title={title ?? t('proxies.binding.title')} icon={<Network aria-hidden="true" />}>
      {body}
    </Panel>
  );
}
