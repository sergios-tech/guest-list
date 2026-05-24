import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Invitation } from '../../entities/invitation.entity';
import {
  CreateInvitationDto, UpdateInvitationDto, ListInvitationsQueryDto,
} from './dto';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Invitation) private readonly repo: Repository<Invitation>,
  ) {}

  list(query: ListInvitationsQueryDto) {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.accommodation) where.accommodation = query.accommodation;
    if (query.q) {
      const safe = escapeLikePattern(query.q.trim());
      if (safe) where.guestLabel = ILike(`%${safe}%`);
    }
    return this.repo.find({
      where,
      relations: ['attendees'],
      order: { guestLabel: 'ASC' },
      take: Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
      skip: query.offset ?? 0,
    });
  }

  async findOne(id: string) {
    const inv = await this.repo.findOne({
      where: { id },
      relations: ['attendees'],
    });
    if (!inv) throw new NotFoundException(`Invitation ${id} not found`);
    return inv;
  }

  create(dto: CreateInvitationDto, userId: string) {
    const entity = this.repo.create({
      ...dto,
      createdBy: userId,
      updatedBy: userId,
    });
    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateInvitationDto, userId: string) {
    const inv = await this.findOne(id);
    Object.assign(inv, dto, { updatedBy: userId });
    return this.repo.save(inv);
  }

  async remove(id: string) {
    const inv = await this.findOne(id);
    await this.repo.remove(inv);
    return { id, deleted: true };
  }
}
