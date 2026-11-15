import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderService } from '../../routing-core/provider.service';
import { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import { PendingOAuth } from './openai-oauth.types';
import { oauthDoneHtml, type OAuthTokenBlob } from '../core';
import { RedirectPkceOauthBaseService } from '../core/redirect-pkce-oauth.base';
import { OPENAI_OAUTH_URLS } from '../../provider-urls/provider-url-constants';

export { PendingOAuth };
export { oauthDoneHtml, type OAuthTokenBlob };

const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

@Injectable()
export class OpenaiOauthService extends RedirectPkceOauthBaseService {
  constructor(
    providerService: ProviderService,
    configService: ConfigService,
    discoveryService: ModelDiscoveryService,
  ) {
    super(providerService, configService, discoveryService, {
      providerId: 'openai',
      serviceName: OpenaiOauthService.name,
      defaultClientId: DEFAULT_CLIENT_ID,
      clientIdEnvVar: 'OPENAI_OAUTH_CLIENT_ID',
      authorizeUrl: OPENAI_OAUTH_URLS.authorize,
      tokenUrl: OPENAI_OAUTH_URLS.token,
      revokeUrl: OPENAI_OAUTH_URLS.revoke,
      scope: 'openid profile email offline_access',
      // Codex CLI login extras: organizations in the id_token and the simplified
      // flow, so Team/Business accounts pick a workspace (sub-openai G5).
      extraAuthorizeParams: {
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'codex_cli_rs',
      },
      callbackPort: 1455,
    });
  }
}
