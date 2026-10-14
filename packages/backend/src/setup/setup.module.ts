import { Module } from '@nestjs/common';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { SetupTokenService } from './setup-token.service';

@Module({
  controllers: [SetupController],
  providers: [SetupService, SetupTokenService],
})
export class SetupModule {}
