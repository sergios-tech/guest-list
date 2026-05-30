import {
  Entity, Column, CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Client } from './client.entity';

export type UserRole = 'OWNER' | 'EDITOR' | 'VIEWER';

// Membership of a user in a client (tenant), with the role that applies WITHIN
// that client. This is the authoritative role for tenant access — it supersedes
// the legacy global app_user.role. Composite PK (user_id, client_id).
@Entity('user_client')
export class UserClient {
  @Column({ name: 'user_id', type: 'uuid', primary: true })
  userId!: string;

  @Column({ name: 'client_id', type: 'uuid', primary: true })
  clientId!: string;

  @Column({ type: 'enum', enum: ['OWNER', 'EDITOR', 'VIEWER'], default: 'EDITOR' })
  role!: UserRole;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: Client;
}
