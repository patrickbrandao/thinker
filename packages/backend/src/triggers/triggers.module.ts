import { Module } from '@nestjs/common';
import { TriggersController } from './triggers.controller';
import { TriggersService } from './triggers.service';
import { TriggerDispatchService } from './trigger-dispatch.service';
import { TriggerWorkerService } from './trigger-worker.service';
import { TriggerListenerService } from './trigger-listener.service';

@Module({
  controllers: [TriggersController],
  providers: [
    TriggersService,
    TriggerDispatchService,
    TriggerWorkerService,
    TriggerListenerService,
  ],
})
export class TriggersModule {}
