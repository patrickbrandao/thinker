import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { BrandingController } from '../branding/branding.controller';
import { ShutdownService } from './shutdown.service';

@Module({
  controllers: [HealthController, BrandingController],
  providers: [ShutdownService],
})
export class HealthModule {}
