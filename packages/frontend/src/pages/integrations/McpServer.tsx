import { createMemo, createResource, createSignal, For, Show, type Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import { PLATFORM_ICONS } from 'thinker-shared';
import CodeBlock from '../../components/CodeBlock.jsx';
import { mcpEndpoint } from '../../services/install-endpoints.js';
import { checkMcpEnabled } from '../../services/setup-status.js';

import { THINKER_DOCS_URL } from '../../services/thinker-links.js';
import RichText from '../../components/RichText.jsx';
import { t } from '../../i18n/index.js';

interface ClientSetup {
  id: string;
  label: string;
  icon?: string;
  language: string;
  code: string;
}

/**
 * One client, one snippet: data, so the page stays a tab list rather than a
 * wall. Typed non-empty so the active-tab fallback to [0] is always defined.
 */
export function clientSetups(endpoint: string): [ClientSetup, ...ClientSetup[]] {
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      icon: PLATFORM_ICONS['claude-code'],
      language: 'bash',
      code: `claude mcp add --transport http thinker ${endpoint}`,
    },
    {
      id: 'codex',
      label: 'Codex',
      icon: PLATFORM_ICONS.codex,
      language: 'bash',
      code: `codex mcp add thinker --url ${endpoint}\ncodex mcp login thinker`,
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      icon: PLATFORM_ICONS.opencode,
      language: 'json',
      code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "thinker": {
      "type": "remote",
      "url": "${endpoint}",
      "enabled": true
    }
  }
}`,
    },
    {
      id: 'other',
      label: 'Other',
      icon: PLATFORM_ICONS.other,
      language: 'json',
      code: `{
  "mcpServers": {
    "thinker": {
      "url": "${endpoint}"
    }
  }
}`,
    },
  ];
}

const McpServer: Component = () => {
  const endpoint = createMemo(() => mcpEndpoint());
  const clients = createMemo(() => clientSetups(endpoint()));
  const [activeId, setActiveId] = createSignal('claude-code');
  const active = createMemo(() => clients().find((c) => c.id === activeId()) ?? clients()[0]);
  // The nav entry is already hidden when MCP is off, but a bookmark still lands
  // here. Say why rather than handing out an endpoint that answers 404 — and
  // show neither panel until the answer is in, so a disabled install never
  // flashes the endpoint first.
  const [enabled] = createResource(checkMcpEnabled);

  return (
    <div class="container--lg">
      <Title>{t('common.pageTitle', { page: t('harnesses.mcp.title') })}</Title>
      <Meta name="description" content={t('harnesses.mcp.metaDescription')} />
      <div class="page-header">
        <div>
          <h1 class="page-header__title">{t('harnesses.mcp.title')}</h1>
          <p class="page-header__subtitle">{t('harnesses.mcp.subtitle')}</p>
        </div>
      </div>

      <Show when={enabled() === false}>
        <div class="panel">
          <div class="panel__title">{t('harnesses.mcp.unavailableTitle')}</div>
          <p class="integration-panel__desc" style="margin-bottom: 0;">
            <RichText
              text={t('harnesses.mcp.unavailableDesc')}
              parts={{
                authUrl: <code>BETTER_AUTH_URL</code>,
                flag: <code>MCP_ENABLED=false</code>,
              }}
            />
          </p>
        </div>
      </Show>

      <Show when={enabled() === true}>
        <div class="panel">
          <div class="panel__title">{t('harnesses.mcp.endpointTitle')}</div>
          <p class="integration-panel__desc">{t('harnesses.mcp.endpointDesc')}</p>
          <CodeBlock code={endpoint()} language="bash" />
        </div>

        <div class="panel">
          <div class="panel__title">{t('harnesses.mcp.connectTitle')}</div>
          <div class="integration-panel__tabs">
            <div class="panel__tabs" role="tablist" aria-label={t('harnesses.mcp.clientTabs')}>
              <For each={clients()}>
                {(client) => (
                  <button
                    type="button"
                    class="panel__tab"
                    classList={{ 'panel__tab--active': activeId() === client.id }}
                    role="tab"
                    aria-selected={activeId() === client.id}
                    onClick={() => setActiveId(client.id)}
                  >
                    <Show when={client.icon}>
                      <img
                        class="panel__tab-icon"
                        src={client.icon}
                        alt=""
                        width="16"
                        height="16"
                      />
                    </Show>
                    {client.id === 'other' ? t('harnesses.platformOther') : client.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          <CodeBlock code={active().code} language={active().language} />
        </div>

        <div class="panel">
          <div class="integration-panel__header">
            <div class="panel__title">{t('harnesses.mcp.modeTitle')}</div>
            <a
              href={THINKER_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn--outline btn--sm"
              style="text-decoration: none;"
            >
              {t('harnesses.mcp.toolList')}
            </a>
          </div>
          <p class="integration-panel__desc" style="margin-bottom: 0;">
            {t('harnesses.mcp.modeDesc')}
          </p>
        </div>
      </Show>
    </div>
  );
};

export default McpServer;
