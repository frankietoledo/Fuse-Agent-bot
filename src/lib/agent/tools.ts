import { LinearClient } from "@linear/sdk";
// Type definitions
interface UserData {
  id: number;
  name: string;
  email: string;
  age?: number;
  occupation?: string;
  location?: string;
  joinDate?: string;
  status?: string;
  department?: string;
  manager?: string;
}

interface GitHubRepo {
  html_url: string;
  full_name: string;
}

interface GitHubFileContent {
  content: string;
  sha: string;
}

interface GitHubPR {
  html_url: string;
  number: number;
}

interface GitHubError {
  message: string;
}

// Utility functions
const getCoordinates = async (
  city_name: string
): Promise<{ lat: number; lon: number; displayName: string } | { error: string }> => {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city_name)}&format=jsonv2`,
      {
        headers: {
          "User-Agent": "Linear-Demo-Agent/1.0",
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      return { error: `OpenStreetMap API error: ${response.status} ${response.statusText}` };
    }

    const data = (await response.json()) as {
      lat: string;
      lon: string;
      display_name: string;
    }[];

    if (data?.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        displayName: data[0].display_name
      };
    }
    return { error: "Location not found" };
  } catch (error) {
    return { error: `Failed to get coordinates: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
};

const getWeather = async (params: { lat: number; long: number }): Promise<string> => {
  const { lat, long } = params;
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${long}&current=temperature_2m,weathercode`
    );
    const data = (await response.json()) as {
      current: { temperature_2m: number; weathercode: number };
    };

    if (data?.current) {
      const weatherCodes: Record<number, string> = {
        0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
        45: "fog", 48: "rime fog", 51: "light drizzle", 53: "moderate drizzle",
        55: "dense drizzle", 56: "light freezing drizzle", 57: "dense freezing drizzle",
        61: "slight rain", 63: "moderate rain", 65: "heavy rain",
        66: "light freezing rain", 67: "heavy freezing rain",
        71: "slight snow", 73: "moderate snow", 75: "heavy snow",
        77: "snow grains", 80: "slight rain showers", 81: "moderate rain showers",
        82: "violent rain showers", 85: "slight snow showers", 86: "heavy snow showers",
        95: "thunderstorm", 96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail"
      };
      
      return `${data.current.temperature_2m}°C, ${weatherCodes[data.current.weathercode] || "unknown weather"}`;
    }
    return "Weather data not available";
  } catch (error) {
    return `Failed to get weather: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
};

