import type { DeliveryResult } from './trigger-senders';

/**
 * Extra time the worker allows a delivery beyond its own timeout before it
 * gives up on it, so one stuck destination never holds the queue.
 */
export const DELIVERY_GRACE_MS = 5_000;

/**
 * Bounds a whole delivery: a destination that never settles fails the
 * attempt instead of holding the worker (and every other trigger) forever.
 */
export function withDeliveryDeadline(
  delivery: Promise<DeliveryResult>,
  ms: number,
): Promise<DeliveryResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<DeliveryResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          success: false,
          statusCode: null,
          error: `Delivery did not finish within ${Math.round(ms / 1000)} s`,
          response: null,
        }),
      ms,
    );
  });
  return Promise.race([delivery, deadline]).finally(() => clearTimeout(timer));
}
