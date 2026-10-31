import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  Matches,
  MaxLength,
  MinLength,
  ArrayMinSize,
  ArrayMaxSize,
  IsUrl,
  IsIn,
  Min,
  IsBoolean,
  IsInt,
  Max,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  CUSTOM_PROVIDER_ALIAS_MAX_LENGTH,
  CUSTOM_PROVIDER_ALIAS_MESSAGE,
  CUSTOM_PROVIDER_ALIAS_PATTERN,
  normalizeCustomProviderAlias,
} from 'thinker-shared';
import {
  MAX_STREAM_WARMUP_OVERRIDE_MS,
  MIN_STREAM_WARMUP_OVERRIDE_MS,
} from '../proxy/stream-warmup';
import {
  LOCAL_SERVER_MAX_TIMEOUT_MS,
  LOCAL_SERVER_MIN_TIMEOUT_MS,
  LOCAL_SERVER_TYPES,
  type LocalServerType,
} from '../../common/constants/local-servers';

/**
 * Connection settings of a local server. The service assembles the base URL
 * from them and re-validates the result (no credentials, query or fragment).
 */
export class LocalServerConfigDto {
  @IsIn(['http', 'https'])
  scheme!: 'http' | 'https';

  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  path_prefix?: string;

  @IsOptional()
  @IsInt()
  @Min(LOCAL_SERVER_MIN_TIMEOUT_MS)
  @Max(LOCAL_SERVER_MAX_TIMEOUT_MS)
  request_timeout_ms?: number;

  @IsOptional()
  @IsInt()
  @Min(LOCAL_SERVER_MIN_TIMEOUT_MS)
  @Max(LOCAL_SERVER_MAX_TIMEOUT_MS)
  probe_timeout_ms?: number;
}

const LOCAL_TYPE_MESSAGE = 'local_type must be "ollama", "lmstudio" or "llamacpp"';

/**
 * Public prefix of the provider's model ids (`<alias>/<model_name>`).
 * Normalised to lowercase; an empty string clears it. Omitted on create
 * derives one from the name; omitted on update leaves it untouched.
 */
function AliasField(): PropertyDecorator {
  const decorators = [
    IsOptional(),
    Transform(({ value }) =>
      typeof value === 'string' ? normalizeCustomProviderAlias(value) : value,
    ),
    IsString(),
    MaxLength(CUSTOM_PROVIDER_ALIAS_MAX_LENGTH),
    Matches(CUSTOM_PROVIDER_ALIAS_PATTERN, { message: CUSTOM_PROVIDER_ALIAS_MESSAGE }),
  ];
  return (target, propertyKey) => {
    for (const decorator of decorators) decorator(target, propertyKey);
  };
}

export const CUSTOM_PROVIDER_API_KINDS = ['openai', 'anthropic'] as const;
export type CustomProviderApiKindDto = (typeof CUSTOM_PROVIDER_API_KINDS)[number];
export const CUSTOM_PROVIDER_MODEL_LIMIT = 500;

export class CustomProviderModelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model_name!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  input_price_per_million_tokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  output_price_per_million_tokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  context_window?: number;

  @IsOptional()
  @IsBoolean()
  price_estimated?: boolean;

  @IsOptional()
  @IsArray()
  @IsIn(['tools', 'vision', 'reasoning'], { each: true })
  capabilities?: ('tools' | 'vision' | 'reasoning')[];
}

export class CreateCustomProviderDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9 ._-]+$/, {
    message: 'Name can only contain letters, numbers, spaces, dots, hyphens, and underscores',
  })
  name!: string;

  @AliasField()
  alias?: string | null;

  @ValidateIf((o: { local_type?: unknown }) => o.local_type === undefined)
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, require_protocol: true }, { message: 'Must be a valid URL' })
  base_url!: string;

  /** Local servers: the runner type. The base URL is then built from `local_config`. */
  @IsOptional()
  @IsIn(LOCAL_SERVER_TYPES, { message: LOCAL_TYPE_MESSAGE })
  local_type?: LocalServerType;

  /** Omitted: the type's defaults (container host alias, documented port). */
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalServerConfigDto)
  local_config?: LocalServerConfigDto;

  @IsOptional()
  @IsIn(CUSTOM_PROVIDER_API_KINDS, { message: 'api_kind must be "openai" or "anthropic"' })
  api_kind?: CustomProviderApiKindDto;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CUSTOM_PROVIDER_MODEL_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => CustomProviderModelDto)
  models!: CustomProviderModelDto[];
}

export class ProbeCustomProviderDto {
  @ValidateIf((o: { local_type?: unknown }) => o.local_type === undefined)
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, require_protocol: true }, { message: 'Must be a valid URL' })
  base_url!: string;

  /** Local servers: the runner type. The base URL is then built from `local_config`. */
  @IsOptional()
  @IsIn(LOCAL_SERVER_TYPES, { message: LOCAL_TYPE_MESSAGE })
  local_type?: LocalServerType;

  /** Omitted: the type's defaults (container host alias, documented port). */
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalServerConfigDto)
  local_config?: LocalServerConfigDto;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider_name?: string;

  @IsOptional()
  @IsIn(CUSTOM_PROVIDER_API_KINDS, { message: 'api_kind must be "openai" or "anthropic"' })
  api_kind?: CustomProviderApiKindDto;

  @IsOptional()
  @IsString()
  apiKey?: string;

  // Edit-mode fallback: when the form re-opens an existing provider it has
  // no plaintext key (list() only returns has_api_key:bool). Sending the
  // provider id lets the server decrypt and reuse the stored key for the
  // probe. The lookup is tenant-scoped, and the key is only used when
  // base_url and api_kind match the stored provider, so it can't be sent to
  // another server. UUID (36 chars); cap defensively.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  provider_id?: string;
}

export class UpdateCustomProviderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9 ._-]+$/, {
    message: 'Name can only contain letters, numbers, spaces, dots, hyphens, and underscores',
  })
  name?: string;

  @AliasField()
  alias?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, require_protocol: true }, { message: 'Must be a valid URL' })
  base_url?: string;

  @IsOptional()
  @IsIn(CUSTOM_PROVIDER_API_KINDS, { message: 'api_kind must be "openai" or "anthropic"' })
  api_kind?: CustomProviderApiKindDto;

  /** Local servers only: new connection settings (the type never changes). */
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalServerConfigDto)
  local_config?: LocalServerConfigDto;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CUSTOM_PROVIDER_MODEL_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => CustomProviderModelDto)
  models?: CustomProviderModelDto[];

  /**
   * Stream warm-up override in ms for the provider's primary connection
   * (#244). Omitted leaves it untouched; null clears it.
   */
  @IsOptional()
  @IsInt()
  @Min(MIN_STREAM_WARMUP_OVERRIDE_MS)
  @Max(MAX_STREAM_WARMUP_OVERRIDE_MS)
  stream_warmup_ms?: number | null;
}
