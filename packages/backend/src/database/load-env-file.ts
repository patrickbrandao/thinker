import { existsSync } from 'node:fs';
import { pinProcessTimeZoneToUtc } from '../common/utils/utc-clock';

/**
 * Side-effect import for the standalone CLIs (migrations, backfills) that run
 * outside Nest's ConfigModule. Loads `.env` from the working directory with
 * Node's native loader, so no `dotenv` dependency is needed. Like
 * `dotenv/config`, a missing file is not an error and variables already set in
 * the environment win over the file.
 */
const envFile = '.env';
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
// The CLIs store timestamps too: same UTC clock as the server (#58).
pinProcessTimeZoneToUtc();
