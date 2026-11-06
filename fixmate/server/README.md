# FixMate server

## Requirements

- Node.js 20 or newer
- npm
- PostgreSQL database (Local, Docker, Neon, Supabase, Render, Railway, or AWS RDS)

## Database Configuration (PostgreSQL)

FixMate uses PostgreSQL via the official Node.js `pg` driver with connection pooling (`pg.Pool`).
Set your database credentials in `server/.env`:

```env
# Option 1: Standard Connection URL
DATABASE_URL=postgresql://postgres:password@localhost:5432/fixmate?sslmode=disable

# Option 2: Discrete credentials
PGHOST=localhost
PGPORT=5432
PGDATABASE=fixmate
PGUSER=postgres
PGPASSWORD=your_password
PGSSL=false

# Pool settings
DB_POOL_MAX=20
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECT_TIMEOUT_MS=5000
```

## Migrating from SQLite to PostgreSQL

To migrate existing SQLite data (`fixmate.sqlite`) into PostgreSQL safely without losing any user accounts, bookings, or wallet balances:

```powershell
npm run migrate:pg
```

This runs `scripts/migrate_sqlite_to_pg.js`, which:
1. Creates all PostgreSQL tables and indexes.
2. Migrates all rows (`services`, `users`, `otps`, `rate limits`, `bookings`, `wallet_tx`, `payment_orders`).
3. Automatically updates all PostgreSQL sequences (`setval`) to the highest migrated IDs.
4. Preserves the original `fixmate.sqlite` file intact with dual backups in `server/backups/`.

## Run locally

From this directory, install dependencies and start the API:

```powershell
npm install
npm start
```

The server serves the client and API at `http://localhost:3000`.

## Testing

Run the test suite:

```powershell
npm test
```
All 22 integration and flow tests run against the database adapter.
