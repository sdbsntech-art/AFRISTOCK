import '../server/loadEnv.js';
import { getSqlitePath } from '../server/databaseConfig.js';
import { closeDatabase, openSqlite } from '../server/sqlite.js';

openSqlite();
console.log(`Base SQLite locale prête : ${getSqlitePath()}`);
closeDatabase();
