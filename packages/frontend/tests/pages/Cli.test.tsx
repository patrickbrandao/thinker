import { describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';

vi.mock('@solidjs/meta', () => ({
  Title: (props: { children?: unknown }) => <title>{String(props.children ?? '')}</title>,
  Meta: () => null,
}));

import Cli, { loginCommand } from '../../src/pages/integrations/Cli';

describe('loginCommand', () => {
  it('pins the host, which only the dashboard knows', () => {
    expect(loginCommand('https://llm.acme.internal')).toBe(
      'mnfst login --url https://llm.acme.internal',
    );
  });
});

describe('CLI page', () => {
  it('shows the npm install for the published package', () => {
    const { container } = render(() => <Cli />);
    expect(container.textContent).toContain('npm install -g mnfst-gateway-cli');
  });

  it('shows the login command pinned to this install', () => {
    const { container } = render(() => <Cli />);
    expect(container.textContent).toContain(`mnfst login --url ${window.location.origin}`);
  });

  it('links to the command reference', () => {
    const { container } = render(() => <Cli />);
    const link = container.querySelector('a[href="https://manifest.build/llm-gateway/docs/cli/"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
