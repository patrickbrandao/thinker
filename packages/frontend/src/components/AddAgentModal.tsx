import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import AgentTypeSelect from './AgentTypeSelect.js';
import { createAgent, getGlobalProviders } from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { markAgentCreated, markSetupPending } from '../services/recent-agents.js';
import { refreshAgents } from '../services/sse.js';
import { type AgentCategory, type AgentPlatform, PLATFORMS_BY_CATEGORY } from 'thinker-shared';
import { t } from '../i18n/index.js';
import { Button, Modal, Switch } from './ui.js';

const DEFAULT_CATEGORY: AgentCategory = 'personal';
const defaultPlatform = (): AgentPlatform | null =>
  PLATFORMS_BY_CATEGORY[DEFAULT_CATEGORY][0] ?? null;

/**
 * "Connect Harness" modal extracted from Workspace so it can be reused by other
 * onboarding surfaces (e.g. an empty-state CTA, the sidebar "+" or a deep-link).
 *
 * Onboarding navigation: a freshly created agent inherits access to every
 * connected provider, so Routing is the most useful first stop.
 * If the tenant has *no* providers yet, we additionally pass
 * `state.openProviders` so Routing opens the provider-connect flow immediately —
 * the new user's very next action is to connect their first provider.
 */
export default function AddAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AgentCategory | null>(DEFAULT_CATEGORY);
  const [platform, setPlatform] = useState<AgentPlatform | null>(defaultPlatform);
  const [creating, setCreating] = useState(false);
  // Defaults ON — explicit so create always sends a choice rather than
  // relying on the server-side default.
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  // Synchronous guard: two clicks in the same tick both see `creating` false.
  const creatingRef = useRef(false);

  // Tracks whether the user dismissed the modal (overlay click / Escape) while a
  // create request was still in flight. A dismissed create must NOT run its
  // post-success side effects (toast, markAgentCreated) or navigate afterwards —
  // otherwise closing the modal mid-request still yanks the user to Routing once
  // the request resolves.
  const cancelled = useRef(false);
  // Monotonic id of the current create attempt. Each async hop re-checks the
  // token it started with, so a dismissed or superseded attempt drops its
  // result instead of acting on it.
  const attemptToken = useRef(0);
  const beginAttempt = (): number => {
    cancelled.current = false;
    return ++attemptToken.current;
  };
  const isStale = (token: number): boolean => cancelled.current || token !== attemptToken.current;

  // Reopening invalidates whatever the previous session left in flight. The
  // success path closes the modal *before* awaiting the providers lookup, and
  // closing is not a dismissal — so a user who immediately reopens to add a
  // second harness would otherwise be yanked to the first one the moment that
  // lookup lands, mid-typing.
  useEffect(() => {
    if (!open) return;
    attemptToken.current++;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // If the component unmounts mid-request, treat it like a dismissal so we never
  // navigate from a disposed modal.
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const resetForm = () => {
    setName('');
    setCategory(DEFAULT_CATEGORY);
    setPlatform(defaultPlatform());
    setRecordingEnabled(true);
  };

  const dismiss = () => {
    cancelled.current = true;
    onClose();
    resetForm();
  };

  const handleCategoryChange = (c: AgentCategory) => {
    setCategory(c);
    setPlatform(PLATFORMS_BY_CATEGORY[c][0] ?? null);
  };

  /**
   * @param token attempt id from {@link beginAttempt}, re-checked after every await.
   */
  const createAgentNow = async (token: number) => {
    const agentName = name.trim();
    if (!agentName) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const result = await createAgent({
        name: agentName,
        ...(category ? { agent_category: category } : {}),
        ...(platform ? { agent_platform: platform } : {}),
        record_messages: recordingEnabled,
      });
      // Local creates do not wait for the asynchronous server-sent event. This
      // immediately reruns the sidebar's harness-list resource with fresh data.
      refreshAgents();
      // The user dismissed the modal while the request was in flight — honour
      // that dismissal and skip every success side effect + the navigation.
      if (isStale(token)) return;
      toast.success(t('harnesses.add.connected', { name: agentName }));
      onClose();
      resetForm();
      const slug = result?.agent?.name ?? agentName;
      markAgentCreated(slug);
      // Persistent flag so the setup modal reopens after a page refresh until
      // the user dismisses or completes it (the in-memory mark above is dropped
      // on reload / cleared by AgentGuard once the agent appears in the list).
      markSetupPending(slug);

      // Decide whether to nudge the user into connecting a provider. A brand-new
      // tenant has nothing routed yet, so we open the provider flow on landing.
      // A failed lookup must not block the redirect — fall back to "has none".
      let hasProviders = false;
      try {
        const res = await getGlobalProviders();
        hasProviders = (res?.providers?.length ?? 0) > 0;
      } catch {
        // Treat a failed providers lookup as "no providers" so onboarding still
        // surfaces the connect flow rather than silently skipping it.
      }

      // A dismissal during the providers lookup must also skip the redirect.
      if (isStale(token)) return;

      // Land on Routing either way; the new agent's API key is surfaced there.
      navigate(`/harnesses/${encodeURIComponent(slug)}/routing`, {
        state: {
          newApiKey: result?.apiKey,
          ...(hasProviders ? {} : { openProviders: true }),
        },
      });
    } catch {
      // error toast already shown by fetchMutate
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    // A second submit while the create is already running would issue a
    // duplicate agent-creation request.
    if (creatingRef.current) return;
    await createAgentNow(beginAttempt());
  };

  return (
    <Modal open={open} onClose={dismiss} title={t('harnesses.add.title')}>
      <p className="mb-4 text-sm text-muted">{t('harnesses.add.desc')}</p>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,200px)_1fr]">
        <div>
          <span className="label">{t('harnesses.add.type')}</span>
          <AgentTypeSelect
            category={category}
            platform={platform}
            onCategoryChange={handleCategoryChange}
            onPlatformChange={setPlatform}
            disabled={creating}
          />
        </div>
        <div>
          <label className="label" htmlFor="agent-name-input">
            {t('harnesses.add.name')}
          </label>
          <input
            ref={inputRef}
            id="agent-name-input"
            className="field"
            type="text"
            placeholder={t('harnesses.add.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            disabled={creating}
          />
        </div>
      </div>

      <div className="mt-4">
        <span className="label">{t('harnesses.add.settings')}</span>
        <div className="well flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">{t('harnesses.add.enableLogs')}</div>
            <div className="hint mt-0.5">{t('harnesses.add.logsHint')}</div>
          </div>
          <Switch
            checked={recordingEnabled}
            onChange={setRecordingEnabled}
            label={t('harnesses.add.enableLogs')}
            disabled={creating}
          />
        </div>
      </div>

      <div className="actions">
        <Button
          size="sm"
          onClick={() => void handleCreate()}
          disabled={!name.trim()}
          busy={creating}
        >
          {creating ? null : t('common.create')}
        </Button>
      </div>
    </Modal>
  );
}
