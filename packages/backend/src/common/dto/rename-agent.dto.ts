import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  IsIn,
} from 'class-validator';
import {
  AGENT_CATEGORIES,
  AGENT_PLATFORMS,
  AGENT_NAME_MAX_LENGTH,
  AGENT_NAME_PATTERN,
} from 'thinker-shared';

export class RenameAgentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(AGENT_NAME_MAX_LENGTH)
  @Matches(AGENT_NAME_PATTERN, {
    message:
      'Agent name must be a DNS label: lowercase letters, numbers and inner hyphens (a-z, 0-9, -)',
  })
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn([...AGENT_CATEGORIES])
  agent_category?: string;

  @IsOptional()
  @IsString()
  @IsIn([...AGENT_PLATFORMS])
  agent_platform?: string;
}
