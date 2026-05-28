import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { google } from 'googleapis';
import { Invitation } from '../../entities/invitation.entity';
import { UserGoogleCredential } from '../../entities/user-google-credential.entity';
import { GoogleOauthService } from './google-oauth.service';
import { parseRow, ParsedRow, RawSheetRow } from './sheet-parser.util';

function envSheetId(): string {
  return (process.env.GOOGLE_SHEET_ID ?? '1gsydyLPpQH3bJoppdZoLYjlq3zKexlc-qWnuYnujeQM').trim();
}
function envSheetTab(): string {
  return (process.env.GOOGLE_SHEET_TAB ?? 'Pozivnice').trim();
}

export interface SyncRowError {
  rowNumber: number;
  guestLabel: string;
  message: string;
}

export interface SyncResult {
  inserted: number;
  updated: number;
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

  async run(userId: string): Promise<SyncResult> {
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
        spreadsheetId: envSheetId(),
        range: `${envSheetTab()}!A2:I`,
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
      inserted: 0, updated: 0, skipped: 0,
      unknownStatuses: 0, demotedConfirmed: 0, errors: [],
    };

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

      try {
        await this.upsertByGuestLabel(parsed.row, userId, result);
      } catch (err) {
        result.errors.push({
          rowNumber,
          guestLabel: parsed.row.guestLabel,
          message: formatRowError(err),
        });
      }
    }

    return result;
  }

  private async upsertByGuestLabel(
    row: ParsedRow,
    userId: string,
    result: SyncResult,
  ): Promise<void> {
    // Match generate_seed.py's identity assumption: guest_label is the natural
    // key. (There's no UNIQUE constraint on it in the DB, so collisions would
    // mean someone manually created a duplicate row — extremely rare for a
    // wedding list. If we hit one, we update the first match deterministically.)
    const existing = await this.invitations.findOne({
      where: { guestLabel: row.guestLabel },
      order: { createdAt: 'ASC' },
    });

    if (existing) {
      Object.assign(existing, row, { updatedBy: userId });
      await this.invitations.save(existing);
      result.updated++;
    } else {
      const entity = this.invitations.create({
        ...row,
        createdBy: userId,
        updatedBy: userId,
      });
      await this.invitations.save(entity);
      result.inserted++;
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
