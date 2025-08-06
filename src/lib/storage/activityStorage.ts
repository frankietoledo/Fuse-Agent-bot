import { AgentActivityType, Content } from "../types.js";

export interface ActivityStorage {
  getActivitiesBySessionId(sessionId: string): Promise<Content[]>;
}