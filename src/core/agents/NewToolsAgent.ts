/**
 * NewToolsAgent - Clean tools architecture using Gemini CLI tools
 * Replaces LocalMCP with clean, focused tool execution
 */

import { readFile } from '../tools/read-file.js';
import { writeFile } from '../tools/write-file.js';
import { edit } from '../tools/edit.js';
import { glob } from '../tools/glob.js';
import { grep } from '../tools/grep.js';
import { ls } from '../tools/ls.js';
import { shell } from '../tools/shell.js';
import { webFetch } from '../tools/web-fetch.js';
import { readManyFiles } from '../tools/read-many-files.js';
import { Tool, ToolResult } from '../tools/tools.js';

export interface ToolRequest {
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export class NewToolsAgent {
  private availableTools: Map<string, Tool> = new Map();

  constructor() {
    this.initializeTools();
  }

  private initializeTools() {
    // Register core Gemini CLI tools
    const tools = [
      readFile,
      writeFile, 
      edit,
      glob,
      grep,
      ls,
      shell,
      webFetch,
      readManyFiles
    ];

    for (const tool of tools) {
      this.availableTools.set(tool.name, tool);
    }
  }

  /**
   * Get list of available tool names
   */
  getAvailableTools(): string[] {
    return Array.from(this.availableTools.keys());
  }

  /**
   * Get tool descriptions for LLM prompt
   */
  getToolDescriptions(): string {
    const descriptions = [];
    
    for (const [name, tool] of this.availableTools) {
      descriptions.push(`- ${name}: ${tool.description}`);
    }
    
    return descriptions.join('\n');
  }

  /**
   * Execute a single tool request
   */
  async executeTool(request: ToolRequest): Promise<ToolExecutionResult> {
    const tool = this.availableTools.get(request.name);
    
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Tool '${request.name}' not found. Available tools: ${this.getAvailableTools().join(', ')}`
      };
    }

    try {
      const result = await tool.execute(request.parameters);
      
      return {
        success: true,
        output: result.output || '',
        metadata: {
          tool_name: request.name,
          execution_time: Date.now(),
          ...result.metadata
        }
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message,
        metadata: {
          tool_name: request.name,
          execution_time: Date.now(),
          error_type: error.constructor.name
        }
      };
    }
  }

  /**
   * Execute multiple tool requests
   */
  async executeTools(requests: ToolRequest[]): Promise<ToolExecutionResult[]> {
    const results = [];
    
    for (const request of requests) {
      const result = await this.executeTool(request);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Parse tool requests from text (MCP-CLI pattern)
   */
  parseToolRequests(text: string): ToolRequest[] {
    const toolCalls = [];
    
    // Extract JSON tool calls from code blocks or inline
    const patterns = [
      /```(?:json|tool_code)\n(.*?)```/gs,
      /({[^{}]*(?:{[^{}]*}[^{}]*)*})/g
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          try {
            const cleanMatch = match
              .replace(/```(?:json|tool_code)\n?/g, '')
              .replace(/```/g, '')
              .trim();
            
            const parsed = JSON.parse(cleanMatch);
            
            // Validate tool call format
            if (parsed.tool && typeof parsed.tool === 'string') {
              toolCalls.push({
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

  /**
   * Process a request and execute tools if found
   */
  async processRequest(input: string): Promise<{
    tools_executed: number;
    results: ToolExecutionResult[];
    summary: string;
  }> {
    const toolRequests = this.parseToolRequests(input);
    
    if (toolRequests.length === 0) {
      return {
        tools_executed: 0,
        results: [],
        summary: 'No tool requests found in input'
      };
    }

    const results = await this.executeTools(toolRequests);
    const successCount = results.filter(r => r.success).length;
    
    return {
      tools_executed: toolRequests.length,
      results,
      summary: `Executed ${toolRequests.length} tools, ${successCount} successful`
    };
  }
}