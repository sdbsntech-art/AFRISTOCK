import { app, pool } from './postgresApp.js';

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '127.0.0.1';

const start = async () => {
  await pool.query('SELECT 1');
  app.listen(port, host, () => {
    console.log(`Serveur AfriStock connecté à PostgreSQL sur http://${host}:${port}`);
  });
};

start().catch((error) => {
  console.error(`Impossible de démarrer AfriStock : ${error.message}`);
  process.exitCode = 1;
});
