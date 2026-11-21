import { useParams } from 'react-router';
import AgentKeysPanel from '../components/AgentKeysPanel.js';
import { agentDisplayName } from '../services/agent-display-name.js';
import { t } from '../i18n/index.js';

/** API Keys tab of a harness: one table with every key (the primary one always first). */
export default function AgentApiKeys() {
  const params = useParams<{ agentName: string }>();
  const agentName = decodeURIComponent(params.agentName ?? '');
  const name = agentDisplayName() ?? agentName;

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <title>{t('common.pageTitle', { page: t('harnesses.keys.pageTitle', { name }) })}</title>
      <AgentKeysPanel agentName={agentName} />
    </div>
  );
}
