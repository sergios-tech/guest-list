import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/jwt-auth.guard';
import {
  ClientContextGuard, CurrentClientId, CurrentUserId,
} from '../auth/client-context.guard';
import { InvitationsService } from './invitations.service';
import {
  CreateInvitationDto, UpdateInvitationDto, ListInvitationsQueryDto,
} from './dto';

// Tenant-scoped: ClientContextGuard validates X-Client-Id against the caller's
// membership and sets req.clientId/req.membershipRole; RolesGuard (after it)
// reads the per-client role. Every handler takes @CurrentClientId() and passes
// it into the service so reads/writes stay scoped to the active client.
@UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly svc: InvitationsService) {}

  @Get()
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  list(@Query() q: ListInvitationsQueryDto, @CurrentClientId() clientId: string) {
    return this.svc.list(q, clientId);
  }

  @Get(':id')
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentClientId() clientId: string) {
    return this.svc.findOne(id, clientId);
  }

  @Post()
  @Roles('OWNER', 'EDITOR')
  create(
    @Body() dto: CreateInvitationDto,
    @CurrentClientId() clientId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.svc.create(dto, clientId, userId);
  }

  @Patch(':id')
  @Roles('OWNER', 'EDITOR')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvitationDto,
    @CurrentClientId() clientId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.svc.update(id, dto, clientId, userId);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentClientId() clientId: string) {
    return this.svc.remove(id, clientId);
  }
}
