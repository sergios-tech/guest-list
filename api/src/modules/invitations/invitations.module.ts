import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invitation } from '../../entities/invitation.entity';
import { UserClient } from '../../entities/user-client.entity';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  // UserClient is needed so ClientContextGuard (used on the controller) can
  // resolve its membership repository via DI — see CLAUDE.md "Multi-tenancy".
  imports: [TypeOrmModule.forFeature([Invitation, UserClient])],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
