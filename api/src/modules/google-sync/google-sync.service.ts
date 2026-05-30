import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import { google } from 'googleapis';
import { Invitation } from '../../entities/invitation.entity';
import { Attendee } from '../../entities/attendee.entity';
import { UserGoogleCredential } from '../../entities/user-google-credential.entity';
import { Client } from '../../entities/client.entity';
import { GoogleOauthService } from './google-oauth.service';
import {
  ATTENDEES_COLUMN_HEADER, norm, parseRow, ParsedAttendee, ParsedRow, RawSheetRow,
} from './sheet-parser.util';
import {
  classifyRows, normalizeLabel, reconcileAttendees, ReconcilePlan, SheetRowInput,
} from './reconcile.util';

// Default sheet tab when a client row leaves google_sheet_tab unset. The sheet
// id is now per-client (Client.googleSheetId) and has no env fallback — a client
// with no configured sheet id cannot sync.
const DEFAULT_SHEET_TAB = 'Pozivnice';

export interface SyncRowError {
  rowNumber: number;
  guestLabel: string;
  message: string;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  renamed: number;
  skipped: number;
  unknownStatuses: number;
  demotedConfirmed: number;
  // Attendees derived from the napomena/notes column (e.g. "igor mira doda ...").
  attendeesCreated: number;
  attendeesRemoved: number;
  // Invitations deleted in clean mode before re-import; 0 in continue mode.
  deleted: number;
  errors: SyncRowError[];
}

export interface ConnectionStatus {
  connected: boolean;
  googleAccount?: string | null;
  connectedAt?: Date;
}

@Injectable()
export class GoogleSyncService {
  private readonly logger = new Logger(GoogleSyncService.name);

