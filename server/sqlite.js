import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import session from 'express-session';
import { DatabaseSync } from 'node:sqlite';
import { getSqlitePath } from './databaseConfig.js';
import { isReadQuery, mapSqliteError, toSqlite } from './sqliteSql.js';
import { secureLocalDirectory, secureLocalFile } from './loadEnv.js';

const txContext = new AsyncLocalStorage();
let queue = Promise.resolve();
let db;

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'database', 'schema.sql');

const toPlainRow = (row) => (row ? { ...row } : row);

const runExclusive = (fn) => {
  if (txContext.getStore()?.active) return fn();
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
};

const execQuery = (sql, params = []) => {
  const trimmed = String(sql).trim();
  if (/GET_LOCK\s*\(/i.test(trimmed)) return [[{ acquired: 1 }]];
  if (/RELEASE_LOCK\s*\(/i.test(trimmed)) return [[{ released: 1 }]];

  const converted = toSqlite(trimmed);
  const values = (Array.isArray(params) ? params : []).map((value) => (value === undefined ? null : value));
  try {
    const stmt = db.prepare(converted);
    if (isReadQuery(converted)) {
      return [stmt.all(...values).map(toPlainRow)];
    }
    const info = stmt.run(...values);
    return [{
      insertId: Number(info.lastInsertRowid),
      affectedRows: info.changes,
    }];
  } catch (error) {
    throw mapSqliteError(error);
  }
};

const queryAsync = (sql, params) => runExclusive(() => execQuery(sql, params));

export class SqliteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    this.selectStmt = database.prepare('SELECT data, expires FROM user_sessions WHERE session_id = ?');
    this.upsertStmt = database.prepare(`
      INSERT INTO user_sessions (session_id, expires, data)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET expires = excluded.expires, data = excluded.data
    `);
    this.deleteStmt = database.prepare('DELETE FROM user_sessions WHERE session_id = ?');
    this.clearExpiredStmt = database.prepare('DELETE FROM user_sessions WHERE expires < ?');
  }

  get(sid, callback) {
    try {
      const row = this.selectStmt.get(sid);
      if (!row) return callback(null, undefined);
      if (Number(row.expires) * 1000 <= Date.now()) {
        this.deleteStmt.run(sid);
        return callback(null, undefined);
      }
      return callback(null, JSON.parse(row.data));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = Number(sess?.cookie?.maxAge) || 12 * 60 * 60 * 1000;
      const expires = Math.floor((Date.now() + maxAge) / 1000);
      this.upsertStmt.run(sid, expires, JSON.stringify(sess));
      this.clearExpiredStmt.run(Math.floor(Date.now() / 1000));
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.deleteStmt.run(sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  touch(sid, sess, callback) {
    this.set(sid, sess, callback);
  }

  close() {
    return Promise.resolve();
  }
}

export const openSqlite = () => {
  if (db) return db;
  const sqlitePath = getSqlitePath();
  if (sqlitePath !== ':memory:') {
    secureLocalDirectory(path.dirname(sqlitePath));
  }
  db = new DatabaseSync(sqlitePath);
  if (sqlitePath !== ':memory:') secureLocalFile(sqlitePath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (sqlitePath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  return db;
};

export const createPool = () => {
  openSqlite();
  return {
    query: queryAsync,
    getConnection: async () => ({
      query: queryAsync,
      beginTransaction: async () => { db.exec('BEGIN IMMEDIATE'); },
      commit: async () => { db.exec('COMMIT'); },
      rollback: async () => { db.exec('ROLLBACK'); },
      release: () => {},
    }),
    on: () => {},
    end: async () => closeDatabase(),
  };
};

export const withTransaction = async (callback) => runExclusive(async () => {
  db.exec('BEGIN IMMEDIATE');
  const connection = {
    query: (sql, params) => Promise.resolve(execQuery(sql, params)),
  };
  try {
    const result = await txContext.run({ active: true }, () => callback(connection));
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore rollback errors */ }
    throw mapSqliteError(error);
  }
});

export const closeDatabase = () => {
  if (!db) return;
  db.close();
  db = undefined;
};

export const pool = createPool();
