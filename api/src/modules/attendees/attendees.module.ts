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
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/jwt-auth.guard';

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

  listByInvitation(invitationId: string) {
    return this.repo.find({ where: { invitationId }, order: { fullName: 'ASC' } });
  }
  async findOne(id: string) {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException(`Attendee ${id} not found`);
    return a;
  }
  async create(dto: CreateAttendeeDto) {
    const invitationExists = await this.invitations.findOne({
      where: { id: dto.invitationId },
      select: ['id'],
    });
    if (!invitationExists) {
      throw new NotFoundException(`Invitation ${dto.invitationId} not found`);
    }
    return this.repo.save(this.repo.create(dto));
  }
  async update(id: string, dto: UpdateAttendeeDto) {
    const a = await this.findOne(id);
    Object.assign(a, dto);
    return this.repo.save(a);
  }
  async remove(id: string) {
    const a = await this.findOne(id);
    await this.repo.remove(a);
    return { id, deleted: true };
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('attendees')
export class AttendeesController {
  constructor(private readonly svc: AttendeesService) {}

  @Get('by-invitation/:invitationId')
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  list(@Param('invitationId', ParseUUIDPipe) id: string) {
    return this.svc.listByInvitation(id);
  }

  @Post()
  @Roles('OWNER', 'EDITOR')
  create(@Body() dto: CreateAttendeeDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'EDITOR')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttendeeDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'EDITOR')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Attendee, Invitation])],
  controllers: [AttendeesController],
  providers: [AttendeesService],
})
export class AttendeesModule {}
