import {
  Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('user_google_credential')
export class UserGoogleCredential {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'refresh_token_enc', type: 'text' })
  refreshTokenEnc!: string;

  @Column({ name: 'refresh_token_iv', type: 'text' })
  refreshTokenIv!: string;

  @Column({ name: 'refresh_token_tag', type: 'text' })
  refreshTokenTag!: string;

  @Column({ name: 'google_account', type: 'text', nullable: true })
  googleAccount?: string | null;

  @CreateDateColumn({ name: 'connected_at' })
  connectedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
