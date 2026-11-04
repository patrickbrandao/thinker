import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantProvider } from '../../entities/tenant-provider.entity';
import { RoutingCoreModule } from '../routing-core/routing-core.module';
import { ModelDiscoveryModule } from '../../model-discovery/model-discovery.module';
import { OpenaiOauthService } from './openai/openai-oauth.service';
import { OpenaiOauthController } from './openai/openai-oauth.controller';
import { MinimaxOauthService } from './minimax/minimax-oauth.service';
import { MinimaxOauthController } from './minimax/minimax-oauth.controller';
import { CopilotDeviceAuthService } from './copilot/copilot-device-auth.service';
import { AnthropicOauthService } from './anthropic/anthropic-oauth.service';
import { AnthropicOauthController } from './anthropic/anthropic-oauth.controller';
import { KiroOauthService } from './kiro/kiro-oauth.service';
import { KiroOauthController } from './kiro/kiro-oauth.controller';
import { XaiOauthController } from './xai/xai-oauth.controller';
import { XaiOauthService } from './xai/xai-oauth.service';
import { OAuthPendingFlowStore } from './core';
import { GeminiOauthService } from './gemini/gemini-oauth.service';
import { GeminiOauthController } from './gemini/gemini-oauth.controller';
import { CodeAssistClientService } from './gemini/codeassist-client.service';
import { OpencodeOauthService } from './opencode/opencode-oauth.service';
import { OpencodeOauthController } from './opencode/opencode-oauth.controller';
import { OpencodeConsoleMonitor } from './opencode/opencode-console-monitor.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantProvider]), RoutingCoreModule, ModelDiscoveryModule],
  controllers: [
    OpenaiOauthController,
    MinimaxOauthController,
    AnthropicOauthController,
    GeminiOauthController,
    KiroOauthController,
    XaiOauthController,
    OpencodeOauthController,
  ],
  providers: [
    OpenaiOauthService,
    MinimaxOauthService,
    CopilotDeviceAuthService,
    AnthropicOauthService,
    KiroOauthService,
    XaiOauthService,
    OAuthPendingFlowStore,
    GeminiOauthService,
    CodeAssistClientService,
    OpencodeOauthService,
    OpencodeConsoleMonitor,
  ],
  exports: [
    OpenaiOauthService,
    MinimaxOauthService,
    CopilotDeviceAuthService,
    AnthropicOauthService,
    GeminiOauthService,
    KiroOauthService,
    XaiOauthService,
    OpencodeOauthService,
  ],
})
export class OAuthModule {}
