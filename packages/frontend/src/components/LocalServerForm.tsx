import { useMemo, useState } from 'react';
import { RefreshCw, Server } from 'lucide-react';
import {
  createCustomProvider,
  deleteCustomProvider,
  getLocalServerDefaults,
  probeLocalServer,
  updateCustomProvider,
  type CustomProviderData,
  type LocalProbeModel,
  type LocalServerConfig,
  type LocalServerType,
} from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { useResource } from '../lib/use-resource.js';
import { providerIcon } from './ProviderIcon.js';
import { Badge, Button, Field, cx } from './ui.js';

export const LOCAL_SERVER_TYPE_NAMES: Record<LocalServerType, string> = {
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  llamacpp: 'llama.cpp',
};

interface Props {
  agentName: string;
  type: LocalServerType;
  /** Edit an existing server; omitted for "Add server". */
  editData?: CustomProviderData;
  /** Names already taken in the organization (new servers get a free default). */
  takenNames?: readonly string[];
  onSaved: () => void;
  /** After Remove server; defaults to onSaved. */
  onDeleted?: () => void;
  onCancel: () => void;
}

interface FormState {
  name: string;
  scheme: 'http' | 'https';
  host: string;
  port: string;
  path_prefix: string;
  apiKey: string;
  request_timeout_s: string;
  probe_timeout_s: string;
}

interface ProbeState {
  version?: string;
  base_url: string;
  models: LocalProbeModel[];
}

function freeName(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!lower.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

function toForm(name: string, config: LocalServerConfig): FormState {
  return {
    name,
    scheme: config.scheme,
    host: config.host,
    port: String(config.port),
    path_prefix: config.path_prefix,
    apiKey: '',
    request_timeout_s: String(Math.round(config.request_timeout_ms / 1000)),
    probe_timeout_s: String(Math.round(config.probe_timeout_ms / 1000)),
  };
}

function toConfig(form: FormState): Partial<LocalServerConfig> {
  return {
    scheme: form.scheme,
    host: form.host.trim(),
    port: Number(form.port),
    path_prefix: form.path_prefix.trim(),
    request_timeout_ms: Math.round(Number(form.request_timeout_s) * 1000),
    probe_timeout_ms: Math.round(Number(form.probe_timeout_s) * 1000),
  };
}

function formError(form: FormState): string | null {
  if (!form.name.trim()) return t('providerSetup.localServer.errName');
  if (!form.host.trim()) return t('providerSetup.localServer.errHost');
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return t('providerSetup.localServer.errPort');
  }
  for (const v of [form.request_timeout_s, form.probe_timeout_s]) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 3600) return t('providerSetup.localServer.errTimeout');
  }
  return null;
}

/**
 * Add or edit one local server (Ollama, LM Studio, llama.cpp): every
 * connection setting is editable and pre-filled with the type's defaults, the
 * connection test uses the software's own endpoints, and the models to route
 * are picked from what the server reports. Prices are always zero.
 */
