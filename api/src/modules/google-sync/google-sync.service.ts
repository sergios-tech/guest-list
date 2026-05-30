import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { google } from 'googleapis';
import { Invitation } from '../../entities/invitation.entity';
import { Attendee } from '../../entities/attendee.entity';
import { UserGoogleCredential } from '../../entities/user-google-credential.entity';
import { Client } from '../../entities/client.entity';
import { GoogleOauthService } from './google-oauth.service';
import {
  ATTENDEES_COLUMN_HEADER, norm, parseRow, ParsedAttendee, RawSheetRow,
} from './sheet-parser.util';
import { classifyRows, reconcileAttendees, SheetRowInput } from './reconcile.util';

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

  async run(userId: string, clientId: string): Promise<SyncResult> {
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
      attendeesCreated: 0, attendeesRemoved: 0, errors: [],
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

    // Load every invitation for this client once, then classify in memory.
    // "Sheet wins" reconciliation: pass-1 exact label match, pass-2 similarity
    // rename detection. Orphans (in DB, gone from sheet) are left untouched here.
    const existing = await this.invitations.find({ where: { clientId } });
    const byId = new Map(existing.map((e) => [e.id, e]));
    const plan = classifyRows(
      sheetRows,
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

    // Apply: each op is isolated so one bad row can't abort the whole sync.
    for (const ins of plan.inserts) {
      try {
        // attendees is a derived child collection, not an invitation column —
        // keep it out of the entity payload (the relation has cascade:false).
        const { attendees, ...invRow } = ins.row;
        const entity = this.invitations.create({
          ...invRow, clientId, createdBy: userId, updatedBy: userId,
          sheetRow: ins.rowNumber,
        });
        const saved = await this.invitations.save(entity);
        await this.syncAttendees(saved.id, attendees, [], result);
        result.inserted++;
      } catch (err) {
        result.errors.push({
          rowNumber: ins.rowNumber, guestLabel: ins.row.guestLabel, message: formatRowError(err),
        });
      }
    }
    for (const upd of plan.updates) {
      try {
        const entity = byId.get(upd.id)!;
        const { attendees, ...invRow } = upd.row;
        // Re-stamp sheet_row each sync: a guest who moved up/down in the sheet
        // (or whose row was previously NULL) tracks its current position.
        Object.assign(entity, invRow, { updatedBy: userId, sheetRow: upd.rowNumber });
        await this.invitations.save(entity);
        await this.syncAttendees(upd.id, attendees, attByInvitation.get(upd.id) ?? [], result);
        result.updated++;
      } catch (err) {
        result.errors.push({
          rowNumber: upd.rowNumber, guestLabel: upd.row.guestLabel, message: formatRowError(err),
        });
      }
    }
    for (const ren of plan.renames) {
      try {
        const entity = byId.get(ren.id)!;
        const { attendees, ...invRow } = ren.row;
        // A renamed guest follows its new sheet position too.
        Object.assign(entity, invRow, { updatedBy: userId, sheetRow: ren.rowNumber });
        await this.invitations.save(entity);
        await this.syncAttendees(ren.id, attendees, attByInvitation.get(ren.id) ?? [], result);
        result.renamed++;
      } catch (err) {
        result.errors.push({
          rowNumber: ren.rowNumber, guestLabel: ren.row.guestLabel, message: formatRowError(err),
        });
      }
    }

    return result;
  }

  /**
   * Reconcile one invitation's attendees against the names parsed from its note.
   * Matches by name so unchanged attendees keep their id (and thus their seat —
   * see reconcileAttendees). Each op runs within the caller's per-row try/catch.
   */
  private async syncAttendees(
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
      await this.attendees.save(
        recon.toInsert.map((a) => this.attendees.create({
          invitationId, fullName: a.fullName, isChild: a.isChild,
        })),
      );
      result.attendeesCreated += recon.toInsert.length;
    }
    for (const u of recon.toUpdate) {
      await this.attendees.update({ id: u.id }, { isChild: u.isChild });
    }
    if (recon.toDeleteIds.length > 0) {
      // seat.attendee_id is ON DELETE SET NULL — removing a dropped guest frees
      // any seat they held, which is the correct outcome (they're not coming).
      await this.attendees.delete(recon.toDeleteIds);
      result.attendeesRemoved += recon.toDeleteIds.length;
    }
  }
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
