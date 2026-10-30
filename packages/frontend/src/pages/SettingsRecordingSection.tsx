import { useRef, useState } from 'react';
import { getRecording, updateRecording } from '../services/api.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { Panel, Switch } from '../components/ui.js';
import SettingsRow from './SettingsRow.js';
import LogRetentionSelect from '../components/LogRetentionSelect.js';
import { t } from '../i18n/index.js';

export default function SettingsRecordingSection({ agentName }: { agentName: string }) {
  const config = useResource(() => getRecording(agentName), [agentName]);
  const [saving, setSaving] = useState(false);
  // The agent shown now, so a save that lands after a harness switch is dropped.
  const currentAgent = useRef(agentName);
  currentAgent.current = agentName;

  const ready = !config.loading && !config.error;
  const enabled = ready ? (config.data?.enabled ?? false) : false;
  const busy = saving || !ready;

  const toggle = async () => {
    if (busy) return;
    const target = agentName;
    setSaving(true);
    try {
      const next = await updateRecording(target, { enabled: !enabled });
      if (currentAgent.current === target) {
        config.setData(next);
        toast.success(
          next.enabled
            ? t('harnesses.recording.enabledToast')
            : t('harnesses.recording.disabledToast'),
        );
      }
    } catch {
      // fetchMutate already shows the backend error.
    } finally {
      setSaving(false);
    }
  };

  const changeRetention = async (days: number | null) => {
    if (busy) return;
    const target = agentName;
    setSaving(true);
    try {
      const next = await updateRecording(target, { retention_days: days });
      if (currentAgent.current === target) {
        config.setData(next);
        toast.success(t('harnesses.retention.savedToast'));
      }
    } catch {
      // fetchMutate already shows the backend error.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title={t('harnesses.recording.title')}>
      <SettingsRow
        title={t('harnesses.recording.enable')}
        description={t('harnesses.recording.desc')}
      >
        <Switch
          checked={enabled}
          onChange={() => void toggle()}
          label={t('harnesses.recording.enable')}
          disabled={busy}
        />
      </SettingsRow>
      <SettingsRow
        title={t('harnesses.retention.label')}
        description={t('harnesses.retention.hint')}
      >
        <div className="w-[260px] max-w-full">
          <LogRetentionSelect
            value={ready ? (config.data?.retention_days ?? null) : null}
            globalDays={ready ? (config.data?.global_retention_days ?? null) : null}
            onChange={(days) => void changeRetention(days)}
            disabled={busy}
            idPrefix="settings-retention"
          />
        </div>
      </SettingsRow>
    </Panel>
  );
}
