import { OpenaiOauthService } from '../oauth/openai/openai-oauth.service';
import { MinimaxOauthService } from '../oauth/minimax/minimax-oauth.service';
import { AnthropicOauthService } from '../oauth/anthropic/anthropic-oauth.service';
import { GeminiOauthService } from '../oauth/gemini/gemini-oauth.service';
import { parseOAuthTokenBlob, REJECTED_TOKEN_EXPIRY } from '../oauth/core';
import { KiroOauthService } from '../oauth/kiro/kiro-oauth.service';
import { XaiOauthService } from '../oauth/xai/xai-oauth.service';
import { OpencodeOauthService } from '../oauth/opencode/opencode-oauth.service';

export interface OAuthServiceSet {
  openaiOauth: OpenaiOauthService;
  minimaxOauth: MinimaxOauthService;
  anthropicOauth: AnthropicOauthService;
  geminiOauth: GeminiOauthService;
  kiroOauth: KiroOauthService;
  xaiOauth: XaiOauthService;
  opencodeOauth?: OpencodeOauthService;
}

export interface ResolvedCredentials {
  apiKey: string | null;
  resourceUrl?: string;
}

function expireRefreshableOAuthBlob(rawValue: string): string | null {
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const blob = parsed as Record<string, unknown>;
    if (typeof blob.t !== 'string' || typeof blob.r !== 'string' || typeof blob.e !== 'number') {
      return null;
    }
    if (!blob.r) return null;
    return JSON.stringify({ ...blob, e: REJECTED_TOKEN_EXPIRY });
  } catch {
    return null;
  }
}

export function isRefreshableOAuthCredential(rawValue: string): boolean {
  return expireRefreshableOAuthBlob(rawValue) !== null;
}

export async function refreshRejectedOAuthCredential(
  provider: string,
  rawValue: string,
  agentId: string,
  tenantId: string,
  keyLabel: string | undefined,
  services: OAuthServiceSet,
): Promise<ResolvedCredentials | null> {
  const expiredRawValue = expireRefreshableOAuthBlob(rawValue);
  if (!expiredRawValue) return null;

  const lower = provider.toLowerCase();
  if (lower === 'openai') {
    const unwrapped = await services.openaiOauth.unwrapToken(
      expiredRawValue,
      agentId,
      tenantId,
      keyLabel,
    );
    return unwrapped ? { apiKey: unwrapped } : null;
  }
  if (lower === 'minimax') {
    const unwrapped = await services.minimaxOauth.unwrapToken(
      expiredRawValue,
      agentId,
      tenantId,
      keyLabel,
    );
    return unwrapped ? { apiKey: unwrapped.t, resourceUrl: unwrapped.u } : null;
  }
  if (lower === 'anthropic') {
    const unwrapped = await services.anthropicOauth.unwrapToken(
      expiredRawValue,
      agentId,
      tenantId,
      keyLabel,
    );
    return unwrapped ? { apiKey: unwrapped } : null;
  }
  if (lower === 'gemini') {
    const unwrapped = await services.geminiOauth.unwrapToken(
      expiredRawValue,
      agentId,
      tenantId,
      keyLabel,
    );
    return unwrapped ? { apiKey: unwrapped, resourceUrl: parseOAuthTokenBlob(rawValue)?.u } : null;
  }
  if (lower === 'kiro') {
    const unwrapped = await services.kiroOauth.unwrapToken(
      expiredRawValue,
      agentId,
      tenantId,
      keyLabel,
    );
    return unwrapped ? { apiKey: unwrapped } : null;
  }
  if (lower === 'xai') {
    const unwrapped = await services.xaiOauth.unwrapToken(
      expiredRawValue,
      agentId,
      tenantId,
      keyLabel,
    );
    return unwrapped ? { apiKey: unwrapped } : null;
  }
  if ((lower === 'opencode-go' || lower === 'opencodego') && services.opencodeOauth) {
    const unwrapped = await services.opencodeOauth.unwrapToken(
      expiredRawValue,
      agentId,
      tenantId,
      keyLabel,
    );
    return unwrapped ? { apiKey: unwrapped } : null;
  }
  return null;
}

export async function resolveApiKey(
  provider: string,
  apiKey: string,
  authType: string | undefined,
  agentId: string,
  tenantId: string,
  openaiOauth: OpenaiOauthService,
  minimaxOauth: MinimaxOauthService,
  anthropicOauth: AnthropicOauthService,
  geminiOauth: GeminiOauthService,
  kiroOauth: KiroOauthService,
  xaiOauth: XaiOauthService,
  keyLabel?: string,
  opencodeOauth?: OpencodeOauthService,
): Promise<ResolvedCredentials> {
  if (authType === 'subscription') {
    const lower = provider.toLowerCase();
    if (lower === 'openai') {
      const unwrapped = await openaiOauth.unwrapToken(apiKey, agentId, tenantId, keyLabel);
      if (unwrapped) return { apiKey: unwrapped };
      if (parseOAuthTokenBlob(apiKey)) return { apiKey: null };
    }
    if (lower === 'minimax') {
      const unwrapped = await minimaxOauth.unwrapToken(apiKey, agentId, tenantId, keyLabel);
      if (unwrapped) return { apiKey: unwrapped.t, resourceUrl: unwrapped.u };
      if (parseOAuthTokenBlob(apiKey)) return { apiKey: null };
    }
    if (lower === 'anthropic') {
      const unwrapped = await anthropicOauth.unwrapToken(apiKey, agentId, tenantId, keyLabel);
      if (unwrapped) return { apiKey: unwrapped };
      if (parseOAuthTokenBlob(apiKey)) return { apiKey: null };
    }
    if (lower === 'gemini') {
      const unwrapped = await geminiOauth.unwrapToken(apiKey, agentId, tenantId, keyLabel);
      if (unwrapped) {
        // The CodeAssist project id was stored in `blob.u` by enrichBlob.
        // Read it from the input blob (refreshes preserve the field).
        const projectId = parseOAuthTokenBlob(apiKey)?.u;
        return { apiKey: unwrapped, resourceUrl: projectId };
      }
      if (parseOAuthTokenBlob(apiKey)) return { apiKey: null };
    }
    if (lower === 'kiro') {
      const unwrapped = await kiroOauth.unwrapToken(apiKey, agentId, tenantId, keyLabel);
      if (unwrapped) return { apiKey: unwrapped };
      if (parseOAuthTokenBlob(apiKey)) return { apiKey: null };
    }
    if (lower === 'xai') {
      const unwrapped = await xaiOauth.unwrapToken(apiKey, agentId, tenantId, keyLabel);
      if (unwrapped) return { apiKey: unwrapped };
      if (parseOAuthTokenBlob(apiKey)) return { apiKey: null };
    }
    // OpenCode Go takes either a Console OAuth blob or a pasted API key.
    if ((lower === 'opencode-go' || lower === 'opencodego') && opencodeOauth) {
      const unwrapped = await opencodeOauth.unwrapToken(apiKey, agentId, tenantId, keyLabel);
      if (unwrapped) return { apiKey: unwrapped };
      if (parseOAuthTokenBlob(apiKey)) return { apiKey: null };
    }
  }
  return { apiKey };
}
