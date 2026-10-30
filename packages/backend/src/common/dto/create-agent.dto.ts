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
import { AGENT_CATEGORIES, AGENT_PLATFORMS } from 'thinker-shared';

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9 _-]+$/, {
    message: 'Agent name must contain only letters, numbers, spaces, dashes, and underscores',
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
