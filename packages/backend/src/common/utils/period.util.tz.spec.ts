import { execFileSync } from 'child_process';
import * as path from 'path';

/**
 * Timezone regression coverage for the local-time period boundaries.
 *
 * The assertions in period.util.spec.ts are vacuous on a UTC host (CI): there,
 * UTC formatting and the correct local formatting produce identical strings.
 * Jest also sandboxes process.env per worker, so setting TZ inside this process
 * never reaches the native tz binding. The only reliable way to pin a timezone
 * is a child process started with a real TZ env var, so we evaluate
 * period.util there with a frozen clock and assert hardcoded wall-clock
 * strings for several zones (west and east of UTC, whole and half-hour
 * offsets).
 */

// 2026-07-01T01:30:00.250Z: Wednesday 1 July in UTC and east of it, but still
// Tuesday 30 June west of it. Day and month flip with the zone, so any UTC
// leak (or a local leak where UTC is expected) breaks the assertions. The
// non-zero milliseconds pin the precision of the exclusive `periodEnd`.
const INSTANT_ISO = '2026-07-01T01:30:00.250Z';

interface ZoneResult {
  day: { periodStart: string; periodEnd: string };
  hour: { periodStart: string; periodEnd: string };
  week: { periodStart: string; periodEnd: string };
  month: { periodStart: string; periodEnd: string };
  resetDay: string;
  resetHour: string;
  resetMonth: string;
  // Invariants computed inside the zone, where local parsing is meaningful.
  endRoundTripsToInstant: boolean;
  startsBeforeInstant: boolean;
  resetsAfterInstant: boolean;
}

const runInZone = (tz: string): ZoneResult => {
  const utilPath = path.resolve(__dirname, 'period.util.ts');
  const script = `
    const RealDate = Date;
    const INSTANT = new RealDate(${JSON.stringify(INSTANT_ISO)}).getTime();
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) { super(INSTANT); } else { super(...args); }
      }
      static now() { return INSTANT; }
    };
    const u = require(${JSON.stringify(utilPath)});
    const parseLocal = (s) => new RealDate(s.replace(' ', 'T')).getTime();
    const periods = ['hour', 'day', 'week', 'month'];
    const out = {
      day: u.computePeriodBoundaries('day'),
      hour: u.computePeriodBoundaries('hour'),
      week: u.computePeriodBoundaries('week'),
      month: u.computePeriodBoundaries('month'),
      resetDay: u.computePeriodResetDate('day'),
      resetHour: u.computePeriodResetDate('hour'),
      resetMonth: u.computePeriodResetDate('month'),
    };
    out.endRoundTripsToInstant = periods.every(
      (p) => parseLocal(u.computePeriodBoundaries(p).periodEnd) === INSTANT,
    );
    out.startsBeforeInstant = periods.every(
      (p) => parseLocal(u.computePeriodBoundaries(p).periodStart) <= INSTANT,
    );
    out.resetsAfterInstant = periods.every(
      (p) => parseLocal(u.computePeriodResetDate(p)) > INSTANT,
    );
    process.stdout.write(JSON.stringify(out));
  `;
  const out = execFileSync(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', '-e', script],
    {
      env: {
        ...process.env,
        TZ: tz,
        TS_NODE_COMPILER_OPTIONS: '{"module":"commonjs"}',
      },
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
    },
  );
  return JSON.parse(out) as ZoneResult;
};

interface ZoneCase {
  tz: string;
  localNow: string;
  dayStart: string;
  hourStart: string;
  monthStart: string;
  resetDay: string;
  resetHour: string;
  resetMonth: string;
}

const CASES: ZoneCase[] = [
  {
    tz: 'UTC',
    localNow: '2026-07-01 01:30:00.250',
    dayStart: '2026-07-01 00:00:00',
    hourStart: '2026-07-01 00:00:00',
    monthStart: '2026-07-01 00:00:00',
    resetDay: '2026-07-02 00:00:00',
    resetHour: '2026-07-01 02:00:00',
    resetMonth: '2026-08-01 00:00:00',
  },
  {
    // UTC-3, no DST. Local date is still 30 June.
    tz: 'America/Sao_Paulo',
    localNow: '2026-06-30 22:30:00.250',
    dayStart: '2026-06-30 00:00:00',
    hourStart: '2026-06-30 21:00:00',
    monthStart: '2026-06-01 00:00:00',
    resetDay: '2026-07-01 00:00:00',
    resetHour: '2026-06-30 23:00:00',
    resetMonth: '2026-07-01 00:00:00',
  },
  {
    // CDT, UTC-5 in July.
    tz: 'America/Chicago',
    localNow: '2026-06-30 20:30:00.250',
    dayStart: '2026-06-30 00:00:00',
    hourStart: '2026-06-30 19:00:00',
    monthStart: '2026-06-01 00:00:00',
    resetDay: '2026-07-01 00:00:00',
    resetHour: '2026-06-30 21:00:00',
    resetMonth: '2026-07-01 00:00:00',
  },
  {
    // UTC+5:30, half-hour offset.
    tz: 'Asia/Kolkata',
    localNow: '2026-07-01 07:00:00.250',
    dayStart: '2026-07-01 00:00:00',
    hourStart: '2026-07-01 06:00:00',
    monthStart: '2026-07-01 00:00:00',
    resetDay: '2026-07-02 00:00:00',
    resetHour: '2026-07-01 08:00:00',
    resetMonth: '2026-08-01 00:00:00',
  },
  {
    // NZST, UTC+12 in July.
    tz: 'Pacific/Auckland',
    localNow: '2026-07-01 13:30:00.250',
    dayStart: '2026-07-01 00:00:00',
    hourStart: '2026-07-01 12:00:00',
    monthStart: '2026-07-01 00:00:00',
    resetDay: '2026-07-02 00:00:00',
    resetHour: '2026-07-01 14:00:00',
    resetMonth: '2026-08-01 00:00:00',
  },
];

describe.each(CASES)('period.util under TZ=$tz', (c) => {
  let result: ZoneResult;

  beforeAll(() => {
    result = runInZone(c.tz);
  }, 30000);

  it('day window runs from local midnight to the exact local now (ms kept)', () => {
    expect(result.day).toEqual({ periodStart: c.dayStart, periodEnd: c.localNow });
  });

  it('periodEnd keeps milliseconds for every period, so same-second rows stay inside', () => {
    for (const p of ['hour', 'day', 'week', 'month'] as const) {
      expect(result[p].periodEnd).toBe(c.localNow);
    }
    expect(result.endRoundTripsToInstant).toBe(true);
  });

  it('hour window starts at the previous local hour', () => {
    expect(result.hour.periodStart).toBe(c.hourStart);
  });

  it('week window starts on the local Monday', () => {
    // Monday 29 June 2026 in every zone above.
    expect(result.week.periodStart).toBe('2026-06-29 00:00:00');
  });

  it('month window starts on the first of the local month', () => {
    expect(result.month.periodStart).toBe(c.monthStart);
  });

  it('resets land on the next local hour / midnight / first of month', () => {
    expect(result.resetHour).toBe(c.resetHour);
    expect(result.resetDay).toBe(c.resetDay);
    expect(result.resetMonth).toBe(c.resetMonth);
  });

  it('every window contains the current instant', () => {
    expect(result.startsBeforeInstant).toBe(true);
    expect(result.resetsAfterInstant).toBe(true);
  });
});
