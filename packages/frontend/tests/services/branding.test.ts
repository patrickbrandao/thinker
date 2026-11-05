import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { THINKER_MARK_512_URL } from '../../src/services/thinker-links';

// branding keeps a module-level in-flight promise, so each test gets a fresh module.
async function fresh() {
  vi.resetModules();
  return import('../../src/services/branding');
}

function stubFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });

describe('branding', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts with the defaults and hideInfo true so the version never flashes in', async () => {
    const { brandingSignal } = await fresh();
    expect(brandingSignal()).toEqual({
      title: 'Thinker',
      logoUrl: THINKER_MARK_512_URL,
      hideInfo: true,
    });
  });

  it('applies the instance branding returned by the backend', async () => {
    const fetchMock = stubFetch(() =>
      ok({ title: 'Acme AI', logoUrl: 'https://acme.test/logo.png', hideInfo: false }),
    );
    const { brandingSignal, loadBranding } = await fresh();
    await loadBranding();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/branding', { credentials: 'same-origin' });
    expect(brandingSignal()).toEqual({
      title: 'Acme AI',
      logoUrl: 'https://acme.test/logo.png',
      hideInfo: false,
    });
  });

  it('hides the info only when the backend says exactly true', async () => {
    stubFetch(() => ok({ hideInfo: true }));
    const { brandingSignal, loadBranding } = await fresh();
    await loadBranding();
    expect(brandingSignal().hideInfo).toBe(true);
  });

  it('falls back to defaults for empty or missing fields, and shows info', async () => {
    stubFetch(() => ok({ title: '', logoUrl: null }));
    const { brandingSignal, loadBranding } = await fresh();
    await loadBranding();
    expect(brandingSignal()).toEqual({
      title: 'Thinker',
      logoUrl: THINKER_MARK_512_URL,
      hideInfo: false,
    });
  });

  it('uses defaults (info shown) on an HTTP error', async () => {
    stubFetch(() => Promise.resolve({ ok: false, json: async () => ({ title: 'ignored' }) }));
    const { brandingSignal, loadBranding } = await fresh();
    await loadBranding();
    expect(brandingSignal()).toEqual({
      title: 'Thinker',
      logoUrl: THINKER_MARK_512_URL,
      hideInfo: false,
    });
  });

  it('keeps defaults and reveals the info when the request fails', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));
    const { brandingSignal, loadBranding } = await fresh();
    await loadBranding();
    expect(brandingSignal().title).toBe('Thinker');
    expect(brandingSignal().hideInfo).toBe(false);
  });

  it('keeps defaults when the body is not JSON', async () => {
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        json: async () => {
          throw new SyntaxError('bad json');
        },
      }),
    );
    const { brandingSignal, loadBranding } = await fresh();
    await loadBranding();
    expect(brandingSignal().title).toBe('Thinker');
    expect(brandingSignal().hideInfo).toBe(false);
  });

  it('fetches only once however many callers ask', async () => {
    const fetchMock = stubFetch(() => ok({ title: 'X' }));
    const { loadBranding } = await fresh();
    const a = loadBranding();
    const b = loadBranding();
    await Promise.all([a, b]);
    await loadBranding();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('notifies subscribers when branding arrives', async () => {
    stubFetch(() => ok({ title: 'Live' }));
    const { brandingSignal, loadBranding } = await fresh();
    const listener = vi.fn();
    brandingSignal.subscribe(listener);
    await loadBranding();
    expect(listener).toHaveBeenCalled();
    expect(brandingSignal().title).toBe('Live');
  });
});
