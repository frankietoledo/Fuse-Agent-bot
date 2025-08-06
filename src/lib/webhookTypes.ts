import { LinearDocument as L } from "@linear/sdk";
import { ToolName } from "./types.js";

interface RequiredCapabilities {
  tools?: ToolName[];
  githubAccess?: boolean;
  weatherAccess?: boolean;
}

function getLabelNames(labels?: { nodes: Array<{ name: string }> } | Array<{ name: string }>): string[] {
  if (!labels) return [];
  return Array.isArray(labels)
    ? labels.map(l => l.name)
    : labels.nodes?.map(l => l.name) ?? [];
}

interface LinearIssue {
  id: string;
  title: string;
  description?: string;
  labels?: { nodes: Array<{ name: string }> } | Array<{ name: string }>;
  project?: { name: string };
  team: { key: string };
  state: { name: string };
  creator: { email: string };
}
export function isLinearIssuePayload(payload: unknown): payload is { type: "Issue"; data: LinearIssue } {
  // console.debug('Received payload:', payload);

  const p = payload as { type?: string; data?: unknown };
  const isValid = typeof p === 'object' &&
                  p !== null &&
                  (console.debug('Evaluating type:', p.type), p.type === "Issue") &&
                  typeof p.data === 'object' &&
                  p.data !== null &&
                  (console.debug('Evaluating data.id:', 'id' in p.data), 'id' in p.data) &&
                  (console.debug('Evaluating data.title:', 'title' in p.data), 'title' in p.data);

  console.debug('Payload validation result:', isValid);
  return isValid;
}

/**
 * Check if task requires capabilities the agent supports
 */
export function hasRequiredCapabilities(
  issue: LinearIssue,
  availableTools: ToolName[]
): boolean {
  // Parse requirements from issue description
  const requirementsMatch = issue.description?.match(/\[requires:(.*?)\]/);
  if (!requirementsMatch) return true; // No requirements specified

  const requirements = requirementsMatch[1].split(',').map(r => r.trim());
  
  return requirements.every(req => {
    if (req === 'github') {
      return availableTools.some(t =>
        t === 'forkRepository' ||
        t === 'readJsonFromRepo' ||
        t === 'createPullRequest'
      );
    }
    if (req === 'weather') {
      return availableTools.some(t =>
        t === 'getCoordinates' ||
        t === 'getWeather' ||
        t === 'getTime'
      );
    }
    return availableTools.includes(req as ToolName);
  });
}

export function shouldProcessIssue(issue: LinearIssue): boolean {
  // Process tasks with label "agent" or in project "Agent Tasks"
  console.debug('payload:', issue);
  console.debug('Processing issue:', {
    id: issue.id,
    title: issue.title,
    labels: getLabelNames(issue.labels),
    project: issue.project?.name
  });
  
  const hasAgentLabel = getLabelNames(issue.labels).includes("agent");
  const isInAgentProject = issue.project?.name === "Agent Tasks";
  
  const result = hasAgentLabel || isInAgentProject;
  console.debug('Issue processing result:', result);
  return result;
}

/**
 * Check if task matches our filtering criteria
 */
export function shouldProcessTask(task: LinearIssue): boolean {
  console.debug('Processing task:', {
    id: task.id,
    title: task.title,
    labels: getLabelNames(task.labels),
    project: task.project?.name
  });
  
  const hasAgentLabel = getLabelNames(task.labels).includes("agent");
  const isInAgentProject = task.project?.name === "Agent Tasks";
  
  const result = hasAgentLabel || isInAgentProject;
  console.debug('Task processing result:', result);
  return result;
}