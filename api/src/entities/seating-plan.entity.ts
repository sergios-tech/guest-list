import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany, VersionColumn,
} from 'typeorm';
import { SeatingTable } from './seating-table.entity';

@Entity('seating_plan')
export class SeatingPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Tenant owner. The one-active-plan constraint is per-client.
  @Column({ name: 'client_id', type: 'uuid' })
  clientId!: string;

  @Column()
  name!: string;

  @Column({ name: 'is_active', default: false })
  isActive!: boolean;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @VersionColumn({ type: 'integer', default: 0 })
  version!: number;

  @OneToMany(() => SeatingTable, (t) => t.plan, { cascade: false })
  tables?: SeatingTable[];
}
