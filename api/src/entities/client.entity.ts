import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

// A client is a tenant: it owns its invitations, seating plans, and Google
// Sheet sync config. The sheet columns were previously global env vars
// (GOOGLE_SHEET_ID / GOOGLE_SHEET_TAB) and now live per-client.
@Entity('client')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'citext', nullable: true })
  slug?: string | null;

  @Column({ name: 'google_sheet_id', type: 'text', nullable: true })
  googleSheetId?: string | null;

  @Column({ name: 'google_sheet_tab', type: 'text', nullable: true })
  googleSheetTab?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
