// Közös teszt-segéd: D1-utánzat valódi SQLite-tal (node:sqlite).
// A D1 viselkedését követi, amennyire a foglalónak számít:
//  - bind: undefined vagy boolean paraméterre hibát dob (a D1 is elutasítja az undefined-ot)
//  - batch: egyetlen tranzakció, bármelyik utasítás hibájára az egész visszagörgetődik
//  - run: { success, meta: { changes } }, first(col), all(): { results }
import { DatabaseSync } from 'node:sqlite';

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const check = (args) => {
    args.forEach((a, i) => {
      if (a === undefined || typeof a === 'boolean') throw new Error(`D1_TYPE_ERROR: Type '${typeof a}' not supported for value at index ${i}`);
    });
  };
  const exec = (sql, args) => {
    check(args);
    const st = db.prepare(sql);
    if (st.columns().length) return { success: true, results: st.all(...args), meta: { changes: 0 } };
    const r = st.run(...args);
    return { success: true, results: [], meta: { changes: Number(r.changes) } };
  };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => { check(args); return { success: true, results: db.prepare(sql).all(...args), meta: {} }; },
    first: async (col) => {
      check(args);
      const r = db.prepare(sql).get(...args) ?? null;
      return col ? (r ? r[col] ?? null : null) : r;
    },
    run: async () => exec(sql, args),
    _exec: () => exec(sql, args),
  });
  let inTx = false;
  return {
    _raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      // a valódi D1 is sorba állítja a batch-eket; itt a szinkron SQLite ugyanezt adja
      if (inTx) throw new Error('beágyazott batch');
      inTx = true;
      db.exec('BEGIN');
      try {
        const out = list.map((s) => s._exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw new Error(`D1_ERROR: ${e.message}`);
      } finally {
        inTx = false;
      }
    },
  };
}
