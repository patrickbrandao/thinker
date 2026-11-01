import ProviderConnectionsPage from './ProviderConnectionsPage.jsx';

/** Local server types: pick one by card or list to add a server of it. */
export default function LocalAdd() {
  return <ProviderConnectionsPage kind="local" view="catalog" />;
}
