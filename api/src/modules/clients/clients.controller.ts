import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, SuperAdminGuard } from '../auth/jwt-auth.guard';
import { ClientsService } from './clients.service';
import {
  CreateClientDto, UpdateClientDto, AddMemberDto, UpdateMemberDto,
} from './dto';

// Platform-admin surface: manage clients (tenants) and their memberships.
// Gated by SuperAdminGuard (is_super_admin flag) — NOT by per-client roles, so
// these endpoints intentionally do NOT use ClientContextGuard.
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('clients')
export class ClientsController {
  constructor(private readonly svc: ClientsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@Body() dto: CreateClientDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }

  @Get(':id/members')
  members(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listMembers(id);
  }

  @Post(':id/members')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.svc.addMember(id, dto);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.svc.updateMember(id, userId, dto);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.svc.removeMember(id, userId);
  }
}
