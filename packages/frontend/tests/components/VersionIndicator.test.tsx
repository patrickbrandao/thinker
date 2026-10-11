import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import VersionIndicator from '../../src/components/VersionIndicator';

describe('VersionIndicator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the build-time version', () => {
    const { container } = render(() => <VersionIndicator />);
    const badge = container.querySelector('.version-indicator');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe(`v${__MANIFEST_VERSION__}`);
    expect(badge?.getAttribute('aria-label')).toBe(`Version ${__MANIFEST_VERSION__}`);
  });

  it('makes no network request and offers no update link', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(() => <VersionIndicator />);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
