import { AuthHeader } from '../components/auth-ui.jsx';
import { t } from '../i18n/index.js';

export default function OauthError() {
  return (
    <>
      <title>{t('common.pageTitle', { page: t('auth.oauthError.pageTitle') })}</title>
      <AuthHeader title={t('auth.oauthError.title')} subtitle={t('auth.oauthError.body')} />
      <p className="form-error font-mono" role="alert">
        invalid_redirect_uri
      </p>
    </>
  );
}
