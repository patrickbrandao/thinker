import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAdminDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  /**
   * One-time token printed in the server log on a fresh install (#29).
   * Optional at the DTO level so a missing token gets the same 403 as a
   * wrong one; the service enforces it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  setupToken?: string;
}
