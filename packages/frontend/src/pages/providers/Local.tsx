import ProviderConnectionsPage from './ProviderConnectionsPage.jsx';

/** Local providers (Ollama, LM Studio, llama.cpp) running next to this install. */
export default function LocalProviders() {
  return <ProviderConnectionsPage kind="local" view="connections" />;
}
