import {
  IsEnum, IsInt, IsISO8601, IsOptional, IsString,
  Max, Min, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import {
  RsvpStatus, AccommodationType,
} from '../../entities/invitation.entity';

export class CreateInvitationDto {
  @IsString() @MaxLength(200)
  guestLabel!: string;

  @IsOptional() @IsInt() @Min(0) @Max(12)
  plannedCount?: number;

  @IsOptional() @IsEnum(RsvpStatus)
  status?: RsvpStatus;

  @IsOptional() @IsInt() @Min(0) @Max(12)
  adults?: number;

  @IsOptional() @IsInt() @Min(0) @Max(12)
  children?: number;

  @IsOptional() @IsInt() @Min(0) @Max(12)
  forecast?: number;

  @IsOptional() @IsISO8601()
  responseDate?: string;

  @IsOptional() @IsEnum(AccommodationType)
  accommodation?: AccommodationType;

  @IsOptional() @IsString() @MaxLength(500)
  declineReason?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

// PartialType makes every CreateInvitationDto field @IsOptional() while
// preserving their other validators (e.g. @IsString, @MaxLength). Without
// this, a PATCH that omits guestLabel returns 400.
export class UpdateInvitationDto extends PartialType(CreateInvitationDto) {
  // Optimistic concurrency token echoed by the client (TypeORM @VersionColumn).
  @IsOptional() @IsInt() @Min(0)
  version?: number;
}

export class ListInvitationsQueryDto {
  @IsOptional() @IsEnum(RsvpStatus) status?: RsvpStatus;
  @IsOptional() @IsEnum(AccommodationType) accommodation?: AccommodationType;
  @IsOptional() @IsString() @MaxLength(200) q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}
