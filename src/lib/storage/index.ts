import { SQLiteStorage } from './sqlite.js';
import { MemoryStorage } from './memory.js';

export interface TokenStorage {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function getStorage(): TokenStorage {
  // Force SQLite if explicitly requested via STORAGE_TYPE
  if (process.env.STORAGE_TYPE === 'sqlite') {
    try {
      return new SQLiteStorage(process.env.SQLITE_DB_PATH || './data/tokens.db');
    } catch (e) {
      console.error('Failed to initialize SQLite storage:', e);
      throw e; // Fail fast if SQLite was explicitly requested
    }
  }

  // In production, default to SQLite
  if (process.env.NODE_ENV === 'production') {
    try {
      return new SQLiteStorage(process.env.SQLITE_DB_PATH || './data/tokens.db');
    } catch (e) {
      console.error('Failed to initialize SQLite storage, falling back to memory:', e);
    }
  }

  // In development/test, use memory storage unless SQLite was requested
  if (process.env.NODE_ENV !== 'test') {
    console.warn('Using in-memory token storage - tokens will not persist between restarts');
  }
  return new MemoryStorage();
}