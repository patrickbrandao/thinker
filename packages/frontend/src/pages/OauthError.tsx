import { Title } from '@solidjs/meta';
import type { Component } from 'solid-js';
import { t } from '../i18n/index.js';

const OauthError: Component = () => (
  <>
    <Title>{t('common.pageTitle', { page: t('auth.oauthError.pageTitle') })}</Title>
    <div class="auth-header">
      <h1 class="auth-header__title">{t('auth.oauthError.title')}</h1>
      <p class="auth-header__subtitle">{t('auth.oauthError.body')}</p>
    </div>
    <p class="auth-form__error" role="alert">
      invalid_redirect_uri
    </p>
  </>
);

export default OauthError;
