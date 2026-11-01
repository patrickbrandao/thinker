import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
  Type,
  mixin,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import type { RequestWithTenantContext } from '../common/decorators/tenant-context.decorator';
import { runWithOutboundScope } from '../common/outbound/outbound-proxy';
import { ProxyEgressService } from './proxy-egress.service';

/**
 * Runs a subscription OAuth handler (authorize, code exchange, device polling,
 * revoke) inside the provider's outbound proxy chain, so the account's token
 * is obtained from the same egress as its inference traffic. `next.handle()`
 * is called inside the scope: Nest binds the handler's async context there.
 */
export function OutboundProviderScope(provider: string): Type<NestInterceptor> {
  @Injectable()
  class OutboundProviderScopeInterceptor implements NestInterceptor {
    constructor(@Optional() private readonly egress?: ProxyEgressService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      const req = context.switchToHttp().getRequest<RequestWithTenantContext>();
      const tenantId = req?.tenantContext?.tenantId;
      if (!this.egress || !tenantId) return next.handle();
      return from(this.egress.scopeForConnection(tenantId, provider, null)).pipe(
        switchMap(
          (scope) =>
            new Observable<unknown>((subscriber) =>
              runWithOutboundScope(scope, () => next.handle().subscribe(subscriber)),
            ),
        ),
      );
    }
  }
  return mixin(OutboundProviderScopeInterceptor);
}
