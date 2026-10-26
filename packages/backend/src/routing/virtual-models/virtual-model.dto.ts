import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  AUTH_TYPES,
  MAX_VIRTUAL_MODEL_FALLBACKS,
  OUTPUT_MODALITIES,
  RESPONSE_MODES,
  type AuthType,
  type OutputModality,
  type ResponseMode,
} from 'thinker-shared';
import { MAX_PROVIDER_KEY_LABEL_LENGTH } from '../dto/routing.dto';

/**
 * A route as a client sends it on create: only the model is required. The
 * service resolves it against the agent's catalog. Name validation lives in
 * the service (`validateVirtualModelName`) so every surface gets the same
 * message.
 */
export class VirtualModelRouteInputDto {
  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  provider?: string;

  @IsOptional()
  @IsIn(AUTH_TYPES)
  authType?: AuthType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PROVIDER_KEY_LABEL_LENGTH)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  keyLabel?: string;
}

export class CreateVirtualModelDto {
  @IsString()
  name!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VirtualModelRouteInputDto)
  override_route?: VirtualModelRouteInputDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_VIRTUAL_MODEL_FALLBACKS)
  @ValidateNested({ each: true })
  @Type(() => VirtualModelRouteInputDto)
  fallback_routes?: VirtualModelRouteInputDto[];

  @IsOptional()
  @IsBoolean()
  continue_on_default?: boolean;

  @IsOptional()
  @IsIn(RESPONSE_MODES)
  response_mode?: ResponseMode;

  @IsOptional()
  @IsIn(OUTPUT_MODALITIES)
  output_modality?: OutputModality;
}

export class UpdateVirtualModelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  continue_on_default?: boolean;

  @IsOptional()
  @IsIn(OUTPUT_MODALITIES)
  output_modality?: OutputModality;
}

export class ToggleVirtualModelDto {
  @IsBoolean()
  enabled!: boolean;
}

export class ReorderVirtualModelsDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}
