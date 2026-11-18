import { Module } from '@nestjs/common';
import { IpPrefixesController } from './ip-prefixes.controller';
import { IpPrefixesService } from './ip-prefixes.service';

/** IP prefix lists; the agent-key guard reads them through ip-restriction-cache. */
@Module({
  controllers: [IpPrefixesController],
  providers: [IpPrefixesService],
})
export class IpPrefixesModule {}
