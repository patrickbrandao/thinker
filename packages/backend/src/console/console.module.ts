import { Module } from '@nestjs/common';
import { ConsoleController } from './console.controller';
import { ConsoleService } from './console.service';
import { TopologyService } from './topology.service';

@Module({
  controllers: [ConsoleController],
  providers: [ConsoleService, TopologyService],
})
export class ConsoleModule {}
