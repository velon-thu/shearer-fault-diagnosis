export const SQLITE_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS sensor_samples_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id TEXT NOT NULL,
      sampled_at TEXT NOT NULL,
      value REAL NOT NULL,
      quality TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS sensor_samples_1m (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id TEXT NOT NULL,
      bucket_at TEXT NOT NULL,
      min_value REAL,
      max_value REAL,
      avg_value REAL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS fault_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      code TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      target TEXT,
      level TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS fault_code_dict (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT,
      tip TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(category, code)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS checkin_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkin_date TEXT NOT NULL,
      status TEXT,
      shift TEXT,
      person TEXT,
      result TEXT,
      note TEXT,
      detail TEXT,
      checked_item_ids TEXT,
      show_in_history INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS knowledge_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_type TEXT NOT NULL,
      title TEXT NOT NULL,
      meta TEXT,
      uri TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS system_config (
      config_key TEXT PRIMARY KEY,
      config_value TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_sensor_samples_raw_sensor_time
    ON sensor_samples_raw(sensor_id, sampled_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_sensor_samples_1m_sensor_time
    ON sensor_samples_1m(sensor_id, bucket_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_fault_events_category_code_time
    ON fault_events(category, code, occurred_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_checkin_records_date
    ON checkin_records(checkin_date)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_type_sort
    ON knowledge_assets(asset_type, sort_order)
  `,
] as const;
