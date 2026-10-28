import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router';
import ErrorState from './ErrorState.jsx';
import NotFound from '../pages/NotFound.jsx';
import { getAgents } from '../services/api.js';
import { setAgentDisplayName } from '../services/agent-display-name.js';
import { setAgentPlatform } from '../services/agent-platform-store.js';
import { isRecentlyCreated, clearRecentAgent } from '../services/recent-agents.js';
import { useResource } from '../lib/use-resource.js';

interface Agent {
  agent_name: string;
  display_name?: string;
  agent_category?: string | null;
  agent_platform?: string | null;
}

interface AgentsData {
  agents: Agent[];
}

/**
 * Guards `/harnesses/:agentName/*`: 404 for an unknown harness, and keeps the
 * harness name and platform stores (topbar trail) in step with the URL. The
 * list is refetched when the harness in the URL changes, so a harness created
 * while another one is open is found.
 */
export default function AgentGuard() {
  const { agentName = '' } = useParams<{ agentName: string }>();
  const decoded = decodeURIComponent(agentName);
  const data = useResource(() => getAgents() as Promise<AgentsData>, [agentName]);
  const list = data.data?.agents;
  const agent = list?.find((a) => a.agent_name === decoded);

  useEffect(() => {
    if (!list) return; // still loading: leave the stores untouched
    if (agent) {
      clearRecentAgent(agent.agent_name);
      setAgentDisplayName(agent.display_name ?? agent.agent_name);
      setAgentPlatform(agent.agent_platform ?? null, agent.agent_category ?? null);
    } else {
      setAgentDisplayName(null);
      setAgentPlatform(null, null);
    }
  }, [list, agent]);

  useEffect(
    () => () => {
      setAgentDisplayName(null);
      setAgentPlatform(null, null);
    },
    [],
  );

  // Only blank on the very first load; keep children mounted during a refetch.
  if (data.data === undefined && data.loading) return null;
  if (data.error && !list)
    return <ErrorState error={data.error} onRetry={() => void data.reload()} />;
  if (!list) return null;
  if (!agent && !isRecentlyCreated(decoded)) return <NotFound />;
  return <Outlet />;
}
