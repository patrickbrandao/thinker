/* v8 ignore start -- route-level onboarding UI is validated through browser QA; pure logic is covered in welcome-helpers.ts. */
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Check, ChevronRight, KeyRound, Server, UserRound } from 'lucide-react';
import ProviderSelectModal from '../components/ProviderSelectModal.jsx';
import AgentTypeSelect from '../components/AgentTypeSelect.jsx';
import SetupStepAddProvider from '../components/SetupStepAddProvider.jsx';
import RoutingModals from '../components/RoutingModals.js';
import RoutingDefaultTierSection from './RoutingDefaultTierSection.js';
import Playground from './Playground.jsx';
import {
  findResumableAgent,
  isSuccessfulAgentMessage,
  type OnboardingAgentSummary,
  type OnboardingMessageSummary,
} from './welcome-helpers.js';
import { useRoutingActions } from './RoutingActions.js';
import { providerIcon } from '../components/ProviderIcon.jsx';
import { Button, cx, Switch } from '../components/ui.jsx';
import { PROVIDERS, subscriptionCatalog } from '../services/providers.js';
import { authClient } from '../services/auth-client.js';
import { installOrigin } from '../services/install-endpoints.js';
import {
  createAgent,
  deleteModelParams,
  getAgentKey,
  getAgents,
  getAvailableModels,
  getCustomProviders,
  getPlaygroundAgent,
  getProviders,
  getTierAssignments,
  listModelParams,
  modelParamsKey,
  refreshModels,
  setModelParams as setModelParamsApi,
  type AgentModelParamsRow,
  type AuthType,
} from '../services/api.js';
import type { RequestParamDefaults } from 'thinker-shared';
import { getMessages } from '../services/api/messages.js';
import { markAgentCreated } from '../services/recent-agents.js';
import { useRightSidebar } from '../services/right-sidebar.jsx';
import { hasOnboardingBeenDone, markOnboardingDone } from '../services/onboarding.js';
import { useResource } from '../lib/use-resource.js';
import {
  type AgentCategory,
  type AgentPlatform,
  PLATFORM_ICONS,
  PLATFORM_LABELS,
  PLATFORMS_BY_CATEGORY,
  thinkerErrorDocsUrl,
} from 'thinker-shared';
import { THINKER_LOGO_URL, THINKER_LOGO_DARK_URL } from '../services/thinker-links.js';
import { t } from '../i18n/index.js';

type StepId = 'harness' | 'providers' | 'playground' | 'route' | 'activate';
const STEP_ORDER: StepId[] = ['harness', 'providers', 'playground', 'route', 'activate'];

type ProviderTab = 'subscription' | 'api_key' | 'local';
const PROVIDER_TAB_ORDER: ProviderTab[] = ['api_key', 'subscription', 'local'];

// Household names first — a new user scans for the provider they already
// use; the long tail lives behind "Show all".
const POPULAR = [
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'deepseek',
  'mistral',
  'openrouter',
  'xai',
  'copilot',
];

/** The theme lives in "Launch sequence"; the rest is plain wayfinding. */
const eyebrow = (id: StepId) =>
  t('welcome.eyebrow', { step: STEP_ORDER.indexOf(id) + 1, total: STEP_ORDER.length });

/** Sidebar label of a step, read at render time so it follows the language. */
const stepLabel = (id: StepId): string => t(`welcome.steps.${id}`);

/** Provider icon, or its initial on a neutral tile when there is no logo. */
function ProviderMark({
  providerId,
  name,
  size = 20,
}: {
  providerId: string;
  name: string;
  size?: number;
}) {
  const icon = providerIcon(providerId, size);
  if (icon)
    return (
      <span className="flex items-center" style={{ width: size, height: size }}>
        {icon}
      </span>
    );
  return (
    <span
      className="inline-flex items-center justify-center rounded-[4px] bg-s3 text-[11px] font-semibold text-ink"
      style={{ width: size, height: size }}
    >
      {(name || providerId).charAt(0).toUpperCase()}
    </span>
  );
}

