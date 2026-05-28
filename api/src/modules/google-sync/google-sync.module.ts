import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invitation } from '../../entities/invitation.entity';
import { UserGoogleCredential } from '../../entities/user-google-credential.entity';
import { GoogleOauthService } from './google-oauth.service';
import { GoogleSyncController } from './google-sync.controller';
import { GoogleSyncService } from './google-sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([Invitation, UserGoogleCredential])],
  controllers: [GoogleSyncController],
  providers: [GoogleOauthService, GoogleSyncService],
})
export class GoogleSyncModule {}
