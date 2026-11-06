import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { BrandingController } from '../branding/branding.controller';
import { ShutdownService } from './shutdown.service';
import { VersionController } from './version.controller';

@Module({
  controllers: [HealthController, BrandingController, VersionController],
  providers: [ShutdownService],
})
export class HealthModule {}
