import { Module } from '@nestjs/common';
import { LiveSessionController } from './live-session.controller';
import { LiveSessionHistoryService } from './live-session-history.service';
import { LiveSessionHubService } from './live-session-hub.service';

/**
 * Live session window backend (docs/dev/janela-sessao-ao-vivo.md): the
 * in-memory hub the proxy feeds, the SSE feed and the replay history.
 */
@Module({
  controllers: [LiveSessionController],
  providers: [LiveSessionHubService, LiveSessionHistoryService],
  exports: [LiveSessionHubService],
})
export class LiveSessionModule {}
