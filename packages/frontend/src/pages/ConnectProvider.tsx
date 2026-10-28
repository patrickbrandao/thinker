import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { getAgents, createAgent } from '../services/api.js';
import { markAgentCreated } from '../services/recent-agents.js';
import { t } from '../i18n/index.js';
import { useResource } from '../lib/use-resource.js';
import { Button } from '../components/ui.js';

interface Agent {
  agent_name: string;
  display_name?: string;
}

interface AgentsData {
  agents: Agent[];
}

export default function ConnectProvider() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const buildTarget = (agentName: string) => {
    const qp = new URLSearchParams();
    const provider = searchParams.get('provider') || 'custom';
    qp.set('provider', provider);
    const name = searchParams.get('name');
    const baseUrl = searchParams.get('baseUrl');
    const apiKey = searchParams.get('apiKey');
    const models = searchParams.get('models');
    if (name) qp.set('name', name);
    if (baseUrl) qp.set('baseUrl', baseUrl);
    if (apiKey) qp.set('apiKey', apiKey);
    if (models) qp.set('models', models);
    return `/harnesses/${encodeURIComponent(agentName)}/routing?${qp.toString()}`;
  };

  // StrictMode runs the mount effect twice in development; create one harness only.
  const createStarted = useRef(false);

  const autoCreate = async () => {
    if (createStarted.current) return;
    createStarted.current = true;
    setCreating(true);
    try {
      const result = await createAgent({ name: 'my-agent' });
      const slug = result?.agent?.name ?? 'my-agent';
      markAgentCreated(slug);
      navigate(buildTarget(slug), { replace: true });
    } catch {
      setCreating(false);
    }
  };

  const data = useResource(async () => {
    const result = (await getAgents()) as AgentsData;
    const agents = result?.agents ?? [];

    if (agents.length === 1 && agents[0]) {
      navigate(buildTarget(agents[0].agent_name), { replace: true });
    } else if (agents.length === 0) {
      await autoCreate();
    }

    return agents;
  }, []);

  const pickAgent = (agentName: string) => {
    navigate(buildTarget(agentName), { replace: true });
  };

  const count = data.data?.length ?? 0;

  return (
    <div className="page narrow pt-20">
      {!data.loading && count > 1 ? (
        <div className="panel mx-auto max-w-[440px] p-8">
          <h2 className="mb-2 text-lg font-semibold text-ink">
            {t('providers.connectPage.selectHarness')}
          </h2>
          <p className="mb-6 text-sm text-muted">{t('providers.connectPage.question')}</p>
          <div className="flex flex-col gap-2">
            {data.data!.map((agent) => (
              <Button
                key={agent.agent_name}
                variant="ghost"
                className="justify-start text-left"
                onClick={() => pickAgent(agent.agent_name)}
              >
                {agent.display_name ?? agent.agent_name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {data.loading || creating || count <= 1 ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <span
            className="spinner size-6"
            role="status"
            aria-label={t('providers.connectPage.loading')}
          />
        </div>
      ) : null}
    </div>
  );
}
