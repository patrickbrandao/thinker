import { createElement } from 'react';
import { Bot, BrainCircuit, Globe, House, Network, Plug, Server } from 'lucide-react';
import { platformIcon } from 'thinker-shared';
import type { FlowEdge, FlowNode, Graph } from '../components/flow/types.js';
import type { FlowLegendItem } from '../components/flow/FlowCanvas.jsx';
import { columnLayout } from '../components/flow/layout.js';
import { ThemedIcon } from '../components/setup-ui.jsx';
import { providerIcon } from '../components/ProviderIcon.jsx';
import type { Topology, TopologyLink } from '../services/api/console.js';
import { formatCost, formatNumber } from '../services/formatters.js';
import { PROVIDERS } from '../services/providers.js';
import { t, tMaybe } from '../i18n/index.js';

const ICON = 40;
const COLUMN = { client: 0, harness: 1, connection: 2, proxy: 3, egress: 4 } as const;
/** Vertical room of a step node (box + name + subtitle) and of a one-line source. */
const STEP_HEIGHT = 144;
const SOURCE_LINE = 18;
const SOURCE_GAP = 40;

export function topologyLegend(): FlowLegendItem[] {
  return [
    { id: 'route', label: t('shell.flow.links.route') },
    { id: 'fallback', label: t('shell.flow.links.fallback'), dashed: true },
    { id: 'error', label: t('shell.flow.links.error'), error: true },
  ];
}

const lucide = (icon: typeof Bot) => createElement(icon, { size: ICON, strokeWidth: 1.5 });

/** IPv4-mapped addresses show as IPv4; a zone id is dropped. */
function plainIp(ip: string): string {
  const bare = ip.split('%')[0] ?? ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  return mapped?.[1] ?? bare;
}

/** Eight 4-digit groups: no zero compression, leading zeros kept. */
export function expandIpv6(ip: string): string[] | null {
  let text = ip.toLowerCase();
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a = 0, b = 0, c = 0, d = 0] = v4.slice(1).map(Number);
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(Math.max(0, fill)).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

/** Text lines of a client node: IPv6 in pairs of groups, IPv4 on one line. */
export function ipLines(ip: string): string[] {
  const plain = plainIp(ip);
  if (!plain.includes(':')) return [plain];
  const groups = expandIpv6(plain);
  if (!groups) return [plain];
  const lines: string[] = [];
  for (let i = 0; i < 8; i += 2) lines.push(`${groups[i]}:${groups[i + 1]}${i < 6 ? ':' : ''}`);
  return lines;
}

function usageTooltip(
  title: string,
  u: { requests: number; errors: number; costUsd?: number; tokens?: number },
  extra: Array<string | null | undefined> = [],
): string {
  const lines = [title, ...extra.filter(Boolean)];
  if (u.requests > 0) {
    lines.push(t('shell.flow.metrics.requests', formatNumber(u.requests)));
    if (u.errors > 0) lines.push(t('shell.flow.metrics.errors', formatNumber(u.errors)));
    if (u.tokens) lines.push(t('shell.flow.metrics.tokens', formatNumber(u.tokens)));
    if (u.costUsd) lines.push(formatCost(u.costUsd) ?? '');
  } else {
    lines.push(t('shell.flow.metrics.idle'));
  }
  return lines.filter(Boolean).join('\n');
}

const failing = (u: { requests: number; errors: number }) =>
  u.requests > 0 && u.errors * 2 >= u.requests;

const harnessHref = (name: string) => `/harnesses/${encodeURIComponent(name)}`;

const providerName = (provider: string, fallback: string) =>
  PROVIDERS.find((p) => p.id === provider.toLowerCase())?.name ?? fallback;

function linkTooltip(l: TopologyLink): string | undefined {
  const lines: string[] = [];
  for (const m of [...(l.models ?? [])].sort((a, b) => b.requests - a.requests)) {
    const tag = m.kind === 'fallback' ? ` (${t('shell.flow.links.fallback').toLowerCase()})` : '';
    const count = m.requests > 0 ? ` · ${formatNumber(m.requests)}` : '';
    lines.push(`${m.via} → ${m.model}${tag}${count}`);
  }
  if (l.requests > 0) {
    lines.push(t('shell.flow.metrics.requests', formatNumber(l.requests)));
    if (l.errors > 0) lines.push(t('shell.flow.metrics.errors', formatNumber(l.errors)));
    if (l.costUsd > 0) lines.push(formatCost(l.costUsd) ?? '');
  }
  return lines.length ? lines.filter(Boolean).join('\n') : undefined;
}

/**
 * Turns the topology API payload into a laid-out flow graph, one column per
 * kind: client address → harness → provider connection → proxy profile →
 * internet / local network. Saved positions win over the column layout.
 * With `activeOnly`, nodes and links without traffic in the window are left
 * out.
 */
