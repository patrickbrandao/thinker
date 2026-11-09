import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VirtualModelShadowWarning from '../../src/components/VirtualModelShadowWarning';
import { resetLocaleForTests } from '../../src/i18n';

describe('VirtualModelShadowWarning', () => {
  it('renders nothing without shadowed ids', () => {
    const { container } = render(<VirtualModelShadowWarning shadows={[]} enabled />);
    expect(container.firstChild).toBeNull();
  });

  it('warns that an enabled virtual model shadows one real model', () => {
    render(<VirtualModelShadowWarning shadows={['gpt-4o']} enabled />);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('Shadows a real model');
    expect(note.textContent).toContain('gpt-4o');
    expect(note.textContent).toContain('While this virtual model is active');
  });

  it('pluralizes with the count and lists every id', () => {
    render(<VirtualModelShadowWarning shadows={['a', 'b', 'c']} enabled />);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('Shadows 3 real models');
    expect(note.querySelectorAll('code')).toHaveLength(3);
  });

  it('uses the future tense for a disabled virtual model', () => {
    render(<VirtualModelShadowWarning shadows={['a']} enabled={false} />);
    expect(screen.getByRole('note').textContent).toContain('If you activate this virtual model');
    expect(screen.getByRole('note').textContent).not.toContain(
      'While this virtual model is active',
    );
  });

  it('uses the "matches" wording while previewing an unsaved name', () => {
    const { rerender } = render(<VirtualModelShadowWarning shadows={['a']} enabled preview />);
    expect(screen.getByRole('note').textContent).toContain('This name matches a real model');
    rerender(<VirtualModelShadowWarning shadows={['a', 'b']} enabled preview />);
    expect(screen.getByRole('note').textContent).toContain('This name matches 2 real models');
  });

  it('is localized in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(<VirtualModelShadowWarning shadows={['a']} enabled />);
    expect(screen.getByRole('note').textContent).not.toContain('Shadows');
    expect(screen.getByRole('note').textContent).toContain('a');
  });
});
