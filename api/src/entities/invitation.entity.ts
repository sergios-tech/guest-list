import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany, VersionColumn,
} from 'typeorm';
import { Attendee } from './attendee.entity';

export enum RsvpStatus {
  NotInvited = 'NIJE_POZVAN',
  Invited = 'POZVAN',
  Declined = 'ODBIJENO',
  Confirmed = 'POTVRDJEN_DOLAZAK',
}

export enum AccommodationType {
  None = 'NONE',
  SiestaSingle = 'SIESTA_SINGLE',
  SiestaDouble = 'SIESTA_DOUBLE',
  SiestaApartment = 'SIESTA_APARTMENT',
  Aria = 'ARIA',
}

// Per-row headcount columns (planned_count/adults/children/forecast) are bounded
// to [COUNT_MIN, COUNT_MAX] by DB CHECK constraints (db/01_schema.sql) — a
// wedding-party-size cap. Single source for the bound shared by the DTO
// validators and the Google-sync clean-mode pre-flight (validateCounts), so a
// future change can't leave one layer out of sync.
export const COUNT_MIN = 0;
export const COUNT_MAX = 12;

@Entity('invitation')
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Tenant owner. Every query must scope by this; set on create from the
  // request's current client (X-Client-Id).
  @Column({ name: 'client_id', type: 'uuid' })
  clientId!: string;

  @Column({ name: 'guest_label' })
  guestLabel!: string;

  @Column({ name: 'planned_count', type: 'smallint', nullable: true })
  plannedCount?: number | null;

  @Column({ type: 'enum', enum: RsvpStatus, default: RsvpStatus.NotInvited })
  status!: RsvpStatus;

  @Column({ type: 'smallint', nullable: true })
  adults?: number | null;

  @Column({ type: 'smallint', nullable: true })
  children?: number | null;

  // confirmed_total is a generated column — read only
  @Column({ name: 'confirmed_total', type: 'smallint', insert: false, update: false })
  confirmedTotal!: number;

  @Column({ type: 'smallint', nullable: true })
  forecast?: number | null;

  @Column({ name: 'response_date', type: 'date', nullable: true })
  responseDate?: string | null;

  @Column({ type: 'enum', enum: AccommodationType, default: AccommodationType.None })
  accommodation!: AccommodationType;

  @Column({ name: 'decline_reason', type: 'text', nullable: true })
  declineReason?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  // Original Google Sheet row number (1-indexed), set on sync. Drives the
  // default list order so the grid mirrors the spreadsheet. NULL for rows
  // created manually in the app — those sort last (see InvitationsService.list).
  @Column({ name: 'sheet_row', type: 'int', nullable: true })
  sheetRow?: number | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // Optimistic concurrency token; auto-incremented by TypeORM on save.
  // Mismatch on update raises OptimisticLockVersionMismatchError -> 409.
  @VersionColumn({ type: 'integer', default: 0 })
  version!: number;

  @OneToMany(() => Attendee, (a) => a.invitation, { cascade: false })
  attendees?: Attendee[];
}
