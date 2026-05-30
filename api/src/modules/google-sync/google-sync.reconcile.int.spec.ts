// Integration tests for the clean/continue reconcile path, driven OFFLINE.
//
// These exercise GoogleSyncService.applySheetValues() — the seam that takes an
// already-fetched sheet grid (no OAuth, no Google network) and runs the full
// parse -> reconcile -> apply against a REAL Postgres. They cover the behaviours
// the code review flagged for clean mode: empty-sheet refusal, id/created_at/seat
// preservation on re-import, orphan deletion, out-of-range soft errors with an
// atomic commit, and continue-vs-clean orphan semantics.
//
// Isolation: a throwaway app_user and a throwaway client are created per file/
// test and deleted afterwards (DELETE FROM client cascades to its invitations,
// attendees, seating plan, tables, and seats). Point it at a DISPOSABLE database
// (guests_test) — never the real `guests` data. See the run recipe in the task
// notes / commit message.
//
// Requires DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME for a reachable Postgres
// with db/01_schema.sql already loaded.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  beforeAll, afterAll, beforeEach, afterEach, describe, it, expect,
} from 'vitest';
import { DataSource, DataSourceOptions, Repository } from 'typeorm';
import { buildTypeOrmConfig } from '../../config/typeorm.config';
import { Invitation } from '../../entities/invitation.entity';
import { Attendee } from '../../entities/attendee.entity';
import { Client } from '../../entities/client.entity';
import { UserGoogleCredential } from '../../entities/user-google-credential.entity';
import { GoogleSyncService } from './google-sync.service';

// Sheet column order mirrors RawSheetRow / generate_seed.py (A..I + companions).
const HEADER = [
  'Gost', 'Planirano', 'Status', 'Odrasli', 'Deca', 'Suma',
  'Prognoza', 'Datum', 'Napomena', 'Zvanica u pratnji',
];

interface RowOpts {
  status?: string;
  adults?: number | '';
  children?: number | '';
  companions?: string;
}

function row(guest: string, opts: RowOpts = {}): unknown[] {
  const { status = 'Pozvan', adults = '', children = '', companions = '' } = opts;
  // [A guest, B planned, C status, D adults, E children, F sum, G forecast,
  //  H date, I napomena, (companions)]
  return [guest, '', status, adults, children, '', '', '', '', companions];
}

const sheet = (...rows: unknown[][]): unknown[][] => [HEADER, ...rows];

