import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'data', 'app.db');
const migrationsDir = path.join(root, 'migrations');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

function run(sql) {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'pipe' });
}

run('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);');
const appliedRaw = execFileSync('sqlite3', ['-json', dbPath, 'SELECT name FROM schema_migrations;'], { encoding: 'utf8' });
const applied = new Set((JSON.parse(appliedRaw || '[]')).map((r) => r.name));

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  run(`BEGIN; ${sql} INSERT INTO schema_migrations(name) VALUES('${file.replace(/'/g, "''")}'); COMMIT;`);
  console.log(`Applied migration: ${file}`);
}
