import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../entities/tenant.entity';
import { Agent } from '../entities/agent.entity';
import { OrganizationMember } from '../entities/organization-member.entity';
import { UserProfile } from '../entities/user-profile.entity';
import { IngestEventBusService } from './services/ingest-event-bus.service';
import { ThinkerRuntimeService } from './services/thinker-runtime.service';
import { TenantCacheService } from './services/tenant-cache.service';
import { UserCacheInterceptor } from './interceptors/user-cache.interceptor';
import { AgentCacheInterceptor } from './interceptors/agent-cache.interceptor';
import { AgentRecordingConfigService } from './services/agent-recording-config.service';
import { RequestRecordingStorageService } from './services/request-recording-storage.service';
import { AgentListCacheInterceptor } from './interceptors/agent-list-cache.interceptor';
import { AgentListCacheService } from './services/agent-list-cache.service';
import { TriggerSignalService } from './services/trigger-signal.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, Agent, OrganizationMember, UserProfile])],
  providers: [
    IngestEventBusService,
    ThinkerRuntimeService,
    TenantCacheService,
    UserCacheInterceptor,
    AgentCacheInterceptor,
    AgentListCacheInterceptor,
    AgentListCacheService,
    AgentRecordingConfigService,
    RequestRecordingStorageService,
    TriggerSignalService,
  ],
  exports: [
    IngestEventBusService,
    ThinkerRuntimeService,
    TenantCacheService,
    UserCacheInterceptor,
    AgentCacheInterceptor,
    AgentListCacheInterceptor,
    AgentListCacheService,
    AgentRecordingConfigService,
    RequestRecordingStorageService,
    TriggerSignalService,
  ],
})
export class CommonModule {}
