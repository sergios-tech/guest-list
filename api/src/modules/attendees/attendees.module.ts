import {
  Body, Controller, Delete, Get, Module, NotFoundException, Param,
  ParseUUIDPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsBoolean, IsOptional, IsString, MaxLength, IsUUID } from 'class-validator';
import { Injectable } from '@nestjs/common';
import { Attendee } from '../../entities/attendee.entity';
import { Invitation } from '../../entities/invitation.entity';
import { UserClient } from '../../entities/user-client.entity';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/jwt-auth.guard';
import { ClientContextGuard, CurrentClientId } from '../auth/client-context.guard';

class CreateAttendeeDto {
  @IsUUID() invitationId!: string;
  @IsString() @MaxLength(120) fullName!: string;
  @IsOptional() @IsBoolean() isChild?: boolean;
  @IsOptional() @IsString() @MaxLength(500) dietaryNotes?: string;
}
class UpdateAttendeeDto {
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsBoolean() isChild?: boolean;
  @IsOptional() @IsString() @MaxLength(500) dietaryNotes?: string;
}

@Injectable()
export class AttendeesService {
  constructor(
    @InjectRepository(Attendee) private readonly repo: Repository<Attendee>,
    @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>,
  ) {}

  // Attendees inherit their tenant from the parent invitation (they have no
  // client_id of their own). Every operation first verifies the parent
  // invitation belongs to the current client, so a guessed attendee/invitation
  // UUID from another tenant is rejected with 404.
  private async assertInvitationInClient(invitationId: string, clientId: string) {
    const inv = await this.invitations.findOne({
      where: { id: invitationId, clientId },
      select: ['id'],
    });
    if (!inv) throw new NotFoundException(`Invitation ${invitationId} not found`);
  }

  async listByInvitation(invitationId: string, clientId: string) {
    await this.assertInvitationInClient(invitationId, clientId);
    return this.repo.find({ where: { invitationId }, order: { fullName: 'ASC' } });
  }
  async findOne(id: string, clientId: string) {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException(`Attendee ${id} not found`);
    await this.assertInvitationInClient(a.invitationId, clientId);
    return a;
  }
  async create(dto: CreateAttendeeDto, clientId: string) {
    await this.assertInvitationInClient(dto.invitationId, clientId);
    return this.repo.save(this.repo.create(dto));
  }
  async update(id: string, dto: UpdateAttendeeDto, clientId: string) {
    const a = await this.findOne(id, clientId);
    Object.assign(a, dto);
    return this.repo.save(a);
  }
  async remove(id: string, clientId: string) {
    const a = await this.findOne(id, clientId);
    await this.repo.remove(a);
    return { id, deleted: true };
  }
}

@UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)
@Controller('attendees')
export class AttendeesController {
  constructor(private readonly svc: AttendeesService) {}

  @Get('by-invitation/:invitationId')
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  list(
    @Param('invitationId', ParseUUIDPipe) id: string,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.listByInvitation(id, clientId);
  }

  @Post()
  @Roles('OWNER', 'EDITOR')
  create(@Body() dto: CreateAttendeeDto, @CurrentClientId() clientId: string) {
    return this.svc.create(dto, clientId);
  }

  @Patch(':id')
  @Roles('OWNER', 'EDITOR')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttendeeDto,
    @CurrentClientId() clientId: string,
  ) {
    return this.svc.update(id, dto, clientId);
  }

  @Delete(':id')
  @Roles('OWNER', 'EDITOR')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentClientId() clientId: string) {
    return this.svc.remove(id, clientId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Attendee, Invitation, UserClient])],
  controllers: [AttendeesController],
  providers: [AttendeesService],
})
export class AttendeesModule {}
