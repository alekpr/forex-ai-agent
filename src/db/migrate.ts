import fs from 'fs';
import path from 'path';
import { query, closePool } from './connection';

async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`Running ${files.length} migration(s)...`);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`  → ${file}`);
    await query(sql);
  }

  console.log('✅ Migrations complete.');
}

runMigrations()
  .catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  })
  .finally(() => closePool());
