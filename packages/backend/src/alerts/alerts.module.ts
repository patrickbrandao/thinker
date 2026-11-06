import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AuditInterceptor } from './audit.interceptor';

@Module({
  controllers: [AlertsController],
  providers: [AlertsService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AlertsModule {}
