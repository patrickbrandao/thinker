import { KeyRound, Server, User } from 'lucide-react';
import type { AuthType, ModelRoute, RoutingProvider } from '../services/api.js';
import { t } from '../i18n/index.js';

/** Billing type icon, as on the model picker tabs. */
export function AuthIcon({ authType }: { authType: AuthType }) {
  const Icon = authType === 'subscription' ? User : authType === 'local' ? Server : KeyRound;
  return <Icon aria-hidden="true" className="size-3 shrink-0 text-muted" />;
}

/** The account a route runs on: its pinned key, the only one there is, or any by priority. */
export function routeAccountLabel(route: ModelRoute, connected: RoutingProvider[]): string {
  if (route.keyLabel) return route.keyLabel;
  const keys = connected.filter(
    (c) =>
      c.is_active &&
      c.auth_type === route.authType &&
      c.provider.toLowerCase() === route.provider.toLowerCase(),
  );
  if (keys.length === 1) return keys[0]!.label;
  return t('routing.manager.autoKey');
}
