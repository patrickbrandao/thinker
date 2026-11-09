import { t } from '../i18n/index.js';

/** Warns that a route's model left its connection's discovered list (see routeNotInCatalog). */
export default function NotInCatalogBadge() {
  return (
    <span
      className="routing-card__not-in-catalog badge is-warn"
      title={t('routing.notInCatalogTitle')}
      aria-label={`${t('routing.notInCatalog')}: ${t('routing.notInCatalogTitle')}`}
    >
      {t('routing.notInCatalog')}
    </span>
  );
}
