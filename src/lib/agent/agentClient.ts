import { AgentActivityType, Content, SessionState, ToolName } from '../types.js';
import { StateStorage } from '../storage/stateStorage.js';
import { OpenAI } from 'openai';
import { isToolName, UnreachableCaseError } from '../types.js';
import { ActivityStorage } from '../storage/activityStorage.js';

export class AgentClient {
  constructor(
    private stateStorage: StateStorage,
    private activityStorage: ActivityStorage,
    private openai: OpenAI
  ) {}

  async handleUserPrompt(agentSessionId: string, userPrompt: string): Promise<Content> {
    let state: SessionState = await this.getOrInitializeState(agentSessionId);
    
    // Update issue context from user prompt
    const issueContext = this.parseIssueContext(userPrompt);
    state.issueContext = { ...state.issueContext, ...issueContext };
    state.activityMessages.push({
      type: AgentActivityType.UserResponse,
      body: userPrompt
    });

    try {
      // Create messages array from state
      const messages = this.createMessagesFromState(state);

      // Call OpenAI
      const response = await this.callOpenAI(messages);
      const content = this.mapResponseToLinearActivityContent(response);

      // Update state with new activity
      state.activityMessages.push(content);
      await this.saveState(agentSessionId, state);

      // Handle action if needed
      if (content.type === AgentActivityType.Action) {
        const toolResult = await this.executeAction({
          action: content.action,
          parameter: content.parameter
        });
        
        state.activityMessages.push({
          type: AgentActivityType.ToolResult,
          body: toolResult
        });
        await this.saveState(agentSessionId, state);
      }
      // Return content for all activity types
      return content;
    } catch (error) {
      console.error('[AgentClient] Error handling user prompt:', error);
      const errorContent: Content = {
        type: AgentActivityType.Error,
        body: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
      state.activityMessages.push(errorContent);
      await this.saveState(agentSessionId, state);
      return errorContent;
    }
  }

  private async getAssociatedRepoInfo(agentSessionId: string): Promise<string | null> {
    try {
      console.log('[AgentClient] [getAssociatedRepoInfo] - fetching repo info for session:', agentSessionId);
      // Placeholder implementation - replace with actual Linear integration
      return 'linear-app/weather-bot';
    } catch (error) {
      console.error('[AgentClient] Error getting repo info:', error);
      return null;
    }
  }

  private async getOrInitializeState(sessionId: string): Promise<SessionState> {
    try {
      const state = await this.stateStorage.getState(sessionId);
      if (state) return state;
      
      const newState: SessionState = {
        activityMessages: [],
        issueContext: {},
        lastUpdated: Date.now(),
        version: 1
      };
      return newState;
    } catch (error) {
      console.error('[AgentClient] Error loading state:', error);
      return {
        activityMessages: [],
        issueContext: {},
        lastUpdated: Date.now(),
        version: 1
      };
    }
  }
  
  private async saveState(sessionId: string, state: SessionState): Promise<void> {
    try {
      state.lastUpdated = Date.now();
      await this.stateStorage.saveState(sessionId, state);
    } catch (error) {
      console.error('[AgentClient] Error saving state:', error);
    }
  }

  private parseIssueContext(userPrompt: string): Record<string, string> {
    const context: Record<string, string> = {};
    
    // Extract issue description
    const issueMatch = userPrompt.match(/ISSUE_DESCRIPTION:([\s\S]*?)(?=ISSUE_COMMENTS:|$)/);
    if (issueMatch) {
      const description = issueMatch[1].trim();
      context.description = description;
    }
    
    // Extract required parameters
    const requiredMatch = userPrompt.match(/REQUIRED_PARAMS:([^\n]+)/);
    const requiredParams: string[] = [];
    if (requiredMatch) {
      requiredParams.push(...requiredMatch[1].split(',').map(p => p.trim()));
    }
    
    // Extract comments
    const commentsMatch = userPrompt.match(/ISSUE_COMMENTS:([\s\S]*)/);
    if (commentsMatch) {
      const comments = commentsMatch[1].split('\n').filter(comment => comment.trim() !== '');
      comments.forEach(comment => {
        const [key, ...valueParts] = comment.split(':');
        if (key && valueParts.length > 0) {
          const value = valueParts.join(':').trim();
          context[key] = value;
        }
      });
    }
    
    // Ensure required params are present
    requiredParams.forEach(param => {
      if (!(param in context)) {
        context[param] = 'REQUIRED_ELICITATION';
      }
    });
    
    console.debug('[AgentClient] [parseIssueContext] - parsed context:', context);
    return context;
  }

  private async callOpenAI(
    messages: any[]
  ): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
      });

      return response.choices[0]?.message?.content || "No response";
    } catch (error) {
      throw new Error(
        `OpenAI API error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async executeAction(props: { action: ToolName; parameter: string | null }): Promise<string> {
    console.log(`[AgentClient] [executeAction] - placeholder for ${props.action}`);
    return 'Placeholder tool result';
  }

  private mapResponseToLinearActivityContent(response: string): Content {
    const typeToKeyword = {
      [AgentActivityType.Thought]: "THINKING:",
      [AgentActivityType.Action]: "ACTION:",
      [AgentActivityType.Response]: "RESPONSE:",
      [AgentActivityType.Elicitation]: "ELICITATION:",
      [AgentActivityType.Error]: "ERROR:",
      [AgentActivityType.UserResponse]: "USER_RESPONSE:",
    } as const;
    
    const mappedType = Object.entries(typeToKeyword).find(([_, keyword]) =>
      response.startsWith(keyword)
    );
    
    const type = mappedType?.[0] as AgentActivityType || AgentActivityType.Thought;

    switch (type) {
      case AgentActivityType.Thought:
      case AgentActivityType.Response:
      case AgentActivityType.Error:
      case AgentActivityType.UserResponse:
        return { type, body: response.replace(typeToKeyword[type], "").trim() };
        
      case AgentActivityType.Elicitation:
        const elicitationMatch = response.match(/ELICITATION:\s*([^:]+):\s*(.*)/);
        if (elicitationMatch) {
          const [, parameter, question] = elicitationMatch;
          return {
            type,
            body: question.trim(),
            parameter: parameter.trim()
          };
        }
        return { type, body: response.replace(typeToKeyword[type], "").trim() };
        
      case AgentActivityType.Action:
        // Handle ACTION format: "ACTION: toolName(param1, param2, ...)"
        const actionMatch = response.match(/ACTION:\s*(\w+)\(([^)]*)\)/);
        if (actionMatch) {
          const [, toolNameRaw, params] = actionMatch;
          if (!isToolName(toolNameRaw)) {
            throw new Error(`Invalid tool name: ${toolNameRaw}`);
          }
          const toolName = toolNameRaw as ToolName;
          return {
            type,
            action: toolName,
            parameter: params || null,
          };
        }
        
        // Handle ACTION format: "ACTION: toolName"
        const simpleActionMatch = response.match(/ACTION:\s*(\w+)/);
        if (simpleActionMatch) {
          const [, toolNameRaw] = simpleActionMatch;
          if (!isToolName(toolNameRaw)) {
            throw new Error(`Invalid tool name: ${toolNameRaw}`);
          }
          return {
            type,
            action: toolNameRaw as ToolName,
            parameter: null,
          };
        }
        
        // If no match, treat as error
        return {
          type: AgentActivityType.Error,
          body: `Invalid action format: ${response}`
        };
        
      default:
        throw new UnreachableCaseError(type);
    }
  }

  private createMessagesFromState(state: SessionState): any[] {
    // Simplified implementation - in real app, this would convert activityMessages to OpenAI message format
    return state.activityMessages.map((msg: Content) => ({
      role: 'user',
      content: `${msg.type}: ${'body' in msg ? msg.body : ''}`
    }));
  }
}
