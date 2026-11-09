import {
  IsString,
  IsIn,
  IsNumber,
  IsOptional,
  IsBoolean,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Minimum threshold per metric: cost is a currency amount (> 0, at most two
 * decimals, so 0.01 is the smallest), tokens is a whole number >= 1.
 * Returns the error message, or null when the value is valid.
 */
export function thresholdError(metric: string | undefined, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'threshold must be a number';
  if (metric === 'tokens') {
    return Number.isInteger(value) && value >= 1
      ? null
      : 'threshold must be a whole number of at least 1 for token limits';
  }
  if (metric === 'cost') {
    const cents = Math.round(value * 100);
    return value > 0 && cents >= 1 && Math.abs(cents - value * 100) < 1e-6
      ? null
      : 'threshold must be greater than 0 with at most 2 decimals (minimum 0.01) for cost limits';
  }
  // Unknown metric on update: the service checks against the stored metric.
  return value > 0 ? null : 'threshold must be greater than 0';
}

@ValidatorConstraint({ name: 'thresholdForMetric' })
class ThresholdForMetric implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const metric = (args.object as { metric_type?: string }).metric_type;
    return thresholdError(metric, value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const metric = (args.object as { metric_type?: string }).metric_type;
    return thresholdError(metric, args.value) ?? 'invalid threshold';
  }
}

export class CreateNotificationRuleDto {
  @IsString()
  agent_name!: string;

  @IsIn(['tokens', 'cost'])
  metric_type!: 'tokens' | 'cost';

  @IsNumber()
  @Validate(ThresholdForMetric)
  @Type(() => Number)
  threshold!: number;

  @IsIn(['hour', 'day', 'week', 'month'])
  period!: 'hour' | 'day' | 'week' | 'month';

  @IsOptional()
  @IsIn(['notify', 'block', 'both'])
  action?: 'notify' | 'block' | 'both';
}

export class UpdateNotificationRuleDto {
  @IsOptional()
  @IsIn(['tokens', 'cost'])
  metric_type?: 'tokens' | 'cost';

  @IsOptional()
  @IsNumber()
  @Validate(ThresholdForMetric)
  @Type(() => Number)
  threshold?: number;

  @IsOptional()
  @IsIn(['hour', 'day', 'week', 'month'])
  period?: 'hour' | 'day' | 'week' | 'month';

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_active?: boolean;

  @IsOptional()
  @IsIn(['notify', 'block', 'both'])
  action?: 'notify' | 'block' | 'both';
}
