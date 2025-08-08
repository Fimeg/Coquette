/**
 * Google Gemini CLI provider - fallback technical AI provider  
 * Uses gemini-cli command-line tool instead of API directly
 */

import { spawn } from 'child_process';
import { 
  BaseProvider, 
  ChatMessage, 
  StreamChunk, 
  ProviderResponse, 
  ProviderOptions,
  ProviderError 
} from './BaseProvider.js';

export class GeminiProvider extends BaseProvider {
  private static readonly CLI_COMMAND = 'gemini';

  async isAvailable(): Promise<boolean> {
    try {
      return new Promise((resolve) => {
        const child = spawn(GeminiProvider.CLI_COMMAND, ['--version'], { 
          stdio: 'pipe'
        });
        
        let output = '';
        child.stdout?.on('data', (data) => {
          output += data.toString();
        });
        
        child.on('close', (code) => {
          resolve(code === 0 && (output.includes('gemini') || output.includes('Gemini')));
        });
        
        child.on('error', () => {
          resolve(false);
        });
        
        // Timeout after 3 seconds
        setTimeout(() => {
          child.kill();
          resolve(false);
        }, 3000);
      });
    } catch {
      return false;
    }
  }

  async sendMessage(
    messages: ChatMessage[],
    options?: ProviderOptions
  ): Promise<ProviderResponse> {
    const prompt = this.formatMessagesForGemini(messages);
    const response = await this.executeGeminiCommand(prompt, options);
    
    return {
      content: response.content,
      metadata: response.metadata,
      timestamp: new Date()
    };
  }

  async* streamMessage(
    messages: ChatMessage[],
    options?: ProviderOptions
  ): AsyncGenerator<StreamChunk, ProviderResponse> {
    const startTime = Date.now();
    let fullResponse = '';
    let metadata: any = {};

    const prompt = this.formatMessagesForGemini(messages);
    try {
      const command = this.buildGeminiCommand(prompt, options, true);
      const child = spawn(command.cmd, command.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...command.env }
      });

      // Handle stderr for debugging/status
      let stderrBuffer = '';
      child.stderr?.on('data', (data) => {
        stderrBuffer += data.toString();
      });

      // Stream stdout
      if (child.stdout) {
        for await (const chunk of this.parseGeminiStream(child.stdout)) {
          fullResponse += chunk.content;
          yield chunk;
        }
      }

      // Wait for process to complete
      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      if (exitCode !== 0) {
        throw new Error(`Gemini CLI exited with code ${exitCode}. stderr: ${stderrBuffer}`);
      }