/** Spinner + message while something loads. */
function Pending({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** Eyebrow, title and description at the top of a step. */
function StepHeader({ id, title, desc }: { id: StepId; title: ReactNode; desc?: ReactNode }) {
  return (
    <div className="mb-5">
      <p className="eyebrow">{eyebrow(id)}</p>
      <h1 className="mt-1 text-xl font-semibold text-ink">{title}</h1>
      {desc ? <p className="mt-1 text-sm text-dim">{desc}</p> : null}
    </div>
  );
}

/** Back/next row under a step; `sticky` pins it to the bottom of the viewport. */
function StepActions({ children, sticky }: { children: ReactNode; sticky?: boolean }) {
  return (
    <div
      className={cx(
        'mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4',
        sticky && 'sticky bottom-0 z-[1] bg-bg pb-4',
      )}
    >
      {children}
    </div>
  );
}

const textLinkClass =
  'border-0 bg-transparent p-0 text-sm text-accent hover:underline disabled:cursor-not-allowed disabled:text-faint';

// Dev-only liftoff preview (`?preview=liftoff`). The dynamic import sits inside
// the `import.meta.env.DEV` branch, so production builds drop the module, its
// templates and `motion` entirely (#229).
const LiftoffPreview = import.meta.env.DEV ? lazy(() => import('./WelcomeLiftoff.jsx')) : null;

export default function Welcome() {
  const navigate = useNavigate();
  // Playground pushes its run-details drawer here; App renders it in the
  // dashboard shell, so the standalone onboarding layout must render it too.
  const { content: rightSidebar } = useRightSidebar();
  const [searchParams] = useSearchParams();
  const liftoffPreview = import.meta.env.DEV && searchParams.get('preview') === 'liftoff';
  const session = authClient.useSession();
  const userId = session.data?.user?.id ?? '';

  // Redirect users who already completed onboarding so they don't see the
  // wizard again on a manual visit to /welcome.
  useEffect(() => {
    if (userId && hasOnboardingBeenDone(userId)) navigate('/', { replace: true });
  }, [userId, navigate]);

  const [step, setStep] = useState<StepId>('harness');
  const [maxStepReached, setMaxStepReached] = useState(0);
  useEffect(() => {
    const index = STEP_ORDER.indexOf(step);
    setMaxStepReached((max) => Math.max(max, index));
  }, [step]);

  // ── Shared resources ─────────────────────────────────────────────────
  // The Playground agent gives provider connections an agent context before
  // the user's own harness exists (providers are tenant-global anyway).
  const agent = useResource(() => getPlaygroundAgent(), []);
  const contextAgent = agent.data?.name;

  // Providers connect against the user's harness once it exists; the reserved
  // Playground agent only bridges the gap before creation.
  const [harnessName, setHarnessName] = useState('');
  const [harnessSlug, setHarnessSlug] = useState('');
  const providerAgent = harnessSlug || contextAgent;
  const providers = useResource(() => getProviders(providerAgent!), [providerAgent], {
    enabled: !!providerAgent,
  });
  const customProviders = useResource(() => getCustomProviders(providerAgent!), [providerAgent], {
    enabled: !!providerAgent,
  });
  const existingAgents = useResource(
    () => getAgents() as Promise<{ agents?: OnboardingAgentSummary[] }>,
    [],
  );

  // ── Routing resources (the user's harness) ───────────────────────────
  const slugEnabled = { enabled: !!harnessSlug };
  const models = useResource(
    () => (harnessSlug ? getAvailableModels(harnessSlug) : Promise.resolve([])),
    [harnessSlug],
    slugEnabled,
  );
  const tiers = useResource(
    () => (harnessSlug ? getTierAssignments(harnessSlug) : Promise.resolve([])),
    [harnessSlug],
    slugEnabled,
  );
  const harnessProviders = useResource(
    () => (harnessSlug ? getProviders(harnessSlug) : Promise.resolve([])),
    [harnessSlug],
    slugEnabled,
  );
  const harnessCustomProviders = useResource(
    () => (harnessSlug ? getCustomProviders(harnessSlug) : Promise.resolve([])),
    [harnessSlug],
    slugEnabled,
  );
  // Per-route request params — same wiring as Routing.tsx so the card's
  // params affordance works here too.
  const modelParams = useResource(
    () =>
      harnessSlug
        ? listModelParams(harnessSlug).catch(() => [] as AgentModelParamsRow[])
        : Promise.resolve([] as AgentModelParamsRow[]),
    [harnessSlug],
    slugEnabled,
  );

  const refetchRouting = async () => {
    await Promise.all([
      tiers.reload(),
      models.reload(),
      harnessProviders.reload(),
      harnessCustomProviders.reload(),
    ]);
  };

  const goTo = (id: StepId) => {
    setStep(id);
    // Provider connections can complete after this harness's models resource
    // initially resolved empty. Refresh before opening routing so a newly
    // connected provider is immediately available for the default proposal.
    if (id === 'playground' || id === 'route') {
      if (harnessSlug && (models.data ?? []).length === 0) {
        void refreshModels(harnessSlug)
          .catch(() => undefined)
          .then(refetchRouting);
      } else {
        void refetchRouting();
      }
    }
  };

  const handleProvidersUpdate = async () => {
    await Promise.all([providers.reload(), customProviders.reload()]);
    if (!harnessSlug) return;
    // Force discovery once a connection finishes. The harness may have asked
    // for models before the provider existed, leaving an empty server cache for
    // its two-minute TTL; a plain GET would keep returning that stale result.
    await refreshModels(harnessSlug).catch(() => undefined);
    await refetchRouting();
  };

  const connectedIds = new Set<string>();
  for (const p of providers.data ?? []) {
    const active = p.auth_type === 'subscription' ? p.is_active : p.is_active && p.has_api_key;
    if (active) connectedIds.add(p.provider);
  }
  for (const c of customProviders.data ?? []) connectedIds.add(`custom:${c.id}`);
  const connectedCount = connectedIds.size;

  // ── Step: providers ──────────────────────────────────────────────────
  const [connectTarget, setConnectTarget] = useState<string | null>(null);
  const [tab, setTab] = useState<ProviderTab>('api_key');
  const selectProviderTab = (next: ProviderTab, focus = false) => {
    setTab(next);
    if (focus) {
      requestAnimationFrame(() => document.getElementById(`welcome-provider-tab-${next}`)?.focus());
    }
  };
  const handleProviderTabKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const idx = PROVIDER_TAB_ORDER.indexOf(tab);
    const next =
      event.key === 'ArrowRight'
        ? PROVIDER_TAB_ORDER[(idx + 1) % PROVIDER_TAB_ORDER.length]
        : PROVIDER_TAB_ORDER[(idx - 1 + PROVIDER_TAB_ORDER.length) % PROVIDER_TAB_ORDER.length];
    selectProviderTab(next!, true);
  };

  const isConnected = (id: string, authType: ProviderTab) => {
    const resolvedType = authType === 'local' ? 'api_key' : authType;
    return (providers.data ?? []).some(
      (p) =>
        p.provider === id &&
        p.auth_type === resolvedType &&
        p.is_active &&
        (resolvedType === 'subscription' || p.has_api_key),
    );
  };

  const allTabProviders =
    tab === 'subscription'
      ? subscriptionCatalog(PROVIDERS, (id) => isConnected(id, 'subscription'))
      : tab === 'local'
        ? PROVIDERS.filter((p) => p.localOnly)
        : PROVIDERS.filter((p) => !p.subscriptionOnly && !p.localOnly);
  // Popular providers first, then the rest in catalog order.
  const tabProviders = [
    ...allTabProviders.filter((p) => POPULAR.includes(p.id)),
    ...allTabProviders.filter((p) => !POPULAR.includes(p.id)),
  ];

  // ── Step: harness ────────────────────────────────────────────────────
  const [harnessKey, setHarnessKey] = useState<string | null>(null);
  const [harnessKeyPrefix, setHarnessKeyPrefix] = useState<string | null>(null);
  const [category, setCategory] = useState<AgentCategory | null>('personal');
  const [platform, setPlatform] = useState<AgentPlatform | null>(
    PLATFORMS_BY_CATEGORY['personal'][0] ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [harnessError, setHarnessError] = useState('');
  // Defaults ON, mirroring the Connect Harness modal — explicit so create
  // always sends a choice rather than relying on the server-side default.
  const [logsEnabled, setLogsEnabled] = useState(true);
  const harnessCreated = !!harnessSlug;

  const handleCategoryChange = (c: AgentCategory) => {
    setCategory(c);
    setPlatform(PLATFORMS_BY_CATEGORY[c][0] ?? null);
  };

  const baseUrl = `${installOrigin()}/v1`;

  const createHarness = async () => {
    const name = harnessName.trim();
    if (!name || creating) return;
    setCreating(true);
    setHarnessError('');
    try {
      const result = await createAgent({
        name,
        ...(category ? { agent_category: category } : {}),
        ...(platform ? { agent_platform: platform } : {}),
        record_messages: logsEnabled,
      });
      const slug = result?.agent?.name ?? name;
      setHarnessSlug(slug);
      setHarnessKey(result.apiKey);
      markAgentCreated(slug);
      goTo('providers');
    } catch (e) {
      setHarnessError(e instanceof Error ? e.message : t('welcome.failedCreate'));
    } finally {
      setCreating(false);
    }
  };

  // ── Step: routing — the app's real default-routing card ──────────────
  const modelParamsMap = new Map<string, RequestParamDefaults>();
  for (const row of modelParams.data ?? []) {
    modelParamsMap.set(
      modelParamsKey(row.scope, row.provider, row.authType, row.model),
      row.params,
    );
  }
  const getModelParamsFor = (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
  ): RequestParamDefaults | null =>
    modelParamsMap.get(modelParamsKey(scope, provider, authType, model)) ?? null;

  const setModelParamsFor = async (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
    next: RequestParamDefaults | null,
  ): Promise<void> => {
    const matches = (r: AgentModelParamsRow) =>
      r.scope === scope &&
      r.provider.toLowerCase() === provider.toLowerCase() &&
      r.authType === authType &&
      r.model === model;
    if (next === null) {
      await deleteModelParams(harnessSlug, { scope, provider, authType, model });
      modelParams.setData((rows) => (rows ?? []).filter((r) => !matches(r)));
      return;
    }
    const saved = await setModelParamsApi(harnessSlug, {
      scope,
      provider,
      authType,
      model,
      params: next,
    });
    modelParams.setData((rows) => [...(rows ?? []).filter((r) => !matches(r)), saved]);
  };

  // New agents get every provider enabled, so connected == enabled here.
  const harnessConnected = harnessProviders.data ?? [];
  const harnessActive = harnessConnected.filter((p) => p.is_active);

  const [dropdownTier, setDropdownTier] = useState<string | null>(null);
  const [fallbackPickerTier, setFallbackPickerTier] = useState<string | null>(null);
  const [instructionModal, setInstructionModal] = useState<'enable' | 'disable' | null>(null);

  const actions = useRoutingActions({
    agentName: harnessSlug,
    tiers: tiers.data,
    mutateTiers: tiers.setData,
    refetchAll: refetchRouting,
    setInstructionModal,
  });

  const handleOverride: typeof actions.handleOverride = async (...args) => {
    setDropdownTier(null);
    return actions.handleOverride(...args);
  };

  const handleAddFallback: typeof actions.handleAddFallback = async (...args) => {
    setFallbackPickerTier(null);
    return actions.handleAddFallback(...args);
  };

  const defaultRoute = actions.getTier('default');
  const routedProviderCount = (() => {
    const primary = defaultRoute?.override_route ?? defaultRoute?.auto_assigned_route;
    if (!primary) return 0;
    const providersInRoute = [primary, ...(defaultRoute?.fallback_routes ?? [])].map((route) =>
      route.provider.toLowerCase(),
    );
    return new Set(providersInRoute).size;
  })();

  // ── Step: first real agent request ───────────────────────────────────
  // Activation only counts traffic that arrives through the user's own
  // integration. Playground is intentionally separate: it is useful for
  // comparing models, but it is not evidence that their agent is connected.
  const [agentRequestSeen, setAgentRequestSeen] = useState(false);
  const [checkingForRequest, setCheckingForRequest] = useState(false);
  const [requestCheckError, setRequestCheckError] = useState(false);
  const [latestAgentRequest, setLatestAgentRequest] = useState<OnboardingMessageSummary | null>(
    null,
  );
  // Thinker's own errors carry a documented M### code — link it.
  const errorDocCode = latestAgentRequest?.error_message?.match(/\bM\d{3}\b/)?.[0] ?? null;
  const [waitedLong, setWaitedLong] = useState(false);

  // The poll reads the latest values through this ref, so the interval below
  // never restarts because a check toggled `checkingForRequest`.
  const pollState = useRef({ harnessSlug, agentRequestSeen, userId, checking: false });
  pollState.current = { ...pollState.current, harnessSlug, agentRequestSeen, userId };

  const checkForFirstAgentRequest = async () => {
    const state = pollState.current;
    const slug = state.harnessSlug;
    if (!slug || state.agentRequestSeen || state.checking) return;
    state.checking = true;
    setCheckingForRequest(true);
    try {
      const result = (await getMessages(
        { agent_name: slug, limit: '1', include_total: 'false' },
        { cache: false },
      )) as { items?: OnboardingMessageSummary[] };
      setRequestCheckError(false);
      const latest = result.items?.[0] ?? null;
      setLatestAgentRequest(latest);
      if (isSuccessfulAgentMessage(latest)) {
        setAgentRequestSeen(true);
        pollState.current.agentRequestSeen = true;
        if (pollState.current.userId) markOnboardingDone(pollState.current.userId);
      }
    } catch {
      // Polling should never surface an unhandled rejection. Keep trying in
      // the background and give the user a useful manual recovery affordance.
      setRequestCheckError(true);
    } finally {
      pollState.current.checking = false;
      setCheckingForRequest(false);
    }
  };
  const checkRef = useRef(checkForFirstAgentRequest);
  checkRef.current = checkForFirstAgentRequest;

  useEffect(() => {
    if (step !== 'activate' || !harnessSlug || agentRequestSeen) return;
    setWaitedLong(false);
    void checkRef.current();
    const timer = window.setInterval(() => void checkRef.current(), 4_000);
    // A minute of silence usually means the agent kept its old config.
    const stallTimer = window.setTimeout(() => setWaitedLong(true), 60_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stallTimer);
    };
  }, [step, harnessSlug, agentRequestSeen]);

  // Resume the newest zero-message harness after a reload. Server state is the
  // source of truth: providers, routes determine the next useful
  // stage, while the restored key keeps the connection instructions usable.
  const [resumeHydrated, setResumeHydrated] = useState(false);
  const [resumeChecked, setResumeChecked] = useState(false);
  const resumeStarted = useRef(false);
  const resumeStageResolved = useRef(false);

  useEffect(() => {
    if (existingAgents.loading || resumeStarted.current) return;
    resumeStarted.current = true;
    const candidate = findResumableAgent(existingAgents.data?.agents ?? []);
    if (!candidate) {
      setResumeChecked(true);
      return;
    }
    setHarnessName(candidate.display_name || candidate.agent_name);
    setHarnessSlug(candidate.agent_name);
    if (candidate.agent_category) setCategory(candidate.agent_category as AgentCategory);
    if (candidate.agent_platform) setPlatform(candidate.agent_platform as AgentPlatform);
    setStep('providers');
    setResumeHydrated(true);
    setResumeChecked(true);
    void getAgentKey(candidate.agent_name)
      .then((key) => {
        setHarnessKey(key.apiKey ?? null);
        setHarnessKeyPrefix(key.keyPrefix ?? null);
      })
      .catch(() => undefined);
  }, [existingAgents.loading, existingAgents.data]);

  // Wait for data fetched for the resumed harness (not just "not loading": a
  // resource that was disabled a render ago reports idle before it starts).
  const providersReady =
    !providers.loading && !customProviders.loading && providers.data !== undefined;
  const tiersReady = !tiers.loading && tiers.data !== undefined;
  useEffect(() => {
    if (!resumeHydrated || resumeStageResolved.current || !providersReady) return;
    if (connectedCount === 0) {
      setStep('providers');
      resumeStageResolved.current = true;
      return;
    }
    if (!tiersReady) return;
    setStep(routedProviderCount === 0 ? 'playground' : 'activate');
    resumeStageResolved.current = true;
  }, [resumeHydrated, providersReady, tiersReady, connectedCount, routedProviderCount]);

  // Never trap users: setup resumes from server state on the next visit, so
  // skipping only skips the guidance, not the work.
  const leaveOnboarding = () => {
    if (userId) markOnboardingDone(userId);
    navigate('/');
  };

  // Which steps are completed, for the sidebar checkmarks. Steps without
  // server state ('playground') count the furthest step reached,
  // not the current one, so navigating back never un-ticks them.
  const stepDone = (id: StepId): boolean => {
    switch (id) {
      case 'harness':
        return harnessCreated;
      case 'providers':
        return connectedCount > 0;
      case 'playground':
        return maxStepReached > STEP_ORDER.indexOf('playground');
      case 'route':
        return routedProviderCount > 0;
      case 'activate':
        return agentRequestSeen;
    }
  };
  const completedStepCount = STEP_ORDER.filter(stepDone).length;

  const providerTabs: { id: ProviderTab; label: string; icon: ReactNode }[] = [
    {
      id: 'api_key',
      label: t('welcome.providers.usageBased'),
      icon: <KeyRound className="size-3.5 text-warn" aria-hidden="true" />,
    },
    {
      id: 'subscription',
      label: t('welcome.providers.subscriptions'),
      icon: <UserRound className="size-3.5 text-info" aria-hidden="true" />,
    },
    {
      id: 'local',
      label: t('welcome.providers.local'),
      icon: <Server className="size-3.5 text-accent" aria-hidden="true" />,
    },
  ];

  return (
    <div className="min-h-screen bg-bg md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <title>{t('welcome.pageTitle')}</title>
      <meta name="description" content={t('welcome.metaDescription')} />

      {/* ── Sidebar: activation progress + steps ───── */}
      <aside className="flex flex-col gap-5 border-b border-line bg-elev p-4 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex h-8 items-center">
          <img src={THINKER_LOGO_URL} alt="Thinker" className="logo-light h-6" />
          <img src={THINKER_LOGO_DARK_URL} alt="" className="logo-dark h-6" />
        </div>

        <section
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={t('welcome.progressLabel', {
            done: completedStepCount,
            total: STEP_ORDER.length,
          })}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">{t('welcome.progressTitle')}</p>
            <span className="font-mono text-xs text-muted">
              {completedStepCount}/{STEP_ORDER.length}
            </span>
          </div>
          <ol className="flex flex-col gap-0.5">
            {STEP_ORDER.map((id, index) => {
              const done = stepDone(id);
              const active = step === id;
              const locked = index > maxStepReached;
              return (
                <li key={id}>
                  {/* Reached steps stay revisitable; unreached ones stay locked
                      so the wizard can't be skipped ahead from the sidebar. */}
                  <button
                    type="button"
                    className={cx(
                      'flex w-full items-center gap-2.5 rounded-control border-0 bg-transparent px-2 py-1.5 text-left text-[13px] text-dim',
                      'hover:bg-s2 disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent',
                      active && 'bg-accent-tint font-medium text-ink hover:bg-accent-tint',
                    )}
                    disabled={locked}
                    tabIndex={locked ? -1 : undefined}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => goTo(id)}
                  >
                    <span
                      className={cx(
                        'inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                        done
                          ? 'border-ok bg-ok text-on-accent'
                          : active
                            ? 'border-accent text-accent'
                            : 'border-line text-muted',
                      )}
                      aria-hidden="true"
                    >
                      {done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
                    </span>
                    <span>{stepLabel(id)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="md:mt-auto">
          <Button variant="ghost" size="sm" onClick={leaveOnboarding}>
            {t('welcome.skip')}
          </Button>
        </div>
      </aside>

      {/* ── Content ────────────────────────────────── */}
      <main
        className={cx(
          'mx-auto w-full px-4 py-8 md:px-8',
          step === 'playground' ? 'max-w-none' : 'max-w-3xl',
        )}
      >
        {!resumeChecked ? (
          <Pending>{t('welcome.restoring')}</Pending>
        ) : step === 'harness' ? (
          <div>
            <StepHeader
              id="harness"
              title={t('welcome.harness.title')}
              desc={t('welcome.harness.desc')}
            />
            {harnessCreated ? (
              <div className="panel flex items-center gap-3 p-5">
                {platform && PLATFORM_ICONS[platform] ? (
                  <img
                    src={PLATFORM_ICONS[platform]}
                    alt=""
                    className="size-8"
                    aria-hidden="true"
                  />
                ) : null}
                <div>
                  <p className="font-semibold text-ink">{harnessName}</p>
                  {platform ? (
                    <p className="text-sm text-muted">{PLATFORM_LABELS[platform]}</p>
                  ) : null}
                </div>
              </div>
            ) : (
              <form
                className="panel flex flex-col gap-4 p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createHarness();
                }}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div>
                    <span className="label">{t('welcome.harness.type')}</span>
                    <AgentTypeSelect
                      category={category}
                      platform={platform}
                      onCategoryChange={handleCategoryChange}
                      onPlatformChange={setPlatform}
                      disabled={creating}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="label" htmlFor="welcome-harness-name">
                      {t('welcome.harness.name')}
                    </label>
                    <input
                      autoFocus
                      id="welcome-harness-name"
                      className="field"
                      type="text"
                      placeholder={t('welcome.harness.namePlaceholder')}
                      value={harnessName}
                      onChange={(e) => setHarnessName(e.target.value)}
                      disabled={creating}
                      required
                      aria-describedby={harnessError ? 'welcome-harness-error' : undefined}
                    />
                  </div>
                </div>
                <div>
                  <span className="label">{t('welcome.harness.settings')}</span>
                  <div className="flex items-center justify-between gap-4 rounded-control border border-line px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {t('welcome.harness.enableLogs')}
                      </p>
                      <p className="hint mt-0.5">{t('welcome.harness.enableLogsHint')}</p>
                    </div>
                    <Switch
                      checked={logsEnabled}
                      onChange={setLogsEnabled}
                      label={t('welcome.harness.enableLogs')}
                      disabled={creating}
                    />
                  </div>
                </div>
                {harnessError ? (
                  <p id="welcome-harness-error" className="form-error" role="alert">
                    {harnessError}
                  </p>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    busy={creating}
                    disabled={!harnessName.trim() || !platform}
                  >
                    {t('welcome.harness.create')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : step === 'providers' ? (
          <div>
            <StepHeader
              id="providers"
              title={t('welcome.providers.title')}
              desc={t('welcome.providers.desc', {
                name: harnessName.trim() || t('welcome.providers.yourHarness'),
              })}
            />

            <div className="tabs" role="tablist">
              {providerTabs.map((item) => (
                <button
                  key={item.id}
                  id={`welcome-provider-tab-${item.id}`}
                  className={cx('tab', tab === item.id && 'is-active')}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  aria-controls={`welcome-provider-panel-${item.id}`}
                  tabIndex={tab === item.id ? 0 : -1}
                  onClick={() => selectProviderTab(item.id)}
                  onKeyDown={handleProviderTabKeyDown}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>

            {!providers.loading && providerAgent ? (
              <div
                id={`welcome-provider-panel-${tab}`}
                className="grid gap-2 sm:grid-cols-2"
                role="tabpanel"
                aria-labelledby={`welcome-provider-tab-${tab}`}
              >
                {tabProviders.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex items-center gap-3 rounded-control border border-line bg-elev px-3 py-2.5 text-left hover:border-line-strong"
                    onClick={() => setConnectTarget(p.id)}
                  >
                    <ProviderMark providerId={p.id} name={p.name} size={22} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {p.name}
                    </span>
                    {isConnected(p.id, tab) ? (
                      <span className="badge is-ok">{t('welcome.providers.connected')}</span>
                    ) : (
                      <span className="btn btn-ghost btn-sm">{t('welcome.providers.connect')}</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <Pending>{t('welcome.providers.loading')}</Pending>
            )}
            {agent.error || providers.error ? (
              <p className="form-error mt-3" role="alert">
                {t('welcome.providers.loadError')}
              </p>
            ) : null}

            <StepActions sticky>
              {connectedCount > 0 ? (
                <button type="button" className={textLinkClass} onClick={() => goTo('route')}>
                  {t('welcome.providers.testLater')}
                </button>
              ) : (
                <span className="text-sm text-muted">{t('welcome.providers.needOne')}</span>
              )}
              <div className="flex items-center gap-3">
                {connectedCount > 0 ? (
                  <span className="text-sm text-muted">
                    {t('welcome.providers.connectedCount', connectedCount)}
                  </span>
                ) : null}
                <Button disabled={connectedCount === 0} onClick={() => goTo('playground')}>
                  {t('welcome.providers.testModels')}
                </Button>
              </div>
            </StepActions>
          </div>
        ) : step === 'playground' ? (
          <div>
            <StepHeader
              id="playground"
              title={t('welcome.playground.title')}
              desc={t('welcome.playground.desc')}
            />
            <Playground embedded />
            <StepActions sticky>
              <Button variant="ghost" onClick={() => goTo('providers')}>
                {t('welcome.playground.backToProviders')}
              </Button>
              <span className="text-sm text-muted">{t('welcome.playground.optional')}</span>
              <Button onClick={() => goTo('route')}>
                {t('welcome.playground.continueToRouting')}
              </Button>
            </StepActions>
          </div>
        ) : step === 'route' ? (
          <div>
            <StepHeader id="route" title={t('welcome.route.title')} />
            {tiers.loading ? (
              <Pending>{t('welcome.route.loading')}</Pending>
            ) : (
              <RoutingDefaultTierSection
                agentName={harnessSlug}
                tier={defaultRoute}
                models={models.data ?? []}
                customProviders={harnessCustomProviders.data ?? []}
                activeProviders={harnessActive}
                connectedProviders={harnessConnected}
                tiersLoading={tiers.loading}
                changingTier={actions.changingTier}
                resettingTier={actions.resettingTier}
                resettingAll={actions.resettingAll}
                addingFallback={actions.addingFallback}
                onDropdownOpen={(tierId) => setDropdownTier(tierId)}
                onOverride={handleOverride}
                onPinKey={actions.handlePinKey}
                onReset={actions.handleReset}
                onFallbackUpdate={actions.handleFallbackUpdate}
                onAddFallback={(tierId) => setFallbackPickerTier(tierId)}
                getFallbacksFor={actions.getFallbacksFor}
                getTier={actions.getTier}
                complexityEnabled={false}
                togglingComplexity={false}
                onToggleComplexity={() => {}}
                showComplexityToggle={false}
                responseMode={defaultRoute?.response_mode ?? 'buffered'}
                changingResponseMode={false}
                onResponseModeChange={() => {}}
                embedded
                getModelParams={getModelParamsFor}
                setModelParams={setModelParamsFor}
              />
            )}
            <StepActions>
              <Button variant="ghost" onClick={() => goTo('playground')}>
                {t('welcome.route.backToTest')}
              </Button>
              <Button disabled={routedProviderCount === 0} onClick={() => goTo('activate')}>
                {t('welcome.route.continue')}
              </Button>
            </StepActions>
          </div>
        ) : (
          <div>
            <StepHeader
              id="activate"
              title={t('welcome.activate.title')}
              desc={t('welcome.activate.desc', {
                name: harnessName.trim() || t('welcome.activate.yourAgent'),
              })}
            />

            <section className="panel p-5" aria-label={t('welcome.activate.instructionsLabel')}>
              <SetupStepAddProvider
                apiKey={harnessKey}
                keyPrefix={harnessKeyPrefix}
                baseUrl={baseUrl}
                platform={platform}
              />
            </section>

            <p className="mt-4 text-sm text-dim">{t('welcome.activate.onceConfigured')}</p>

            <section
              className={cx(
                'mt-4 flex flex-col gap-3 rounded-surface border p-4',
                agentRequestSeen ? 'border-ok bg-ok-tint' : 'border-line bg-elev',
              )}
              aria-live="polite"
            >
              {agentRequestSeen ? (
                <div className="flex items-start gap-3" role="status">
                  <span
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-ok text-on-accent"
                    aria-hidden="true"
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  <div>
                    <strong className="text-ink">{t('welcome.activate.liveTitle')}</strong>
                    <p className="text-sm text-dim">
                      {t('welcome.activate.liveDesc')}
                      {latestAgentRequest?.model ? (
                        <> {t('welcome.activate.liveTo', { model: latestAgentRequest.model })}</>
                      ) : null}
                      {latestAgentRequest?.duration_ms ? (
                        <> {t('welcome.activate.liveIn', { ms: latestAgentRequest.duration_ms })}</>
                      ) : null}
                      .
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <span className="spinner mt-1" aria-hidden="true" />
                    <div>
                      <h2 className="text-sm font-semibold text-ink">
                        {t('welcome.activate.waitingTitle')}
                      </h2>
                      <p className="text-sm text-dim">{t('welcome.activate.waitingDesc')}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={cx(textLinkClass, 'self-start')}
                    disabled={checkingForRequest}
                    onClick={() => void checkForFirstAgentRequest()}
                  >
                    {checkingForRequest
                      ? t('welcome.activate.checking')
                      : t('welcome.activate.checkAgain')}
                  </button>
                  {requestCheckError ? (
                    <p className="text-sm text-muted" role="status">
                      {t('welcome.activate.checkError')}
                    </p>
                  ) : null}
                  {waitedLong && !latestAgentRequest ? (
                    <p className="text-sm text-muted" role="status">
                      {t('welcome.activate.waitedLong')}
                    </p>
                  ) : null}
                  {latestAgentRequest && !isSuccessfulAgentMessage(latestAgentRequest) ? (
                    <div className="notice is-danger flex-col gap-1" role="alert">
                      <strong>{t('welcome.activate.failedTitle')}</strong>
                      <p className="text-sm">
                        {latestAgentRequest.error_message ||
                          t('welcome.activate.failedStatus', {
                            status: latestAgentRequest.status ?? '',
                          })}
                      </p>
                      {errorDocCode ? (
                        <a
                          className="text-sm"
                          href={thinkerErrorDocsUrl(errorDocCode)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('welcome.activate.whatDoesMean', { code: errorDocCode })}
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </section>

            <StepActions>
              <Button variant="ghost" onClick={() => goTo('route')}>
                {t('welcome.activate.backToRouting')}
              </Button>
              {agentRequestSeen ? (
                <Button onClick={leaveOnboarding}>
                  {t('welcome.activate.goToDashboard')}
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </StepActions>
          </div>
        )}
      </main>

      {/* Playground run-details drawer (right sidebar) — rendered by App in
          the dashboard, by the wizard itself here. */}
      {rightSidebar}

      {/* Dev-only: the liftoff cinematic, accessible via ?preview=liftoff. In
          production the activate step already says "it works", so a 5.6 s
          animation would be frustrating — route straight to the dashboard. */}
      {import.meta.env.DEV && LiftoffPreview && liftoffPreview ? (
        <Suspense fallback={null}>
          <LiftoffPreview
            latestAgentRequest={latestAgentRequest}
            harnessSlug={harnessSlug}
            onLeave={leaveOnboarding}
          />
        </Suspense>
      ) : null}

      {/* Provider connect modal — root level so the fixed overlay fills the viewport */}
      {step === 'providers' && connectTarget && harnessSlug ? (
        <ProviderSelectModal
          agentName={harnessSlug}
          providers={providers.data ?? []}
          customProviders={customProviders.data ?? []}
          providerDeepLink={{
            providerId: connectTarget,
            authType: tab === 'local' ? 'api_key' : tab,
          }}
          onClose={() => setConnectTarget(null)}
          onUpdate={handleProvidersUpdate}
          onPollProviders={handleProvidersUpdate}
        />
      ) : null}

      {/* Model / fallback picker modals for the routing card — same as Routing.tsx */}
      {harnessSlug ? (
        <RoutingModals
          agentName={harnessSlug}
          dropdownTier={dropdownTier}
          onDropdownClose={() => setDropdownTier(null)}
          fallbackPickerTier={fallbackPickerTier}
          onFallbackPickerClose={() => setFallbackPickerTier(null)}
          showProviderModal={false}
          onProviderModalClose={() => {}}
          instructionModal={instructionModal}
          instructionProvider={null}
          onInstructionClose={() => setInstructionModal(null)}
          models={models.data ?? []}
          tiers={tiers.data ?? []}
          customProviders={harnessCustomProviders.data ?? []}
          connectedProviders={harnessConnected}
          getTier={actions.getTier}
          onOverride={handleOverride}
          onAddFallback={handleAddFallback}
          onProviderUpdate={refetchRouting}
          onOpenProviderModal={() => setStep('providers')}
        />
      ) : null}
    </div>
  );
}
/* v8 ignore stop */
