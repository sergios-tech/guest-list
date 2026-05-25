import {
  BadRequestException, ConflictException, Injectable,
  NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource, IsNull, Not,
  OptimisticLockVersionMismatchError, QueryFailedError, Repository,
} from 'typeorm';
import { SeatingPlan } from '../../entities/seating-plan.entity';
import { SeatingTable } from '../../entities/seating-table.entity';
import { Seat } from '../../entities/seat.entity';
import { Invitation, RsvpStatus } from '../../entities/invitation.entity';
import {
  AssignSeatDto, AutoFillDto, CreatePlanDto, CreateTableDto, SwapSeatsDto,
  UpdatePlanDto, UpdateTableDto,
} from './dto';

// Translate Postgres constraint violations into stable codes the frontend can
// localise — same pattern as InvitationsService.rethrowDbError.
function rethrowDbError(err: unknown): never {
  if (err instanceof QueryFailedError) {
    const driver = (err as any).driverError ?? {};
    const code: string | undefined = driver.code;
    const constraint: string | undefined = driver.constraint;
    if (code === '23505') {
      if (constraint === 'ux_seating_plan_one_active') {
        throw new ConflictException({
          code: 'SEATING_PLAN_ONLY_ONE_ACTIVE',
          message: 'Another plan is already active.',
        });
      }
      if (constraint === 'ux_seat_unique_attendee'
          || constraint === 'ux_seat_unique_slot') {
        throw new ConflictException({
          code: 'SEAT_DOUBLE_ASSIGNMENT',
          message: 'This guest is already assigned to a seat in this plan.',
        });
      }
      if (constraint === 'seating_table_plan_id_table_number_key') {
        throw new ConflictException({
          code: 'SEATING_TABLE_NUMBER_TAKEN',
          message: 'Another table already uses this number.',
        });
      }
      throw new ConflictException({
        code: 'SEATING_UNIQUE_VIOLATION',
        message: 'A conflicting seating record already exists.',
      });
    }
    if (code === '23514') {
      if (constraint === 'chk_seat_one_assignment') {
        throw new UnprocessableEntityException({
          code: 'SEAT_ASSIGNMENT_INVALID',
          message: 'A seat must hold either a named attendee or an invitation slot, not both.',
        });
      }
      throw new UnprocessableEntityException({
        code: 'SEATING_CHECK_VIOLATION',
        message: 'Seating change violates a database constraint.',
      });
    }
    if (code === '23503') {
      throw new BadRequestException({
        code: 'SEATING_FK_VIOLATION',
        message: 'Referenced record not found.',
      });
    }
  }
  throw err;
}

// Hydrated seat record shipped to the frontend. `attendee` and `invitation`
// summaries let the UI render labels without an N+1 round-trip.
interface SeatView {
  id: string;
  tableId: string;
  seatNumber: number;
  attendeeId: string | null;
  invitationId: string | null;
  slotIndex: number | null;
  attendeeName: string | null;
  invitationLabel: string | null;
}

interface TableView {
  id: string;
  tableNumber: number;
  seatCount: number;
  label: string | null;
  seats: SeatView[];
}

interface PlanDetailView {
  id: string;
  name: string;
  isActive: boolean;
  notes: string | null;
  version: number;
  tables: TableView[];
}

interface PlanSummaryView {
  id: string;
  name: string;
  isActive: boolean;
  tableCount: number;
  seatCount: number;
  seatedCount: number;
}

interface UnseatedUnit {
  kind: 'attendee' | 'slot';
  invitationId: string;
  invitationLabel: string;
  attendeeId?: string;
  attendeeName?: string;
  slotIndex?: number;
  isChild?: boolean;
}