export function buildTopologyGraph(data: Topology, options: { activeOnly?: boolean } = {}): Graph {
  const links = options.activeOnly ? data.links.filter((l) => l.requests > 0) : data.links;
  const used = new Set(links.flatMap((l) => [l.source, l.target]));
  const keep = (id: string) => !options.activeOnly || used.has(id);
  const targets = new Set(links.map((l) => l.target));
  const sources = new Set(links.map((l) => l.source));
  const columns = new Map<string, number>();

  const nodes: FlowNode[] = [];
  const push = (node: Omit<FlowNode, 'position'>, column: number) => {
    columns.set(node.id, column);
    nodes.push({
      ...node,
      position: { x: 0, y: 0 },
      data: { ...node.data, inbound: targets.has(node.id), outbound: sources.has(node.id) },
    });
  };

  for (const c of data.clients) {
    if (!keep(c.id)) continue;
    push(
      {
        id: c.id,
        type: 'source',
        data: {
          kind: 'source',
          icon: createElement(Bot, { size: 22, strokeWidth: 1.6 }),
          title: c.ip,
          lines: ipLines(c.ip),
          tooltip: usageTooltip(plainIp(c.ip), c),
          state: failing(c) ? 'error' : undefined,
        },
      },
      COLUMN.client,
    );
  }
  for (const h of data.harnesses) {
    if (!keep(h.id)) continue;
    const icon = platformIcon(h.platform, null);
    push(
      {
        id: h.id,
        type: 'node',
        data: {
          kind: 'node',
          icon: icon ? createElement(ThemedIcon, { src: icon, size: ICON }) : lucide(BrainCircuit),
          title: h.displayName || h.name,
          tooltip: usageTooltip(h.displayName || h.name, h, [h.platform]),
          state: failing(h) ? 'error' : h.requests === 0 ? 'idle' : undefined,
          href: harnessHref(h.name),
        },
      },
      COLUMN.harness,
    );
  }
  for (const p of data.providers) {
    if (!keep(p.id)) continue;
    const name = providerName(p.provider, p.name);
    const auth = tMaybe(`shell.flow.auth.${p.authType}`) ?? p.authType;
    push(
      {
        id: p.id,
        type: 'node',
        data: {
          kind: 'node',
          icon:
            providerIcon(p.provider.toLowerCase(), ICON) ??
            lucide(p.authType === 'local' ? Server : Plug),
          title: name,
          subtitle: p.label,
          tooltip: usageTooltip(`${name} · ${p.label}`, p, [
            auth,
            p.active ? null : t('shell.flow.disabled'),
          ]),
          state: failing(p) ? 'error' : p.requests === 0 ? 'idle' : undefined,
          href: `/providers/connections/${encodeURIComponent(p.connectionId)}`,
        },
      },
      COLUMN.connection,
    );
  }
  for (const proxy of data.proxies) {
    if (!keep(proxy.id)) continue;
    const name = proxy.profileId ? proxy.name : t('shell.flow.globalProxy');
    push(
      {
        id: proxy.id,
        type: 'node',
        data: {
          kind: 'node',
          icon: lucide(Network),
          title: t('shell.flow.proxy'),
          subtitle: name,
          tooltip: usageTooltip(`${t('shell.flow.proxy')} · ${name}`, proxy),
          state: failing(proxy) ? 'error' : undefined,
          href: '/proxy-servers',
        },
      },
      COLUMN.proxy,
    );
  }
  for (const end of data.egress) {
    if (!keep(end.id)) continue;
    const title = t(`shell.flow.egress.${end.id}`);
    push(
      {
        id: end.id,
        type: 'node',
        data: {
          kind: 'node',
          icon: lucide(end.id === 'local' ? House : Globe),
          title,
          tooltip: usageTooltip(title, end),
        },
      },
      COLUMN.egress,
    );
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = links
    .filter((l) => ids.has(l.source) && ids.has(l.target))
    .map((l) => ({
      id: `${l.source}>${l.target}`,
      source: l.source,
      target: l.target,
      data: {
        live: l.requests,
        label: l.requests > 0 ? formatNumber(l.requests) : undefined,
        tooltip: linkTooltip(l),
        dashed: l.kind === 'fallback',
        state: failing(l) ? 'error' : undefined,
      },
    }));

  return columnLayout(
    { nodes, edges },
    {
      columnOf: (node) => columns.get(node.id) ?? 0,
      heightOf: (node) =>
        node.type === 'source'
          ? (node.data.lines?.length ?? 1) * SOURCE_LINE + SOURCE_GAP
          : STEP_HEIGHT,
      positions: data.positions,
    },
  );
}
