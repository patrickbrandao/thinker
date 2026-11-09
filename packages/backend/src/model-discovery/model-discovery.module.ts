import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantProvider } from '../entities/tenant-provider.entity';
import { AgentEnabledProvider } from '../entities/agent-enabled-provider.entity';
import { CustomProvider } from '../entities/custom-provider.entity';
import { ModelPricesModule } from '../model-prices/model-prices.module';
import { ProviderModelFetcherService } from './provider-model-fetcher.service';
import { ModelDiscoveryService } from './model-discovery.service';
import { OpencodeCatalogService } from './opencode-catalog.service';
import { CopilotTokenService } from '../routing/proxy/copilot-token.service';
import { LiveContextService } from './live-context';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantProvider, AgentEnabledProvider, CustomProvider]),
    ModelPricesModule,
  ],
  providers: [
    ProviderModelFetcherService,
    ModelDiscoveryService,
    OpencodeCatalogService,
    CopilotTokenService,
    LiveContextService,
  ],
  exports: [ModelDiscoveryService, ProviderModelFetcherService, OpencodeCatalogService],
})
export class ModelDiscoveryModule {}
