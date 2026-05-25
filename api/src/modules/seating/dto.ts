import {
  IsBoolean, IsInt, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreatePlanDto {
  @IsString() @MaxLength(120)
  name!: string;

  @IsInt() @Min(1) @Max(50)
  tableCount!: number;

  @IsInt() @Min(1) @Max(30)
  seatsPerTable!: number;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {
  // Only `name` and `notes` are honoured on PATCH — table/seat counts are
  // changed through the dedicated table endpoints. `version` is the
  // optimistic-lock token.
  @IsOptional() @IsInt() @Min(0)
  version?: number;
}

export class UpdateTableDto {
  @IsOptional() @IsInt() @Min(1) @Max(200)
  tableNumber?: number;

  @IsOptional() @IsInt() @Min(1) @Max(30)
  seatCount?: number;

  @IsOptional() @IsString() @MaxLength(120)
  label?: string;
}

export class CreateTableDto {
  @IsInt() @Min(1) @Max(30)
  seatCount!: number;

  // Optional: omit and the server picks max(tableNumber) + 1.
  @IsOptional() @IsInt() @Min(1) @Max(200)
  tableNumber?: number;

  @IsOptional() @IsString() @MaxLength(120)
  label?: string;
}

// Exactly one of {attendeeId} OR {invitationId, slotIndex} must be set.
// We accept all three fields and enforce the XOR with @ValidateIf so the
// payload mirrors the schema's chk_seat_one_assignment.
export class AssignSeatDto {
  @ValidateIf((o: AssignSeatDto) => o.invitationId == null)
  @IsUUID()
  attendeeId?: string;

  @ValidateIf((o: AssignSeatDto) => o.attendeeId == null)
  @IsUUID()
  invitationId?: string;

  @ValidateIf((o: AssignSeatDto) => o.invitationId != null)
  @IsInt() @Min(1) @Max(12)
  slotIndex?: number;
}

export class SwapSeatsDto {
  @IsUUID() seatAId!: string;
  @IsUUID() seatBId!: string;
}

export class AutoFillDto {
  @IsOptional() @IsBoolean()
  clearExisting?: boolean;
}
