import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Raw facts the rest of the backend reports for event triggers. Producers
 * (proxy recorder, limit checks, harness lifecycle) only publish; the
 * triggers module decides whether anything subscribed and does all the work
 * off the request path.
 */
export type TriggerSignal =
  | {
      kind: 'request';
      tenantId: string;
      agentId: string;
      agentName: string;
      requestId: string;
    }
  | {
      kind: 'attempt';
      tenantId: string;
      agentId: string;
      agentName: string;
      tenantProviderId: string | null;
      provider: string | null;
      keyLabel: string | null;
      ok: boolean;
      httpStatus: number | null;
      errorCode: string | null;
      errorMessage: string | null;
    }
  | {
      kind: 'limit';
      tenantId: string;
      agentName: string;
      alertType: 'soft' | 'hard';
      ruleId: string;
      metric: 'tokens' | 'cost';
      threshold: number;
      actual: number;
      period: string;
      periodStart: string;
      periodEnd: string;
      periodReset?: string;
    }
  | {
      kind: 'harness';
      tenantId: string;
      action: 'created' | 'deleted';
      agentId: string;
      agentName: string;
      displayName: string;
      userId: string | null;
    };

@Injectable()
export class TriggerSignalService implements OnModuleDestroy {
  private readonly subject = new Subject<TriggerSignal>();

  emit(signal: TriggerSignal): void {
    this.subject.next(signal);
  }

  signals(): Observable<TriggerSignal> {
    return this.subject.asObservable();
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
