import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { FlaskConical, Network, Trash2 } from 'lucide-react';
import ErrorState from '../components/ErrorState.js';
import LogRetentionSelect from '../components/LogRetentionSelect.js';
import {
  endpointOf,
  ProxyStatusBadge,
  resultLabel,
  sourceTypeLabel,
} from '../components/proxy/ProxyParts.js';
import ProxyLogsTab from '../components/proxy/ProxyLogsTab.js';
import ProxyStatsTab from '../components/proxy/ProxyStatsTab.js';
import { Badge, Button, Field, Modal, Panel, Skel, Switch, Tabs } from '../components/ui.js';
import { ApiError } from '../services/api/core.js';
import {
  createProxy,
  deleteProxy,
  getProxy,
  listProxies,
  proxyPath,
  testProxy,
  updateProxy,
  type ProxyDebug,
  type ProxyDetail,
  type ProxyScheme,
  type ProxyTestResult,
  type ProxyWrite,
} from '../services/api/proxies.js';
import { formatDateTime } from '../services/formatters.js';
import { roleCan } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

type Tab = 'settings' | 'logs' | 'stats';
const TABS: Tab[] = ['settings', 'logs', 'stats'];
const DEBUG_DURATIONS: Exclude<ProxyDebug, 'off'>[] = ['1h', '24h', '7d', 'forever'];

interface Form {
  name: string;
  scheme: ProxyScheme;
  host: string;
  port: string;
  auth: boolean;
  username: string;
  password: string;
  enabled: boolean;
  connect_timeout_ms: string;
  debug: boolean;
  /** 'keep' leaves a running debug window as it is. */
  debugDuration: Exclude<ProxyDebug, 'off'> | 'keep';
  log_retention_days: number | null;
}

function formOf(p: ProxyDetail | null): Form {
  return {
    name: p?.name ?? '',
    scheme: p?.scheme ?? 'http',
    host: p?.host ?? '',
    port: p ? String(p.port) : '3128',
    auth: !!p?.username,
    username: p?.username ?? '',
    password: '',
    enabled: p?.enabled ?? true,
    connect_timeout_ms: String(p?.connect_timeout_ms ?? 10000),
    debug: p?.debug_enabled ?? false,
    debugDuration: p?.debug_enabled ? 'keep' : '24h',
    log_retention_days: p?.log_retention_days ?? null,
  };
}

function validate(form: Form, proxy: ProxyDetail | null): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = t('proxies.form.errors.name');
  if (!form.host.trim()) errors.host = t('proxies.form.errors.host');
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    errors.port = t('proxies.form.errors.port');
  const timeout = Number(form.connect_timeout_ms);
  if (!Number.isInteger(timeout) || timeout < 1) errors.timeout = t('proxies.form.errors.timeout');
  if (form.auth && !form.username.trim()) errors.username = t('proxies.form.errors.username');
  if (form.auth && !form.password && !(proxy?.has_password && proxy.username))
    errors.password = t('proxies.form.errors.password');
  return errors;
}

function payloadOf(form: Form, proxy: ProxyDetail | null): ProxyWrite {
  const out: ProxyWrite = {
    name: form.name.trim(),
    scheme: form.scheme,
    host: form.host.trim(),
    port: Number(form.port),
    enabled: form.enabled,
    connect_timeout_ms: Number(form.connect_timeout_ms),
    log_retention_days: form.log_retention_days,
  };
  if (form.auth) {
    out.username = form.username.trim();
    if (form.password) out.password = form.password;
  } else if (!proxy || proxy.username || proxy.has_password) {
    out.auth = 'none';
  }
  if (!form.debug) {
    if (!proxy || proxy.debug_enabled) out.debug = 'off';
  } else if (form.debugDuration !== 'keep') {
    out.debug = form.debugDuration;
  }
  return out;
}

