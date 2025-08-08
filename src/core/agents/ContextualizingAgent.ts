import { PersonalityProvider } from '../providers/PersonalityProvider.js';
import { DebugLogger } from '../DebugLogger.js';
import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';

const CONTEXT7_PORT = 3000;

export class ContextualizingAgent {
  private personalityProvider: PersonalityProvider;
  private logger: DebugLogger;
  private context7Server: ChildProcess | null = null;

  constructor(personalityProvider: PersonalityProvider) {
    this.personalityProvider = personalityProvider;
    this.logger = DebugLogger.getInstance();
  }

  async start(): Promise<void> {
    this.logger.logEngineEvent('contextualizing_agent_starting');
    await this.startContext7Server();
  }

  async stop(): Promise<void> {
    this.logger.logEngineEvent('contextualizing_agent_stopping');
    this.stopContext7Server();
  }

  private async startContext7Server(): Promise<void> {
    const path = await import('path');
    const context7Path = path.join(process.cwd(), 'context7');
    
    return new Promise((resolve, reject) => {
      const serverProcess = spawn('node', ['dist/index.js', '--transport', 'http'], {
        cwd: context7Path,
        detached: true,
        stdio: 'pipe',
      });

      this.context7Server = serverProcess;

      serverProcess.stdout?.on('data', (data) => {
        this.logger.logEngineEvent('context7_server_stdout', { message: data.toString() });
        if (data.toString().includes('running on HTTP')) {
          resolve();
        }
      });

      serverProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        // Context7 outputs status messages to stderr - only log as error if it contains actual error keywords
        if (output.toLowerCase().includes('error') || output.toLowerCase().includes('failed')) {
          this.logger.logError('context7_server_stderr', new Error(output));
        } else {
          this.logger.logEngineEvent('context7_server_stderr', { message: output });
          // Check for successful startup message in stderr as well
          if (output.includes('running on HTTP')) {
            resolve();
          }
        }
      });

      serverProcess.on('close', (code) => {
        this.logger.logEngineEvent('context7_server_closed', { code });
        this.context7Server = null;
      });

      serverProcess.on('error', (err) => {
        this.logger.logError('context7_server_error', err);
        reject(err);
      });
    });
  }

  private stopContext7Server(): void {
    if (this.context7Server && this.context7Server.pid) {
      try {
        // Kill the entire process group to ensure the server and its children are terminated
        process.kill(-this.context7Server.pid);
      } catch (e) {
        // Fallback for environments where process groups are not supported
        this.context7Server.kill();
      }
      this.context7Server = null;
    }
  }

  async getContextForLibrary(libraryName: string): Promise<string> {
    this.logger.logEngineEvent('contextualizing_agent_get_context', { libraryName });

    try {
      // Step 1: Resolve the library ID
      const libraryId = await this.resolveLibraryId(libraryName);
      if (!libraryId) {
        return `Could not find a library matching \"${libraryName}\".`;
      }

      // Step 2: Get the library documentation
      const documentation = await this.getLibraryDocs(libraryId);
      return documentation;

    } catch (error: any) {
      this.logger.logError('contextualizing_agent_error', error);
      return `An error occurred while fetching documentation for \"${libraryName}\".`;
    }
  }

  private async resolveLibraryId(libraryName: string): Promise<string | null> {
    const response = await axios.post(`http://localhost:${CONTEXT7_PORT}/mcp`, {
      mcp_version: '1.0',
      tool_name: 'resolve-library-id',
      parameters: {
        libraryName,
      },
    });

    const content = response.data.content[0].text;
    // This is a bit of a hack, but it's the easiest way to get the ID
    const match = content.match(/Library ID: (\S+)/);
    return match ? match[1] : null;
  }

  private async getLibraryDocs(libraryId: string): Promise<string> {
    const response = await axios.post(`http://localhost:${CONTEXT7_PORT}/mcp`, {
      mcp_version: '1.0',
      tool_name: 'get-library-docs',
      parameters: {
        context7CompatibleLibraryID: libraryId,
      },
    });

    return response.data.content[0].text;
  }
}