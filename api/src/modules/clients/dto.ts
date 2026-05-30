import {
  IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf,
} from 'class-validator';

export class CreateClientDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(60) slug?: string;
  @IsOptional() @IsString() @MaxLength(120) googleSheetId?: string;
  @IsOptional() @IsString() @MaxLength(120) googleSheetTab?: string;
}

export class UpdateClientDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(60) slug?: string;
  @IsOptional() @IsString() @MaxLength(120) googleSheetId?: string;
  @IsOptional() @IsString() @MaxLength(120) googleSheetTab?: string;
}

// A member is identified by EITHER an existing userId OR an email (resolved to
// an existing, non-deleted user). Exactly one is required.
export class AddMemberDto {
  @ValidateIf((o) => !o.email) @IsUUID() userId?: string;
  @ValidateIf((o) => !o.userId) @IsEmail() email?: string;
  @IsIn(['OWNER', 'EDITOR', 'VIEWER']) role!: 'OWNER' | 'EDITOR' | 'VIEWER';
}

export class UpdateMemberDto {
  @IsIn(['OWNER', 'EDITOR', 'VIEWER']) role!: 'OWNER' | 'EDITOR' | 'VIEWER';
}
