import {
  BadRequestException, ConflictException, Injectable,
  NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ILike, OptimisticLockVersionMismatchError, QueryFailedError, Repository,
} from 'typeorm';
import { Invitation } from '../../entities/invitation.entity';
import {
  CreateInvitationDto, UpdateInvitationDto, ListInvitationsQueryDto,
} from './dto';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Translate Postgres constraint violations into 4xx errors with stable codes
// the frontend can localise. Raw QueryFailedError otherwise surfaces as 500.
function rethrowDbError(err: unknown): never {
  if (err instanceof QueryFailedError) {
    const driver = (err as any).driverError ?? {};
    const code: string | undefined = driver.code;
    const constraint: string | undefined = driver.constraint;
    if (code === '23514') {
      // CHECK violation
      if (constraint === 'chk_confirmed_requires_counts') {
        throw new UnprocessableEntityException({
          code: 'INVITATION_CONFIRMED_REQUIRES_ADULTS',
          message: 'Confirmed invitations must have an adult count.',
        });
      }
      if (constraint === 'chk_declined_zero_counts') {
        throw new UnprocessableEntityException({
          code: 'INVITATION_DECLINED_WITH_COUNTS',
          message: 'Declined invitations must have zero adults and children.',
        });
      }
      throw new UnprocessableEntityException({
        code: 'INVITATION_CHECK_VIOLATION',
        message: 'Invitation violates a database constraint.',
      });
    }
    if (code === '23505') {
      throw new ConflictException({
        code: 'INVITATION_UNIQUE_VIOLATION',
        message: 'A conflicting record already exists.',
      });
    }
    if (code === '23503') {
      throw new BadRequestException({
        code: 'INVITATION_FK_VIOLATION',
        message: 'Referenced record not found.',
      });
    }
  }
  throw err;
}

@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Invitation) private readonly repo: Repository<Invitation>,
  ) {}

  list(query: ListInvitationsQueryDto, clientId: string) {
    const where: any = { clientId };
    if (query.status) where.status = query.status;
    if (query.accommodation) where.accommodation = query.accommodation;
    if (query.q) {
      const safe = escapeLikePattern(query.q.trim());
      if (safe) where.guestLabel = ILike(`%${safe}%`);
    }
    // No `relations: ['attendees']` — the grid never reads them and a 150-row
    // wedding with ~4 attendees each tripled the payload.
    //
    // Order mirrors the source Google Sheet: sheet_row ASC reproduces the
    // spreadsheet's top-to-bottom order. NULLS LAST parks manually-created
    // invitations (no sheet row) at the bottom, where created_at ASC keeps them
    // in the order they were added; guest_label is the final stable tiebreak.
    return this.repo.find({
      where,
      order: {
        sheetRow: { direction: 'ASC', nulls: 'LAST' },
        createdAt: 'ASC',
        guestLabel: 'ASC',
      },
      take: Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
      skip: query.offset ?? 0,
    });
  }

  // Scoped by clientId in the WHERE clause: a guessed id from another tenant
  // returns 404 (no cross-tenant existence leak), matching AttendeesService.
  async findOne(id: string, clientId: string) {
    const inv = await this.repo.findOne({
      where: { id, clientId },
      relations: ['attendees'],
    });
    if (!inv) throw new NotFoundException(`Invitation ${id} not found`);
    return inv;
  }

  async create(dto: CreateInvitationDto, clientId: string, userId: string) {
    const entity = this.repo.create({
      ...dto,
      clientId,
      createdBy: userId,
      updatedBy: userId,
    });
    try {
      const saved = await this.repo.save(entity);
      // Refetch so generated `confirmed_total` reflects the new adults+children.
      return this.findOne(saved.id, clientId);
    } catch (err) {
      rethrowDbError(err);
    }
  }

  async update(id: string, dto: UpdateInvitationDto, clientId: string, userId: string) {
    const inv = await this.findOne(id, clientId);
    const { version, ...patch } = dto;
    if (version !== undefined) inv.version = version;
    Object.assign(inv, patch, { updatedBy: userId });
    try {
      await this.repo.save(inv);
    } catch (err) {
      if (err instanceof OptimisticLockVersionMismatchError) {
        throw new ConflictException({
          code: 'INVITATION_CONFLICT',
          message: 'This invitation was edited by someone else. Reload to see the latest.',
        });
      }
      rethrowDbError(err);
    }
    // Refetch so generated `confirmed_total` (Postgres-computed) is current
    // and the bumped @VersionColumn is reflected in the response.
    return this.findOne(id, clientId);
  }

  async remove(id: string, clientId: string) {
    const inv = await this.findOne(id, clientId);
    await this.repo.remove(inv);
    return { id, deleted: true };
  }
}
