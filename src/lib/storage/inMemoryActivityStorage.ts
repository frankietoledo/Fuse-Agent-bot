import { AgentActivityType, Content } from "../types.js";
import { ActivityStorage } from "./activityStorage.js";

export class InMemoryActivityStorage implements ActivityStorage {
  private activities: Record<string, Content[]> = {};

  async getActivitiesBySessionId(sessionId: string): Promise<Content[]> {
    return this.activities[sessionId] || [];
  }

  async saveActivity(sessionId: string, activity: Content): Promise<void> {
    if (!this.activities[sessionId]) {
      this.activities[sessionId] = [];
    }
    this.activities[sessionId].push(activity);
  }
}