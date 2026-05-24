import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query,
  Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/jwt-auth.guard';
import { InvitationsService } from './invitations.service';
import {
  CreateInvitationDto, UpdateInvitationDto, ListInvitationsQueryDto,
} from './dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly svc: InvitationsService) {}

  @Get()
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  list(@Query() q: ListInvitationsQueryDto) {
    return this.svc.list(q);
  }

  @Get(':id')
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'EDITOR')
  create(@Body() dto: CreateInvitationDto, @Req() req: any) {
    return this.svc.create(dto, req.user.id);
  }

  @Patch(':id')
  @Roles('OWNER', 'EDITOR')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvitationDto,
    @Req() req: any,
  ) {
    return this.svc.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}