      // Extract metadata from stderr if available
      metadata = this.parseGeminiMetadata(stderrBuffer);

    } catch (error: any) {
      this.handleProviderError(error, 'stream message');
    }

    return {
      content: fullResponse,
      metadata,
      timestamp: new Date()
    };
  }

  // Private methods for Gemini CLI integration

  private async executeGeminiCommand(
    prompt: string,
    options?: ProviderOptions
  ): Promise<{ content: string; metadata: any }> {
    return new Promise((resolve, reject) => {
      const command = this.buildGeminiCommand(prompt, options);
      const child = spawn(command.cmd, command.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...command.env }
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          const content = this.extractGeminiResponse(stdout);
          const metadata = this.parseGeminiMetadata(stderr);
          resolve({ content, metadata });
        } else {
          reject(new Error(`Gemini CLI failed with exit code ${code}. stderr: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to spawn Gemini CLI: ${error.message}`));
      });

      // Send input if needed
      if (command.input) {
        child.stdin?.write(command.input);
        child.stdin?.end();
      }

      // Set timeout
      const timeout = options?.timeout_ms || this.getRequestTimeout();
      setTimeout(() => {
        child.kill();
        reject(new Error(`Gemini CLI timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  private buildGeminiCommand(
    prompt: string,
    options?: ProviderOptions,
    stream: boolean = false
  ): {
    cmd: string;
    args: string[];
    env: Record<string, string>;
    input?: string;
  } {
    const args: string[] = [];
    const env: Record<string, string> = {};

    // Model selection
    if (options?.model) {
      args.push('--model', options.model);
    }

    // Temperature
    if (options?.temperature !== undefined) {
      args.push('--temperature', options.temperature.toString());
    }

    // Max tokens
    if (options?.max_tokens) {
      args.push('--max-tokens', options.max_tokens.toString());
    }

    // Stream mode
    if (stream) {
      args.push('--stream');
    }

    // JSON output for better parsing
    args.push('--json');
    
    // Use chat mode for conversation
    args.push('chat');
    
    // Add the prompt as an argument or use stdin
    if (prompt.length < 1000) {
      // Short prompt - use as argument
      args.push(prompt);
    } else {
      // Long prompt - use stdin
      return {
        cmd: GeminiProvider.CLI_COMMAND,
        args,
        env,
        input: prompt
      };
    }

    return {
      cmd: GeminiProvider.CLI_COMMAND,
      args,
      env
    };
  }

  private formatMessagesForGemini(messages: ChatMessage[]): string {
    // Extract system message if present
    const systemMessages = messages.filter(msg => msg.role === 'system');
    const conversationMessages = messages.filter(msg => msg.role !== 'system');

    let prompt = '';

    // Add system context if present
    if (systemMessages.length > 0) {
      const systemContent = systemMessages.map(msg => msg.content).join('\\n');
      prompt += `System: ${systemContent}\\n\\n`;
    }

    // Add conversation history for multi-turn chats
    if (conversationMessages.length > 1) {
      const history = conversationMessages
        .slice(0, -1)
        .map(msg => `${msg.role === 'user' ? 'Human' : 'Model'}: ${msg.content}`)
        .join('\\n\\n');
      prompt += `${history}\\n\\n`;
    }

    // Add current user message
    const lastMessage = conversationMessages[conversationMessages.length - 1];
    if (lastMessage?.role === 'user') {
      prompt += conversationMessages.length === 1 ? lastMessage.content : `Human: ${lastMessage.content}`;
    }

    return prompt;
  }

  private async* parseGeminiStream(stream: NodeJS.ReadableStream): AsyncGenerator<StreamChunk> {
    let buffer = '';
    
    stream.setEncoding('utf8');
    
    for await (const chunk of stream) {
      buffer += chunk;
      
      // Look for complete JSON objects
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            
            // Handle different gemini-cli output formats
            if (data.text || data.content) {
              yield {
                content: data.text || data.content,
                isComplete: data.done || data.finished || false,
                metadata: data.usage ? {
                  usage: {
                    prompt_tokens: data.usage.prompt_tokens || 0,
                    completion_tokens: data.usage.completion_tokens || 0,
                    total_tokens: data.usage.total_tokens || 0
                  }
                } : undefined
              };
            }
          } catch (parseError) {
            // Not JSON, treat as plain text chunk
            if (line.trim()) {
              yield {
                content: line + '\\n',
                isComplete: false
              };
            }
          }
        }
      }
    }
    
    // Yield any remaining content
    if (buffer.trim()) {
      yield {
        content: buffer,
        isComplete: true
      };
    }
  }

  private extractGeminiResponse(stdout: string): string {
    // Try to parse as JSON first (if --json flag was used)
    try {
      const jsonResponse = JSON.parse(stdout);
      return jsonResponse.text || jsonResponse.content || jsonResponse.response || stdout;
    } catch {
      // Not JSON, clean up plain text output
      const lines = stdout.split('\\n');
      
      // Filter out CLI UI elements
      const contentLines = lines.filter(line => {
        // Remove common Gemini CLI UI elements
        if (line.includes('Thinking...')) return false;
        if (line.includes('Generating...')) return false;
        if (line.includes('Model:')) return false;
        if (line.match(/^\\s*$/)) return false; // Empty lines
        if (line.startsWith('Usage:')) return false;
        
        return true;
      });

      return contentLines.join('\\n').trim();
    }
  }

  private parseGeminiMetadata(stderr: string): any {
    const metadata: any = {};
    
    // Extract usage information if present
    const usageMatch = stderr.match(/Usage: (\\d+) input tokens, (\\d+) output tokens/);
    if (usageMatch) {
      metadata.usage = {
        prompt_tokens: parseInt(usageMatch[1]),
        completion_tokens: parseInt(usageMatch[2]),
        total_tokens: parseInt(usageMatch[1]) + parseInt(usageMatch[2])
      };
    }

    // Extract model information
    const modelMatch = stderr.match(/Model: ([^\\n\\r]+)/);
    if (modelMatch) {
      metadata.model = modelMatch[1].trim();
    }

    // Extract any safety ratings or other Gemini-specific info
    const safetyMatch = stderr.match(/Safety: ([^\\n\\r]+)/);
    if (safetyMatch) {
      metadata.safety = safetyMatch[1].trim();
    }

    return metadata;
  }
}