  constructor(
    @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>,
    @InjectRepository(Attendee) private readonly attendees: Repository<Attendee>,
    @InjectRepository(UserGoogleCredential) private readonly creds: Repository<UserGoogleCredential>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    private readonly oauth: GoogleOauthService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getStatus(userId: string): Promise<ConnectionStatus> {
    const row = await this.creds.findOne({ where: { userId } });
    if (!row) return { connected: false };
    return {
      connected: true,
      googleAccount: row.googleAccount,
      connectedAt: row.connectedAt,
    };
  }

  async disconnect(userId: string): Promise<void> {
    await this.oauth.disconnect(userId);
  }

  async run(
    userId: string,
    clientId: string,
    mode: 'continue' | 'clean' = 'continue',
  ): Promise<SyncResult> {
    // Sheet config is per-client (was previously global env vars). Resolve the
    // current tenant's sheet id/tab before touching Google.
    const client = await this.clients.findOne({ where: { id: clientId } });
    if (!client) {
      throw new BadRequestException('No Google Sheet configured for this client');
    }
    const sheetId = client.googleSheetId?.trim();
    if (!sheetId) {
      throw new BadRequestException('No Google Sheet configured for this client');
    }
    const sheetTab = (client.googleSheetTab?.trim() || DEFAULT_SHEET_TAB);

    const auth = await this.oauth.getAuthorizedClient(userId).catch((err) => {
      if (err instanceof NotFoundException) {
        throw new BadRequestException({
          code: 'GOOGLE_NOT_CONNECTED',
          message: 'Connect a Google account before syncing.',
        });
      }
      throw err;
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Pull A1:Z including the header row — the attendees column ('Zvanica u
    // pratnji') is located by header name, not a fixed letter, so it can move.
    let values: unknown[][] = [];
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetTab}!A1:Z`,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      });
      values = (resp.data.values as unknown[][] | undefined) ?? [];
    } catch (err: any) {
      // Translate common Google errors into UI-friendly codes.
      const status = err?.response?.status ?? err?.code;
      if (status === 403 || status === 401) {
        throw new BadRequestException({
          code: 'GOOGLE_SHEET_FORBIDDEN',
          message: 'Your Google account does not have access to the configured sheet.',
        });
      }
      if (status === 404) {
        throw new BadRequestException({
          code: 'GOOGLE_SHEET_NOT_FOUND',
          message: 'Configured Google Sheet not found.',
        });
      }
      this.logger.error('Google Sheets fetch failed', err?.stack ?? err);
      throw err;
    }

    const result: SyncResult = {
      inserted: 0, updated: 0, renamed: 0, skipped: 0,
      unknownStatuses: 0, demotedConfirmed: 0,
      attendeesCreated: 0, attendeesRemoved: 0, deleted: 0, errors: [],
    };

    // Row 1 is the header. Locate the attendees column by (NFC-normalised,
    // case-insensitive) header title; -1 if the sheet doesn't have it yet.
    const header = (values[0] ?? []) as unknown[];
    const wantedHeader = norm(ATTENDEES_COLUMN_HEADER).toLowerCase();
    const companionIdx = header.findIndex((h) => norm(h).toLowerCase() === wantedHeader);
    if (companionIdx < 0) {
      this.logger.warn(
        `Sheet '${sheetTab}' has no '${ATTENDEES_COLUMN_HEADER}' column; attendees will not be synced.`,
      );
    }

    // Parse every data row (skip the header), tallying parse-level outcomes.
    const sheetRows: SheetRowInput[] = [];
    for (let i = 1; i < values.length; i++) {
      const rowNumber = i + 1;  // values[1] is sheet row 2 (1-indexed)
      const cells = values[i] ?? [];

      const raw: RawSheetRow = {
        rowNumber,
        guest:         cells[0],
        plannedCount:  cells[1],
        status:        cells[2],
        adults:        cells[3],
        children:      cells[4],
        // index 5 is the sum formula; ignored
        forecast:      cells[6],
        responseDate:  cells[7],
        napomena:      cells[8],
        companions:    companionIdx >= 0 ? cells[companionIdx] : undefined,
      };
      const parsed = parseRow(raw);
      if (parsed.kind === 'skip') {
        result.skipped++;
        continue;
      }
      if (parsed.unknownStatus) result.unknownStatuses++;
      if (parsed.demoted) result.demotedConfirmed++;
      sheetRows.push({ rowNumber, row: parsed.row });
    }

    // Reconcile the parsed sheet against the DB. Both modes share this setup and
    // the apply helper; only the apply STRATEGY differs (clean is atomic and
    // deletes orphans, continue is best-effort and leaves orphans).
    let rowsToApply = sheetRows;
    if (mode === 'clean') {
      // Pre-flight BEFORE any write so the transaction can be genuinely atomic.
      // Drop out-of-range rows (they would otherwise trip a DB CHECK and, inside
      // a transaction, abort the WHOLE batch — Postgres aborts the transaction on
      // the first error and rejects every later statement) and collapse duplicate
      // guest labels (clean must not create two invitations for one guest).
      const seen = new Set<string>();
      const filtered: SheetRowInput[] = [];
      for (const sr of sheetRows) {
        const invalid = validateCounts(sr.row);
        if (invalid) {
          result.errors.push({
            rowNumber: sr.rowNumber, guestLabel: sr.row.guestLabel, message: invalid,
          });
          continue;
        }
        const key = normalizeLabel(sr.row.guestLabel);
        if (seen.has(key)) {
          result.errors.push({
            rowNumber: sr.rowNumber, guestLabel: sr.row.guestLabel,
            message: 'Duplicate guest in sheet — only the first occurrence is kept',
          });
          continue;
        }
        seen.add(key);
        filtered.push(sr);
      }
      // Never let a misread/empty/wrong-tab sheet wipe the whole guest list: a
      // clean with nothing valid to import would orphan (and delete) everything.
      if (filtered.length === 0) {
        throw new BadRequestException({
          code: 'CLEAN_SYNC_EMPTY_SHEET',
          message: 'Refusing to clean: the sheet has no valid data rows to import.',
        });
      }
      rowsToApply = filtered;
    }

    // Load every invitation for this client once, then classify in memory.
    // "Sheet wins" reconciliation: pass-1 exact label match, pass-2 similarity
    // rename detection.
    const existing = await this.invitations.find({ where: { clientId } });
    const byId = new Map(existing.map((e) => [e.id, e]));
    const plan = classifyRows(
      rowsToApply,
      existing.map((e) => ({ id: e.id, guestLabel: e.guestLabel, createdAt: e.createdAt })),
    );

    // Load every attendee for this client's invitations once, bucketed by
    // invitation id, so per-row reconciliation (update/rename) is in-memory.
    // attendee has no client_id — scope it through its parent invitation ids.
    const existingAttendees = existing.length
      ? await this.attendees.find({ where: { invitationId: In(existing.map((e) => e.id)) } })
      : [];
    const attByInvitation = new Map<string, Attendee[]>();
    for (const a of existingAttendees) {
      const list = attByInvitation.get(a.invitationId);
      if (list) list.push(a);
      else attByInvitation.set(a.invitationId, [a]);
    }

    if (mode === 'clean') {
      // Clean = the sheet is the COMPLETE source of truth. Reconcile like a normal
      // sync (matched guests keep their id — and thus their seat and created_at),
      // then delete the orphans (in DB, gone from the sheet). The whole apply is
      // one transaction: a hard failure rolls back and the original data survives.
      // Out-of-range/duplicate rows were filtered above, so nothing aborts the
      // transaction mid-flight; errors are NOT swallowed here (isolateErrors:
      // false), so a real failure surfaces instead of a false success.
      await this.dataSource.transaction(async (mgr) => {
        await this.applyPlan(mgr, plan, byId, attByInvitation, clientId, userId, result, false);
        const orphanIds = plan.orphans.map((o) => o.id);
        if (orphanIds.length > 0) {
          // FK cleanup is automatic — attendee.invitation_id is ON DELETE CASCADE
          // and seat.invitation_id/attendee_id are ON DELETE SET NULL (the orphan
          // guests' seats are freed; seating plans/tables survive).
          const del = await mgr.delete(Invitation, orphanIds);
          result.deleted = del.affected ?? 0;
        }
      });
      return result;
    }

    // Continue mode: best-effort and per-row isolated (one bad row can't abort the
    // sync), non-transactional. Orphans (in DB, gone from sheet) are left alone.
    await this.applyPlan(
      this.dataSource.manager, plan, byId, attByInvitation, clientId, userId, result, true,
    );
    return result;
  }

  /**
   * Apply a reconciliation plan's inserts/updates/renames through `mgr`.
   *
   * `mgr` is either a transaction's EntityManager (clean mode — atomic) or the
   * default manager (continue mode — each save is its own implicit transaction).
   * When `isolateErrors` is true a failing row is recorded in `result.errors` and
   * the loop continues (continue mode's per-row isolation); when false the error
   * propagates so the surrounding transaction rolls back (clean mode — no false
   * success). Orphan handling is the caller's responsibility.
   */
  private async applyPlan(
    mgr: EntityManager,
    plan: ReconcilePlan,
    byId: Map<string, Invitation>,
    attByInvitation: Map<string, Attendee[]>,
    clientId: string,
    userId: string,
    result: SyncResult,
    isolateErrors: boolean,
  ): Promise<void> {
    const apply = async (
      rowNumber: number,
      guestLabel: string,
      fn: () => Promise<void>,
    ): Promise<void> => {
      if (!isolateErrors) {
        await fn();
        return;
      }
      try {
        await fn();
      } catch (err) {
        result.errors.push({ rowNumber, guestLabel, message: formatRowError(err) });
      }
    };

    for (const ins of plan.inserts) {
      await apply(ins.rowNumber, ins.row.guestLabel, async () => {
        // attendees is a derived child collection, not an invitation column —
        // keep it out of the entity payload (the relation has cascade:false).
        const { attendees, ...invRow } = ins.row;
        const entity = mgr.create(Invitation, {
          ...invRow, clientId, createdBy: userId, updatedBy: userId, sheetRow: ins.rowNumber,
        });
        const saved = await mgr.save(entity);
        await this.syncAttendees(mgr, saved.id, attendees, [], result);
        result.inserted++;
      });
    }
    for (const upd of plan.updates) {
      await apply(upd.rowNumber, upd.row.guestLabel, async () => {
        const entity = byId.get(upd.id)!;
        const { attendees, ...invRow } = upd.row;
        // Re-stamp sheet_row each sync: a guest who moved up/down in the sheet
        // (or whose row was previously NULL) tracks its current position.
        Object.assign(entity, invRow, { updatedBy: userId, sheetRow: upd.rowNumber });
        await mgr.save(entity);
        await this.syncAttendees(mgr, upd.id, attendees, attByInvitation.get(upd.id) ?? [], result);
        result.updated++;
      });
    }
    for (const ren of plan.renames) {
      await apply(ren.rowNumber, ren.row.guestLabel, async () => {
        const entity = byId.get(ren.id)!;
        const { attendees, ...invRow } = ren.row;
        // A renamed guest follows its new sheet position too.
        Object.assign(entity, invRow, { updatedBy: userId, sheetRow: ren.rowNumber });
        await mgr.save(entity);
        await this.syncAttendees(mgr, ren.id, attendees, attByInvitation.get(ren.id) ?? [], result);
        result.renamed++;
      });
    }
  }

  /**
   * Reconcile one invitation's attendees against the names parsed from the sheet.
   * Matches by name so unchanged attendees keep their id (and thus their seat —
   * see reconcileAttendees). Runs through the caller's `mgr` so it participates in
   * the same transaction (clean mode) or implicit per-call transaction (continue).
   */
  private async syncAttendees(
    mgr: EntityManager,
    invitationId: string,
    desired: ParsedAttendee[],
    existing: Attendee[],
    result: SyncResult,
  ): Promise<void> {
    const recon = reconcileAttendees(
      existing.map((a) => ({ id: a.id, fullName: a.fullName, isChild: a.isChild })),
      desired,
    );

    if (recon.toInsert.length > 0) {
      await mgr.save(
        recon.toInsert.map((a) => mgr.create(Attendee, {
          invitationId, fullName: a.fullName, isChild: a.isChild,
        })),
      );
      result.attendeesCreated += recon.toInsert.length;
    }
    for (const u of recon.toUpdate) {
      await mgr.update(Attendee, { id: u.id }, { isChild: u.isChild });
    }
    if (recon.toDeleteIds.length > 0) {
      // seat.attendee_id is ON DELETE SET NULL — removing a dropped guest frees
      // any seat they held, which is the correct outcome (they're not coming).
      await mgr.delete(Attendee, recon.toDeleteIds);
      result.attendeesRemoved += recon.toDeleteIds.length;
    }
  }
}

// Pre-flight guard for clean mode: the DB enforces `adults/children/planned_count/
// forecast BETWEEN 0 AND 12` as CHECK constraints. In continue mode a violating
// row is isolated (its own implicit transaction fails, the rest proceed), but in
// clean mode every write shares one transaction, so a single CHECK failure would
// abort the whole batch. Validate up front and report the row instead. Returns an
// error message, or null when the row's counts are all in range.
function validateCounts(row: ParsedRow): string | null {
  const fields: Array<[string, number | null | undefined]> = [
    ['planned count', row.plannedCount],
    ['adults', row.adults],
    ['children', row.children],
    ['forecast', row.forecast],
  ];
  for (const [label, value] of fields) {
    if (value != null && (value < 0 || value > 12)) {
      return `${label} must be between 0 and 12 (got ${value})`;
    }
  }
  return null;
}

function formatRowError(err: unknown): string {
  if (err instanceof QueryFailedError) {
    const driver = (err as any).driverError ?? {};
    if (driver.code === '23514') {
      // CHECK violation — surface which one so the user can fix the sheet cell.
      return `Constraint violation: ${driver.constraint ?? 'unknown'}`;
    }
    if (driver.code === '23505') return 'Duplicate row in sheet';
    return `Database error (${driver.code ?? '?'})`;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
