import { createContext, useContext, useState, type ReactNode } from 'react';
import type { AuthType } from 'thinker-shared';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

/**
 * Two-step "add provider" flow inside the floating window: part 1 picks the
 * provider's internal type when it has variants (OpenCode Zen/free,
 * OpenCode Console/Go, MiniMax login/token, Vertex express/project), part 2
 * is the connection form. Providers without variants open on part 2.
 */

/** Values part 1 fixes for the part 2 form. */
export interface ProviderWizardPreset {
  /** Starting API key ('' for a paid key, the free key for OpenCode free). */
  apiKey?: string;
  /** API-key region/mode fixed by the variant (Vertex `express`/`project`). */
  endpointRegion?: string;
  /** Subscription channel fixed by the variant (MiniMax login vs pasted token). */
  subscriptionMethod?: 'login' | 'token';
}

interface WizardContextValue {
  preset: ProviderWizardPreset;
  /** Back to part 1; undefined when the provider has no variants. */
  onBack?: () => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

/** The wizard's preset and back action, or null outside the wizard. */
export function useProviderWizard(): WizardContextValue | null {
  return useContext(WizardContext);
}

export interface ProviderVariant {
  key: string;
  label: string;
  hint: string;
  /** Provider the connection is created for (OpenCode Go is its own id). */
  providerId: string;
  preset?: ProviderWizardPreset;
}

/** Variants of a catalog card on a page; null when it has none. */
export function providerVariants(providerId: string, authType: AuthType): ProviderVariant[] | null {
  const v = (key: string, providerId: string, preset?: ProviderWizardPreset): ProviderVariant => ({
    key,
    label: t(
      `providerSetup.wizard.variant.${key}.label` as 'providerSetup.wizard.variant.zen.label',
    ),
    hint: t(`providerSetup.wizard.variant.${key}.hint` as 'providerSetup.wizard.variant.zen.hint'),
    providerId,
    preset,
  });
  if (authType === 'api_key' && providerId === 'opencode') {
    return [v('zen', 'opencode', { apiKey: '' }), v('free', 'opencode', { apiKey: 'public' })];
  }
  if (authType === 'subscription' && providerId === 'opencode') {
    return [v('console', 'opencode'), v('go', 'opencode-go')];
  }
  if (authType === 'subscription' && providerId === 'minimax') {
    return [
      v('minimaxLogin', 'minimax', { subscriptionMethod: 'login' }),
      v('minimaxToken', 'minimax', { subscriptionMethod: 'token' }),
    ];
  }
  if (authType === 'api_key' && providerId === 'vertex') {
    return [
      v('vertexExpress', 'vertex', { endpointRegion: 'express' }),
      v('vertexProject', 'vertex', { endpointRegion: 'project' }),
    ];
  }
  return null;
}

function Steps({ step }: { step: 1 | 2 }) {
  const dot = (n: 1 | 2, label: string) => (
    <span className="flex items-center gap-1.5">
      <span
        className={cx(
          'inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
          step === n ? 'bg-accent text-on-accent' : 'bg-s3 text-muted',
        )}
        aria-current={step === n ? 'step' : undefined}
      >
        {n}
      </span>
      <span className={cx('text-xs', step === n ? 'text-ink' : 'text-muted')}>{label}</span>
    </span>
  );
  return (
    <ol
      className="m-0 mb-4 flex list-none items-center gap-2 p-0"
      aria-label={t('providerSetup.wizard.steps')}
    >
      <li>{dot(1, t('providerSetup.wizard.stepType'))}</li>
      <li aria-hidden="true" className="h-px w-8 bg-line" />
      <li>{dot(2, t('providerSetup.wizard.stepParams'))}</li>
    </ol>
  );
}

/**
 * Wraps the connection form. `render` draws part 2 for the chosen provider
 * id; part 1 only appears when {@link providerVariants} has variants.
 */
export function ProviderWizard({
  providerId,
  authType,
  render,
}: {
  providerId: string;
  authType: AuthType;
  render: (providerId: string) => ReactNode;
}) {
  const variants = providerVariants(providerId, authType);
  const [chosen, setChosen] = useState<ProviderVariant | null>(null);
  const [pick, setPick] = useState<string>(variants?.[0]?.key ?? '');

  if (!variants) {
    return (
      <WizardContext.Provider value={{ preset: {} }}>{render(providerId)}</WizardContext.Provider>
    );
  }

  if (!chosen) {
    const selected = variants.find((x) => x.key === pick) ?? variants[0]!;
    return (
      <div>
        <Steps step={1} />
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="label mb-1">{t('providerSetup.wizard.chooseType')}</legend>
          {variants.map((x) => (
            <label
              key={x.key}
              className={cx(
                'flex cursor-pointer flex-col gap-0.5 rounded-control border px-3 py-2',
                pick === x.key ? 'border-accent bg-accent-tint' : 'border-line bg-elev',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="radio"
                  name="provider-wizard-variant"
                  value={x.key}
                  checked={pick === x.key}
                  onChange={() => setPick(x.key)}
                  className="accent-[var(--accent)]"
                />
                {x.label}
              </span>
              <span className="pl-6 text-xs text-muted">{x.hint}</span>
            </label>
          ))}
        </fieldset>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn btn-sm" onClick={() => setChosen(selected)}>
            {t('providerSetup.wizard.next')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <WizardContext.Provider value={{ preset: chosen.preset ?? {}, onBack: () => setChosen(null) }}>
      <Steps step={2} />
      <p className="m-0 mb-3 flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">
          {t('providerSetup.wizard.typeChosen')} <span className="text-ink">{chosen.label}</span>
        </span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setChosen(null)}>
          {t('providerSetup.wizard.back')}
        </button>
      </p>
      <div key={chosen.key}>{render(chosen.providerId)}</div>
    </WizardContext.Provider>
  );
}
