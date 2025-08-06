import type { ChatCompletionMessageParam } from "openai/resources/index";
import { AgentActivityType } from "../types.js";

// Current state version
const CURRENT_STATE_VERSION = 1;

export interface SessionState {
  activityMessages: ChatCompletionMessageParam[];
  issueContext: Record<string, string>;
  lastUpdated: number;
  version: number;
  encryptionIV?: string; // Initialization vector for encryption
}

export interface StateStorage {
  saveState(sessionId: string, state: SessionState): Promise<void>;
  getState(sessionId: string): Promise<SessionState | null>;
  deleteState(sessionId: string): Promise<void>;
  cleanupStates(olderThanDays: number): Promise<void>;
  validateState(state: SessionState): boolean;
}

// State encryption function type
export type EncryptFunction = (data: string) => Promise<{ encrypted: string; iv: string }>;
// State decryption function type
export type DecryptFunction = (encrypted: string, iv: string) => Promise<string>;