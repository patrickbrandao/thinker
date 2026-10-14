import type { Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import CodeBlock from '../../components/CodeBlock.jsx';
import { installOrigin } from '../../services/install-endpoints.js';

import { THINKER_DOCS_URL } from '../../services/thinker-links.js';

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
      <Title>CLI - Thinker</Title>
      <Meta
        name="description"
        content="Install the thinker CLI and manage harnesses, providers, routing and request logs from the terminal."
      />
      <div class="page-header">
        <div>
          <h1 class="page-header__title">CLI</h1>
          <p class="page-header__subtitle">
            Everything the dashboard does, from a terminal, a script, or a coding agent
          </p>
        </div>
      </div>

      <div class="integration-grid">
        <div class="panel">
          <div class="panel__title">1. Install</div>
          <p class="integration-panel__desc">
            The CLI ships in the Thinker repository. Install it from a checkout of the release that
            matches this instance; the command is <code>thinker</code>.
          </p>
          <CodeBlock code={INSTALL} language="bash" />
        </div>

        <div class="panel">
          <div class="panel__title">2. Sign in</div>
          <p class="integration-panel__desc">
            This opens your browser, you approve, and the CLI stores a token for this host. The
            token never travels through the URL.
          </p>
          <CodeBlock code={login()} language="bash" />
        </div>
      </div>

      <div class="panel" style="margin-top: var(--gap-lg);">
        <div class="integration-panel__header">
          <div class="panel__title">3. Drive it</div>
          <a
            href={THINKER_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn--outline btn--sm"
            style="text-decoration: none;"
          >
            Documentation
          </a>
        </div>
        <p class="integration-panel__desc">
          Create a harness, connect a provider, set a route, and prove it works with one real
          request.
        </p>
        <CodeBlock code={EXAMPLE} language="bash" />
      </div>
    </div>
  );
};

export default Cli;
