import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, Panel, Switch } from '../components/ui.js';
import SettingsRow from './SettingsRow.js';
import {
  getIpRestriction,
  ipPrefixListPath,
  listIpPrefixLists,
  updateIpRestriction,
  type IpRestriction,
} from '../services/api/ip-prefix-lists.js';
import { roleCan } from '../services/session-store.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * Source IP restriction of a harness (Settings tab): when on, its keys are
 * accepted only from addresses in the picked IP prefix lists. Admins and
 * owners only; hidden for other roles (the backend enforces it too).
 */
export default function SettingsIpRestrictionSection({ agentName }: { agentName: string }) {
  if (!roleCan.manageProviders()) return null;
  return <Section agentName={agentName} />;
}

function Section({ agentName }: { agentName: string }) {
  const config = useResource(() => getIpRestriction(agentName), [agentName]);
  const lists = useResource(listIpPrefixLists, []);
  const [draft, setDraft] = useState<IpRestriction>({ enabled: false, listIds: [] });
  const [saving, setSaving] = useState(false);
  const currentAgent = useRef(agentName);
  currentAgent.current = agentName;

  useEffect(() => {
    if (config.data) setDraft(config.data);
  }, [config.data]);

  const ready = !config.loading && !config.error && !!config.data;
  const saved = config.data ?? { enabled: false, listIds: [] };
  const dirty = draft.enabled !== saved.enabled || !sameIds(draft.listIds, saved.listIds);
  const needList = draft.enabled && draft.listIds.length === 0;
  const available = lists.data?.lists ?? [];

  const toggleList = (id: string, on: boolean) =>
    setDraft((d) => ({
      ...d,
      listIds: on ? [...d.listIds, id] : d.listIds.filter((x) => x !== id),
    }));

  const save = async () => {
    if (!dirty || needList) return;
    const target = agentName;
    setSaving(true);
    try {
      const next = await updateIpRestriction(target, draft);
      if (currentAgent.current === target) {
        config.setData(next);
        toast.success(t('ipLists.restriction.saved'));
      }
    } catch {
      // fetchMutate already shows the backend error.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title={t('ipLists.restriction.title')} bodyClassName="flex flex-col gap-4">
      <SettingsRow
        title={t('ipLists.restriction.toggle')}
        description={t('ipLists.restriction.help')}
      >
        <Switch
          checked={draft.enabled}
          onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
          label={t('ipLists.restriction.toggle')}
          disabled={!ready || saving}
        />
      </SettingsRow>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={!ready || saving}>
        <legend className="label">{t('ipLists.restriction.lists')}</legend>
        {lists.loading && !lists.data ? (
          <p className="m-0 text-sm text-muted">{t('common.loading')}</p>
        ) : available.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t('ipLists.restriction.noLists')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {available.map((list) => (
              <li key={list.id} className="flex items-center gap-2 text-sm">
                <input
                  id={`ip-list-${list.id}`}
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={draft.listIds.includes(list.id)}
                  onChange={(e) => toggleList(list.id, e.currentTarget.checked)}
                />
                <label htmlFor={`ip-list-${list.id}`} className="text-ink">
                  {list.name}
                </label>
                <Link to={ipPrefixListPath(list.id)} className="text-xs text-muted hover:underline">
                  {t('ipLists.form.entriesCount', { count: list.entries.length })}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link to="/ip-prefix-lists" className="w-fit text-xs text-muted hover:text-ink">
          {t('ipLists.restriction.manage')}
        </Link>
      </fieldset>

      {needList ? (
        <p className="m-0 text-[13px] text-warn" role="alert">
          {t('ipLists.restriction.needList')}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void save()} disabled={!dirty || needList} busy={saving}>
          {t('common.save')}
        </Button>
      </div>
    </Panel>
  );
}
