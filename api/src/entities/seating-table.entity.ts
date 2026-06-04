import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn,
} from 'typeorm';
import { SeatingPlan } from './seating-plan.entity';
import { Seat } from './seat.entity';

// The geometry a table is drawn with on the seating canvas. Stored as plain
// lowercase strings (not Serbian domain vocabulary — purely a UI shape), and
// guarded by chk_seating_table_shape in the DB.
export const TABLE_SHAPES = ['circle', 'rectangle'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

@Entity('seating_table')
export class SeatingTable {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @ManyToOne(() => SeatingPlan, (p) => p.tables, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan!: SeatingPlan;

  @Column({ name: 'table_number', type: 'smallint' })
  tableNumber!: number;

  @Column({ name: 'seat_count', type: 'smallint' })
  seatCount!: number;

  @Column({ type: 'text', nullable: true })
  label?: string | null;

  @Column({ type: 'text', default: 'circle' })
  shape!: TableShape;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => Seat, (s) => s.table, { cascade: false })
  seats?: Seat[];
}
