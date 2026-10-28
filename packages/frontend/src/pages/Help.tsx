import { ExternalLink } from 'lucide-react';
import { THINKER_DOCS_URL, THINKER_ISSUES_URL } from '../services/thinker-links.js';
import { t } from '../i18n/index.js';

function HelpRow({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{title}</div>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-ghost btn-sm no-underline"
      >
        {action}
        <ExternalLink aria-hidden="true" />
      </a>
    </div>
  );
}

export default function Help() {
  return (
    <div className="page narrow">
      <title>{t('common.pageTitle', { page: t('harnesses.help.title') })}</title>
      <meta name="description" content={t('harnesses.help.metaDescription')} />
      <div className="page-head">
        <div>
          <h1>{t('harnesses.help.title')}</h1>
          <p className="sub">{t('harnesses.help.subtitle')}</p>
        </div>
      </div>

      <section className="panel">
        <HelpRow
          title={t('harnesses.help.docsTitle')}
          description={t('harnesses.help.docsDesc')}
          href={THINKER_DOCS_URL}
          action={t('harnesses.help.openDocs')}
        />
        <HelpRow
          title={t('harnesses.help.issuesTitle')}
          description={t('harnesses.help.issuesDesc')}
          href={THINKER_ISSUES_URL}
          action={t('harnesses.help.openIssues')}
        />
      </section>
    </div>
  );
}
