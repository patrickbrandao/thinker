import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import OpenCodeSetup from '../../src/components/OpenCodeSetup';

const writeText = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('navigator', {
  clipboard: { writeText },
});

describe('OpenCodeSetup', () => {
  beforeEach(() => {
    writeText.mockClear();
  });

  it('renders a paste-ready opencode.json block with a placeholder when the full key is unavailable', async () => {
    const { container } = render(
      <OpenCodeSetup apiKey={null} keyPrefix="thk_live" baseUrl="http://localhost:38240/v1" />,
    );

    expect(container.textContent).toContain('~/.config/opencode/opencode.json');
    expect(container.textContent).not.toContain('project root');
    expect(container.textContent).toContain('"baseURL": "http://localhost:38240/v1"');
    expect(container.textContent).toContain('"apiKey": "thk_YOUR_KEY"');
    expect(container.textContent).not.toContain('"apiKey": "thk_live..."');
    expect(container.textContent).toContain('"model": "thinker/auto"');
    expect(screen.queryByLabelText('Reveal API key')).toBeNull();

    const copyConfig = container.querySelector(
      '.setup-cli-block__actions [aria-label="Copy to clipboard"]',
    );
    expect(copyConfig).not.toBeNull();
    fireEvent.click(copyConfig!);
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"apiKey": "thk_YOUR_KEY"'));
    });
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('thk_live...'));
  });

  it('reveals and hides the full API key without changing the copy payload', async () => {
    const { container } = render(
      <OpenCodeSetup
        apiKey="thk_secret"
        keyPrefix="thk_live"
        baseUrl="http://localhost:38240/v1"
      />,
    );

    expect(container.textContent).toContain('"apiKey": "thk_live..."');
    expect(container.textContent).not.toContain('thk_secret');

    fireEvent.click(screen.getByLabelText('Reveal API key'));
    expect(container.textContent).toContain('"apiKey": "thk_secret"');

    fireEvent.click(screen.getByLabelText('Hide API key'));
    expect(container.textContent).toContain('"apiKey": "thk_live..."');

    const copyFullConfig = container.querySelector(
      '.setup-cli-block__actions [aria-label="Copy to clipboard"]',
    );
    expect(copyFullConfig).not.toBeNull();
    fireEvent.click(copyFullConfig!);
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"apiKey": "thk_secret"'));
    });
  });
});
