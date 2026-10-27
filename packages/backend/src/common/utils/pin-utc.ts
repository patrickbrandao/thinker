/**
 * Side-effect import: pins the process time zone to UTC (#58). Import it
 * before anything else in each entry point so no Date is created in another
 * zone. See ./utc-clock.ts for the convention.
 */
import { pinProcessTimeZoneToUtc } from './utc-clock';

/** The non-UTC `TZ` the environment asked for, or null. */
export const overriddenTimeZone = pinProcessTimeZoneToUtc();
