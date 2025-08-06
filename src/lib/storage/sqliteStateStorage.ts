import Database from 'better-sqlite3';
import { SessionState, StateStorage, EncryptFunction, DecryptFunction } from './stateStorage.js';
import crypto from 'crypto';

export class SQLiteStateStorage implements StateStorage {
  private db: Database.Database;
  private encryptFn?: EncryptFunction;
  private decryptFn?: DecryptFunction;

  constructor(
    dbPath: string, 
    encryptFn?: EncryptFunction, 
    decryptFn?: DecryptFunction
  ) {
    this.db = new Database(dbPath);
    this.encryptFn = encryptFn;
    this.decryptFn = decryptFn;
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_states (
        session_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        last_updated INTEGER DEFAULT (strftime('%s','now')),
        version INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_states_created_at ON session_states(created_at);
    `);
  }

  async saveState(sessionId: string, state: SessionState): Promise<void> {
    let stateString = JSON.stringify(state);
    
    // Encrypt if encryption function provided
    if (this.encryptFn) {
      const encrypted = await this.encryptFn(stateString);
      stateString = JSON.stringify({ 
        encrypted: encrypted.encrypted, 
        iv: encrypted.iv 
      });
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO session_states (session_id, state, version, last_updated)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(sessionId, stateString, state.version, Math.floor(Date.now() / 1000));
  }

  async getState(sessionId: string): Promise<SessionState | null> {
    const stmt = this.db.prepare('SELECT state, version FROM session_states WHERE session_id = ?');
    const row = stmt.get(sessionId) as {state: string, version: number} | undefined;
    
    if (!row) return null;
    
    let stateString = row.state;
    
    // Handle encrypted state
    if (this.decryptFn) {
      try {
        const encryptedState = JSON.parse(stateString);
        if (encryptedState.encrypted && encryptedState.iv) {
          stateString = await this.decryptFn(encryptedState.encrypted, encryptedState.iv);
        }
      } catch (e) {
        console.error('Error decrypting state:', e);
        return null;
      }
    }
    
    try {
      const state = JSON.parse(stateString) as SessionState;
      
      // Validate state version
      if (state.version !== row.version) {
        console.warn(`State version mismatch: stored ${row.version}, actual ${state.version}`);
        return null;
      }
      
      return state;
    } catch (e) {
      console.error('Error parsing state:', e);
      return null;
    }
  }

  async deleteState(sessionId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM session_states WHERE session_id = ?');
    stmt.run(sessionId);
  }

  async cleanupStates(olderThanDays: number): Promise<void> {
    const cutoff = Math.floor(Date.now() / 1000) - (olderThanDays * 86400);
    const stmt = this.db.prepare('DELETE FROM session_states WHERE last_updated < ?');
    stmt.run(cutoff);
  }

  validateState(state: SessionState): boolean {
    return (
      Array.isArray(state.activityMessages) &&
      typeof state.issueContext === 'object' &&
      state.issueContext !== null &&
      typeof state.lastUpdated === 'number' &&
      typeof state.version === 'number'
    );
  }
}

// Default encryption/decryption functions using Node.js crypto
export const defaultEncrypt: EncryptFunction = async (data: string) => {
  const iv = crypto.randomBytes(16);
  const key = crypto.randomBytes(32); // In real app, use a secure key from config
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encrypted, iv: iv.toString('hex') };
};

export const defaultDecrypt: DecryptFunction = async (encrypted: string, iv: string) => {
  const key = crypto.randomBytes(32); // Must match key used for encryption
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};