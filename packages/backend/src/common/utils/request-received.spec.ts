import type { IncomingMessage } from 'node:http';
import { markRequestReceived, requestReceivedAtMs } from './request-received';

const req = () => ({}) as IncomingMessage;

afterEach(() => jest.restoreAllMocks());

describe('request received stamp', () => {
  it('falls back when the request was never stamped', () => {
    expect(requestReceivedAtMs(req(), 123)).toBe(123);
  });

  it('stamps the current time', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const r = req();
    markRequestReceived(r);
    expect(requestReceivedAtMs(r, 5)).toBe(1_000);
  });

  it('keeps the first stamp: a later middleware cannot move it', () => {
    const now = jest.spyOn(Date, 'now');
    const r = req();
    now.mockReturnValue(1_000);
    markRequestReceived(r);
    now.mockReturnValue(9_000);
    markRequestReceived(r);
    expect(requestReceivedAtMs(r, 5)).toBe(1_000);
  });

  it('is per request, and does not leak a visible property onto it', () => {
    jest.spyOn(Date, 'now').mockReturnValue(42);
    const a = req();
    const b = req();
    markRequestReceived(a);
    expect(requestReceivedAtMs(b, 7)).toBe(7);
    expect(Object.keys(a)).toEqual([]);
    expect(JSON.stringify(a)).toBe('{}');
  });

  it('treats a stamp of 0 as a stamp (not as missing)', () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const r = req();
    markRequestReceived(r);
    expect(requestReceivedAtMs(r, 99)).toBe(0);
  });
});