/** Debug state in words: "On until … (in 3 hours)" / "On, no time limit" / "Expired". */
function debugRemaining(proxy: ProxyDetail): string | null {
  if (!proxy.debug_enabled) return null;
  if (!proxy.debug_until) return t('proxies.form.debugForever');
  const left = Date.parse(proxy.debug_until) - Date.now();
  if (!(left > 0)) return t('proxies.form.debugExpired');
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const rel =
    hours >= 48
      ? `${Math.floor(hours / 24)}d ${hours % 24}h`
      : hours
        ? `${hours}h ${minutes}m`
        : `${minutes}m`;
  return t('proxies.form.debugUntil', { when: formatDateTime(proxy.debug_until), left: rel });
}

/**
 * One proxy server (/proxy-servers/:proxyId, or /proxy-servers/new to add
 * one): Settings (form, test, delete), Logs and Stats tabs.
 */
export default function ProxyServer() {
  const { proxyId = 'new' } = useParams<{ proxyId: string }>();
  const isNew = proxyId === 'new';
  const canManage = roleCan.manageProviders();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = !isNew && tabParam && TABS.includes(tabParam) ? tabParam : 'settings';
  const detail = useResource(() => getProxy(proxyId), [proxyId], {
    enabled: !isNew && canManage,
  });
  const proxy = isNew ? null : (detail.data ?? null);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    if (next === 'settings') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  };

  const back = (
    <Link to="/proxy-servers" className="text-sm text-muted hover:text-ink">
      {t('proxies.back')}
    </Link>
  );

  if (!canManage) {
    return (
      <div className="page">
        {back}
        <div className="notice is-info mt-4">
          <span>{t('proxies.adminOnly')}</span>
        </div>
      </div>
    );
  }
  if (!isNew && detail.error) {
    return (
      <div className="page">
        {back}
        <div className="mt-4">
          <ErrorState error={detail.error} onRetry={() => void detail.reload()} />
        </div>
      </div>
    );
  }
  if (!isNew && !proxy) {
    return (
      <div className="page">
        <Skel width="100%" height={300} />
      </div>
    );
  }

  return (
    <div className="page">
      <title>
        {t('common.pageTitle', { page: proxy ? proxy.name : t('proxies.form.createTitle') })}
      </title>
      {back}
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="m-0 flex items-center gap-2">
          <Network aria-hidden="true" className="size-5 text-muted" />
          {proxy ? proxy.name : t('proxies.form.createTitle')}
        </h1>
        {proxy ? (
          <>
            <ProxyStatusBadge status={proxy.status} />
            <span className="font-mono text-xs text-muted">{endpointOf(proxy)}</span>
            {proxy.debug_enabled ? <Badge tone="info">{t('proxies.list.debug')}</Badge> : null}
          </>
        ) : null}
      </div>

      {proxy ? (
        <Tabs<Tab>
          className="mb-4"
          label={proxy.name}
          value={tab}
          onChange={setTab}
          items={[
            { key: 'settings', label: t('proxies.tabs.settings') },
            { key: 'logs', label: t('proxies.tabs.logs') },
            { key: 'stats', label: t('proxies.tabs.stats') },
          ]}
        />
      ) : null}

      {tab === 'logs' && proxy ? (
        <ProxyLogsTab proxy={proxy} />
      ) : tab === 'stats' && proxy ? (
        <ProxyStatsTab proxyId={proxy.id} />
      ) : (
        <SettingsTab
          proxy={proxy}
          onSaved={(saved) => {
            if (isNew) navigate(proxyPath(saved.id), { replace: true });
            else detail.setData(saved);
          }}
          onDeleted={() => navigate('/proxy-servers')}
        />
      )}
    </div>
  );
}

