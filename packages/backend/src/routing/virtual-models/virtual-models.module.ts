import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VirtualModel } from '../../entities/virtual-model.entity';
import { AgentModelParams } from '../../entities/agent-model-params.entity';
import { ModelDiscoveryModule } from '../../model-discovery/model-discovery.module';
import { RoutingCoreModule } from '../routing-core/routing-core.module';
import { VirtualModelService } from './virtual-model.service';
import { VirtualModelController } from './virtual-model.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([VirtualModel, AgentModelParams]),
    ModelDiscoveryModule,
    RoutingCoreModule,
  ],
  providers: [VirtualModelService],
  controllers: [VirtualModelController],
  exports: [VirtualModelService],
})
export class VirtualModelsModule {}
