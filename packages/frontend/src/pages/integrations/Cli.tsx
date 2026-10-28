import { ExternalLink } from 'lucide-react';
import CodeBlock from '../../components/CodeBlock.js';
import RichText from '../../components/RichText.js';
import { Panel } from '../../components/ui.js';
import { installOrigin } from '../../services/install-endpoints.js';
import { THINKER_DOCS_URL } from '../../services/thinker-links.js';
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

export default function Cli() {
  const login = loginCommand(installOrigin());

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: 'CLI' })}</title>
      <meta name="description" content={t('harnesses.cli.metaDescription')} />

      <div className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t('harnesses.cli.installTitle')}>
            <p className="mb-3 text-sm text-dim">
              <RichText
                text={t('harnesses.cli.installDesc')}
                parts={{ command: <code className="font-mono">thinker</code> }}
              />
            </p>
            <CodeBlock code={INSTALL} language="bash" />
          </Panel>

          <Panel title={t('harnesses.cli.signInTitle')}>
            <p className="mb-3 text-sm text-dim">{t('harnesses.cli.signInDesc')}</p>
            <CodeBlock code={login} language="bash" />
          </Panel>
        </div>

        <Panel
          title={t('harnesses.cli.driveTitle')}
          actions={
            <a
              href={THINKER_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              {t('harnesses.cli.documentation')}
              <ExternalLink aria-hidden="true" />
            </a>
          }
        >
          <p className="mb-3 text-sm text-dim">{t('harnesses.cli.driveDesc')}</p>
          <CodeBlock code={EXAMPLE} language="bash" />
        </Panel>
      </div>
    </div>
  );
}
