import { app, closeSessionStore, pool } from './mysqlApp.js';
import { getLocalServerHost } from './databaseConfig.js';

const port = Number(process.env.PORT) || 3001;
const host = getLocalServerHost();

let server;

const start = async () => {
  await pool.query('SELECT 1');
  server = app.listen(port, host, () => {
    console.log(`Serveur AfriStock connecté à MySQL (Laragon) sur http://${host}:${port}`);
  });
};

const shutdown = async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await closeSessionStore();
  await pool.end();
};

const handleShutdown = () => {
  shutdown().catch((error) => {
    console.error(`Impossible d’arrêter proprement AfriStock : ${error.message}`);
    process.exitCode = 1;
  });
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

start().catch((error) => {
  console.error(`Impossible de démarrer AfriStock : ${error.message}`);
  process.exitCode = 1;
  shutdown().catch((shutdownError) => {
    console.error(`Impossible de fermer les connexions MySQL : ${shutdownError.message}`);
  });
});