function SettingsTab({
  proxy,
  onSaved,
  onDeleted,
}: {
  proxy: ProxyDetail | null;
  onSaved: (p: ProxyDetail) => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(proxy));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm(formOf(proxy));
    setErrors({});
  }, [proxy]);

  const patch = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    const found = validate(form, proxy);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const body = payloadOf(form, proxy);
      const saved = proxy ? await updateProxy(proxy.id, body) : await createProxy(body);
      toast.success(proxy ? t('proxies.toast.updated') : t('proxies.toast.created'));
      onSaved(saved);
    } catch {
      // the backend's 400 messages are toasted by fetchMutate
    } finally {
      setSaving(false);
    }
  };

  const remaining = proxy ? debugRemaining(proxy) : null;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <Panel title={t('proxies.form.title')} bodyClassName="flex flex-col gap-4">
        <Field label={t('proxies.form.name')} htmlFor="proxy-name" error={errors.name}>
          <input
            id="proxy-name"
            className="field"
            maxLength={100}
            value={form.name}
            onChange={(e) => patch('name', e.currentTarget.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[120px_minmax(0,1fr)_120px]">
          <Field label={t('proxies.form.scheme')} htmlFor="proxy-scheme">
            <select
              id="proxy-scheme"
              className="field"
              value={form.scheme}
              onChange={(e) => patch('scheme', e.currentTarget.value as ProxyScheme)}
            >
              {/* i18n-ignore */}
              <option value="http">http</option>
              {/* i18n-ignore */}
              <option value="https">https</option>
            </select>
          </Field>
          <Field label={t('proxies.form.host')} htmlFor="proxy-host" error={errors.host}>
            <input
              id="proxy-host"
              className="field font-mono"
              autoComplete="off"
              spellCheck={false}
              value={form.host}
              onChange={(e) => patch('host', e.currentTarget.value)}
            />
          </Field>
          <Field label={t('proxies.form.port')} htmlFor="proxy-port" error={errors.port}>
            <input
              id="proxy-port"
              className="field font-mono"
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(e) => patch('port', e.currentTarget.value)}
            />
          </Field>
        </div>
        <p className="hint m-0">{t('proxies.form.schemeHint')}</p>

        <div>
          <span className="label">{t('proxies.form.auth')}</span>
          <div className="segmented w-fit" role="radiogroup" aria-label={t('proxies.form.auth')}>
            <button
              type="button"
              role="radio"
              aria-checked={!form.auth}
              aria-pressed={!form.auth}
              onClick={() => patch('auth', false)}
            >
              {t('proxies.form.authNone')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={form.auth}
              aria-pressed={form.auth}
              onClick={() => patch('auth', true)}
            >
              {t('proxies.form.authBasic')}
            </button>
          </div>
        </div>
        {form.auth ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('proxies.form.username')}
              htmlFor="proxy-username"
              error={errors.username}
            >
              <input
                id="proxy-username"
                className="field"
                autoComplete="off"
                value={form.username}
                onChange={(e) => patch('username', e.currentTarget.value)}
              />
            </Field>
            <Field
              label={t('proxies.form.password')}
              htmlFor="proxy-password"
              error={errors.password}
              hint={proxy?.has_password ? t('proxies.form.passwordKeep') : undefined}
            >
              <input
                id="proxy-password"
                className="field"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => patch('password', e.currentTarget.value)}
              />
            </Field>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('proxies.form.timeout')}
            htmlFor="proxy-timeout"
            error={errors.timeout}
            hint={t('proxies.form.timeoutHint')}
          >
            <input
              id="proxy-timeout"
              className="field font-mono"
              type="number"
              min={1}
              value={form.connect_timeout_ms}
              onChange={(e) => patch('connect_timeout_ms', e.currentTarget.value)}
            />
          </Field>
          <div>
            <span className="label">{t('proxies.form.enabled')}</span>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.enabled}
                label={t('proxies.form.enabled')}
                onChange={(v) => patch('enabled', v)}
              />
              <span className="text-sm text-dim">
                {form.enabled ? t('common.enabled') : t('common.disabled')}
              </span>
            </div>
            <p className="hint">{t('proxies.form.enabledHint')}</p>
          </div>
        </div>

        <div>
          <span className="label">{t('proxies.form.debug')}</span>
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              checked={form.debug}
              label={t('proxies.form.debug')}
              onChange={(v) => {
                patch('debug', v);
                if (v && !proxy?.debug_enabled) patch('debugDuration', '24h');
              }}
            />
            {form.debug ? (
              <select
                className="field w-auto min-w-[160px]"
                aria-label={t('proxies.form.debugDuration')}
                value={form.debugDuration}
                onChange={(e) =>
                  patch('debugDuration', e.currentTarget.value as Form['debugDuration'])
                }
              >
                {proxy?.debug_enabled ? (
                  <option value="keep">{t('proxies.form.debugKeep')}</option>
                ) : null}
                {DEBUG_DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(`proxies.form.debugDurations.${d}`)}
                  </option>
                ))}
              </select>
            ) : null}
            {remaining ? <span className="text-sm text-dim">{remaining}</span> : null}
          </div>
          <p className="hint">{t('proxies.form.debugHint')}</p>
        </div>

        <div>
          <span className="label">{t('proxies.form.retention')}</span>
          <LogRetentionSelect
            idPrefix="proxy-retention"
            value={form.log_retention_days}
            globalDays={null}
            onChange={(days) => patch('log_retention_days', days)}
          />
          <p className="hint">{t('proxies.form.retentionHint')}</p>
        </div>

        <div className="actions">
          {proxy ? (
            <Button variant="ghost" size="sm" onClick={() => setForm(formOf(proxy))}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button size="sm" busy={saving} onClick={() => void save()}>
            {proxy ? t('common.saveChanges') : t('proxies.form.createSubmit')}
          </Button>
        </div>
      </Panel>

      {proxy ? (
        <div className="flex flex-col gap-4">
          <TestPanel proxy={proxy} />
          <BindingsPanel proxy={proxy} />
          <DeletePanel proxy={proxy} onDeleted={onDeleted} />
        </div>
      ) : null}
    </div>
  );
}

