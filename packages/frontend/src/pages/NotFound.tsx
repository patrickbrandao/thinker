import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { t } from '../i18n/index.js';

export default function NotFound() {
  return (
    <>
      <title>{t('common.pageTitle', { page: t('auth.notFound.pageTitle') })}</title>
      <div className="page narrow">
        <div className="empty py-16">
          <span className="font-mono text-5xl font-semibold text-faint">404</span>
          <h1 className="text-ink">{t('auth.notFound.title')}</h1>
          <p className="max-w-md text-sm">{t('auth.notFound.text')}</p>
          <Link to="/" className="btn btn-ghost mt-2">
            <ChevronLeft aria-hidden="true" />
            {t('auth.notFound.back')}
          </Link>
        </div>
      </div>
    </>
  );
}
