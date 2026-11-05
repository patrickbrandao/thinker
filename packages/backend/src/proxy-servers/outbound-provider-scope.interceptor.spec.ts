import {
  defer,
  firstValueFrom,
  from,
  lastValueFrom,
  mergeAll,
  of,
  throwError,
  type Observable,
} from 'rxjs';
import type { CallHandler, NestInterceptor } from '@nestjs/common';
import { OutboundProviderScope } from './outbound-provider-scope.interceptor';
import { currentOutboundScope, type OutboundScope } from '../common/outbound/outbound-proxy';

function scopeOf(provider: string): OutboundScope {
  return {
    tenantId: 't1',
    sourceType: 'provider',
    sourceId: provider,
    sourceLabel: provider,
    chain: [{ kind: 'direct' }],
    hops: [],
  };
}

function context(tenantContext: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ tenantContext }) }),
  } as never;
}

/** `intercept` may return a promise of the stream; Nest awaits it, so does the spec. */
function intercepted(
  interceptor: NestInterceptor,
  ctx: ReturnType<typeof context>,
  next: CallHandler,
): Observable<unknown> {
  return from(Promise.resolve(interceptor.intercept(ctx, next))).pipe(mergeAll());
}

function build(provider = 'openai') {
  const egress = {
    scopeForConnection: jest.fn(async (_t: string, p: string) => scopeOf(p)),
  };
  const Interceptor = OutboundProviderScope(provider);
  return { egress, interceptor: new Interceptor(egress as never) };
}

describe('OutboundProviderScope', () => {
  it('runs the handler inside the provider subscription scope of the tenant', async () => {
    const { egress, interceptor } = build('openai');
    let seen: OutboundScope | null = null;
    const next = {
      handle: () =>
        defer(async () => {
          // After an await: the async context must survive.
          await new Promise((resolve) => setImmediate(resolve));
          seen = currentOutboundScope();
          return 'done';
        }),
    };
    const out = await firstValueFrom(intercepted(interceptor, context({ tenantId: 't1' }), next));
    expect(out).toBe('done');
    expect(egress.scopeForConnection).toHaveBeenCalledWith('t1', 'openai', null, 'subscription');
    expect(seen).toMatchObject({ tenantId: 't1', sourceId: 'openai', chain: [{ kind: 'direct' }] });
  });

  it('does not leak the scope outside the handler', async () => {
    const { interceptor } = build();
    await lastValueFrom(
      intercepted(interceptor, context({ tenantId: 't1' }), { handle: () => of('x') }),
    );
    expect(currentOutboundScope()).toBeNull();
  });

  it('resolves the scope per provider and per request tenant', async () => {
    const a = build('anthropic');
    const b = build('openai');
    await lastValueFrom(
      intercepted(a.interceptor, context({ tenantId: 'tA' }), { handle: () => of(1) }),
    );
    await lastValueFrom(
      intercepted(b.interceptor, context({ tenantId: 'tB' }), { handle: () => of(1) }),
    );
    expect(a.egress.scopeForConnection).toHaveBeenCalledWith(
      'tA',
      'anthropic',
      null,
      'subscription',
    );
    expect(b.egress.scopeForConnection).toHaveBeenCalledWith('tB', 'openai', null, 'subscription');
    expect(OutboundProviderScope('openai')).not.toBe(OutboundProviderScope('anthropic'));
  });

  it('keeps concurrent requests of different tenants apart', async () => {
    const egress = {
      scopeForConnection: jest.fn(async (tenant: string) => ({
        ...scopeOf('openai'),
        tenantId: tenant,
      })),
    };
    const interceptor = new (OutboundProviderScope('openai'))(egress as never);
    const run = (tenant: string, delay: number) =>
      firstValueFrom(
        intercepted(interceptor, context({ tenantId: tenant }), {
          handle: () =>
            defer(async () => {
              await new Promise((resolve) => setTimeout(resolve, delay));
              return currentOutboundScope()?.tenantId;
            }),
        }),
      );
    await expect(Promise.all([run('tA', 20), run('tB', 1)])).resolves.toEqual(['tA', 'tB']);
  });

  it('passes through, without resolving anything, when the request has no tenant', async () => {
    const { egress, interceptor } = build();
    for (const tenantContext of [undefined, { tenantId: null }]) {
      let seen: OutboundScope | null | undefined;
      await lastValueFrom(
        intercepted(interceptor, context(tenantContext), {
          handle: () =>
            defer(() => {
              seen = currentOutboundScope();
              return of('ok');
            }),
        }),
      );
      expect(seen).toBeNull();
    }
    expect(egress.scopeForConnection).not.toHaveBeenCalled();
  });

  it('passes through when the egress service is not available (optional dependency)', async () => {
    const interceptor = new (OutboundProviderScope('openai'))(undefined);
    await expect(
      firstValueFrom(
        intercepted(interceptor, context({ tenantId: 't1' }), { handle: () => of(7) }),
      ),
    ).resolves.toBe(7);
  });

  it('propagates handler errors', async () => {
    const { interceptor } = build();
    await expect(
      lastValueFrom(
        intercepted(interceptor, context({ tenantId: 't1' }), {
          handle: () => throwError(() => new Error('boom')),
        }),
      ),
    ).rejects.toThrow('boom');
  });

  it('propagates a scope resolution failure instead of running the handler unscoped', async () => {
    const egress = { scopeForConnection: jest.fn().mockRejectedValue(new Error('db down')) };
    const interceptor = new (OutboundProviderScope('openai'))(egress as never);
    const handle = jest.fn(() => of('x'));
    await expect(
      lastValueFrom(intercepted(interceptor, context({ tenantId: 't1' }), { handle })),
    ).rejects.toThrow('db down');
    expect(handle).not.toHaveBeenCalled();
  });
});