export default function LocalServerForm(props: Props) {
  const typeName = LOCAL_SERVER_TYPE_NAMES[props.type];
  const isEdit = !!props.editData;

  const defaults = useResource(async () => {
    const all = await getLocalServerDefaults(props.agentName);
    return all.find((d) => d.type === props.type) ?? null;
  }, [props.agentName, props.type]);

  const [form, setForm] = useState<FormState | null>(null);
  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(props.editData?.models.map((m) => m.model_name) ?? []),
  );

  const initial = useMemo<FormState | null>(() => {
    if (props.editData?.local_config) {
      return toForm(props.editData.name, props.editData.local_config);
    }
    if (!defaults.data) return null;
    return toForm(freeName(typeName, props.takenNames ?? []), defaults.data.config);
  }, [props.editData, defaults.data, typeName, props.takenNames]);
  const current = form ?? initial;

  const set = (patch: Partial<FormState>) => {
    if (!current) return;
    setForm({ ...current, ...patch });
    // Settings changed: the last test no longer describes this server.
    if (!('name' in patch && Object.keys(patch).length === 1)) setProbe(null);
  };

  const runProbe = async () => {
    if (!current) return;
    const err = formError(current);
    if (err) {
      setProbeError(err);
      return;
    }
    setProbing(true);
    setProbeError(null);
    try {
      const result = await probeLocalServer(props.agentName, {
        local_type: props.type,
        local_config: toConfig(current),
        ...(current.apiKey ? { apiKey: current.apiKey } : {}),
        ...(props.editData ? { provider_id: props.editData.id } : {}),
      });
      setProbe(result);
      const names = result.models.map((m) => m.model_name);
      setSelected((prev) => {
        // A new server starts with the models already in memory (or everything,
        // when none is loaded or the server doesn't say); an edit keeps its picks.
        if (!isEdit && !probe) {
          const loaded = result.models.filter((m) => m.loaded).map((m) => m.model_name);
          return new Set(loaded.length ? loaded : names);
        }
        const available = new Set(names);
        return new Set([...prev].filter((n) => available.has(n)));
      });
    } catch (e) {
      setProbe(null);
      setProbeError(e instanceof Error ? e.message : t('providerSetup.local.couldNotReach'));
    } finally {
      setProbing(false);
    }
  };

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const save = async () => {
    if (!current) return;
    const err = formError(current);
    if (err) {
      setProbeError(err);
      return;
    }
    const known = new Map<string, LocalProbeModel>(
      (props.editData?.models ?? []).map((m) => [m.model_name, m]),
    );
    for (const m of probe?.models ?? []) known.set(m.model_name, m);
    const models = [...selected]
      .filter((n) => known.has(n))
      .map((n) => {
        const m = known.get(n)!;
        return {
          model_name: n,
          input_price_per_million_tokens: 0,
          output_price_per_million_tokens: 0,
          ...(m.context_window ? { context_window: m.context_window } : {}),
          ...(m.capabilities?.length ? { capabilities: m.capabilities } : {}),
        };
      });
    if (models.length === 0) {
      setProbeError(t('providerSetup.localServer.errModels'));
      return;
    }
    setSaving(true);
    try {
      if (props.editData) {
        await updateCustomProvider(props.agentName, props.editData.id, {
          ...(current.name.trim() !== props.editData.name ? { name: current.name.trim() } : {}),
          local_config: toConfig(current),
          ...(current.apiKey ? { apiKey: current.apiKey } : {}),
          models,
        });
        toast.success(t('providerSetup.local.updated', current.name.trim(), models.length));
      } else {
        await createCustomProvider(props.agentName, {
          name: current.name.trim(),
          local_type: props.type,
          local_config: toConfig(current),
          ...(current.apiKey ? { apiKey: current.apiKey } : {}),
          models,
        });
        toast.success(t('providerSetup.local.connectedModels', current.name.trim(), models.length));
      }
      props.onSaved();
    } catch (e) {
      setProbeError(
        e instanceof Error
          ? e.message
          : t('providerSetup.local.failedConnect', { name: current.name }),
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!props.editData) return;
    setDeleting(true);
    try {
      await deleteCustomProvider(props.agentName, props.editData.id);
      toast.success(t('providerSetup.local.disconnected', { name: props.editData.name }));
      (props.onDeleted ?? props.onSaved)();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : t('providerSetup.local.failedDisconnect', { name: props.editData.name }),
      );
    } finally {
      setDeleting(false);
    }
  };

  if (!current) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted">
        <span className="spinner" aria-hidden="true" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  // Edits keep the stored model list until a new test replaces it.
  const listed: LocalProbeModel[] = probe?.models ?? props.editData?.models ?? [];
  const id = (field: string) => `ls-${props.type}-${field}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-8 items-center justify-center">
          {providerIcon(props.type, 28)}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">
            {isEdit
              ? t('providerSetup.localServer.editTitle', { type: typeName })
              : t('providerSetup.localServer.addTitle', { type: typeName })}
          </div>
          <div className="text-xs text-muted">
            {defaults.data
              ? t('providerSetup.localServer.defaultsHint', {
                  port: String(defaults.data.default_port),
                  env: defaults.data.env,
                })
              : null}
          </div>
        </div>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void runProbe();
        }}
      >
        <Field label={t('providerSetup.localServer.name')} htmlFor={id('name')}>
          <input
            id={id('name')}
            className="field"
            type="text"
            maxLength={50}
            value={current.name}
            onChange={(e) => set({ name: e.currentTarget.value })}
          />
        </Field>
        <div className="grid grid-cols-[7rem_1fr_6rem] gap-2">
          <Field label={t('providerSetup.localServer.scheme')} htmlFor={id('scheme')}>
            <select
              id={id('scheme')}
              className="field"
              value={current.scheme}
              onChange={(e) => set({ scheme: e.currentTarget.value as 'http' | 'https' })}
            >
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </Field>
          <Field label={t('providerSetup.localServer.host')} htmlFor={id('host')}>
            <input
              id={id('host')}
              className="field font-mono"
              type="text"
              placeholder="192.168.1.20"
              value={current.host}
              onChange={(e) => set({ host: e.currentTarget.value })}
            />
          </Field>
          <Field label={t('providerSetup.localServer.port')} htmlFor={id('port')}>
            <input
              id={id('port')}
              className="field font-mono"
              type="number"
              min={1}
              max={65535}
              value={current.port}
              onChange={(e) => set({ port: e.currentTarget.value })}
            />
          </Field>
        </div>
        <Field
          label={t('providerSetup.localServer.pathPrefix')}
          hint={t(
            props.type === 'llamacpp'
              ? 'providerSetup.localServer.pathPrefixHintLlamacpp'
              : 'providerSetup.localServer.pathPrefixHint',
          )}
          htmlFor={id('prefix')}
        >
          <input
            id={id('prefix')}
            className="field font-mono"
            type="text"
            placeholder="/"
            value={current.path_prefix}
            onChange={(e) => set({ path_prefix: e.currentTarget.value })}
          />
        </Field>
        <Field
          label={t('providerSetup.localServer.apiKey')}
          hint={
            props.editData?.has_api_key
              ? t('providerSetup.localServer.apiKeyStored')
              : t('providerSetup.localServer.apiKeyHint')
          }
          htmlFor={id('key')}
        >
          <input
            id={id('key')}
            className="field provider-detail__input--masked font-mono"
            type="password"
            autoComplete="off"
            value={current.apiKey}
            onChange={(e) => set({ apiKey: e.currentTarget.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field
            label={t('providerSetup.localServer.requestTimeout')}
            hint={t('providerSetup.localServer.requestTimeoutHint')}
            htmlFor={id('rt')}
          >
            <input
              id={id('rt')}
              className="field"
              type="number"
              min={1}
              max={3600}
              value={current.request_timeout_s}
              onChange={(e) => set({ request_timeout_s: e.currentTarget.value })}
            />
          </Field>
          <Field label={t('providerSetup.localServer.probeTimeout')} htmlFor={id('pt')}>
            <input
              id={id('pt')}
              className="field"
              type="number"
              min={1}
              max={3600}
              value={current.probe_timeout_s}
              onChange={(e) => set({ probe_timeout_s: e.currentTarget.value })}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="ghost" busy={probing}>
            <RefreshCw size={14} aria-hidden="true" />
            {t('providerSetup.localServer.test')}
          </Button>
        </div>
      </form>

      {probeError ? (
        <div className="notice whitespace-pre-line" role="alert">
          <Server aria-hidden="true" />
          <span>{probeError}</span>
        </div>
      ) : null}

      {probe ? (
        <div className="notice is-info">
          <Server aria-hidden="true" />
          <span>
            {probe.version
              ? t('providerSetup.localServer.reachableVersion', {
                  url: probe.base_url,
                  version: probe.version,
                })
              : t('providerSetup.localServer.reachable', { url: probe.base_url })}
          </span>
        </div>
      ) : null}

      {listed.length > 0 ? (
        <div className="flex max-h-60 flex-col overflow-y-auto border-t border-line">
          {listed.map((m) => {
            const on = selected.has(m.model_name);
            return (
              <button
                key={m.model_name}
                type="button"
                role="switch"
                aria-checked={on}
                className="provider-toggle flex w-full items-center justify-between gap-3 border-b border-line bg-transparent py-2 text-left"
                onClick={() => toggle(m.model_name)}
              >
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm text-ink">{m.model_name}</span>
                  {m.context_window ? (
                    <Badge mono>
                      {t('providerSetup.localServer.ctx', {
                        n: m.context_window.toLocaleString('en-US'),
                      })}
                    </Badge>
                  ) : null}
                  {'loaded' in m && m.loaded ? (
                    <Badge tone="ok">{t('providerSetup.localServer.loaded')}</Badge>
                  ) : null}
                  {m.capabilities?.map((c) => (
                    <Badge key={c} tone="outline">
                      {t(`providerSetup.localServer.cap.${c}` as const)}
                    </Badge>
                  ))}
                </span>
                <span
                  aria-hidden="true"
                  // `.switch` draws its on state from aria-checked.
                  aria-checked={on}
                  className={cx(
                    'switch provider-toggle__switch shrink-0',
                    on && 'provider-toggle__switch--on',
                  )}
                />
              </button>
            );
          })}
        </div>
      ) : probe ? (
        <div className="text-sm text-muted">
          {t('providerSetup.local.noModelsLoaded', { url: probe.base_url, name: typeName })}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        {isEdit ? (
          <Button
            size="sm"
            variant="ghost"
            className="mr-auto"
            busy={deleting}
            onClick={() => void remove()}
          >
            {t('providerSetup.localServer.remove')}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          busy={saving}
          disabled={selected.size === 0 || probing || (!isEdit && !probe)}
          onClick={() => void save()}
        >
          {isEdit ? t('common.saveChanges') : t('providerSetup.local.connectModels', selected.size)}
        </Button>
      </div>
    </div>
  );
}
