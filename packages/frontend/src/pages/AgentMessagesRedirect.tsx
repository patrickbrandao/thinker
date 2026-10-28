import { Navigate, useLocation, useParams } from 'react-router';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Redirects /harnesses/:agentName/messages → /messages?agent=<name> so the
 * global message log opens pre-filtered to the harness the user came from
 * (e.g. via a Recent Requests "View more" link). Extra query params (like the
 * `?request=` drawer deep-link) are carried through.
 */
export default function AgentMessagesRedirect() {
  const params = useParams<{ agentName: string }>();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  search.set('agent', safeDecode(params.agentName ?? ''));
  return <Navigate to={`/messages?${search.toString()}`} replace />;
}
