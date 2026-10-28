import { Navigate, useParams } from 'react-router';
import { agentPath } from '../services/routing.js';

/**
 * Redirects /harnesses/:agentName/limits → /harnesses/:agentName/guardrails.
 * Keeps backward-compat for any bookmarks or links using the old path.
 */
export default function AgentLimitsRedirect() {
  const params = useParams<{ agentName: string }>();
  return <Navigate to={agentPath(params.agentName ?? null, '/guardrails')} replace />;
}
