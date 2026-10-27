import type { Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import CodeBlock from '../../components/CodeBlock.jsx';
import { installOrigin } from '../../services/install-endpoints.js';

import { THINKER_DOCS_URL } from '../../services/thinker-links.js';
import RichText from '../../components/RichText.jsx';
import { t } from '../../i18n/index.js';

/** Installed from a checkout of the Thinker repository; it is not published to a registry. */
const INSTALL = `git clone https://github.com/patrickbrandao/thinker.git\ncd thinker && npm ci && npm run build --workspace=packages/shared --workspace=packages/cli\nnpm install -g ./packages/cli`;

/**
 * The CLI has to be told which host to talk to, and this dashboard is the only
 * place that knows it.
 */
export function loginCommand(origin: string): string {
  return `thinker login --url ${origin}`;
}

const EXAMPLE = `thinker agent create --name coding-assistant --platform openclaw
thinker provider connect xai --auth-type api_key --credential-env XAI_API_KEY
thinker agent configure coding-assistant --models grok-4.5,grok-4 --provider xai
thinker routing test coding-assistant`;

const Cli: Component = () => {
  const login = () => loginCommand(installOrigin());

  return (
    <div class="container--lg">
      <Title>{t('common.pageTitle', { page: 'CLI' })}</Title>
      <Meta name="description" content={t('harnesses.cli.metaDescription')} />
      <div class="page-header">
        <div>
          <h1 class="page-header__title">CLI</h1>
          <p class="page-header__subtitle">{t('harnesses.cli.subtitle')}</p>
        </div>
      </div>

      <div class="integration-grid">
        <div class="panel">
          <div class="panel__title">{t('harnesses.cli.installTitle')}</div>
          <p class="integration-panel__desc">
            <RichText
              text={t('harnesses.cli.installDesc')}
              parts={{ command: <code>thinker</code> }}
            />
          </p>
          <CodeBlock code={INSTALL} language="bash" />
        </div>

        <div class="panel">
          <div class="panel__title">{t('harnesses.cli.signInTitle')}</div>
          <p class="integration-panel__desc">{t('harnesses.cli.signInDesc')}</p>
          <CodeBlock code={login()} language="bash" />
        </div>
      </div>

      <div class="panel" style="margin-top: var(--gap-lg);">
        <div class="integration-panel__header">
          <div class="panel__title">{t('harnesses.cli.driveTitle')}</div>
          <a
            href={THINKER_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn--outline btn--sm"
            style="text-decoration: none;"
          >
            {t('harnesses.cli.documentation')}
          </a>
        </div>
        <p class="integration-panel__desc">{t('harnesses.cli.driveDesc')}</p>
        <CodeBlock code={EXAMPLE} language="bash" />
      </div>
    </div>
  );
};

export default Cli;
