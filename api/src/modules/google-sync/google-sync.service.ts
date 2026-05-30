import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { google } from 'googleapis';
import { Invitation } from '../../entities/invitation.entity';
import { UserGoogleCredential } from '../../entities/user-google-credential.entity';
import { Client } from '../../entities/client.entity';
import { GoogleOauthService } from './google-oauth.service';
import { parseRow, RawSheetRow } from './sheet-parser.util';
import { classifyRows, SheetRowInput } from './reconcile.util';

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

    // Pull A2:I to skip the header row. Returns string-valued cells.
    let values: unknown[][] = [];
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetTab}!A2:I`,
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
      unknownStatuses: 0, demotedConfirmed: 0, errors: [],
    };

    // Parse every sheet row first, tallying parse-level outcomes.
    const sheetRows: SheetRowInput[] = [];
    for (let i = 0; i < values.length; i++) {
      const rowNumber = i + 2;  // sheet rows are 1-indexed; data starts at row 2
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

    // Apply: each op is isolated so one bad row can't abort the whole sync.
    for (const ins of plan.inserts) {
      try {
        const entity = this.invitations.create({
          ...ins.row, clientId, createdBy: userId, updatedBy: userId,
        });
        await this.invitations.save(entity);
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
        Object.assign(entity, upd.row, { updatedBy: userId });
        await this.invitations.save(entity);
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
        Object.assign(entity, ren.row, { updatedBy: userId });
        await this.invitations.save(entity);
        result.renamed++;
      } catch (err) {
        result.errors.push({
          rowNumber: ren.rowNumber, guestLabel: ren.row.guestLabel, message: formatRowError(err),
        });
      }
    }

    return result;
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
