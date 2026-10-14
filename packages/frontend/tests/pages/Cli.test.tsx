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
      'thinker login --url https://llm.acme.internal',
    );
  });
});

describe('CLI page', () => {
  it('installs the CLI from a repository checkout, not from a registry', () => {
    const { container } = render(() => <Cli />);
    expect(container.textContent).toContain('git clone https://github.com/patrickbrandao/thinker.git');
    expect(container.textContent).toContain('npm install -g ./packages/cli');
  });

  it('shows the login command pinned to this install', () => {
    const { container } = render(() => <Cli />);
    expect(container.textContent).toContain(`thinker login --url ${window.location.origin}`);
  });

  it('links to the repository docs', () => {
    const { container } = render(() => <Cli />);
    const link = container.querySelector(
      'a[href="https://github.com/patrickbrandao/thinker/tree/main/docs"]',
    );
    expect(link).not.toBeNull();
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
