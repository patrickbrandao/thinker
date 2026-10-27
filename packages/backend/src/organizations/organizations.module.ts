import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../entities/tenant.entity';
import { OrganizationMember } from '../entities/organization-member.entity';
import { UserProfile } from '../entities/user-profile.entity';
import { AccountsService } from './accounts.service';
import { OrganizationsService } from './organizations.service';
import {
  AdminUsersController,
  MeAccountController,
  OrganizationsController,
} from './organizations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, OrganizationMember, UserProfile])],
  controllers: [OrganizationsController, MeAccountController, AdminUsersController],
  providers: [AccountsService, OrganizationsService],
  exports: [AccountsService, OrganizationsService],
})
export class OrganizationsModule {}
