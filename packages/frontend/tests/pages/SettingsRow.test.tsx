import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsRow from '../../src/pages/SettingsRow';

describe('SettingsRow', () => {
  it('shows the title, description and control', () => {
    render(
      <SettingsRow title="Recording" description="Store request bodies">
        <button>Toggle</button>
      </SettingsRow>,
    );
    expect(screen.getByText('Recording')).toBeTruthy();
    expect(screen.getByText('Store request bodies').tagName).toBe('P');
    expect(screen.getByRole('button', { name: 'Toggle' })).toBeTruthy();
  });

  it('omits the description paragraph and the control cell when not given', () => {
    const { container } = render(<SettingsRow title="Only title" />);
    expect(container.querySelector('p')).toBeNull();
    expect(container.firstElementChild!.children).toHaveLength(1);
  });

  it('accepts rich titles and merges a custom class', () => {
    const { container } = render(
      <SettingsRow title={<strong>Rich</strong>} className="border-t">
        <span>c</span>
      </SettingsRow>,
    );
    expect(container.querySelector('strong')!.textContent).toBe('Rich');
    expect(container.firstElementChild!.className).toContain('border-t');
    expect(container.firstElementChild!.className).toContain('flex-col');
  });
});
