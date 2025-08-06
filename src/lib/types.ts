export enum AgentActivityType {
  Thought = "thought",
  Action = "action",
  Response = "response",
  Elicitation = "elicitation",
  Error = "error",
  UserResponse = "userResponse",
  ToolResult = "toolResult"
}

/**
 * Error thrown when an unreachable case is encountered in an exhaustive switch statement
 */
export class UnreachableCaseError extends Error {
  constructor(value: unknown) {
    super(`Unreachable case: ${value}`);
    this.name = "UnreachableCaseError";
  }
}

/**
 * The content of an agent activity
 */
export type Content =
  | { type: AgentActivityType.Thought; body: string }
  | {
      type: AgentActivityType.Action;
      action: ToolName;
      parameter: string | null;
      result?: string;
    }
  | { type: AgentActivityType.Response; body: string }
  | { type: AgentActivityType.Elicitation; body: string; parameter?: string }
  | { type: AgentActivityType.Error; body: string }
  | { type: AgentActivityType.UserResponse; body: string }
  | { type: AgentActivityType.ToolResult; body: string };

/**
 * The name of a tool that can be executed by the agent
 */
export type ToolName =
  | "getCoordinates"
  | "getWeather"
  | "getTime"
  | "forkRepository"
  | "readJsonFromRepo"
  | "createPullRequest"
  | "checkAssociatedRepo"
  | "getRepositoryInfo";

/**
 * Check if a string is a valid tool name
 * @param value - The string to check
 * @returns True if the string is a valid tool name, false otherwise
 */
export const isToolName = (value: string): value is ToolName => {
  return [
    "getCoordinates",
    "getWeather",
    "getTime",
    "forkRepository",
    "readJsonFromRepo",
    "createPullRequest"
  ].includes(value);
};

/**
 * Map our activity type to Linear's activity type
 */
export const toLinearActivityType = (type: AgentActivityType): string => {
  switch (type) {
    case AgentActivityType.Thought: return "thought";
    case AgentActivityType.Action: return "action";
    case AgentActivityType.Response: return "response";
    case AgentActivityType.Elicitation: return "elicitation";
    case AgentActivityType.Error: return "error";
    case AgentActivityType.UserResponse: return "response"; // Map to Linear's response type
    default: 
      throw new UnreachableCaseError(type);
  }
};

export interface SessionState {
  activityMessages: any[];
  issueContext: Record<string, string>;
  lastUpdated: number;
  version: number;
  encryptionIV?: string;
}

/**
 * OAuth token response from Linear
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}
