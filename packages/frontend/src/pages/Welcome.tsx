/* v8 ignore start -- route-level onboarding UI is validated through browser QA; pure logic is covered in welcome-helpers.ts. */
import { Meta, Title } from '@solidjs/meta';
import { useNavigate, useSearchParams } from '@solidjs/router';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  lazy,
  onCleanup,
  untrack,
  type Component,
  type JSX,
} from 'solid-js';
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
import { createRoutingActions } from './RoutingActions.js';
import { providerIcon } from '../components/ProviderIcon.jsx';
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
  type AvailableModel,
} from '../services/api.js';
import type { RequestParamDefaults } from 'thinker-shared';
import { getMessages } from '../services/api/messages.js';
import { customProviderColor } from '../services/formatters.js';
import { markAgentCreated } from '../services/recent-agents.js';
import { useRightSidebar } from '../services/right-sidebar.jsx';
import { hasOnboardingBeenDone, markOnboardingDone } from '../services/onboarding.js';
import {
  type AgentCategory,
  type AgentPlatform,
  PLATFORM_ICONS,
  PLATFORM_LABELS,
  PLATFORMS_BY_CATEGORY,
  thinkerErrorDocsUrl,
} from 'thinker-shared';
import '../styles/routing.css';
import '../styles/routing-providers.css';
import '../styles/routing-modal.css';
import '../styles/welcome.css';
import { THINKER_LOGO_URL, THINKER_LOGO_DARK_URL } from '../services/thinker-links.js';
import { t } from '../i18n/index.js';

type StepId = 'harness' | 'providers' | 'playground' | 'route' | 'activate';
const STEP_ORDER: StepId[] = ['harness', 'providers', 'playground', 'route', 'activate'];

/** The theme lives in "Launch sequence"; the rest is plain wayfinding. */
const eyebrow = (id: StepId) =>
  t('welcome.eyebrow', { step: STEP_ORDER.indexOf(id) + 1, total: STEP_ORDER.length });

/** Sidebar label of a step, read at render time so it follows the language. */
const stepLabel = (id: StepId): string => t(`welcome.steps.${id}`);

/** Replicates ProviderMark from ProviderConnectionsPage (icon or colored initial). */
const ProviderMark: Component<{ providerId: string; name: string; size?: number }> = (props) => {
  const s = () => props.size ?? 20;
  return (
    <Show
      when={providerIcon(props.providerId, s())}
      fallback={
        <span
          style={
            {
              display: 'inline-flex',
              'align-items': 'center',
              'justify-content': 'center',
              width: `${s()}px`,
              height: `${s()}px`,
              'border-radius': '4px',
              'font-size': s() > 20 ? '12px' : '11px',
              'font-weight': '600',
              color: 'white',
              background: customProviderColor(props.name || props.providerId),
            } as JSX.CSSProperties
          }
        >
          {(props.name || props.providerId).charAt(0).toUpperCase()}
        </span>
      }
    >
      <span style={`display:flex;align-items:center;width:${s()}px;height:${s()}px`}>
        {providerIcon(props.providerId, s())}
      </span>
    </Show>
  );
};

// Dev-only liftoff preview (`?preview=liftoff`). The dynamic import sits inside
// the `import.meta.env.DEV` branch, so production builds drop the module, its
// templates and `motion` entirely (#229).
const LiftoffPreview = import.meta.env.DEV ? lazy(() => import('./WelcomeLiftoff.jsx')) : null;

