import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { thinkerVersion } from '../common/utils/thinker-version';

/**
 * `GET /version` (outside `/api`): a JSON identity some harnesses probe to
 * classify the server (Hermes caches the verdict instead of re-probing every
 * few minutes). Without it the SPA fallback answers HTML. Deliberately no
 * `/props`: a llama.cpp-shaped answer would make the client apply one
 * server's `n_ctx` to every model.
 */
@Controller()
export class VersionController {
  @Public()
  @Get('version')
  @Header('Cache-Control', 'no-cache')
  getVersion(): { version: string; name: string } {
    return { version: `thinker-${thinkerVersion() ?? 'unknown'}`, name: 'thinker' };
  }
}
