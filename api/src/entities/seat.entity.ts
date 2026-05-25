import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { SeatingTable } from './seating-table.entity';
import { Attendee } from './attendee.entity';
import { Invitation } from './invitation.entity';

@Entity('seat')
export class Seat {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ name: 'table_id', type: 'uuid' })
  tableId!: string;

  // Composite FK (table_id, plan_id) -> seating_table(id, plan_id) is declared
  // at the schema level. TypeORM models the relationship as a single ManyToOne
  // on table_id, which is enough for ORM-level eager/lazy loading.
  @ManyToOne(() => SeatingTable, (t) => t.seats, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'table_id' })
  table!: SeatingTable;

  @Column({ name: 'seat_number', type: 'smallint' })
  seatNumber!: number;

  @Column({ name: 'attendee_id', type: 'uuid', nullable: true })
  attendeeId?: string | null;

  @ManyToOne(() => Attendee, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'attendee_id' })
  attendee?: Attendee | null;

  @Column({ name: 'invitation_id', type: 'uuid', nullable: true })
  invitationId?: string | null;

  @ManyToOne(() => Invitation, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'invitation_id' })
  invitation?: Invitation | null;

  @Column({ name: 'slot_index', type: 'smallint', nullable: true })
  slotIndex?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
