import { Module } from '@nestjs/common';
import { RoutingCoreModule } from '../routing-core/routing-core.module';
import { VirtualModelsModule } from '../virtual-models/virtual-models.module';
import { ModelDiscoveryModule } from '../../model-discovery/model-discovery.module';
import { RouteModelParamsService } from './route-model-params.service';
import { RouteModelParamsController } from './route-model-params.controller';

@Module({
  imports: [RoutingCoreModule, VirtualModelsModule, ModelDiscoveryModule],
  providers: [RouteModelParamsService],
  controllers: [RouteModelParamsController],
  exports: [RouteModelParamsService],
})
export class RouteModelParamsModule {}
