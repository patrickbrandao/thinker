import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import { runWithEgressAffinity } from '../common/outbound/egress-balance';
import type { IngestionContext } from '../otlp/interfaces/ingestion-context.interface';
import { detectHarnessSession } from '../routing/proxy/harness-session';

/**
 * Runs a gateway request with its egress affinity: the root harness session
 * (the one the Sessions page groups by, so subagents share their main
 * session's proxy) and the agent. Balanced outbound profile lines read it.
 */
@Injectable()
export class EgressAffinityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { ingestionContext?: IngestionContext }>();
    const session = detectHarnessSession(req?.headers);
    const affinity = {
      sessionKey: session ? (session.parentId ?? session.id) : null,
      agentKey: req?.ingestionContext?.agentId ?? null,
    };
    return new Observable<unknown>((subscriber) =>
      runWithEgressAffinity(affinity, () => next.handle().subscribe(subscriber)),
    );
  }
}
