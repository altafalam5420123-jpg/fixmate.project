require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { createApp } = require('./app');
const { openDb } = require('./db');

const port = Number(process.env.PORT) || 3000;
const db = openDb();

async function startServer() {
  try {
    await db.initDb();
    console.log('[FixMate Database] PostgreSQL database connected and initialized.');
  } catch (dbErr) {
    console.warn('[FixMate Database Warning] Could not connect to PostgreSQL on startup:', dbErr.message);
    console.warn('Set DATABASE_URL or PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD in server/.env');
  }

  const app = createApp(db);
  const server = app.listen(port, () => {
    console.log(`FixMate server listening on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[FixMate Error] Port ${port} pehle se chal raha hai!`);
      console.error(`Purana process band karne ke liye ye command chalayein:`);
      console.error(`  taskkill /F /IM node.exe`);
      console.error(`Aur phir dubara server start karein:`);
      console.error(`  node src/server.js\n`);
      process.exit(1);
    } else {
      throw err;
    }
  });

  process.on('SIGTERM', async () => {
    try {
      await db.close();
    } catch {
      // ignore
    }
    server.close();
  });
}

startServer();
