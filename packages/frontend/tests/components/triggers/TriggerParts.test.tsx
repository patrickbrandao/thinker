import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TriggerTestResultView, TriggerTypeIcon, TriggerTypeTag } from '../../../src/components/triggers/TriggerParts';
import { resetLocaleForTests, t } from '../../../src/i18n';

describe('TriggerTypeIcon / TriggerTypeTag', () => {
  it.each(['email', 'webhook', 'telegram', 'syslog'] as const)('draws a decorative icon for %s', (type) => {
    const { container } = render(<TriggerTypeIcon type={type} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to a default icon for an unknown type', () => {
    const { container } = render(<TriggerTypeIcon type={'carrier-pigeon' as never} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('accepts a custom class', () => {
    const { container } = render(<TriggerTypeIcon type="email" className="size-8" />);
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('size-8');
  });

  it('labels each type and names the e-mail provider when known', () => {
    const { container, rerender } = render(<TriggerTypeTag type="webhook" />);
    expect(container.textContent).toBe('Webhook');
    rerender(<TriggerTypeTag type="telegram" />);
    expect(container.textContent).toBe('Telegram');
    rerender(<TriggerTypeTag type="syslog" />);
    expect(container.textContent).toBe('Syslog');
    rerender(<TriggerTypeTag type="email" />);
    expect(container.textContent).toBe('E-mail');
    rerender(<TriggerTypeTag type="email" provider="mailgun" />);
    expect(container.textContent).toBe('Email API Mailgun');
  });

  it('shows an unknown type as-is', () => {
    const { container } = render(<TriggerTypeTag type={'fax' as never} />);
    expect(container.textContent).toBe('fax');
  });
});

describe('TriggerTestResultView', () => {
  it('shows a success with status code and duration, and announces it as a status', () => {
    render(
      <TriggerTestResultView
        result={{ success: true, status_code: 204, error: null, response: null, duration_ms: 1500 }}
      />,
    );
    const box = screen.getByRole('status');
    expect(box.textContent).toContain('Delivered');
    expect(box.textContent).toContain('Status code: 204');
    expect(box.textContent).toContain('Duration: 1.5s');
    expect(screen.queryByText('Error')).toBeNull();
    expect(screen.queryByText('Server response')).toBeNull();
  });

  it('shows a failure with the error and the server response', () => {
    render(
      <TriggerTestResultView
        result={{ success: false, status_code: 500, error: 'HTTP 500 from server', response: '{"oops":true}', duration_ms: 90 }}
      />,
    );
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('HTTP 500 from server')).toBeTruthy();
    expect(screen.getByText('{"oops":true}').tagName).toBe('PRE');
    expect(screen.getByRole('status').textContent).toContain('Duration: 90ms');
  });

  it('omits the status code when the request never reached a server', () => {
    render(
      <TriggerTestResultView
        result={{ success: false, status_code: null, error: 'ECONNREFUSED', response: null, duration_ms: 10 }}
      />,
    );
    expect(screen.queryByText(/Status code/)).toBeNull();
    expect(screen.getByText('ECONNREFUSED')).toBeTruthy();
  });

  it('renders in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(
      <TriggerTestResultView
        result={{ success: true, status_code: 200, error: null, response: null, duration_ms: 5 }}
      />,
    );
    expect(screen.getByText(t('triggers.testResult.success'))).toBeTruthy();
    expect(t('triggers.testResult.success')).not.toBe('Delivered');
    expect(screen.getByRole('status').textContent).toContain(t('triggers.testResult.statusCode'));
  });
});
