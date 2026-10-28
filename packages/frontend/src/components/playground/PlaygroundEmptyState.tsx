import NoConnectionsPrompt from '../NoConnectionsPrompt.jsx';

interface Props {
  /** Kept for the contract; the prompt now routes to the provider pages itself. */
  onConnect: () => void;
}

export default function PlaygroundEmptyState(_props: Props) {
  return <NoConnectionsPrompt />;
}
