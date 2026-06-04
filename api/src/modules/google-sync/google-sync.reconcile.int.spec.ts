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

// A header grid WITHOUT the dedicated companions column (mirrors the real source
// spreadsheet, whose names live in Napomena) — used to prove a column-less sheet
// leaves existing attendees untouched rather than wiping them.
const NO_COMPANION_HEADER = HEADER.slice(0, 9); // A..I, no 'Zvanica u pratnji'
const sheetNoCompanions = (...rows: unknown[][]): unknown[][] =>
  [NO_COMPANION_HEADER, ...rows.map((r) => r.slice(0, 9))];

// This suite needs a REAL Postgres and creates/drops throwaway clients, so it is
// OFF by default: `npm test` skips it entirely (the pure unit specs still run).
// Opt in explicitly against a DISPOSABLE database (never the live `guests` data):
//   RUN_DB_TESTS=1 DB_HOST=localhost DB_PORT=5432 DB_USER=dbuser \
//   DB_PASSWORD=... DB_NAME=guests_test npx vitest run google-sync.reconcile.int
// The explicit RUN_DB_TESTS gate stops a stray dev DB_HOST from pointing the
// suite at production.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!RUN_DB_TESTS)('GoogleSyncService.applySheetValues (offline reconcile)', () => {
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

  it('a column-less sheet leaves existing attendees untouched (does not wipe them)', async () => {
    // Seed a guest WITH a companion (creates an attendee) via a sheet that has
    // the dedicated column.
    await service.applySheetValues(clientId, userId, 'clean', sheet(
      row('Guest A', { companions: 'Ana' }),
    ));
    const a0 = await invitations.findOneByOrFail({ clientId, guestLabel: 'Guest A' });
    expect(await attendees.findOneBy({ invitationId: a0.id, fullName: 'Ana' })).not.toBeNull();

    // Continue (the default) from a column-less sheet: attendees must survive.
    const cont = await service.applySheetValues(
      clientId, userId, 'continue', sheetNoCompanions(row('Guest A')),
    );
    expect(cont.attendeesRemoved).toBe(0);
    expect(await attendees.findOneBy({ invitationId: a0.id, fullName: 'Ana' })).not.toBeNull();

    // A column-less CLEAN must also leave the roster alone (absent != empty).
    const clean = await service.applySheetValues(
      clientId, userId, 'clean', sheetNoCompanions(row('Guest A')),
    );
    expect(clean.attendeesRemoved).toBe(0);
    expect(await attendees.findOneBy({ invitationId: a0.id, fullName: 'Ana' })).not.toBeNull();
  });

  it('a guest going Declined keeps its attendees in clean/mirror mode (roster preserved)', async () => {
    // Seed a confirmed guest with two companions (creates attendees).
    await service.applySheetValues(clientId, userId, 'clean', sheet(
      row('Guest A', { status: 'Potvrđen dolazak', adults: 2, companions: 'Ana, Marko' }),
    ));
    const a0 = await invitations.findOneByOrFail({ clientId, guestLabel: 'Guest A' });
    expect(await attendees.countBy({ invitationId: a0.id })).toBe(2);

    // Same guest now Declines. A clean (mirror) sync parses an empty roster, but
    // a Declined row must SKIP attendee reconciliation: nothing deleted/inserted,
    // and the stored attendees (with their seats) survive for a future un-decline.
    const res = await service.applySheetValues(clientId, userId, 'clean', sheet(
      row('Guest A', { status: 'Odbijeno' }),
    ));
    expect(res.attendeesRemoved).toBe(0);
    expect(res.attendeesCreated).toBe(0);
    const after = await invitations.findOneByOrFail({ id: a0.id });
    expect(after.status).toBe('ODBIJENO');
    expect(after.confirmedTotal).toBe(0);
    expect(await attendees.countBy({ invitationId: a0.id })).toBe(2);

    // Continue mode honours the same skip.
    const cont = await service.applySheetValues(clientId, userId, 'continue', sheet(
      row('Guest A', { status: 'Odbijeno' }),
    ));
    expect(cont.attendeesRemoved).toBe(0);
    expect(await attendees.countBy({ invitationId: a0.id })).toBe(2);
  });

  it('clean keeps an existing guest whose row has an out-of-range count', async () => {
    await service.applySheetValues(clientId, userId, 'clean', sheet(row('Guest A'), row('Guest B')));
    const a0 = await invitations.findOneByOrFail({ clientId, guestLabel: 'Guest A' });

    // Re-clean with Guest A's adults out of range (a typo). It is reported as a
    // soft error but is STILL in the sheet, so it must NOT be deleted as an orphan.
    const res = await service.applySheetValues(clientId, userId, 'clean', sheet(
      row('Guest A', { adults: 20 }),
      row('Guest B'),
    ));
    expect(res.errors.some((e) => e.guestLabel === 'Guest A')).toBe(true);
    expect(res.deleted).toBe(0);
    expect(await invitations.findOneBy({ id: a0.id })).not.toBeNull();
    expect(await countInv()).toBe(2);
  });

  it('continue mode does not delete app-created attendees missing from the sheet', async () => {
    await service.applySheetValues(clientId, userId, 'clean', sheet(row('Guest A')));
    const a0 = await invitations.findOneByOrFail({ clientId, guestLabel: 'Guest A' });
    // Simulate an attendee added through the app UI (not present in the sheet).
    await attendees.save(attendees.create({
      invitationId: a0.id, fullName: 'Manual Person', isChild: false,
    }));

    // A continue sync whose companions cell for Guest A is empty is additive — it
    // must not remove the manually-added attendee.
    const res = await service.applySheetValues(clientId, userId, 'continue', sheet(row('Guest A')));
    expect(res.attendeesRemoved).toBe(0);
    expect(
      await attendees.findOneBy({ invitationId: a0.id, fullName: 'Manual Person' }),
    ).not.toBeNull();

    // Whereas a CLEAN sync (mirror) with an empty companions cell DOES remove it.
    const cleanRes = await service.applySheetValues(
      clientId, userId, 'clean', sheet(row('Guest A')),
    );
    expect(cleanRes.attendeesRemoved).toBe(1);
    expect(
      await attendees.findOneBy({ invitationId: a0.id, fullName: 'Manual Person' }),
    ).toBeNull();
  });
});
