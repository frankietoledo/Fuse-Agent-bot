import Database from 'better-sqlite3';

interface TokenStorage {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class SQLiteStorage implements TokenStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at);
    `);
  }

  async get(key: string): Promise<string | null> {
    const stmt = this.db.prepare('SELECT value FROM tokens WHERE key = ?');
    const row = stmt.get(key) as {value: string} | undefined;
    return row?.value || null;
  }

  async put(key: string, value: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tokens (key, value) 
      VALUES (?, ?)
    `);
    stmt.run(key, value);
  }

  async delete(key: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM tokens WHERE key = ?');
    stmt.run(key);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}