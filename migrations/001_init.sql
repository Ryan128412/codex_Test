CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distribution_name TEXT NOT NULL UNIQUE,
  is_public TEXT NOT NULL CHECK (is_public IN ('enabled', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS distribution_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distribution_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  alternate_email TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (distribution_id) REFERENCES distributions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_name TEXT NOT NULL,
  distribution_group TEXT,
  delivery_type TEXT NOT NULL,
  email_title TEXT NOT NULL DEFAULT 'Default',
  email_message TEXT NOT NULL DEFAULT 'Default',
  file_path TEXT,
  output_filename TEXT,
  access_group TEXT,
  package_enabled INTEGER NOT NULL DEFAULT 1,
  location TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
