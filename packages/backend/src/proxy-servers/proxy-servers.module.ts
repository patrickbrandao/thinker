import { Global, Module } from '@nestjs/common';
import { ProxyServersController } from './proxy-servers.controller';
import { ProxyServersService } from './proxy-servers.service';
import { ProxyEgressService } from './proxy-egress.service';

/** Outbound proxy servers. Global: providers, triggers and OAuth resolve chains here. */
@Global()
@Module({
  controllers: [ProxyServersController],
  providers: [ProxyServersService, ProxyEgressService],
  exports: [ProxyEgressService],
})
export class ProxyServersModule {}
