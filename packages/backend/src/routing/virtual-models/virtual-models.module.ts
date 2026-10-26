import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VirtualModel } from '../../entities/virtual-model.entity';
import { AgentModelParams } from '../../entities/agent-model-params.entity';
import { Agent } from '../../entities/agent.entity';
import { ModelDiscoveryModule } from '../../model-discovery/model-discovery.module';
import { RoutingCoreModule } from '../routing-core/routing-core.module';
import { VirtualModelService } from './virtual-model.service';
import { VirtualModelController } from './virtual-model.controller';
import { ModelListRoutingService } from './model-list-routing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([VirtualModel, AgentModelParams, Agent]),
    ModelDiscoveryModule,
    RoutingCoreModule,
  ],
  providers: [VirtualModelService, ModelListRoutingService],
  controllers: [VirtualModelController],
  exports: [VirtualModelService, ModelListRoutingService],
})
export class VirtualModelsModule {}