describe('GoogleSyncService.applySheetValues (offline reconcile)', () => {
  let ds: DataSource;
  let service: GoogleSyncService;
  let invitations: Repository<Invitation>;
  let attendees: Repository<Attendee>;
  let clients: Repository<Client>;
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    // buildTypeOrmConfig() returns the broad Nest TypeOrmModuleOptions; narrow
    // to DataSourceOptions for a standalone DataSource (same shape at runtime).
    ds = new DataSource(buildTypeOrmConfig() as DataSourceOptions);
    await ds.initialize();
    invitations = ds.getRepository(Invitation);
    attendees = ds.getRepository(Attendee);
    clients = ds.getRepository(Client);

    // createdBy/updatedBy reference app_user — create a throwaway one to own the
    // synced rows. Keep its id so afterAll can remove it.
    userId = randomUUID();
    await ds.query(
      `INSERT INTO app_user (id, email, password_hash, display_name, is_super_admin)
       VALUES ($1, $2, 'x', 'Sync Test', false)`,
      [userId, `synctest-${userId}@example.test`],
    );

    service = new GoogleSyncService(
      invitations, attendees,
      ds.getRepository(UserGoogleCredential), clients,
      undefined as never, // oauth — not used by applySheetValues
      ds,
    );
  });

  afterAll(async () => {
    if (!ds?.isInitialized) return;
    await ds.query(`DELETE FROM app_user WHERE id = $1`, [userId]);
    await ds.destroy();
  });

  beforeEach(async () => {
    clientId = randomUUID();
    await clients.save(clients.create({ id: clientId, name: `test-${clientId.slice(0, 8)}` }));
  });

  afterEach(async () => {
    // Cascades to invitations/attendees/seating_plan/seating_table/seat.
    await ds.query(`DELETE FROM client WHERE id = $1`, [clientId]);
  });

  const countInv = () => invitations.count({ where: { clientId } });

  it('refuses a clean when no valid rows remain, deleting nothing', async () => {
    await service.applySheetValues(clientId, userId, 'clean', sheet(row('Seed Guest')));
    expect(await countInv()).toBe(1);

    // Header-only grid -> zero parsed rows -> must refuse, not wipe.
    await expect(
      service.applySheetValues(clientId, userId, 'clean', sheet()),
    ).rejects.toThrow(/Refusing to clean/i);

    expect(await countInv()).toBe(1);
  });

  it('clean preserves matched ids, created_at and seats; deletes only orphans', async () => {
    const first = await service.applySheetValues(clientId, userId, 'clean', sheet(
      row('Guest A'),
      row('Guest B', { companions: 'Ana' }),
      row('Guest C', { companions: 'Cad' }),
    ));
    expect(first.inserted).toBe(3);
    expect(first.deleted).toBe(0);

    const a0 = await invitations.findOneByOrFail({ clientId, guestLabel: 'Guest A' });
    const b0 = await invitations.findOneByOrFail({ clientId, guestLabel: 'Guest B' });
    const c0 = await invitations.findOneByOrFail({ clientId, guestLabel: 'Guest C' });
    const ana = await attendees.findOneByOrFail({ invitationId: b0.id, fullName: 'Ana' });
    const cad = await attendees.findOneByOrFail({ invitationId: c0.id, fullName: 'Cad' });

    // Seat Ana (kept guest) and Cad (orphan-to-be) so we can show one seat
    // survives and the other is freed.
    const planId = randomUUID();
    const tableId = randomUUID();
    await ds.query(
      `INSERT INTO seating_plan (id, client_id, name, is_active) VALUES ($1,$2,'Plan',true)`,
      [planId, clientId],
    );
    await ds.query(
      `INSERT INTO seating_table (id, plan_id, table_number, seat_count) VALUES ($1,$2,1,10)`,
      [tableId, planId],
    );
    await ds.query(
      `INSERT INTO seat (plan_id, table_id, seat_number, attendee_id) VALUES ($1,$2,1,$3)`,
      [planId, tableId, ana.id],
    );
    await ds.query(
      `INSERT INTO seat (plan_id, table_id, seat_number, attendee_id) VALUES ($1,$2,2,$3)`,
      [planId, tableId, cad.id],
    );

    // Re-import with C removed: A,B reconcile (kept), C becomes the orphan.
    const second = await service.applySheetValues(clientId, userId, 'clean', sheet(
      row('Guest A'),
      row('Guest B', { companions: 'Ana' }),
    ));
    expect(second.updated).toBe(2);
    expect(second.inserted).toBe(0);
    expect(second.deleted).toBe(1);

    // A & B keep their invitation id and created_at (update-in-place, not re-insert).
    const a1 = await invitations.findOneByOrFail({ clientId, guestLabel: 'Guest A' });
    const b1 = await invitations.findOneByOrFail({ clientId, guestLabel: 'Guest B' });
    expect(a1.id).toBe(a0.id);
    expect(b1.id).toBe(b0.id);
    expect(a1.createdAt.getTime()).toBe(a0.createdAt.getTime());
    expect(b1.createdAt.getTime()).toBe(b0.createdAt.getTime());

    // C is gone; its attendee cascade-deleted.
    expect(await invitations.findOneBy({ id: c0.id })).toBeNull();
    expect(await attendees.findOneBy({ id: cad.id })).toBeNull();

    // Ana kept her id -> her seat still holds her. Cad's seat was freed (SET NULL).
    const anaSeat = await ds.query(`SELECT attendee_id FROM seat WHERE attendee_id = $1`, [ana.id]);
    expect(anaSeat.length).toBe(1);
    const cadSeat = await ds.query(
      `SELECT attendee_id FROM seat WHERE plan_id = $1 AND seat_number = 2`, [planId],
    );
    expect(cadSeat[0].attendee_id).toBeNull();
  });

  it('clean records out-of-range rows as soft errors and still commits the valid ones', async () => {
    const res = await service.applySheetValues(clientId, userId, 'clean', sheet(
      row('Valid X'),
      row('Bad Y', { adults: 20 }),  // violates CHECK (adults BETWEEN 0 AND 12)
      row('Valid Z'),
    ));

    expect(res.inserted).toBe(2);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].guestLabel).toBe('Bad Y');
    expect(res.errors[0].message).toMatch(/between 0 and 12/i);

    expect(await invitations.findOneBy({ clientId, guestLabel: 'Valid X' })).not.toBeNull();
    expect(await invitations.findOneBy({ clientId, guestLabel: 'Valid Z' })).not.toBeNull();
    expect(await invitations.findOneBy({ clientId, guestLabel: 'Bad Y' })).toBeNull();
    expect(await countInv()).toBe(2);
  });

  it('clean collapses duplicate guest labels into one invitation', async () => {
    const res = await service.applySheetValues(clientId, userId, 'clean', sheet(
      row('Doubled'),
      row('Doubled'),
      row('Unique'),
    ));
    expect(res.inserted).toBe(2);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/duplicate/i);
    expect(await countInv()).toBe(2);
  });

  it('continue mode leaves orphans in place (does not delete)', async () => {
    await service.applySheetValues(clientId, userId, 'clean', sheet(
      row('Keep A'), row('Drop B'),
    ));
    expect(await countInv()).toBe(2);

    const res = await service.applySheetValues(clientId, userId, 'continue', sheet(row('Keep A')));
    expect(res.deleted).toBe(0);
    expect(await countInv()).toBe(2); // Drop B survives in continue mode
  });
});