const getTime = async (params: { lat: number; long: number }): Promise<string> => {
  const { lat, long } = params;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(
      `https://timeapi.io/api/Time/current/coordinate?latitude=${lat}&longitude=${long}`,
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      return `Time API error: ${response.status} ${response.statusText}`;
    }

    const data = (await response.json()) as {
      date: string;
      time: string;
      timeZone: string;
      dayOfWeek: string;
      dstActive: boolean;
    };

    if (data) {
      return `${data.dayOfWeek}, ${data.date} at ${data.time} ${data.timeZone}${data.dstActive ? " (DST active)" : ""}`;
    }
    return "Time data not available";
  } catch (error) {
    return `Failed to get time: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
};

const forkRepository = async (repo: string, githubToken: string): Promise<string> => {
  try {
    console.debug('[DEBUG] Starting forkRepository operation', { repo });
    const [owner, repoName] = repo.split('/');
    const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/forks`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {html_url?: string};
    if (!data?.html_url) {
      throw new Error('Invalid GitHub API response');
    }
    console.debug('[DEBUG] forkRepository completed successfully', { url: data.html_url });
    return data.html_url;
  } catch (error) {
    console.debug('[DEBUG] forkRepository failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error(`Failed to fork repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

const readJsonFromRepo = async (
  repo: string,
  path: string,
  githubToken: string
): Promise<unknown> => {
  try {
    console.debug('[DEBUG] Starting readJsonFromRepo operation', { repo, path });
    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (!response.ok) {
      const errorData = await response.json() as {message?: string};
      throw new Error(`Failed to read JSON: ${errorData?.message ?? 'Unknown error'}`);
    }

    const fileData = await response.json() as {content?: string, sha?: string};
    if (!fileData?.content) {
      throw new Error('Invalid GitHub file content response');
    }
    const result = JSON.parse(atob(fileData.content));
    console.debug('[DEBUG] readJsonFromRepo completed successfully');
    return result;
  } catch (error) {
    console.debug('[DEBUG] readJsonFromRepo failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error(`Failed to read JSON from repo: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

async function createPullRequest(
  repo: string,
  branch: string,
  path: string,
  content: unknown,
  message: string,
  githubToken: string
): Promise<string> {
  try {
    console.debug('[DEBUG] Starting createPullRequest operation', { repo, branch, path, message });
    const commitResponse = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Update ${path}`,
          content: btoa(JSON.stringify(content, null, 2)),
          branch: branch,
          sha: await getFileSha(repo, path, githubToken)
        })
      }
    );

    if (!commitResponse.ok) {
      const errorData = await commitResponse.json() as {message?: string};
      throw new Error(`Failed to commit changes: ${errorData?.message ?? 'Unknown error'}`);
    }

    const prResponse = await fetch(
      `https://api.github.com/repos/${repo}/pulls`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: message,
          head: branch,
          base: 'main',
          body: `Automated PR for ${path} changes`
        })
      }
    );

    if (!prResponse.ok) {
      const errorData = await prResponse.json() as {message?: string};
      throw new Error(`Failed to create PR: ${errorData?.message ?? 'Unknown error'}`);
    }

    const prData = await prResponse.json() as {html_url?: string};
    if (!prData?.html_url) {
      throw new Error('Invalid GitHub PR response format');
    }
    console.debug('[DEBUG] createPullRequest completed successfully', { prUrl: prData.html_url });
    return prData.html_url;
  } catch (error) {
    console.debug('[DEBUG] createPullRequest failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    throw new Error(`Failed to create pull request: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function getFileSha(repo: string, path: string, githubToken: string): Promise<string> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (!response.ok) {
      const errorData = await response.json() as {message?: string};
      throw new Error(`Failed to get file SHA: ${errorData?.message ?? 'Unknown error'}`);
    }

    const fileData = await response.json() as {sha?: string};
    if (!fileData?.sha) {
      throw new Error('Invalid GitHub file content response');
    }
    return fileData.sha;
  } catch (error) {
    throw new Error(`Failed to get file SHA: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Reads user data from local JSON file with validation and error handling
 * @param taskDescription Description of the task being attempted
 * @returns User data if valid, or error message if not
 */
async function readUserData(taskDescription: string): Promise<UserData[] | { error: string }> {
  try {
    // Scope validation - check if task is related to user management
    const validScopes = ['user', 'users', 'profile', 'account'];
    const isInScope = validScopes.some(scope =>
      taskDescription.toLowerCase().includes(scope)
    );

    if (!isInScope) {
      return {
        error: `Task is out of scope for user data operations. Valid scopes are: ${validScopes.join(', ')}`
      };
    }

    // Information check - verify required fields in task description
    const requiredInfo = ['id', 'email', 'action'];
    const missingInfo = requiredInfo.filter(field =>
      !taskDescription.toLowerCase().includes(field)
    );

    if (missingInfo.length > 0) {
      return {
        error: `Additional information required: ${missingInfo.join(', ')}`
      };
    }

    // Execution - read and validate user data
    const response = await fetch('/data/users.json');
    if (!response.ok) {
      return { error: `Failed to read user data: ${response.status} ${response.statusText}` };
    }

    const users = await response.json() as UserData[];
    if (!Array.isArray(users)) {
      return { error: 'Invalid user data format - expected array' };
    }

    // Basic validation of user objects
    const invalidUsers = users.filter(user =>
      !user.id || !user.name || !user.email
    );

    if (invalidUsers.length > 0) {
      return {
        error: `Invalid user data found for ${invalidUsers.length} user(s)`
      };
    }

    return users;
  } catch (error) {
    return {
      error: `Failed to process user data: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Type guards
function isGitHubRepo(data: unknown): data is GitHubRepo {
  return typeof data === 'object' && data !== null && 
         typeof (data as GitHubRepo).html_url === 'string' && 
         typeof (data as GitHubRepo).full_name === 'string';
}

function isGitHubFileContent(data: unknown): data is GitHubFileContent {
  return typeof data === 'object' && data !== null && 
         typeof (data as GitHubFileContent).content === 'string' && 
         typeof (data as GitHubFileContent).sha === 'string';
}

function isGitHubPR(data: unknown): data is GitHubPR {
  return typeof data === 'object' && data !== null && 
         typeof (data as GitHubPR).html_url === 'string' && 
         typeof (data as GitHubPR).number === 'number';
}

function isGitHubError(data: unknown): data is GitHubError {
  return typeof data === 'object' && data !== null && 
         typeof (data as GitHubError).message === 'string';
}

interface RepositoryInfo {
  name: string;
  url: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  labels?: string[];
}

interface RepositoryInfo {
  name: string;
  url: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  labels?: string[];
}

/**
 * Fetches repository information from Linear's API using issue context
 * @param issueId - The Linear issue ID
 * @param linearClient - The Linear client instance
 * @returns Repository details or error message
 */
const getRepositoryInfo = async (
  issueId: string,
  linearClient: LinearClient
): Promise<RepositoryInfo | { error: string }> => {
  try {
    console.debug('[DEBUG] Starting getRepositoryInfo operation', { issueId });
    const issue = await linearClient.issue(issueId);
    if (!issue) {
      console.debug('[DEBUG] getRepositoryInfo: Issue not found');
      return { error: "Issue not found" };
    }

    const repoUrl = await checkAssociatedRepo({ issue });
    if (!repoUrl) {
      console.debug('[DEBUG] getRepositoryInfo: No repository associated with issue');
      return { error: "No repository associated with this issue" };
    }

    const result = {
      name: repoUrl.split('/').pop() || 'Unknown',
      url: repoUrl,
      description: `Repository linked to issue ${issue.identifier}`
    };
    console.debug('[DEBUG] getRepositoryInfo completed successfully', { repoUrl: result.url });
    return result;
  } catch (error) {
    console.debug('[DEBUG] getRepositoryInfo failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    return {
      error: `Failed to fetch repository info: ${error instanceof Error ? error.message : "Unknown error"}`
    };
  }
};

const checkAssociatedRepo = async (issueContext: Record<string, unknown>): Promise<string | null> => {
  try {
    // Check for GitHub repo URL in issue context
    const repoUrl = issueContext.githubRepoUrl;
    if (typeof repoUrl === 'string' && repoUrl.startsWith('https://github.com/')) {
      return repoUrl;
    }

    // Check for repo name in issue context
    const repoName = issueContext.githubRepo;
    if (typeof repoName === 'string') {
      return `https://github.com/${repoName}`;
    }

    return null;
  } catch (error) {
    throw new Error(`Failed to check associated repo: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export {
  getCoordinates,
  getWeather,
  getTime,
  forkRepository,
  readJsonFromRepo,
  createPullRequest,
  getFileSha,
  readUserData,
  checkAssociatedRepo
};