const Welcome: Component = () => {
  const navigate = useNavigate();
  // Playground pushes its run-details drawer here; App renders it in the
  // dashboard shell, so the standalone onboarding layout must render it too.
  const { content: rightSidebar } = useRightSidebar();
  const [searchParams] = useSearchParams();
  const liftoffPreview = () => import.meta.env.DEV && searchParams.preview === 'liftoff';
  const session = authClient.useSession();
  const userId = () => session()?.data?.user?.id ?? '';
  // Redirect users who already completed onboarding so they don't see the
  // wizard again on a manual visit to /welcome.
  createEffect(() => {
    const uid = userId();
    if (uid && hasOnboardingBeenDone(uid)) navigate('/', { replace: true });
  });
  const [step, setStep] = createSignal<StepId>('harness');
  const [maxStepReached, setMaxStepReached] = createSignal(0);
  createEffect(() => {
    const index = STEP_ORDER.indexOf(step());
    if (index > untrack(maxStepReached)) setMaxStepReached(index);
  });
  const goTo = (id: StepId) => {
    setStep(id);
    // Provider connections can complete after this harness's models resource
    // initially resolved empty. Refresh before opening routing so a newly
    // connected provider is immediately available for the default proposal.
    if (id === 'playground' || id === 'route') {
      const slug = harnessSlug();
      if (slug && (models() ?? []).length === 0) {
        void refreshModels(slug)
          .catch(() => undefined)
          .then(refetchRouting);
      } else {
        void refetchRouting();
      }
    }
  };
  // ── Shared resources ─────────────────────────────────────────────────
  // The Playground agent gives provider connections an agent context before
  // the user's own harness exists (providers are tenant-global anyway).
  const [agent] = createResource(() => getPlaygroundAgent());
  const contextAgent = () => agent()?.name;

  // Providers connect against the user's harness once it exists; the reserved
  // Playground agent only bridges the gap before creation. Declared before the
  // resources below because createResource evaluates its source immediately.
  const [harnessName, setHarnessName] = createSignal('');
  const [harnessSlug, setHarnessSlug] = createSignal('');
  const providerAgent = () => harnessSlug() || contextAgent();
  const [providers, { refetch: refetchProviders }] = createResource(providerAgent, (name) =>
    getProviders(name),
  );
  const [customProviders, { refetch: refetchCustom }] = createResource(providerAgent, (name) =>
    getCustomProviders(name),
  );
  const [existingAgents] = createResource(
    () => getAgents() as Promise<{ agents?: OnboardingAgentSummary[] }>,
  );
  const handleProvidersUpdate = async () => {
    await Promise.all([refetchProviders(), refetchCustom()]);
    const slug = harnessSlug();
    if (!slug) return;
    // Force discovery once a connection finishes. The harness may have asked
    // for models before the provider existed, leaving an empty server cache for
    // its two-minute TTL; a plain GET would keep returning that stale result.
    await refreshModels(slug).catch(() => undefined);
    await refetchRouting();
  };

  const connectedCount = createMemo(() => {
    const ids = new Set<string>();
    for (const p of providers() ?? []) {
      const active = p.auth_type === 'subscription' ? p.is_active : p.is_active && p.has_api_key;
      if (active) ids.add(p.provider);
    }
    for (const c of customProviders() ?? []) ids.add(`custom:${c.id}`);
    return ids.size;
  });

  // ── Step: providers ──────────────────────────────────────────────────
  const [connectTarget, setConnectTarget] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<'subscription' | 'api_key' | 'local'>('api_key');
  const selectProviderTab = (next: 'subscription' | 'api_key' | 'local', focus = false) => {
    setTab(next);
    if (focus) {
      requestAnimationFrame(() => document.getElementById(`welcome-provider-tab-${next}`)?.focus());
    }
  };
  const handleProviderTabKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const order: Array<'api_key' | 'subscription' | 'local'> = ['api_key', 'subscription', 'local'];
    const idx = order.indexOf(tab() as 'api_key' | 'subscription' | 'local');
    const next =
      event.key === 'ArrowRight'
        ? order[(idx + 1) % order.length]
        : order[(idx - 1 + order.length) % order.length];
    selectProviderTab(next!, true);
  };

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

  const allTabProviders = () => {
    if (tab() === 'subscription')
      return subscriptionCatalog(PROVIDERS, (id) => isConnected(id, 'subscription'));
    if (tab() === 'local') return PROVIDERS.filter((p) => p.localOnly);
    return PROVIDERS.filter((p) => !p.subscriptionOnly && !p.localOnly);
  };

  // Popular providers first, then the rest in catalog order.
  const tabProviders = () => {
    const all = allTabProviders();
    const popular = all.filter((p) => POPULAR.includes(p.id));
    return [...popular, ...all.filter((p) => !POPULAR.includes(p.id))];
  };

  const isConnected = (id: string, authType: 'subscription' | 'api_key' | 'local') => {
    const resolvedType = authType === 'local' ? 'api_key' : authType;
    return (providers() ?? []).some(
      (p) =>
        p.provider === id &&
        p.auth_type === resolvedType &&
        p.is_active &&
        (resolvedType === 'subscription' || p.has_api_key),
    );
  };

  // ── Step: harness ────────────────────────────────────────────────────
  const [harnessKey, setHarnessKey] = createSignal<string | null>(null);
  const [harnessKeyPrefix, setHarnessKeyPrefix] = createSignal<string | null>(null);
  const [category, setCategory] = createSignal<AgentCategory | null>('personal');
  const [platform, setPlatform] = createSignal<AgentPlatform | null>(
    PLATFORMS_BY_CATEGORY['personal'][0] ?? null,
  );
  const [creating, setCreating] = createSignal(false);
  const [harnessError, setHarnessError] = createSignal('');
  // Defaults ON, mirroring the Connect Harness modal — explicit so create
  // always sends a choice rather than relying on the server-side default.
  const [logsEnabled, setLogsEnabled] = createSignal(true);
  const harnessCreated = () => !!harnessSlug();

  const handleCategoryChange = (c: AgentCategory) => {
    setCategory(c);
    setPlatform(PLATFORMS_BY_CATEGORY[c][0] ?? null);
  };

  const baseUrl = () => {
    return `${installOrigin()}/v1`;
  };

  const createHarness = async () => {
    const name = harnessName().trim();
    if (!name || creating()) return;
    setCreating(true);
    setHarnessError('');
    try {
      const result = await createAgent({
        name,
        ...(category() ? { agent_category: category()! } : {}),
        ...(platform() ? { agent_platform: platform()! } : {}),
        record_messages: logsEnabled(),
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
  const [models, { refetch: refetchModels }] = createResource(harnessSlug, (slug) =>
    slug ? getAvailableModels(slug) : Promise.resolve([]),
  );
  const [tiers, { refetch: refetchTiers, mutate: mutateTiers }] = createResource(
    harnessSlug,
    (slug) => (slug ? getTierAssignments(slug) : Promise.resolve([])),
  );
  const [harnessProviders, { refetch: refetchHarnessProviders }] = createResource(
    harnessSlug,
    (slug) => (slug ? getProviders(slug) : Promise.resolve([])),
  );
  const [harnessCustomProviders, { refetch: refetchHarnessCustom }] = createResource(
    harnessSlug,
    (slug) => (slug ? getCustomProviders(slug) : Promise.resolve([])),
  );

  const refetchRouting = async () => {
    await Promise.all([
      refetchTiers(),
      refetchModels(),
      refetchHarnessProviders(),
      refetchHarnessCustom(),
    ]);
  };

  // Per-route request params — same wiring as Routing.tsx so the card's
  // params affordance works here too.
  const [modelParams, { mutate: mutateModelParams }] = createResource(harnessSlug, (slug) =>
    slug ? listModelParams(slug).catch(() => [] as AgentModelParamsRow[]) : Promise.resolve([]),
  );
  const modelParamsMap = createMemo(() => {
    const map = new Map<string, RequestParamDefaults>();
    for (const row of modelParams() ?? []) {
      map.set(modelParamsKey(row.scope, row.provider, row.authType, row.model), row.params);
    }
    return map;
  });
  const getModelParamsFor = (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
  ): RequestParamDefaults | null =>
    modelParamsMap().get(modelParamsKey(scope, provider, authType, model)) ?? null;

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
      await deleteModelParams(harnessSlug(), { scope, provider, authType, model });
      mutateModelParams((rows) => (rows ?? []).filter((r) => !matches(r)));
      return;
    }
    const saved = await setModelParamsApi(harnessSlug(), {
      scope,
      provider,
      authType,
      model,
      params: next,
    });
    mutateModelParams((rows) => [...(rows ?? []).filter((r) => !matches(r)), saved]);
  };

  // New agents get every provider enabled, so connected == enabled here.
  const harnessConnected = () => harnessProviders() ?? [];
  const harnessActive = () => harnessConnected().filter((p) => p.is_active);

  const [dropdownTier, setDropdownTier] = createSignal<string | null>(null);
  const [fallbackPickerTier, setFallbackPickerTier] = createSignal<string | null>(null);
  const [instructionModal, setInstructionModal] = createSignal<'enable' | 'disable' | null>(null);

  const actions = createRoutingActions({
    agentName: harnessSlug,
    tiers,
    mutateTiers,
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

  const defaultRoute = () => actions.getTier('default');
  const routedProviderCount = () => {
    const tier = defaultRoute();
    const primary = tier?.override_route ?? tier?.auto_assigned_route;
    if (!primary) return 0;
    const providersInRoute = [primary, ...(tier?.fallback_routes ?? [])].map((route) =>
      route.provider.toLowerCase(),
    );
    return new Set(providersInRoute).size;
  };

  // ── Step: first real agent request ───────────────────────────────────
  // Activation only counts traffic that arrives through the user's own
  // integration. Playground is intentionally separate: it is useful for
  // comparing models, but it is not evidence that their agent is connected.
  const [agentRequestSeen, setAgentRequestSeen] = createSignal(false);
  const [checkingForRequest, setCheckingForRequest] = createSignal(false);
  const [requestCheckError, setRequestCheckError] = createSignal(false);
  const [latestAgentRequest, setLatestAgentRequest] = createSignal<OnboardingMessageSummary | null>(
    null,
  );
  // Thinker's own errors carry a documented M### code — link it.
  const errorDocCode = () => latestAgentRequest()?.error_message?.match(/\bM\d{3}\b/)?.[0] ?? null;
  const [waitedLong, setWaitedLong] = createSignal(false);

  const checkForFirstAgentRequest = async () => {
    const slug = harnessSlug();
    if (!slug || agentRequestSeen() || checkingForRequest()) return;
    setCheckingForRequest(true);
    try {
      const result = (await getMessages(
        {
          agent_name: slug,
          limit: '1',
          include_total: 'false',
        },
        { cache: false },
      )) as {
        items?: OnboardingMessageSummary[];
      };
      setRequestCheckError(false);
      const latest = result.items?.[0] ?? null;
      setLatestAgentRequest(latest);
      if (isSuccessfulAgentMessage(latest)) {
        setAgentRequestSeen(true);
        const uid = userId();
        if (uid) markOnboardingDone(uid);
      }
    } catch {
      // Polling should never surface an unhandled rejection. Keep trying in
      // the background and give the user a useful manual recovery affordance.
      setRequestCheckError(true);
    } finally {
      setCheckingForRequest(false);
    }
  };

  createEffect(() => {
    if (step() !== 'activate' || !harnessSlug() || agentRequestSeen()) return;
    setWaitedLong(false);
    // The check toggles `checkingForRequest`; keep that implementation detail
    // out of this effect's dependencies or it becomes a request loop instead
    // of the intended four-second poll.
    untrack(() => void checkForFirstAgentRequest());
    const timer = window.setInterval(() => void checkForFirstAgentRequest(), 4_000);
    // A minute of silence usually means the agent kept its old config.
    const stallTimer = window.setTimeout(() => setWaitedLong(true), 60_000);
    onCleanup(() => {
      window.clearInterval(timer);
      window.clearTimeout(stallTimer);
    });
  });

  // Resume the newest zero-message harness after a reload. Server state is the
  // source of truth: providers, routes determine the next useful
  // stage, while the restored key keeps the connection instructions usable.
  const [resumeHydrated, setResumeHydrated] = createSignal(false);
  const [resumeChecked, setResumeChecked] = createSignal(false);
  let resumeStarted = false;
  let resumeStageResolved = false;
  createEffect(() => {
    if (existingAgents.loading || resumeStarted) return;
    resumeStarted = true;
    const candidate = findResumableAgent(existingAgents()?.agents ?? []);
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
  });

  createEffect(() => {
    if (!resumeHydrated() || resumeStageResolved || providers.loading || customProviders.loading)
      return;
    if (connectedCount() === 0) {
      setStep('providers');
      resumeStageResolved = true;
      return;
    }
    if (tiers.loading) return;
    if (routedProviderCount() === 0) setStep('playground');
    else setStep('activate');
    resumeStageResolved = true;
  });

  // Never trap users: setup resumes from server state on the next visit, so
  // skipping only skips the guidance, not the work.
  const leaveOnboarding = () => {
    const uid = userId();
    if (uid) markOnboardingDone(uid);
    navigate('/');
  };

  // Which steps are completed, for the sidebar checkmarks. Steps without
  // server state ('playground') count the furthest step reached,
  // not the current one, so navigating back never un-ticks them.
  const stepDone = (id: StepId): boolean => {
    switch (id) {
      case 'harness':
        return harnessCreated();
      case 'providers':
        return connectedCount() > 0;
      case 'playground':
        return maxStepReached() > STEP_ORDER.indexOf('playground');
      case 'route':
        return routedProviderCount() > 0;
      case 'activate':
        return agentRequestSeen();
    }
  };

  const completedStepCount = () => STEP_ORDER.filter(stepDone).length;

  return (
    <div class="welcome">
      <Title>{t('welcome.pageTitle')}</Title>
      <Meta name="description" content={t('welcome.metaDescription')} />

      {/* ── Sidebar: activation progress + steps ───── */}
      <aside class="welcome__sidebar">
        <div class="welcome__sidebar-top">
          <img
            src={THINKER_LOGO_URL}
            alt="Thinker"
            class="welcome__logo-mark welcome__logo-light"
          />
          <img src={THINKER_LOGO_DARK_URL} alt="" class="welcome__logo-mark welcome__logo-dark" />
        </div>

        <section
          class="welcome__progress"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={t('welcome.progressLabel', {
            done: completedStepCount(),
            total: STEP_ORDER.length,
          })}
        >
          <div class="welcome__progress-header">
            <p>{t('welcome.progressTitle')}</p>
            <span>
              {completedStepCount()}/{STEP_ORDER.length}
            </span>
          </div>
          <ol class="welcome__nav">
            <For each={STEP_ORDER}>
              {(id, index) => (
                <li
                  class="welcome__nav-item"
                  classList={{
                    'welcome__nav-item--active': step() === id,
                    'welcome__nav-item--done': stepDone(id),
                  }}
                >
                  {/* Reached steps stay revisitable; unreached ones stay locked
                      so the wizard can't be skipped ahead from the sidebar. */}
                  <button
                    type="button"
                    class="welcome__nav-btn"
                    disabled={index() > maxStepReached()}
                    tabindex={index() > maxStepReached() ? -1 : undefined}
                    aria-current={step() === id ? 'step' : undefined}
                    onClick={() => goTo(id)}
                  >
                    <span class="welcome__nav-check" aria-hidden="true">
                      <Show when={stepDone(id)} fallback={index() + 1}>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="3"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </Show>
                    </span>
                    <span class="welcome__nav-label">{stepLabel(id)}</span>
                  </button>
                </li>
              )}
            </For>
          </ol>
        </section>

        <div class="welcome__sidebar-footer">
          <button type="button" class="btn btn--ghost btn--sm" onClick={leaveOnboarding}>
            {t('welcome.skip')}
          </button>
        </div>
      </aside>

      {/* ── Content ────────────────────────────────── */}
      <main class="welcome__main">
        <Show when={!resumeChecked()}>
          <div class="welcome__panel welcome__pending" role="status">
            <span class="welcome__spinner" />
            <span>{t('welcome.restoring')}</span>
          </div>
        </Show>

        <Show when={resumeChecked()}>
          {/* ====== Harness ====== */}
          <Show when={step() === 'harness'}>
            <div class="welcome__panel">
              <div class="welcome__panel-header">
                <p class="welcome__eyebrow">{eyebrow('harness')}</p>
                <h1 class="welcome__panel-title">{t('welcome.harness.title')}</h1>
                <p class="welcome__panel-desc">{t('welcome.harness.desc')}</p>
              </div>

              <Show
                when={!harnessCreated()}
                fallback={
                  <div
                    class="panel welcome__form-panel welcome__harness-summary"
                    style="padding: 20px; margin-bottom: 0;"
                  >
                    <Show when={platform() && PLATFORM_ICONS[platform()!]}>
                      <img
                        src={PLATFORM_ICONS[platform()!]}
                        alt=""
                        class="welcome__harness-summary-icon"
                        aria-hidden="true"
                      />
                    </Show>
                    <div>
                      <p class="welcome__harness-summary-name">{harnessName()}</p>
                      <Show when={platform()}>
                        <p class="welcome__harness-summary-type">{PLATFORM_LABELS[platform()!]}</p>
                      </Show>
                    </div>
                  </div>
                }
              >
                <form
                  class="panel welcome__form-panel"
                  style="padding: 20px; margin-bottom: 0;"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createHarness();
                  }}
                >
                  <div class="agent-type-select-row">
                    <div>
                      <label class="modal-card__field-label">{t('welcome.harness.type')}</label>
                      <AgentTypeSelect
                        category={category()}
                        platform={platform()}
                        onCategoryChange={handleCategoryChange}
                        onPlatformChange={setPlatform}
                        disabled={creating()}
                      />
                    </div>
                    <div style="flex: 1;">
                      <label class="modal-card__field-label" for="welcome-harness-name">
                        {t('welcome.harness.name')}
                      </label>
                      <input
                        ref={(el) => requestAnimationFrame(() => el.focus())}
                        id="welcome-harness-name"
                        class="modal-card__input modal-card__input--lg"
                        type="text"
                        placeholder={t('welcome.harness.namePlaceholder')}
                        value={harnessName()}
                        onInput={(e) => setHarnessName(e.currentTarget.value)}
                        disabled={creating()}
                        required
                        aria-describedby={harnessError() ? 'welcome-harness-error' : undefined}
                      />
                    </div>
                  </div>
                  <div class="add-agent-toggles">
                    <div class="model-params__group">
                      {/* Same label treatment as the Type / Harness name field
                          labels, not the larger Model-params group header. */}
                      <div class="modal-card__field-label add-agent-toggles__header">
                        {t('welcome.harness.settings')}
                      </div>
                      <div class="model-params__group-card">
                        <div class="model-params__row">
                          <div class="model-params__row-text">
                            <div class="model-params__label-title">
                              <span>{t('welcome.harness.enableLogs')}</span>
                            </div>
                            <div class="model-params__label-hint">
                              {t('welcome.harness.enableLogsHint')}
                            </div>
                          </div>
                          <div class="model-params__row-control">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={logsEnabled()}
                              aria-label={t('welcome.harness.enableLogs')}
                              class="settings-switch"
                              classList={{ 'settings-switch--on': logsEnabled() }}
                              disabled={creating()}
                              onClick={() => setLogsEnabled(!logsEnabled())}
                            >
                              <span class="settings-switch__track">
                                <span class="settings-switch__thumb" />
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <Show when={harnessError()}>
                    <p
                      id="welcome-harness-error"
                      class="welcome__error"
                      role="alert"
                      style="margin-top: 10px;"
                    >
                      {harnessError()}
                    </p>
                  </Show>
                  <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                    <button
                      type="submit"
                      class="btn btn--primary btn--sm"
                      disabled={!harnessName().trim() || !platform() || creating()}
                    >
                      {creating() ? <span class="spinner" /> : t('welcome.harness.create')}
                    </button>
                  </div>
                </form>
              </Show>
            </div>
          </Show>

          {/* ====== Providers ====== */}
          <Show when={step() === 'providers'}>
            <div class="welcome__panel">
              <div class="welcome__panel-header">
                <p class="welcome__eyebrow">{eyebrow('providers')}</p>
                <h1 class="welcome__panel-title">{t('welcome.providers.title')}</h1>
                <p class="welcome__panel-desc">
                  {t('welcome.providers.desc', {
                    name: harnessName().trim() || t('welcome.providers.yourHarness'),
                  })}
                </p>
              </div>

              <div class="panel__tabs" role="tablist">
                <button
                  id="welcome-provider-tab-api-key"
                  class="panel__tab"
                  classList={{ 'panel__tab--active': tab() === 'api_key' }}
                  type="button"
                  role="tab"
                  aria-selected={tab() === 'api_key'}
                  aria-controls="welcome-provider-panel-api-key"
                  tabindex={tab() === 'api_key' ? 0 : -1}
                  onClick={() => selectProviderTab('api_key')}
                  onKeyDown={handleProviderTabKeyDown}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    style="color: #e59d55"
                  >
                    <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
                  </svg>
                  {t('welcome.providers.usageBased')}
                </button>
                <button
                  id="welcome-provider-tab-subscription"
                  class="panel__tab"
                  classList={{ 'panel__tab--active': tab() === 'subscription' }}
                  type="button"
                  role="tab"
                  aria-selected={tab() === 'subscription'}
                  aria-controls="welcome-provider-panel-subscription"
                  tabindex={tab() === 'subscription' ? 0 : -1}
                  onClick={() => selectProviderTab('subscription')}
                  onKeyDown={handleProviderTabKeyDown}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    style="color: #1cc4bf"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {t('welcome.providers.subscriptions')}
                </button>
                <button
                  id="welcome-provider-tab-local"
                  class="panel__tab"
                  classList={{ 'panel__tab--active': tab() === 'local' }}
                  type="button"
                  role="tab"
                  aria-selected={tab() === 'local'}
                  aria-controls="welcome-provider-panel-local"
                  tabindex={tab() === 'local' ? 0 : -1}
                  onClick={() => selectProviderTab('local')}
                  onKeyDown={handleProviderTabKeyDown}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                    style="color: #F72585"
                  >
                    <path d="m13.18 6.75 2.66-4.22-1.69-1.07L12 4.87 9.85 1.46 8.16 2.53l2.66 4.22-8.67 13.72A1.006 1.006 0 0 0 3 22.01h18c.36 0 .7-.2.88-.52s.16-.71-.03-1.02zM10.24 20 12 16.98 13.76 20zm5.83 0-3.21-5.5c-.36-.62-1.37-.62-1.73 0L7.92 20H4.81L12 8.62 19.19 20h-3.11Z" />
                  </svg>
                  {t('welcome.providers.local')}
                </button>
              </div>

              <Show
                when={!providers.loading && providerAgent()}
                fallback={
                  <div class="welcome__pending">
                    <span class="welcome__spinner" />
                    <span>{t('welcome.providers.loading')}</span>
                  </div>
                }
              >
                <div
                  id={`welcome-provider-panel-${tab()}`}
                  class="provider-modal__list welcome__provider-list"
                  role="tabpanel"
                  aria-labelledby={`welcome-provider-tab-${tab()}`}
                >
                  <For each={tabProviders()}>
                    {(p) => {
                      const con = () => isConnected(p.id, tab());
                      return (
                        <button
                          type="button"
                          class="provider-toggle"
                          onClick={() => setConnectTarget(p.id)}
                        >
                          <span class="provider-toggle__icon">
                            <ProviderMark providerId={p.id} name={p.name} size={22} />
                          </span>
                          <span class="provider-toggle__info">
                            <span class="provider-toggle__name">{p.name}</span>
                          </span>
                          <Show
                            when={con()}
                            fallback={
                              <span class="btn btn--outline btn--sm">
                                {t('welcome.providers.connect')}
                              </span>
                            }
                          >
                            <span class="welcome__provider-connected">
                              {t('welcome.providers.connected')}
                            </span>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
              <Show when={agent.error || providers.error}>
                <p class="welcome__error" role="alert">
                  {t('welcome.providers.loadError')}
                </p>
              </Show>

              <div class="welcome__actions welcome__actions--split welcome__actions--sticky">
                <Show
                  when={connectedCount() > 0}
                  fallback={
                    <span class="welcome__actions-note">{t('welcome.providers.needOne')}</span>
                  }
                >
                  <button type="button" class="welcome__text-link" onClick={() => goTo('route')}>
                    {t('welcome.providers.testLater')}
                  </button>
                </Show>
                <div style="display:flex;align-items:center;gap:12px">
                  <Show when={connectedCount() > 0}>
                    <span class="welcome__actions-note">
                      {t('welcome.providers.connectedCount', connectedCount())}
                    </span>
                  </Show>
                  <button
                    type="button"
                    class="btn btn--primary"
                    disabled={connectedCount() === 0}
                    onClick={() => goTo('playground')}
                  >
                    {t('welcome.providers.testModels')}
                  </button>
                </div>
              </div>
            </div>
          </Show>

          {/* ====== Embedded Playground ====== */}
          <Show when={step() === 'playground'}>
            <div class="welcome__panel welcome__panel--playground">
              <div class="welcome__panel-header">
                <p class="welcome__eyebrow">{eyebrow('playground')}</p>
                <h1 class="welcome__panel-title">{t('welcome.playground.title')}</h1>
                <p class="welcome__panel-desc">{t('welcome.playground.desc')}</p>
              </div>
              <Playground embedded />
              <div class="welcome__actions welcome__actions--split welcome__actions--sticky">
                <button type="button" class="btn btn--ghost" onClick={() => goTo('providers')}>
                  {t('welcome.playground.backToProviders')}
                </button>
                <span class="welcome__actions-note">{t('welcome.playground.optional')}</span>
                <button type="button" class="btn btn--primary" onClick={() => goTo('route')}>
                  {t('welcome.playground.continueToRouting')}
                </button>
              </div>
            </div>
          </Show>

          {/* ====== Reliability routing ====== */}
          <Show when={step() === 'route'}>
            <div class="welcome__panel welcome__panel--routing">
              <div class="welcome__panel-header">
                <p class="welcome__eyebrow">{eyebrow('route')}</p>
                <h1 class="welcome__panel-title">{t('welcome.route.title')}</h1>
              </div>

              <Show
                when={!tiers.loading}
                fallback={
                  <div class="welcome__pending">
                    <span class="welcome__spinner" />
                    <span>{t('welcome.route.loading')}</span>
                  </div>
                }
              >
                <RoutingDefaultTierSection
                  agentName={harnessSlug}
                  tier={() => actions.getTier('default')}
                  models={() => models() ?? []}
                  customProviders={() => harnessCustomProviders() ?? []}
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
                  complexityEnabled={() => false}
                  togglingComplexity={() => false}
                  onToggleComplexity={() => {}}
                  showComplexityToggle={() => false}
                  responseMode={() => actions.getTier('default')?.response_mode ?? 'buffered'}
                  changingResponseMode={() => false}
                  onResponseModeChange={() => {}}
                  embedded
                  getModelParams={getModelParamsFor}
                  setModelParams={setModelParamsFor}
                />
              </Show>

              <div class="welcome__actions welcome__actions--split">
                <button class="btn btn--ghost" onClick={() => goTo('playground')}>
                  {t('welcome.route.backToTest')}
                </button>
                <button
                  class="btn btn--primary"
                  disabled={routedProviderCount() === 0}
                  onClick={() => goTo('activate')}
                >
                  {t('welcome.route.continue')}
                </button>
              </div>
            </div>
          </Show>

          {/* ====== First request from the real harness ====== */}
          <Show when={step() === 'activate'}>
            <div class="welcome__panel welcome__panel--setup">
              <div class="welcome__panel-header">
                <p class="welcome__eyebrow">{eyebrow('activate')}</p>
                <h1 class="welcome__panel-title">{t('welcome.activate.title')}</h1>
                <p class="welcome__panel-desc">
                  {t('welcome.activate.desc', {
                    name: harnessName().trim() || t('welcome.activate.yourAgent'),
                  })}
                </p>
              </div>

              <section
                class="panel welcome__form-panel welcome__setup-snippets"
                style="padding: 20px; margin-bottom: 0;"
                aria-label={t('welcome.activate.instructionsLabel')}
              >
                <SetupStepAddProvider
                  apiKey={harnessKey()}
                  keyPrefix={harnessKeyPrefix()}
                  baseUrl={baseUrl()}
                  platform={platform()}
                />
              </section>

              <p class="welcome__panel-desc">{t('welcome.activate.onceConfigured')}</p>

              <section
                class="welcome__agent-wait"
                classList={{ 'welcome__agent-wait--success': agentRequestSeen() }}
                aria-live="polite"
              >
                <Show
                  when={agentRequestSeen()}
                  fallback={
                    <>
                      <div class="welcome__agent-wait-heading">
                        <span class="welcome__spinner" aria-hidden="true" />
                        <div>
                          <h2 class="welcome__route-test-title">
                            {t('welcome.activate.waitingTitle')}
                          </h2>
                          <p class="welcome__section-desc">{t('welcome.activate.waitingDesc')}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="welcome__text-link"
                        disabled={checkingForRequest()}
                        onClick={() => void checkForFirstAgentRequest()}
                      >
                        {checkingForRequest()
                          ? t('welcome.activate.checking')
                          : t('welcome.activate.checkAgain')}
                      </button>
                      <Show when={requestCheckError()}>
                        <p class="welcome__availability-note" role="status">
                          {t('welcome.activate.checkError')}
                        </p>
                      </Show>
                      <Show when={waitedLong() && !latestAgentRequest()}>
                        <p class="welcome__availability-note" role="status">
                          {t('welcome.activate.waitedLong')}
                        </p>
                      </Show>
                      <Show
                        when={
                          latestAgentRequest() && !isSuccessfulAgentMessage(latestAgentRequest())
                        }
                      >
                        <div class="welcome__request-failure" role="alert">
                          <strong>{t('welcome.activate.failedTitle')}</strong>
                          <p>
                            {latestAgentRequest()?.error_message ||
                              t('welcome.activate.failedStatus', {
                                status: latestAgentRequest()?.status ?? '',
                              })}
                          </p>
                          <Show when={errorDocCode()}>
                            <a
                              class="welcome__text-link"
                              href={thinkerErrorDocsUrl(errorDocCode()!)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t('welcome.activate.whatDoesMean', { code: errorDocCode()! })}
                            </a>
                          </Show>
                        </div>
                      </Show>
                    </>
                  }
                >
                  <div class="welcome__agent-wait-heading" role="status">
                    <span class="welcome__success-icon" aria-hidden="true">
                      ✓
                    </span>
                    <div>
                      <strong>{t('welcome.activate.liveTitle')}</strong>
                      <p class="welcome__section-desc">
                        {t('welcome.activate.liveDesc')}
                        <Show when={latestAgentRequest()?.model}>
                          {' '}
                          {t('welcome.activate.liveTo', {
                            model: latestAgentRequest()?.model ?? '',
                          })}
                        </Show>
                        <Show when={latestAgentRequest()?.duration_ms}>
                          {' '}
                          {t('welcome.activate.liveIn', {
                            ms: latestAgentRequest()?.duration_ms ?? 0,
                          })}
                        </Show>
                        .
                      </p>
                    </div>
                  </div>
                </Show>
              </section>

              <div class="welcome__actions welcome__actions--split">
                <button class="btn btn--ghost" onClick={() => goTo('route')}>
                  {t('welcome.activate.backToRouting')}
                </button>
                <Show when={agentRequestSeen()}>
                  <button class="btn btn--primary" onClick={leaveOnboarding}>
                    {t('welcome.activate.goToDashboard')}
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </Show>
              </div>
            </div>
          </Show>
        </Show>
      </main>

      {/* Playground run-details drawer (right sidebar) — rendered by App in
          the dashboard, by the wizard itself here. */}
      {rightSidebar()}

      {/* Dev-only: the liftoff cinematic, accessible via ?preview=liftoff. In
          production the activate step already says "it works", so a 5.6 s
          animation would be frustrating — route straight to the dashboard. */}
      {import.meta.env.DEV && LiftoffPreview && (
        <Show when={liftoffPreview()}>
          <LiftoffPreview
            latestAgentRequest={latestAgentRequest()}
            harnessSlug={harnessSlug()}
            onLeave={leaveOnboarding}
          />
        </Show>
      )}

      {/* Provider connect modal — root level so the fixed overlay fills the viewport */}
      <Show when={step() === 'providers' && connectTarget() && harnessSlug()}>
        <ProviderSelectModal
          agentName={harnessSlug()}
          providers={providers() ?? []}
          customProviders={customProviders() ?? []}
          providerDeepLink={{
            providerId: connectTarget()!,
            authType: tab() === 'local' ? 'api_key' : tab(),
          }}
          onClose={() => {
            setConnectTarget(null);
          }}
          onUpdate={handleProvidersUpdate}
          onPollProviders={handleProvidersUpdate}
        />
      </Show>

      {/* Model / fallback picker modals for the routing card — same as Routing.tsx */}
      <Show when={harnessSlug()}>
        <RoutingModals
          agentName={harnessSlug}
          dropdownTier={dropdownTier}
          onDropdownClose={() => {
            setDropdownTier(null);
          }}
          fallbackPickerTier={fallbackPickerTier}
          onFallbackPickerClose={() => {
            setFallbackPickerTier(null);
          }}
          showProviderModal={() => false}
          onProviderModalClose={() => {}}
          instructionModal={instructionModal}
          instructionProvider={() => null}
          onInstructionClose={() => {
            setInstructionModal(null);
          }}
          models={() => models() ?? []}
          tiers={() => tiers() ?? []}
          customProviders={() => harnessCustomProviders() ?? []}
          connectedProviders={harnessConnected}
          getTier={actions.getTier}
          onOverride={handleOverride}
          onAddFallback={handleAddFallback}
          onProviderUpdate={refetchRouting}
          onOpenProviderModal={() => setStep('providers')}
        />
      </Show>
    </div>
  );
};

export default Welcome;
/* v8 ignore stop */
