/**
 * Claude Code CLI provider - integrates with the Claude Code CLI tool
 * This is the primary technical AI provider for Coquette
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

export class ClaudeCodeProvider extends BaseProvider {
  private static readonly CLI_COMMAND = 'claude';

  async isAvailable(): Promise<boolean> {
    try {
      return new Promise((resolve) => {
        const child = spawn(ClaudeCodeProvider.CLI_COMMAND, ['--version'], { 
          stdio: 'pipe'
        });
        
        let output = '';
        child.stdout?.on('data', (data) => {
          output += data.toString();
        });
        
        child.on('close', (code) => {
          resolve(code === 0 && output.includes('claude'));
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
    console.log('[ClaudeCodeProvider] sendMessage called with', messages.length, 'messages');
    const response = await this.executeClaudeCommand(messages, options);
    console.log('[ClaudeCodeProvider] executeClaudeCommand completed');
    
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

    try {
      const command = this.buildClaudeCommand(messages, options);
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
        for await (const chunk of this.parseClaudeStream(child.stdout)) {
          fullResponse += chunk.content;
          yield chunk;
        }
      }

      // Wait for process to complete
      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      if (exitCode !== 0) {
        throw new Error(`Claude CLI exited with code ${exitCode}. stderr: ${stderrBuffer}`);
      }

      // Extract metadata from stderr if available
      metadata = this.parseClaudeMetadata(stderrBuffer);

    } catch (error: any) {
      this.handleProviderError(error, 'stream message');
    }

    return {
      content: fullResponse,
      metadata,
      timestamp: new Date()
    };
  }

  // Private methods for Claude CLI integration

  private async executeClaudeCommand(
    messages: ChatMessage[],
    options?: ProviderOptions
  ): Promise<{ content: string; metadata: any }> {
    return new Promise((resolve, reject) => {
      console.log('[ClaudeCodeProvider] Executing Claude --print command');
      
      const prompt = this.formatMessagesForClaude(messages);
      console.log('[ClaudeCodeProvider] Direct command: claude --print --', prompt.substring(0, 50) + '...');
      
      // Use the exact same format that works in shell
      const child = spawn('claude', ['--print', '--', prompt], {
        stdio: ['ignore', 'pipe', 'pipe'], // ignore stdin since we're not using it
        env: process.env // use clean environment
      });
      
      console.log('[ClaudeCodeProvider] Child process spawned, PID:', child.pid);
      
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        console.log('[ClaudeCodeProvider] Process closed with code:', code);
        console.log('[ClaudeCodeProvider] stdout length:', stdout.length);
        console.log('[ClaudeCodeProvider] stderr length:', stderr.length);
        
        if (code === 0) {
          const content = this.extractClaudeResponse(stdout);
          const metadata = this.parseClaudeMetadata(stderr);
          resolve({ content, metadata });
        } else {
          reject(new Error(`Claude CLI failed with exit code ${code}. stderr: ${stderr}`));
        }
      });
      
      child.on('error', (error) => {
        console.log('[ClaudeCodeProvider] Process error:', error.message);
        reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
      });
      
      // Set timeout - use shorter timeout for testing
      const timeout = this.getRequestTimeout(options?.timeout_ms || 30000);
      console.log('[ClaudeCodeProvider] Setting timeout to:', timeout + 'ms');
      setTimeout(() => {
        console.log('[ClaudeCodeProvider] Timeout reached, killing process');
        child.kill();
        reject(new Error(`Claude CLI timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  private buildClaudeCommand(
    messages: ChatMessage[],
    options?: ProviderOptions
  ): {
    cmd: string;
    args: string[];
    env: Record<string, string>;
  } {
    const args: string[] = [];
    const env: Record<string, string> = {};

    // Model selection
    if (options?.model) {
      args.push('--model', options.model);
    }

    // Convert messages to Claude CLI format
    const prompt = this.formatMessagesForClaude(messages);
    
    // Use --print for non-interactive output
    args.push('--print');
    args.push('--');  // Separator to indicate end of options
    args.push(prompt);

    return {
      cmd: ClaudeCodeProvider.CLI_COMMAND,
      args,
      env
    };
  }

  private formatMessagesForClaude(messages: ChatMessage[]): string {
    // Extract system message if present
    const systemMessages = messages.filter(msg => msg.role === 'system');
    const conversationMessages = messages.filter(msg => msg.role !== 'system');

    let prompt = '';

    // Add system context if present
    if (systemMessages.length > 0) {
      const systemContent = systemMessages.map(msg => msg.content).join('\n');
      prompt += `System context: ${systemContent}\n\n`;
    }

    // Add conversation history
    if (conversationMessages.length > 1) {
      // If there's conversation history, format it
      const history = conversationMessages
        .slice(0, -1)
        .map(msg => `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`)
        .join('\n\n');
      prompt += `Previous conversation:\n${history}\n\n`;
    }

    // Add current user message
    const lastMessage = conversationMessages[conversationMessages.length - 1];
    if (lastMessage?.role === 'user') {
      prompt += lastMessage.content;
    }

    return prompt;
  }

  private async* parseClaudeStream(stream: NodeJS.ReadableStream): AsyncGenerator<StreamChunk> {
    let buffer = '';
    
    stream.setEncoding('utf8');
    
    for await (const chunk of stream) {
      buffer += chunk;
      
      // Look for natural breaking points in Claude's output
      const lines = buffer.split('\n');
      
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';
      
      // Yield complete lines as chunks
      for (const line of lines) {
        if (line.trim()) {
          yield {
            content: line + '\n',
            isComplete: false
          };
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

  private extractClaudeResponse(stdout: string): string {
    // Clean up Claude CLI output, removing UI noise
    const lines = stdout.split('\n');
    
    // Filter out CLI UI elements
    const contentLines = lines.filter(line => {
      // Remove common Claude CLI UI elements
      if (line.includes('✻ Spelunking...')) return false;
      if (line.includes('? for shortcuts')) return false;
      if (line.includes('Auto-update failed')) return false;
      if (line.includes('Approaching usage limit')) return false;
      if (line.match(/^\s*$/)) return false; // Empty lines
      
      return true;
    });

    return contentLines.join('\n').trim();
  }

  private parseClaudeMetadata(stderr: string): any {
    const metadata: any = {};
    
    // Extract usage information if present
    const usageMatch = stderr.match(/Usage: (\d+) prompt tokens, (\d+) completion tokens/);
    if (usageMatch) {
      metadata.usage = {
        prompt_tokens: parseInt(usageMatch[1]),
        completion_tokens: parseInt(usageMatch[2]),
        total_tokens: parseInt(usageMatch[1]) + parseInt(usageMatch[2])
      };
    }

    // Extract model information
    const modelMatch = stderr.match(/Model: ([^\n\r]+)/);
    if (modelMatch) {
      metadata.model = modelMatch[1].trim();
    }

    // Extract reasoning/thinking if present
    const reasoningMatch = stderr.match(/Reasoning: ([\s\S]*?)(?=\n\n|$)/);
    if (reasoningMatch) {
      metadata.reasoning = reasoningMatch[1].trim();
    }

    return metadata;
  }
}