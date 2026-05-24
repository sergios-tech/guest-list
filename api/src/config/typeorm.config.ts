import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Invitation } from '../entities/invitation.entity';
import { Attendee } from '../entities/attendee.entity';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

export function buildTypeOrmConfig(): TypeOrmModuleOptions {
  // Prefer discrete env vars over DATABASE_URL — avoids URI-encoding pitfalls
  // when the Postgres password contains @, :, /, ?, #, or % (compose embeds
  // the raw value otherwise, which any standards-compliant URI parser will
  // split at the first @).
  const usingDiscrete = !!process.env.DB_HOST;
  const sslMode = process.env.DATABASE_SSL;

  const common: Partial<TypeOrmModuleOptions> = {
    type: 'postgres',
    entities: [User, Invitation, Attendee],
    synchronize: false,        // schema owned by db/01_schema.sql
    logging: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['error', 'warn'],
    ssl: sslMode === 'require'
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false', ca: process.env.DATABASE_CA }
      : false,
    extra: {
      max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'guest-list-api',
    },
    // Allow up to ~60s of db startup lag (cold compose volume) before giving up.
    retryAttempts: parseInt(process.env.DB_RETRY_ATTEMPTS ?? '30', 10),
    retryDelay: parseInt(process.env.DB_RETRY_DELAY_MS ?? '2000', 10),
  };

  if (usingDiscrete) {
    return {
      ...common,
      host: requireEnv('DB_HOST'),
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: requireEnv('DB_USER'),
      password: requireEnv('DB_PASSWORD'),
      database: requireEnv('DB_NAME'),
    } as TypeOrmModuleOptions;
  }

  return { ...common, url: requireEnv('DATABASE_URL') } as TypeOrmModuleOptions;
}
