import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Invitation } from './entities/invitation.entity';
import { Attendee } from './entities/attendee.entity';
import { AuthModule } from './modules/auth/auth.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { AttendeesModule } from './modules/attendees/attendees.module';
import { StatsModule } from './modules/stats/stats.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [User, Invitation, Attendee],
      synchronize: false,        // schema is owned by db/01_schema.sql
      logging: ['error', 'warn'],
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 5 },     // 5 req / sec / IP burst
      { name: 'long', ttl: 60_000, limit: 30 },    // 30 req / min / IP sustained
    ]),
    AuthModule,
    InvitationsModule,
    AttendeesModule,
    StatsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
