import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'OWNER' | 'EDITOR' | 'VIEWER';

@Entity('app_user')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'citext', unique: true })
  email!: string;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column({ name: 'display_name' })
  displayName!: string;

  // Legacy global role. Superseded by per-client UserClient.role; no longer
  // read by the auth layer. Retained for backward compat / audit.
  @Column({ type: 'enum', enum: ['OWNER', 'EDITOR', 'VIEWER'], default: 'EDITOR' })
  role!: UserRole;

  // Platform super-admin (manages clients + memberships). Orthogonal to the
  // per-client OWNER/EDITOR/VIEWER roles.
  @Column({ name: 'is_super_admin', type: 'boolean', default: false })
  isSuperAdmin!: boolean;

  @Column({ default: 'sr' })
  locale!: string;

  // Soft-delete sentinel; null for active users. Audit columns on invitation
  // (created_by/updated_by) keep pointing at the original UUID instead of
  // being SET NULL when an operator deactivates a user.
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
