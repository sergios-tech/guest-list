import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invitation } from '../../entities/invitation.entity';
import { Attendee } from '../../entities/attendee.entity';
import { UserGoogleCredential } from '../../entities/user-google-credential.entity';
import { Client } from '../../entities/client.entity';
import { UserClient } from '../../entities/user-client.entity';
import { ClientContextGuard } from '../auth/client-context.guard';
import { GoogleOauthService } from './google-oauth.service';
import { GoogleSyncController } from './google-sync.controller';
import { GoogleSyncService } from './google-sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invitation, Attendee, UserGoogleCredential, Client, UserClient]),
  ],
  controllers: [GoogleSyncController],
  providers: [GoogleOauthService, GoogleSyncService, ClientContextGuard],
})
export class GoogleSyncModule {}
