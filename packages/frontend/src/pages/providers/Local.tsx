import type { Component } from 'solid-js';
import ProviderConnectionsPage from './ProviderConnectionsPage.jsx';

/** Local providers (Ollama, LM Studio, llama.cpp) running next to this install. */
const LocalProviders: Component = () => <ProviderConnectionsPage kind="local" />;

export default LocalProviders;
