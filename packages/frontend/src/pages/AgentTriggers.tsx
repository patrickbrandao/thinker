import { useParams } from 'react-router';
import HarnessTriggersPanel from '../components/triggers/HarnessTriggersPanel.js';
import { roleCan } from '../services/session-store.js';
import { useResource } from '../lib/use-resource.js';
import { getHarnessTriggers, listTriggers } from '../services/api/triggers.js';
import { agentDisplayName } from '../services/agent-display-name.js';
import { t } from '../i18n/index.js';

/** Triggers tab of a harness: the workspace triggers that receive its events. */
export default function AgentTriggers() {
  const params = useParams<{ agentName: string }>();
  const agentName = decodeURIComponent(params.agentName ?? '');
  const triggers = useResource(() => listTriggers(), []);
  const bindings = useResource(() => getHarnessTriggers(agentName), [agentName]);
  const name = agentDisplayName() ?? agentName;

  return (
    <div>
      <title>{t('common.pageTitle', { page: `${name} ${t('triggers.title')}` })}</title>
      <HarnessTriggersPanel
        agentName={agentName}
        triggers={triggers.data}
        bindings={bindings.data}
        loading={triggers.loading || bindings.loading}
        canEdit={roleCan.editHarnesses()}
        onSaved={(saved) => bindings.setData(saved)}
      />
    </div>
  );
}
