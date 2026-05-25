import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { Invitation } from './invitation.entity';

@Entity('attendee')
export class Attendee {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'invitation_id', type: 'uuid' })
  invitationId!: string;

  @ManyToOne(() => Invitation, (i) => i.attendees, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invitation_id' })
  invitation!: Invitation;

  @Column({ name: 'full_name' })
  fullName!: string;

  @Column({ name: 'is_child', default: false })
  isChild!: boolean;

  @Column({ name: 'dietary_notes', type: 'text', nullable: true })
  dietaryNotes?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
