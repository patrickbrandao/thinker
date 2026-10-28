import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PLATFORM_ICONS } from 'thinker-shared';
import CodeBlock from '../../components/CodeBlock.js';
import RichText from '../../components/RichText.js';
import { Panel, Tabs } from '../../components/ui.js';
import { mcpEndpoint } from '../../services/install-endpoints.js';
import { checkMcpEnabled } from '../../services/setup-status.js';
import { THINKER_DOCS_URL } from '../../services/thinker-links.js';
import { useResource } from '../../lib/use-resource.js';
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

export default function McpServer() {
  const endpoint = mcpEndpoint();
  const clients = useMemo(() => clientSetups(endpoint), [endpoint]);
  const [activeId, setActiveId] = useState('claude-code');
  const active = clients.find((c) => c.id === activeId) ?? clients[0];
  // The menu entry is already hidden when MCP is off, but a bookmark still
  // lands here. Say why rather than handing out an endpoint that answers 404,
  // and show neither panel until the answer is in, so a disabled install never
  // flashes the endpoint first.
  const enabled = useResource(checkMcpEnabled, []).data;

  return (
    <div className="page">
      <title>{t('common.pageTitle', { page: t('harnesses.mcp.title') })}</title>
      <meta name="description" content={t('harnesses.mcp.metaDescription')} />

      {enabled === false ? (
        <Panel title={t('harnesses.mcp.unavailableTitle')}>
          <p className="text-sm text-dim">
            <RichText
              text={t('harnesses.mcp.unavailableDesc')}
              parts={{
                authUrl: <code className="font-mono">BETTER_AUTH_URL</code>,
                flag: <code className="font-mono">MCP_ENABLED=false</code>,
              }}
            />
          </p>
        </Panel>
      ) : null}

      {enabled === true ? (
        <div className="flex flex-col gap-4">
          <Panel title={t('harnesses.mcp.endpointTitle')}>
            <p className="mb-3 text-sm text-dim">{t('harnesses.mcp.endpointDesc')}</p>
            <CodeBlock code={endpoint} language="bash" />
          </Panel>

          <Panel title={t('harnesses.mcp.connectTitle')}>
            <Tabs
              className="mb-3"
              label={t('harnesses.mcp.clientTabs')}
              value={active.id}
              onChange={setActiveId}
              items={clients.map((client) => ({
                key: client.id,
                label: client.id === 'other' ? t('harnesses.platformOther') : client.label,
                icon: client.icon ? (
                  <img
                    className="tab-icon size-4"
                    src={client.icon}
                    alt=""
                    width={16}
                    height={16}
                  />
                ) : undefined,
              }))}
            />
            <CodeBlock code={active.code} language={active.language} />
          </Panel>

          <Panel
            title={t('harnesses.mcp.modeTitle')}
            actions={
              <a
                href={THINKER_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                {t('harnesses.mcp.toolList')}
                <ExternalLink aria-hidden="true" />
              </a>
            }
          >
            <p className="text-sm text-dim">{t('harnesses.mcp.modeDesc')}</p>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
