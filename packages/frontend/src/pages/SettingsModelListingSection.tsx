import { createResource, createSignal, For, type Component } from 'solid-js';
import { getModelListing, updateModelListing, type ModelListingMode } from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';

const MODES: ModelListingMode[] = ['closed', 'restricted', 'open'];

const SettingsModelListingSection: Component<{ agentName: () => string }> = (props) => {
  const [config, { mutate }] = createResource(() => props.agentName(), getModelListing);
  const [saving, setSaving] = createSignal(false);

  const mode = (): ModelListingMode =>
    !config.loading && !config.error ? (config()?.mode ?? 'open') : 'open';
  const busy = () => saving() || config.loading || Boolean(config.error);

  const change = async (next: ModelListingMode) => {
    if (busy() || next === mode()) return;
    const agentName = props.agentName();
    setSaving(true);
    try {
      const saved = await updateModelListing(agentName, next);
      if (props.agentName() === agentName) {
        mutate(saved);
        toast.success(t('harnesses.modelListing.savedToast'));
      }
    } catch {
      // fetchMutate already shows the backend error.
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2 class="settings-section__title">{t('harnesses.modelListing.title')}</h2>
      <div class="settings-card">
        <div class="settings-card__row">
          <div class="settings-card__label">
            <span class="settings-card__label-title">{t('harnesses.modelListing.label')}</span>
            <span class="settings-card__label-desc">
              {t(`harnesses.modelListing.${mode()}Desc`)}
            </span>
          </div>
          <div class="settings-card__control settings-card__control--end">
            <select
              class="select"
              aria-label={t('harnesses.modelListing.label')}
              value={mode()}
              disabled={busy()}
              onChange={(e) => void change(e.currentTarget.value as ModelListingMode)}
            >
              <For each={MODES}>
                {(value) => <option value={value}>{t(`harnesses.modelListing.${value}`)}</option>}
              </For>
            </select>
          </div>
        </div>
      </div>
    </>
  );
};

export default SettingsModelListingSection;
