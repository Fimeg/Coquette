/**
 * OllamaToolProvider - Ollama/Gemma with clean ToolsAgent architecture
 * Uses dedicated ToolsAgent for tool orchestration, keeps Gemma focused on personality
 */

import { BaseProvider, ChatMessage, ProviderResponse } from './BaseProvider.js';
import { ToolsAgent } from '../agents/ToolsAgent.js';
import { InputRouter } from '../InputRouter.js';

export class OllamaToolProvider extends BaseProvider {
  private baseUrl: string;
  private model: string;
  private toolsAgent?: ToolsAgent;
  private inputRouter?: InputRouter;

  constructor(config: any, toolsAgent?: ToolsAgent, inputRouter?: InputRouter) {
    super('ollama_tools', config);
    this.baseUrl = config.base_url || 'http://localhost:11434';
    this.model = config.model || 'gemma3n:e4b';
    this.toolsAgent = toolsAgent;
    this.inputRouter = inputRouter;
  }

  async sendMessage(messages: ChatMessage[]): Promise<ProviderResponse> {
    const startTime = Date.now();
    const lastMessage = messages[messages.length - 1];

    try {
      // NEW CLEAN ARCHITECTURE: Use existing InputRouter for intent classification
      let responseContent = '';
      
      // Use the proper InputRouter for AI-based intent classification
      let toolsNeeded = false;
      if (this.inputRouter) {
        const intentResult = await this.inputRouter.getIntent(lastMessage.content);
        toolsNeeded = intentResult.intent === 'task';
        console.log(`[OllamaToolProvider] InputRouter classified intent: ${intentResult.intent} (${intentResult.summary})`);
      } else {
        console.warn('[OllamaToolProvider] No InputRouter available, skipping tools');
      }
      
      if (this.toolsAgent && toolsNeeded) {
        console.log('[OllamaToolProvider] Tool request detected, delegating to ToolsAgent...');
        
        // Let ToolsAgent handle tool orchestration completely
        const toolResult = await this.toolsAgent.processRequest(lastMessage.content);
        
        if (toolResult.success) {
          // Got clean tool results, now send ONLY results to Gemma for personality interpretation
          const personalityMessages = [
            {
              role: 'system' as const,
              content: 'You are Ani, a helpful AI assistant. Interpret the following tool results and respond in character. DO NOT attempt to use tools - results are already provided.'
            },
            {
              role: 'user' as const,
              content: `Original request: ${lastMessage.content}\n\nTool results: ${toolResult.result}`
            }
          ];
          
          // Send clean request to Gemma for personality interpretation only
          responseContent = await this.callGemmaPersonality(personalityMessages);
        } else {
          responseContent = `I encountered an issue while processing your request: ${toolResult.error}`;
        }
      } else {
        // No tools needed, send directly to Gemma for personality-only response
        console.log('[OllamaToolProvider] No tool request detected, sending to Gemma for personality response...');
        const personalityMessages = [
          {
            role: 'system' as const,
            content: 'You are Ani, a helpful AI assistant. Respond naturally and conversationally.'
          },
          ...messages
        ];
        responseContent = await this.callGemmaPersonality(personalityMessages);
      }

      return {
        content: responseContent,
        metadata: {
          provider: 'ollama_tools',
          model: this.model,
          processing_time_ms: Date.now() - startTime,
          architecture: 'clean_separation' // Mark this as using the new clean architecture
        }
      };

    } catch (error: any) {
      return {
        content: `Error calling Ollama: ${error.message}`,
        metadata: {
          model: this.model,
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          },
          provider_specific: {
            provider_id: 'ollama_tools',
            latency_ms: Date.now() - startTime,
            error: error.message
          }
        }
      };
    }
  }

  private createToolSystemPrompt(availableTools: string[]): string {
    // Create tool descriptions based on LocalTools available tools
    const toolDescriptions = availableTools.map(tool => {
      switch (tool) {
        case 'list_directory':
          return '- list_directory(directory_path="."): Lists files and directories at given path.';
        case 'read_file':
          return '- read_file(file_path): Reads content from a local file.';
        case 'write_file':
          return '- write_file(file_path, content): Writes content to a file.';
        case 'create_directory':
          return '- create_directory(directory_path): Creates a directory.';
        case 'delete_file':
          return '- delete_file(file_path): Deletes a file. USE WITH CAUTION.';
        case 'copy_file':
          return '- copy_file(source, destination): Copies a file.';
        case 'move_file':
          return '- move_file(source, destination): Moves/renames a file.';
        case 'append_to_file':
          return '- append_to_file(file_path, content): Appends content to a file.';
        case 'get_current_directory':
          return '- get_current_directory(): Gets current working directory (pwd).';
        case 'get_current_datetime':
          return '- get_current_datetime(): Gets the current date and time.';
        case 'run_command':
          return '- run_command(command): Executes a shell command. USE WITH CAUTION.';
        case 'search_content':
          return '- search_content(pattern, path=".", include="**/*"): Searches for text content within files using regex patterns.';
        case 'find_files':
          return '- find_files(pattern, path="."): Finds files matching glob patterns (e.g., **/*.js, src/**/*.ts).';
        // Gemini CLI tools
        case 'read_file':
          return '- read_file(absolute_path): Reads content from a file using production-grade Gemini CLI tool.';
        case 'write_file':
          return '- write_file(absolute_path, content): Writes content to a file using production-grade Gemini CLI tool.';
        case 'edit':
          return '- edit(absolute_path, old_string, new_string): Edits a file by replacing old_string with new_string.';
        case 'glob':
          return '- glob(pattern): Finds files matching glob patterns using production-grade tool.';
        case 'grep':
          return '- grep(pattern, path): Searches for patterns in files using production-grade tool.';
        case 'ls':
          return '- ls(path): Lists directory contents using production-grade tool.';
        case 'shell':
          return '- shell(command): Executes shell commands using production-grade tool.';
        case 'web_fetch':
          return '- web_fetch(url): Fetches content from URLs using production-grade tool.';
        case 'read_many_files':
          return '- read_many_files(paths): Reads multiple files efficiently using production-grade tool.';
        case 'memory':
          return '- memory(operation, content): Manages memory/notes using production-grade tool.';
        case 'web_search':
          return '- web_search(query): Searches the web using production-grade tool.';
        default:
          return `- ${tool}(): Available tool.`;
      }
    }).join('\n');

    return `You are a helpful assistant with access to production-grade tools.

When you need a tool, use this exact format:
\`\`\`tool_code
{"tool": "tool_name", "args": {"param": "value"}}
\`\`\`

Then continue the conversation naturally.

Available tools:
${toolDescriptions}

If you have completed the task and do not need to use a tool, respond with a final, conversational message to the user. Do NOT call any more tools if the task is complete.`;
  }

  private extractToolCallsFromResponse(response: string): any[] {
    const toolCalls = [];
    
    // MCP-CLI pattern: extract JSON from code blocks or inline
    const patterns = [
      /```(?:json|tool_code)\n(.*?)```/gs,
      /({[^{}]*(?:{[^{}]*}[^{}]*)*})/g,
      /({.*?})/g
    ];

    for (const pattern of patterns) {
      const matches = response.match(pattern);
      if (matches) {
        for (const match of matches) {
          try {
            const cleanMatch = match
              .replace(/```(?:json|tool_code)\n?/g, '')
              .replace(/```/g, '')
              .trim();
            
            const parsed = JSON.parse(cleanMatch);
            
            // Validate MCP-CLI format
            if (parsed.tool && typeof parsed.tool === 'string') {
              toolCalls.push({
                id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: parsed.tool,
                parameters: parsed.args || {}
              });
            }
          } catch (e) {
            continue;
          }
        }
      }
    }
    
    return toolCalls;
  }

  private async executeTools(toolCalls: any[]): Promise<any[]> {
    const results = [];
    
    for (const toolCall of toolCalls) {
      try {
        const result = await this.localTools.executeTool(toolCall);
        results.push({
          tool: toolCall.name,
          success: result.success,
          output: result.success ? (result.data?.output || JSON.stringify(result.data)) : result.error,
          ...result
        });
      } catch (error: any) {
        results.push({
          tool: toolCall.name,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async *sendMessageStream(messages: ChatMessage[]): AsyncGenerator<any, void, unknown> {
    // For now, fall back to non-streaming
    const response = await this.sendMessage(messages);
    yield { content: response.content, isComplete: true };
  }

  async *streamMessage(messages: ChatMessage[]): AsyncGenerator<any, any, unknown> {
    // For now, fall back to non-streaming
    const response = await this.sendMessage(messages);
    yield { content: response.content, isComplete: true };
    return response;
  }
}