function TestPanel({ proxy }: { proxy: ProxyDetail }) {
  const [url, setUrl] = useState(proxy.suggested_test_url ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProxyTestResult | null>(null);

  const run = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await testProxy(proxy.id, url.trim()));
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t('proxies.test.title')} bodyClassName="flex flex-col gap-3">
      <p className="m-0 text-sm text-muted">{t('proxies.test.body')}</p>
      <Field label={t('proxies.test.url')} htmlFor="proxy-test-url">
        <input
          id="proxy-test-url"
          className="field font-mono"
          type="url"
          // i18n-ignore
          placeholder="https://api.openai.com/"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
        />
      </Field>
      <Button size="sm" busy={busy} disabled={!url.trim()} onClick={() => void run()}>
        <FlaskConical aria-hidden="true" />
        {t('proxies.test.run')}
      </Button>
      {result ? (
        <div className="well flex flex-col gap-1.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={result.ok ? 'ok' : 'danger'}>
              {result.ok ? t('proxies.test.ok') : t('proxies.test.failed')}
            </Badge>
            <Badge mono>{resultLabel(result.result)}</Badge>
            {result.status !== null ? (
              <Badge mono>{t('proxies.test.status', { status: result.status })}</Badge>
            ) : null}
          </div>
          <div className="text-xs text-dim">
            {t('proxies.test.timings', {
              tunnel: result.tunnel_ms ?? '—',
              total: result.total_ms,
            })}
          </div>
          {result.error ? (
            <p className="m-0 break-words text-xs text-danger">{result.error}</p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function BindingsPanel({ proxy }: { proxy: ProxyDetail }) {
  return (
    <Panel title={t('proxies.bindings.title', { count: proxy.bindings.length })}>
      {proxy.bindings.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('proxies.bindings.empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
          {proxy.bindings.map((b) => (
            <li key={`${b.target_type}:${b.target_id}`} className="flex items-center gap-2">
              <Badge>{sourceTypeLabel(b.target_type)}</Badge>
              <span className="min-w-0 truncate text-ink">{b.label}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DeletePanel({ proxy, onDeleted }: { proxy: ProxyDetail; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [bindings, setBindings] = useState(proxy.bindings);
  const [mode, setMode] = useState<'remove' | 'replace'>('remove');
  const [replaceWith, setReplaceWith] = useState('');
  const [busy, setBusy] = useState(false);
  const others = useResource(async () => (await listProxies()).proxies, [], { enabled: open });
  const candidates = (others.data ?? []).filter((p) => p.id !== proxy.id);

  const close = () => setOpen(false);
  const start = () => {
    setBindings(proxy.bindings);
    setMode('remove');
    setReplaceWith('');
    setOpen(true);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await deleteProxy(
        proxy.id,
        bindings.length ? (mode === 'replace' ? { mode, replaceWith } : { mode }) : {},
        { silent: true },
      );
      toast.success(
        res?.affected
          ? t('proxies.toast.deletedAffected', { count: res.affected })
          : t('proxies.toast.deleted'),
      );
      setOpen(false);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Bound since the page loaded: show the bindings and ask again.
        try {
          setBindings((await getProxy(proxy.id)).bindings);
        } catch {
          // keep what we have
        }
      } else {
        toast.error(err instanceof Error ? err.message : t('proxies.toast.deleteFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const losing = bindings.filter((b) => b.loses_proxy);

  return (
    <>
      <Panel title={t('proxies.delete.title')} bodyClassName="flex flex-col gap-3">
        <p className="m-0 text-sm text-muted">{t('proxies.delete.body')}</p>
        <Button variant="danger" size="sm" className="w-fit" onClick={start}>
          <Trash2 aria-hidden="true" />
          {t('proxies.delete.button')}
        </Button>
      </Panel>
      <Modal
        open={open}
        title={t('proxies.delete.modalTitle', { name: proxy.name })}
        onClose={close}
      >
        {bindings.length === 0 ? (
          <p className="text-sm text-dim">{t('proxies.delete.confirm', { name: proxy.name })}</p>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <p className="m-0 text-dim">{t('proxies.delete.inUse', { count: bindings.length })}</p>
            <ul className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-auto p-0">
              {bindings.map((b) => (
                <li key={`${b.target_type}:${b.target_id}`} className="flex items-center gap-2">
                  <Badge>{sourceTypeLabel(b.target_type)}</Badge>
                  <span className="min-w-0 truncate text-ink">{b.label}</span>
                </li>
              ))}
            </ul>
            <label className="check">
              <input
                type="radio"
                name="proxy-delete-mode"
                checked={mode === 'remove'}
                onChange={() => setMode('remove')}
              />
              {t('proxies.delete.removeAll')}
            </label>
            {mode === 'remove' && losing.length ? (
              <div className="notice is-warn">
                <span>
                  {t('proxies.delete.losesProxy')} {losing.map((b) => b.label).join(', ')}
                </span>
              </div>
            ) : null}
            <label className="check">
              <input
                type="radio"
                name="proxy-delete-mode"
                checked={mode === 'replace'}
                disabled={candidates.length === 0}
                onChange={() => setMode('replace')}
              />
              {t('proxies.delete.replace')}
            </label>
            {mode === 'replace' ? (
              <select
                className="field"
                aria-label={t('proxies.delete.replace')}
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.currentTarget.value)}
              >
                <option value="">{t('proxies.delete.pickReplacement')}</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        )}
        <div className="actions">
          <Button variant="ghost" size="sm" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            busy={busy}
            disabled={bindings.length > 0 && mode === 'replace' && !replaceWith}
            onClick={() => void submit()}
          >
            {t('proxies.delete.submit')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
