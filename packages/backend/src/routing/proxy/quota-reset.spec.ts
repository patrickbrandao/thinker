import { parseQuotaSignal } from './quota-reset';

const NOW = Date.parse('2026-11-05T10:00:00Z');

describe('parseQuotaSignal', () => {
  it('reads Codex usage_limit_reached resets_at and resets_in_seconds', () => {
    const at = JSON.stringify({
      error: { type: 'usage_limit_reached', resets_at: NOW / 1000 + 3600 },
    });
    expect(parseQuotaSignal(at, NOW)).toEqual({ exhausted: true, resetInMs: 3_600_000 });
    const inSecs = JSON.stringify({
      error: { type: 'usage_limit_reached', resets_in_seconds: 60 },
    });
    expect(parseQuotaSignal(inSecs, NOW)).toEqual({ exhausted: true, resetInMs: 60_000 });
  });

  it('reads Google QUOTA_EXHAUSTED with RetryInfo', () => {
    const body = JSON.stringify([
      {
        error: {
          code: 429,
          details: [
            { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'QUOTA_EXHAUSTED' },
            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7200s' },
          ],
        },
      },
    ]);
    expect(parseQuotaSignal(body, NOW)).toEqual({ exhausted: true, resetInMs: 7_200_000 });
  });

  it('ignores a Google RATE_LIMIT_EXCEEDED burst', () => {
    const body = JSON.stringify({
      error: {
        details: [
          { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED' },
        ],
      },
    });
    expect(parseQuotaSignal(body, NOW)).toBeNull();
  });

  it('reads the Z.ai reset time in China time', () => {
    const body = JSON.stringify({
      error: { code: '1308', message: 'Usage limit reached, resets at 2026-11-05 20:00:00' },
    });
    // 20:00 UTC+8 is 12:00 UTC, two hours after NOW.
    expect(parseQuotaSignal(body, NOW)).toEqual({ exhausted: true, resetInMs: 7_200_000 });
    expect(parseQuotaSignal(JSON.stringify({ error: { code: '1311' } }), NOW)).toBeNull();
  });

  it('reads MiniMax M Plan base_resp codes', () => {
    expect(parseQuotaSignal(JSON.stringify({ base_resp: { status_code: 2056 } }), NOW)).toEqual({
      exhausted: true,
    });
    expect(parseQuotaSignal(JSON.stringify({ base_resp: { status_code: 2062 } }), NOW)).toBeNull();
  });

  it('keeps the generic OpenCode/OpenAI patterns', () => {
    expect(parseQuotaSignal('{"error":{"type":"FreeUsageLimitError"}}', NOW)).toEqual({
      exhausted: true,
    });
    expect(parseQuotaSignal('rate limited', NOW)).toBeNull();
  });
});
