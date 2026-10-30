import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator';
import { AGENT_NAME_MAX_LENGTH, AGENT_NAME_PATTERN } from 'thinker-shared';

export class DuplicateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(AGENT_NAME_MAX_LENGTH)
  @Matches(AGENT_NAME_PATTERN, {
    message:
      'Agent name must be a DNS label: lowercase letters, numbers and inner hyphens (a-z, 0-9, -)',
  })
  name!: string;
}
