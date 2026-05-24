import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { AttendeesModule } from './modules/attendees/attendees.module';
import { StatsModule } from './modules/stats/stats.module';
import { HealthModule } from './modules/health/health.module';
import { buildTypeOrmConfig } from './config/typeorm.config';

// When REDIS_URL is set, throttler counters survive api restarts and are
// shared across replicas. Without it, counters live in-process — acceptable
// for local dev, but a single api restart resets all rate limits.
const redisUrl = process.env.REDIS_URL;
const throttlerStorage = redisUrl
  ? new ThrottlerStorageRedisService(new Redis(redisUrl))
  : undefined;

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmConfig()),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'short', ttl: 1_000, limit: 5 },     // 5 req / sec / IP burst
        { name: 'long', ttl: 60_000, limit: 30 },    // 30 req / min / IP sustained
      ],
      storage: throttlerStorage,
    }),
    AuthModule,
    InvitationsModule,
    AttendeesModule,
    StatsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
