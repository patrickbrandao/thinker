import { useRef, useState } from 'react';
import { getModelListing, updateModelListing, type ModelListingMode } from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { Panel } from '../components/ui.js';
import Select from '../components/Select.js';
import SettingsRow from './SettingsRow.js';
import { t } from '../i18n/index.js';

const MODES: ModelListingMode[] = ['closed', 'restricted', 'open'];

export default function SettingsModelListingSection({ agentName }: { agentName: string }) {
  const config = useResource(() => getModelListing(agentName), [agentName]);
  const [saving, setSaving] = useState(false);
  const currentAgent = useRef(agentName);
  currentAgent.current = agentName;

  const ready = !config.loading && !config.error;
  const mode: ModelListingMode = ready ? (config.data?.mode ?? 'open') : 'open';
  const busy = saving || !ready;

  const change = async (next: ModelListingMode) => {
    if (busy || next === mode) return;
    const target = agentName;
    setSaving(true);
    try {
      const saved = await updateModelListing(target, next);
      if (currentAgent.current === target) {
        config.setData(saved);
        toast.success(t('harnesses.modelListing.savedToast'));
      }
    } catch {
      // fetchMutate already shows the backend error.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title={t('harnesses.modelListing.title')}>
      <SettingsRow
        title={t('harnesses.modelListing.label')}
        description={t(`harnesses.modelListing.${mode}Desc`)}
      >
        <div className="w-full sm:w-44">
          <Select
            label={t('harnesses.modelListing.label')}
            value={mode}
            disabled={busy}
            options={MODES.map((value) => ({
              value,
              label: t(`harnesses.modelListing.${value}`),
            }))}
            onChange={(value) => void change(value as ModelListingMode)}
          />
        </div>
      </SettingsRow>
    </Panel>
  );
}
