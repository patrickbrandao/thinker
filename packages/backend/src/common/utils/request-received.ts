import type { IncomingMessage } from 'node:http';

const RECEIVED_AT = Symbol('thinker.receivedAt');

type WithReceivedAt = IncomingMessage & { [RECEIVED_AT]?: number };

/** Stamps the first moment the app saw this request (epoch ms); first call wins. */
export function markRequestReceived(req: IncomingMessage): void {
  (req as WithReceivedAt)[RECEIVED_AT] ??= Date.now();
}

/** When the request first reached the app, or `fallback` when it was never stamped. */
export function requestReceivedAtMs(req: IncomingMessage, fallback: number): number {
  return (req as WithReceivedAt)[RECEIVED_AT] ?? fallback;
}