@Injectable()
export class SeatingService {
  constructor(
    @InjectRepository(SeatingPlan) private readonly plans: Repository<SeatingPlan>,
    @InjectRepository(SeatingTable) private readonly tables: Repository<SeatingTable>,
    @InjectRepository(Seat) private readonly seats: Repository<Seat>,
    @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ---------------- plans ----------------

  async listPlans(): Promise<PlanSummaryView[]> {
    const rows: Array<{
      id: string; name: string; is_active: boolean;
      table_count: string; seat_count: string; seated_count: string;
    }> = await this.ds.query(`
      SELECT
        p.id,
        p.name,
        p.is_active,
        COALESCE(t.cnt, 0) AS table_count,
        COALESCE(s.total, 0) AS seat_count,
        COALESCE(s.taken, 0) AS seated_count
      FROM seating_plan p
      LEFT JOIN (
        SELECT plan_id, COUNT(*) AS cnt FROM seating_table GROUP BY plan_id
      ) t ON t.plan_id = p.id
      LEFT JOIN (
        SELECT plan_id,
               COUNT(*) AS total,
               COUNT(*) FILTER (
                 WHERE attendee_id IS NOT NULL OR invitation_id IS NOT NULL
               ) AS taken
        FROM seat GROUP BY plan_id
      ) s ON s.plan_id = p.id
      ORDER BY p.is_active DESC, lower(p.name) ASC
    `);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: r.is_active,
      tableCount: Number(r.table_count),
      seatCount: Number(r.seat_count),
      seatedCount: Number(r.seated_count),
    }));
  }

  async createPlan(dto: CreatePlanDto, userId: string): Promise<PlanDetailView> {
    const created = await this.ds.transaction(async (em) => {
      const plan = em.getRepository(SeatingPlan).create({
        name: dto.name,
        notes: dto.notes ?? null,
        createdBy: userId,
        updatedBy: userId,
      });
      const savedPlan = await em.getRepository(SeatingPlan).save(plan);

      // Materialise tables + seats in two bulk inserts.
      const tableRows: Partial<SeatingTable>[] = [];
      for (let i = 1; i <= dto.tableCount; i++) {
        tableRows.push({
          planId: savedPlan.id,
          tableNumber: i,
          seatCount: dto.seatsPerTable,
        });
      }
      const savedTables = await em.getRepository(SeatingTable).save(tableRows);

      const seatRows: Partial<Seat>[] = [];
      for (const t of savedTables) {
        for (let s = 1; s <= t.seatCount; s++) {
          seatRows.push({
            planId: savedPlan.id,
            tableId: t.id,
            seatNumber: s,
          });
        }
      }
      await em.getRepository(Seat).save(seatRows);

      return savedPlan.id;
    }).catch(rethrowDbError);
    return this.findPlan(created);
  }

  async findPlan(id: string): Promise<PlanDetailView> {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`Seating plan ${id} not found`);

    const tables = await this.tables.find({
      where: { planId: id },
      order: { tableNumber: 'ASC' },
    });

    // Single fetch of every seat in the plan with the assignment join data.
    const rows: Array<{
      id: string; table_id: string; seat_number: number;
      attendee_id: string | null; invitation_id: string | null;
      slot_index: number | null;
      attendee_name: string | null; guest_label: string | null;
    }> = await this.ds.query(`
      SELECT s.id, s.table_id, s.seat_number,
             s.attendee_id, s.invitation_id, s.slot_index,
             a.full_name AS attendee_name,
             i.guest_label
        FROM seat s
        LEFT JOIN attendee a ON a.id = s.attendee_id
        LEFT JOIN invitation i ON i.id = COALESCE(s.invitation_id, a.invitation_id)
       WHERE s.plan_id = $1
       ORDER BY s.table_id, s.seat_number
    `, [id]);

    const seatsByTable = new Map<string, SeatView[]>();
    for (const r of rows) {
      const arr = seatsByTable.get(r.table_id) ?? [];
      arr.push({
        id: r.id,
        tableId: r.table_id,
        seatNumber: r.seat_number,
        attendeeId: r.attendee_id,
        invitationId: r.invitation_id,
        slotIndex: r.slot_index,
        attendeeName: r.attendee_name,
        invitationLabel: r.guest_label,
      });
      seatsByTable.set(r.table_id, arr);
    }

    return {
      id: plan.id,
      name: plan.name,
      isActive: plan.isActive,
      notes: plan.notes ?? null,
      version: plan.version,
      tables: tables.map((t) => ({
        id: t.id,
        tableNumber: t.tableNumber,
        seatCount: t.seatCount,
        label: t.label ?? null,
        seats: seatsByTable.get(t.id) ?? [],
      })),
    };
  }

  async updatePlan(id: string, dto: UpdatePlanDto, userId: string) {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`Seating plan ${id} not found`);

    const { version, tableCount, seatsPerTable, ...patch } = dto;
    void tableCount; void seatsPerTable; // ignored on PATCH; use table endpoints

    if (version !== undefined) plan.version = version;
    Object.assign(plan, patch, { updatedBy: userId });
    try {
      await this.plans.save(plan);
    } catch (err) {
      if (err instanceof OptimisticLockVersionMismatchError) {
        throw new ConflictException({
          code: 'SEATING_PLAN_CONFLICT',
          message: 'This plan was edited by someone else. Reload to see the latest.',
        });
      }
      rethrowDbError(err);
    }
    return this.findPlan(id);
  }

  async activatePlan(id: string, userId: string) {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`Seating plan ${id} not found`);

    await this.ds.transaction(async (em) => {
      // Deactivate the currently-active plan(s) first — the partial unique
      // index forbids two `is_active = true` rows at once.
      await em.getRepository(SeatingPlan).update(
        { isActive: true, id: Not(id) },
        { isActive: false, updatedBy: userId },
      );
      await em.getRepository(SeatingPlan).update(
        { id },
        { isActive: true, updatedBy: userId },
      );
    }).catch(rethrowDbError);

    return this.findPlan(id);
  }

  async removePlan(id: string) {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`Seating plan ${id} not found`);
    await this.plans.remove(plan);
    return { id, deleted: true };
  }

  // ---------------- tables ----------------

  async addTable(planId: string, dto: CreateTableDto) {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Seating plan ${planId} not found`);

    return this.ds.transaction(async (em) => {
      const tableRepo = em.getRepository(SeatingTable);
      // Pick the next available table number when the client doesn't supply one.
      // MAX + 1 keeps gaps if the user deleted a middle table — gap-filling
      // would surprise users who pick numbers to match the physical room.
      let tableNumber = dto.tableNumber;
      if (tableNumber === undefined) {
        const row = await tableRepo
          .createQueryBuilder('t')
          .select('COALESCE(MAX(t.table_number), 0)', 'max')
          .where('t.plan_id = :p', { p: planId })
          .getRawOne<{ max: string }>();
        tableNumber = Number(row?.max ?? 0) + 1;
      }

      const table = tableRepo.create({
        planId,
        tableNumber,
        seatCount: dto.seatCount,
        label: dto.label ?? null,
      });
      const saved = await tableRepo.save(table);

      const seatRows: Partial<Seat>[] = [];
      for (let s = 1; s <= dto.seatCount; s++) {
        seatRows.push({ planId, tableId: saved.id, seatNumber: s });
      }
      await em.getRepository(Seat).save(seatRows);
      return saved;
    }).catch(rethrowDbError);
  }

  async removeTable(id: string) {
    const table = await this.tables.findOne({ where: { id } });
    if (!table) throw new NotFoundException(`Seating table ${id} not found`);

    // Refuse to drop a table that's holding seated guests — matches the
    // shrink-occupied policy so the user can never silently lose arrangements.
    const occupied = await this.seats
      .createQueryBuilder('s')
      .where('s.table_id = :t', { t: table.id })
      .andWhere('(s.attendee_id IS NOT NULL OR s.invitation_id IS NOT NULL)')
      .getCount();
    if (occupied > 0) {
      throw new UnprocessableEntityException({
        code: 'SEATING_TABLE_DELETE_OCCUPIED',
        message: 'Cannot delete a table with seated guests. Clear them first.',
      });
    }

    await this.tables.remove(table);
    return { id, deleted: true };
  }

  async updateTable(id: string, dto: UpdateTableDto) {
    const table = await this.tables.findOne({ where: { id } });
    if (!table) throw new NotFoundException(`Seating table ${id} not found`);

    if (dto.label !== undefined) table.label = dto.label || null;
    if (dto.tableNumber !== undefined) table.tableNumber = dto.tableNumber;

    if (dto.seatCount !== undefined && dto.seatCount !== table.seatCount) {
      await this.resizeTable(table, dto.seatCount);
    }

    try {
      await this.tables.save(table);
    } catch (err) {
      rethrowDbError(err);
    }
    return this.findTable(id);
  }

  private async resizeTable(table: SeatingTable, newCount: number) {
    if (newCount < table.seatCount) {
      // Reject the shrink if any seat above the new size is occupied — safer
      // than silently dropping arrangements.
      const occupied = await this.seats
        .createQueryBuilder('s')
        .where('s.table_id = :t', { t: table.id })
        .andWhere('s.seat_number > :n', { n: newCount })
        .andWhere('(s.attendee_id IS NOT NULL OR s.invitation_id IS NOT NULL)')
        .getCount();
      if (occupied > 0) {
        throw new UnprocessableEntityException({
          code: 'SEATING_TABLE_SHRINK_OCCUPIED',
          message: 'Cannot shrink — seats above the new size are occupied. Clear them first.',
        });
      }
      await this.ds.transaction(async (em) => {
        await em.getRepository(Seat).createQueryBuilder()
          .delete().from(Seat)
          .where('table_id = :t', { t: table.id })
          .andWhere('seat_number > :n', { n: newCount })
          .execute();
        await em.getRepository(SeatingTable).update(
          { id: table.id },
          { seatCount: newCount },
        );
      });
      table.seatCount = newCount;
    } else {
      // Grow: append seat rows for the new seat numbers.
      const toCreate: Partial<Seat>[] = [];
      for (let s = table.seatCount + 1; s <= newCount; s++) {
        toCreate.push({
          planId: table.planId,
          tableId: table.id,
          seatNumber: s,
        });
      }
      await this.seats.save(toCreate);
      table.seatCount = newCount;
    }
  }

  private async findTable(id: string) {
    const table = await this.tables.findOne({ where: { id } });
    if (!table) throw new NotFoundException(`Seating table ${id} not found`);
    return table;
  }

  // ---------------- seats ----------------

  async assignSeat(seatId: string, dto: AssignSeatDto) {
    const seat = await this.seats.findOne({ where: { id: seatId } });
    if (!seat) throw new NotFoundException(`Seat ${seatId} not found`);

    // Reset all assignment fields before applying the new one so an existing
    // attendee-assigned seat can be overwritten with a slot assignment and
    // vice-versa without tripping chk_seat_one_assignment.
    seat.attendeeId = null;
    seat.invitationId = null;
    seat.slotIndex = null;

    if (dto.attendeeId) {
      seat.attendeeId = dto.attendeeId;
    } else if (dto.invitationId && dto.slotIndex !== undefined) {
      seat.invitationId = dto.invitationId;
      seat.slotIndex = dto.slotIndex;
    } else {
      throw new BadRequestException({
        code: 'SEAT_ASSIGNMENT_INVALID',
        message: 'Provide either attendeeId or (invitationId, slotIndex).',
      });
    }
    try {
      await this.seats.save(seat);
    } catch (err) {
      rethrowDbError(err);
    }
    return this.seats.findOne({ where: { id: seatId } });
  }

  async clearSeat(seatId: string) {
    const seat = await this.seats.findOne({ where: { id: seatId } });
    if (!seat) throw new NotFoundException(`Seat ${seatId} not found`);
    seat.attendeeId = null;
    seat.invitationId = null;
    seat.slotIndex = null;
    await this.seats.save(seat);
    return { id: seatId, cleared: true };
  }

  async swapSeats(dto: SwapSeatsDto) {
    if (dto.seatAId === dto.seatBId) {
      throw new BadRequestException('Cannot swap a seat with itself.');
    }
    await this.ds.transaction(async (em) => {
      const repo = em.getRepository(Seat);
      const [a, b] = await Promise.all([
        repo.findOne({ where: { id: dto.seatAId } }),
        repo.findOne({ where: { id: dto.seatBId } }),
      ]);
      if (!a || !b) throw new NotFoundException('One of the seats was not found.');
      if (a.planId !== b.planId) {
        throw new BadRequestException('Cannot swap seats across plans.');
      }
      // Two-phase swap: clear both, then re-assign. This avoids tripping the
      // unique indexes on (plan_id, attendee_id) and (plan_id, invitation_id,
      // slot_index) which would otherwise see two rows pointing at the same
      // attendee mid-update.
      const aAssignment = pickAssignment(a);
      const bAssignment = pickAssignment(b);
      clearAssignment(a);
      clearAssignment(b);
      await repo.save([a, b]);
      applyAssignment(a, bAssignment);
      applyAssignment(b, aAssignment);
      await repo.save([a, b]);
    }).catch(rethrowDbError);
    return { swapped: true };
  }

  // ---------------- auto-fill ----------------

  async autoFill(planId: string, dto: AutoFillDto) {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Seating plan ${planId} not found`);

    const result = await this.ds.transaction(async (em) => {
      const seatRepo = em.getRepository(Seat);
      const tableRepo = em.getRepository(SeatingTable);

      if (dto.clearExisting) {
        await seatRepo.createQueryBuilder()
          .update()
          .set({ attendeeId: null, invitationId: null, slotIndex: null })
          .where('plan_id = :p', { p: planId })
          .execute();
      }

      // Pull confirmed invitations + their named attendees.
      const invitations = await em.getRepository(Invitation).find({
        where: { status: RsvpStatus.Confirmed },
        relations: ['attendees'],
        order: { confirmedTotal: 'DESC' },
      });

      // Determine which units are already seated so we don't double-place them
      // (relevant when clearExisting=false).
      const occupied = await seatRepo.find({
        where: [
          { planId, attendeeId: Not(IsNull()) },
          { planId, invitationId: Not(IsNull()) },
        ],
      });
      const seatedAttendees = new Set<string>();
      const seatedSlots = new Set<string>(); // `${invId}|${slot}`
      for (const s of occupied) {
        if (s.attendeeId) seatedAttendees.add(s.attendeeId);
        if (s.invitationId && s.slotIndex != null) {
          seatedSlots.add(`${s.invitationId}|${s.slotIndex}`);
        }
      }

      // Build seatable groups per invitation.
      type Unit =
        | { kind: 'attendee'; attendeeId: string }
        | { kind: 'slot'; invitationId: string; slotIndex: number };

      interface Group {
        invitationId: string;
        units: Unit[];
      }

      const groups: Group[] = [];
      for (const inv of invitations) {
        const total = inv.confirmedTotal ?? 0;
        if (total <= 0) continue;
        const namedAttendees = (inv.attendees ?? [])
          .slice(0, total)
          .filter((a) => !seatedAttendees.has(a.id));
        const namedTaken = (inv.attendees ?? []).slice(0, total).length;
        const slotCount = Math.max(0, total - namedTaken);
        // Slot indexes for the placeholder guests start after the named ones.
        const slots: Unit[] = [];
        for (let i = 1; i <= slotCount; i++) {
          const slotIndex = namedTaken + i;
          if (!seatedSlots.has(`${inv.id}|${slotIndex}`)) {
            slots.push({ kind: 'slot', invitationId: inv.id, slotIndex });
          }
        }
        const units: Unit[] = [
          ...namedAttendees.map<Unit>((a) => ({ kind: 'attendee', attendeeId: a.id })),
          ...slots,
        ];
        if (units.length > 0) {
          groups.push({ invitationId: inv.id, units });
        }
      }

      // Hardest first: larger groups need bigger contiguous free chunks.
      groups.sort((a, b) => b.units.length - a.units.length);

      // Load tables with their free seats (ordered by seat_number so we fill
      // tables in a predictable, left-to-right manner).
      const tables = await tableRepo.find({
        where: { planId },
        order: { tableNumber: 'ASC' },
      });
      const freeSeatsByTable = new Map<string, Seat[]>();
      for (const t of tables) {
        const free = await seatRepo.find({
          where: {
            tableId: t.id,
            attendeeId: IsNull(),
            invitationId: IsNull(),
          },
          order: { seatNumber: 'ASC' },
        });
        freeSeatsByTable.set(t.id, free);
      }

      const unseated: Array<{ invitationId: string; count: number }> = [];
      let assignedCount = 0;

      for (const group of groups) {
        let remaining: Unit[] = [...group.units];

        // First pass: find a single table that holds the whole group.
        let placed = false;
        for (const t of tables) {
          const free = freeSeatsByTable.get(t.id)!;
          if (free.length >= remaining.length) {
            const used = free.splice(0, remaining.length);
            for (let i = 0; i < used.length; i++) {
              applyUnit(used[i], remaining[i]);
            }
            await seatRepo.save(used);
            assignedCount += used.length;
            placed = true;
            break;
          }
        }
        if (placed) continue;

        // Second pass: split across tables ordered by biggest free chunk.
        const ranked = tables
          .map((t) => ({ t, free: freeSeatsByTable.get(t.id)! }))
          .filter((x) => x.free.length > 0)
          .sort((a, b) => b.free.length - a.free.length);

        for (const { free } of ranked) {
          if (remaining.length === 0) break;
          if (free.length === 0) continue;
          const chunk = Math.min(free.length, remaining.length);
          const used = free.splice(0, chunk);
          for (let i = 0; i < chunk; i++) {
            applyUnit(used[i], remaining[i]);
          }
          await seatRepo.save(used);
          assignedCount += chunk;
          remaining = remaining.slice(chunk);
        }

        if (remaining.length > 0) {
          unseated.push({ invitationId: group.invitationId, count: remaining.length });
        }
      }

      return { assignedCount, unseated };
    }).catch(rethrowDbError);

    return result;
  }

  // ---------------- unseated ----------------

  async unseatedForPlan(planId: string): Promise<UnseatedUnit[]> {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Seating plan ${planId} not found`);

    const invitations = await this.invitations.find({
      where: { status: RsvpStatus.Confirmed },
      relations: ['attendees'],
      order: { guestLabel: 'ASC' },
    });

    const seats = await this.seats.find({ where: { planId } });
    const seatedAttendees = new Set<string>();
    const seatedSlots = new Set<string>();
    for (const s of seats) {
      if (s.attendeeId) seatedAttendees.add(s.attendeeId);
      if (s.invitationId && s.slotIndex != null) {
        seatedSlots.add(`${s.invitationId}|${s.slotIndex}`);
      }
    }

    const out: UnseatedUnit[] = [];
    for (const inv of invitations) {
      const total = inv.confirmedTotal ?? 0;
      if (total <= 0) continue;
      const named = (inv.attendees ?? []).slice(0, total);
      for (const a of named) {
        if (!seatedAttendees.has(a.id)) {
          out.push({
            kind: 'attendee',
            invitationId: inv.id,
            invitationLabel: inv.guestLabel,
            attendeeId: a.id,
            attendeeName: a.fullName,
            isChild: a.isChild,
          });
        }
      }
      const slotCount = Math.max(0, total - named.length);
      for (let i = 1; i <= slotCount; i++) {
        const slotIndex = named.length + i;
        if (!seatedSlots.has(`${inv.id}|${slotIndex}`)) {
          out.push({
            kind: 'slot',
            invitationId: inv.id,
            invitationLabel: inv.guestLabel,
            slotIndex,
          });
        }
      }
    }
    return out;
  }
}

// ---------------- helpers ----------------

type AssignmentSnapshot =
  | { kind: 'empty' }
  | { kind: 'attendee'; attendeeId: string }
  | { kind: 'slot'; invitationId: string; slotIndex: number };

function pickAssignment(s: Seat): AssignmentSnapshot {
  if (s.attendeeId) return { kind: 'attendee', attendeeId: s.attendeeId };
  if (s.invitationId && s.slotIndex != null) {
    return { kind: 'slot', invitationId: s.invitationId, slotIndex: s.slotIndex };
  }
  return { kind: 'empty' };
}

function clearAssignment(s: Seat) {
  s.attendeeId = null;
  s.invitationId = null;
  s.slotIndex = null;
}

function applyAssignment(s: Seat, a: AssignmentSnapshot) {
  clearAssignment(s);
  if (a.kind === 'attendee') s.attendeeId = a.attendeeId;
  if (a.kind === 'slot') {
    s.invitationId = a.invitationId;
    s.slotIndex = a.slotIndex;
  }
}

function applyUnit(
  s: Seat,
  u: { kind: 'attendee'; attendeeId: string }
   | { kind: 'slot'; invitationId: string; slotIndex: number },
) {
  if (u.kind === 'attendee') s.attendeeId = u.attendeeId;
  else {
    s.invitationId = u.invitationId;
    s.slotIndex = u.slotIndex;
  }
}
