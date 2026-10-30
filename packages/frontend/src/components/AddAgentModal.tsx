import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import AgentTypeGrid from './AgentTypeGrid.js';
import { createAgent } from '../services/api.js';
import { highlightAgent } from '../services/recent-agents.js';
import { refreshAgents } from '../services/sse.js';
import {
  type AgentCategory,
  type AgentPlatform,
  AGENT_NAME_MAX_LENGTH,
  AGENT_NAME_PATTERN,
  PLATFORMS_BY_CATEGORY,
  platformIcon,
  toAgentName,
} from 'thinker-shared';
import { themedIcon, useDarkTheme } from './setup-ui.js';
import { t } from '../i18n/index.js';
import { Button, FloatingWindow, Switch, Tabs, cx } from './ui.js';
import LogRetentionSelect from './LogRetentionSelect.js';
import { getLogRetention } from '../services/api/organizations.js';
import { me } from '../services/session-store.js';
import { useResource } from '../lib/use-resource.js';

const DEFAULT_CATEGORY: AgentCategory = 'coding';
const defaultPlatform = (): AgentPlatform | null =>
  PLATFORMS_BY_CATEGORY[DEFAULT_CATEGORY][0] ?? null;

/**
 * "Connect Harness" modal extracted from Workspace so it can be reused by other
 * onboarding surfaces (e.g. an empty-state CTA, the sidebar "+" or a deep-link).
 *
 * After a create there is no success screen: the user lands on (or stays on)
 * the harness list, where the new harness is ringed for a few seconds.
 */
export default function AddAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AgentCategory | null>(DEFAULT_CATEGORY);
  const [platform, setPlatform] = useState<AgentPlatform | null>(defaultPlatform);
  const [creating, setCreating] = useState(false);
  // Defaults ON — explicit so create always sends a choice rather than
  // relying on the server-side default.
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  // null = Global (follows the organization's retention).
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [tab, setTab] = useState<'harness' | 'settings'>('harness');
  const dark = useDarkTheme();
  const typeIcon = platformIcon(platform, category);
  const titleIcon = typeIcon ? themedIcon(typeIcon, dark) : null;
  const orgId = me()?.organization?.id;
  const orgRetention = useResource(() => getLogRetention(orgId!), [orgId, open], {
    enabled: open && !!orgId,
  });
  const globalDays = orgRetention.data
    ? (orgRetention.data.retention_days ?? orgRetention.data.default_days)
    : null;
  const inputRef = useRef<HTMLInputElement>(null);
  // Synchronous guard: two clicks in the same tick both see `creating` false.
  const creatingRef = useRef(false);

  // Tracks whether the user dismissed the modal (overlay click / Escape) while a
  // create request was still in flight. A dismissed create must NOT run its
  // post-success side effects (highlight) or navigate afterwards — otherwise
  // closing the modal mid-request still moves the user once the request resolves.
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

  // Reopening invalidates whatever the previous session left in flight.
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
    setRetentionDays(null);
    setTab('harness');
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
    if (!AGENT_NAME_PATTERN.test(agentName)) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const result = await createAgent({
        name: agentName,
        ...(category ? { agent_category: category } : {}),
        ...(platform ? { agent_platform: platform } : {}),
        record_messages: recordingEnabled,
        log_retention_days: retentionDays,
      });
      // Local creates do not wait for the asynchronous server-sent event. This
      // immediately reruns the sidebar's harness-list resource with fresh data.
      refreshAgents();
      // The user dismissed the modal while the request was in flight — honour
      // that dismissal and skip every success side effect + the navigation.
      if (isStale(token)) return;
      onClose();
      resetForm();
      highlightAgent(result?.agent?.name ?? agentName);
      if (pathname !== '/harnesses') navigate('/harnesses');
    } catch {
      // error toast already shown by fetchMutate
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const nameValid = AGENT_NAME_PATTERN.test(name);

  const handleCreate = async () => {
    if (!nameValid) return;
    // A second submit while the create is already running would issue a
    // duplicate agent-creation request.
    if (creatingRef.current) return;
    await createAgentNow(beginAttempt());
  };

  return (
    <FloatingWindow
      open={open}
      onClose={dismiss}
      title={name || t('harnesses.add.title')}
      icon={
        titleIcon ? (
          <img
            src={titleIcon.src}
            alt=""
            width={20}
            height={20}
            className={cx('add-agent__title-icon shrink-0 object-contain', titleIcon.className)}
          />
        ) : null
      }
      className="floating-window--wide"
      footer={
        <Button size="sm" onClick={() => void handleCreate()} disabled={!nameValid} busy={creating}>
          {creating ? null : t('common.create')}
        </Button>
      }
    >
      <Tabs
        items={[
          { key: 'harness', label: t('harnesses.add.tabHarness') },
          { key: 'settings', label: t('harnesses.add.tabSettings') },
        ]}
        value={tab}
        onChange={setTab}
        label={t('harnesses.add.title')}
      />

      {/* Both tabs stay mounted so the name field keeps its element and focus. */}
      <div role="tabpanel" hidden={tab !== 'harness'}>
        <p className="mb-4 text-sm text-muted">{t('harnesses.add.desc')}</p>

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
          maxLength={AGENT_NAME_MAX_LENGTH}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={name !== '' && !nameValid}
          aria-describedby="agent-name-hint"
          onChange={(e) => setName(toAgentName(e.currentTarget.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate();
          }}
          disabled={creating}
        />
        <p id="agent-name-hint" className="hint">
          {name !== '' && !nameValid ? t('harnesses.add.nameInvalid') : t('harnesses.add.nameHint')}
        </p>

        <span className="label mt-4">{t('harnesses.add.type')}</span>
        <AgentTypeGrid
          category={category}
          platform={platform}
          onCategoryChange={handleCategoryChange}
          onPlatformChange={setPlatform}
          disabled={creating}
          iconSize={32}
        />
      </div>
      <div role="tabpanel" hidden={tab !== 'settings'}>
        <div className="flex flex-col gap-3">
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
          <div className="well">
            <div className="text-sm font-medium text-ink">{t('harnesses.retention.label')}</div>
            <div className="hint mb-2 mt-0.5">{t('harnesses.retention.hint')}</div>
            <LogRetentionSelect
              value={retentionDays}
              globalDays={globalDays}
              onChange={setRetentionDays}
              disabled={creating}
              idPrefix="add-agent-retention"
            />
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}
