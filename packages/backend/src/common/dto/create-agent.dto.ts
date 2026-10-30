import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  IsIn,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { MAX_LOG_RETENTION_DAYS } from '../../config/recording-retention';
import {
  AGENT_CATEGORIES,
  AGENT_PLATFORMS,
  AGENT_NAME_MAX_LENGTH,
  AGENT_NAME_PATTERN,
} from 'thinker-shared';

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(AGENT_NAME_MAX_LENGTH)
  @Matches(AGENT_NAME_PATTERN, {
    message:
      'Agent name must be a DNS label: lowercase letters, numbers and inner hyphens (a-z, 0-9, -)',
  })
  name!: string;

  @IsOptional()
  @IsString()
  @IsIn([...AGENT_CATEGORIES])
  agent_category?: string;

  @IsOptional()
  @IsString()
  @IsIn([...AGENT_PLATFORMS])
  agent_platform?: string;

  /** Explicit recording choice at creation. Omit to keep the column default. */
  @IsOptional()
  @IsBoolean()
  record_messages?: boolean;

  /** Days to keep this harness's logs. Omit or null to follow the organization. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_LOG_RETENTION_DAYS)
  log_retention_days?: number | null;
}
