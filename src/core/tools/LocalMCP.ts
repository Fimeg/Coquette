/**
 * LocalMCP - Local Model Control Protocol implementation for tool dispatch
 * Handles filesystem operations, shell commands, and web interactions safely
 */

import { ToolCall, ToolResult, LocalToolConfig, CoquetuteMode } from '../types.js';
import { promises as fs } from 'fs';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import { GrepTool } from './GrepTool.js';
import { GlobTool } from './GlobTool.js';

const execAsync = promisify(exec);

export interface LocalToolContext {
  working_directory: string;
  environment: Record<string, string>;
  user_id: string;
  session_id: string;
  safety_mode: 'strict' | 'moderate' | 'permissive';
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  safety_level: 'safe' | 'caution' | 'dangerous';
  requires_approval: boolean;
  timeout_ms: number;
}

export class LocalMCP {
  private config: LocalToolConfig;
  private context: LocalToolContext;
  private availableTools: Map<string, ToolDefinition> = new Map();
  private runningProcesses: Map<string, ChildProcess> = new Map();
  private pendingApprovals: Map<string, ToolCall> = new Map();
  private grepTool: GrepTool;
  private globTool: GlobTool;

  constructor(config: LocalToolConfig, context: LocalToolContext) {
    this.config = config;
    this.context = context;
    this.grepTool = new GrepTool(this.context.working_directory);
    this.globTool = new GlobTool(this.context.working_directory);
    this.initializeTools();
  }

  /**
   * Get list of available tools based on configuration
   */
  getAvailableTools(): string[] {
    const tools: string[] = [];

    if (this.config.enabled) {
      if (this.config.allowed_operations.filesystem) {
        tools.push('read_file', 'write_file', 'list_directory', 'create_directory', 'delete_file', 'copy_file', 'move_file', 'append_to_file', 'find_files', 'search_content');
      }
      
      if (this.config.allowed_operations.shell_commands) {
        tools.push('run_command', 'run_script', 'check_process');
      }
      
      if (this.config.allowed_operations.web_requests) {
        tools.push('fetch_url', 'download_file', 'web_search');
      }
      
      if (this.config.allowed_operations.system_info) {
        tools.push('system_info', 'disk_usage', 'memory_usage', 'process_list', 'get_current_directory', 'change_directory', 'get_current_datetime');
      }
    }

    return tools;
  }

  /**
   * Execute a tool call with safety checks and approval workflow
   */
  async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    // Send tool activity start notification
    this.notifyToolActivity(`Executing ${toolCall.name}`, toolCall.name);
    
    // Safety validation
    const safetyCheck = await this.validateToolSafety(toolCall);
    if (!safetyCheck.safe) {
      this.notifyToolActivity(''); // Clear activity
      return {
        success: false,
        output: '',
        error: `Tool execution blocked: ${safetyCheck.reason}`,
        metadata: { safety_violation: true }
      };
    }

    // Check if approval is required
    if (this.requiresApproval(toolCall)) {
      this.notifyToolActivity('Waiting for approval', toolCall.name);
      return await this.handleApprovalWorkflow(toolCall);
    }

    // Execute the tool
    try {
      const result = await this.executeToolInternal(toolCall);
      
      // Send completion blurb
      const status = result.success ? 'completed' : 'failed';
      this.notifyToolBlurb(`${toolCall.name} ${status}`, toolCall.name);
      
      this.notifyToolActivity(''); // Clear activity
      return result;
    } catch (error) {
      this.notifyToolBlurb(`${toolCall.name} failed: ${error}`, toolCall.name);
      this.notifyToolActivity(''); // Clear activity
      throw error;
    }
  }

  /**
   * Send tool activity notification to TUI
   */
  private notifyToolActivity(activity: string, toolName?: string) {
    const message = {
      type: 'tool_activity',
      activity: activity,
      tool_name: toolName,
      timestamp: new Date().toISOString()
    };
    
    process.stderr.write(JSON.stringify(message) + '\n');
  }

  /**
   * Send tool execution blurb to TUI
   */
  private notifyToolBlurb(content: string, toolName?: string) {
    const message = {
      type: 'tool_blurb',
      content: content,
      tool_name: toolName,
      timestamp: new Date().toISOString()
    };
    
    process.stderr.write(JSON.stringify(message) + '\n');
  }

  /**
   * Request approval for a tool execution
   */
  async requestApproval(toolCall: ToolCall): Promise<string> {
    const approvalId = this.generateApprovalId();
    this.pendingApprovals.set(approvalId, toolCall);
    
    return approvalId;
  }

  /**
   * Approve or reject a pending tool execution
   */
  async processApproval(approvalId: string, approved: boolean): Promise<ToolResult> {
    const toolCall = this.pendingApprovals.get(approvalId);
    
    if (!toolCall) {
      return {
        success: false,
        output: '',
        error: 'Approval ID not found',
        metadata: { approval_error: true }
      };
    }

    this.pendingApprovals.delete(approvalId);

    if (!approved) {
      return {
        success: false,
        output: '',
        error: 'Tool execution rejected by user',
        metadata: { user_rejected: true }
      };
    }

    toolCall.approved = true;
    return await this.executeToolInternal(toolCall);
  }

  /**
   * Get pending approvals
   */
  getPendingApprovals(): Array<{ id: string; tool_call: ToolCall }> {
    return Array.from(this.pendingApprovals.entries()).map(([id, toolCall]) => ({
      id,
      tool_call: toolCall
    }));
  }

  /**
   * Cancel a running process
   */
  async cancelProcess(processId: string): Promise<boolean> {
    const process = this.runningProcesses.get(processId);
    
    if (process) {
      process.kill('SIGTERM');
      this.runningProcesses.delete(processId);
      return true;
    }
    
    return false;
  }

  // Private tool implementations

  private async executeToolInternal(toolCall: ToolCall): Promise<ToolResult> {
    try {
      switch (toolCall.name) {
        case 'read_file':
          return await this.readFile(toolCall.parameters);
        case 'write_file':
          return await this.writeFile(toolCall.parameters);
        case 'list_directory':
          return await this.listDirectory(toolCall.parameters);
        case 'create_directory':
          return await this.createDirectory(toolCall.parameters);
        case 'delete_file':
          return await this.deleteFile(toolCall.parameters);
        case 'run_command':
          return await this.runCommand(toolCall.parameters);
        case 'run_script':
          return await this.runScript(toolCall.parameters);
        case 'check_process':
          return await this.checkProcess(toolCall.parameters);
        case 'change_directory':
          return await this.changeDirectory(toolCall.parameters);
        case 'get_current_directory':
          return await this.getCurrentDirectory();
        case 'copy_file':
          return await this.copyFile(toolCall.parameters);
        case 'move_file':
          return await this.moveFile(toolCall.parameters);
        case 'find_files':
          return await this.globTool.execute(toolCall.parameters);
        case 'search_content':
          return await this.grepTool.execute(toolCall.parameters);
        case 'append_to_file':
          return await this.appendToFile(toolCall.parameters);
        case 'get_current_datetime':
          return await this.getCurrentDateTime();
        case 'fetch_url':
          return await this.fetchUrl(toolCall.parameters);
        case 'download_file':
          return await this.downloadFile(toolCall.parameters);
        case 'web_search':
          return await this.webSearch(toolCall.parameters);
        case 'url_to_markdown':
          return await this.urlToMarkdown(toolCall.parameters);
        case 'system_info':
          return await this.getSystemInfo();
        case 'disk_usage':
          return await this.getDiskUsage(toolCall.parameters);
        case 'memory_usage':
          return await this.getMemoryUsage();
        case 'process_list':
          return await this.getProcessList();
        default:
          return {
            success: false,
            output: '',
            error: `Unknown tool: ${toolCall.name}`
          };
      }
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message,
        metadata: { exception: error.name }
      };
    }
  }

  // Filesystem operations

  private async readFile(params: { file_path: string; encoding?: string }): Promise<ToolResult> {
    // Enhanced validation inspired by gemini-cli
    if (!params.file_path || typeof params.file_path !== 'string') {
      return { 
        success: false, 
        output: '', 
        error: 'file_path parameter is required and must be a string' 
      };
    }

    const safePath = this.validateAndResolvePath(params.file_path);
    
    if (!safePath.safe) {
      return { success: false, output: '', error: safePath.error! };
    }

    try {
      // Check if path exists and is a file (not a directory)
      const stats = await fs.stat(safePath.path);
      
      if (stats.isDirectory()) {
        return { 
          success: false, 
          output: '', 
          error: `Cannot read '${params.file_path}': is a directory. Use list_directory to see contents or specify a file path.`
        };
      }

      if (!stats.isFile()) {
        return { 
          success: false, 
          output: '', 
          error: `Cannot read '${params.file_path}': not a regular file.`
        };
      }

      // Enhanced file size check
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
      if (stats.size > MAX_FILE_SIZE) {
        return {
          success: false,
          output: '',
          error: `File too large (${Math.round(stats.size / 1024 / 1024)}MB). Maximum size is 10MB.`
        };
      }

      // Basic binary detection - check if file looks like binary
      if (await this.isBinaryFile(safePath.path)) {
        return {
          success: false,
          output: '',
          error: `Cannot read '${params.file_path}': appears to be a binary file. Use copy_file or download_file for binary content.`
        };
      }

      const content = await fs.readFile(safePath.path, params.encoding || 'utf8');
      
      return {
        success: true,
        output: content,
        metadata: {
          file_size: content.length,
          file_size_bytes: stats.size,
          encoding: params.encoding || 'utf8',
          file_type: 'file',
          last_modified: stats.mtime.toISOString()
        }
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { 
          success: false, 
          output: '', 
          error: `File not found: '${params.file_path}'`
        };
      }
      if (error.code === 'EACCES') {
        return { 
          success: false, 
          output: '', 
          error: `Permission denied: '${params.file_path}'`
        };
      }
      return { 
        success: false, 
        output: '', 
        error: `Failed to read file: ${error.message}`
      };
    }
  }

  private async writeFile(params: { file_path: string; content: string; encoding?: string }): Promise<ToolResult> {
    const safePath = this.validateAndResolvePath(params.file_path);
    
    if (!safePath.safe) {
      return { success: false, output: '', error: safePath.error! };
    }

    await fs.writeFile(safePath.path, params.content, params.encoding || 'utf8');
    
    return {
      success: true,
      output: `File written successfully: ${safePath.path}`,
      metadata: {
        bytes_written: params.content.length,
        encoding: params.encoding || 'utf8'
      }
    };
  }

  private async listDirectory(params: { directory_path: string; include_hidden?: boolean }): Promise<ToolResult> {
    const safePath = this.validateAndResolvePath(params.directory_path);
    
    if (!safePath.safe) {
      return { success: false, output: '', error: safePath.error! };
    }

    const items = await fs.readdir(safePath.path, { withFileTypes: true });
    
    const filteredItems = items.filter(item => 
      params.include_hidden || !item.name.startsWith('.')
    );

    const itemList = filteredItems.map(item => ({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      size: item.isFile() ? (fs.stat(path.join(safePath.path, item.name))).then(stats => stats.size) : null
    }));

    return {
      success: true,
      output: JSON.stringify(itemList, null, 2),
      metadata: {
        directory: safePath.path,
        item_count: itemList.length
      }
    };
  }

  private async createDirectory(params: { directory_path: string; recursive?: boolean }): Promise<ToolResult> {
    const safePath = this.validateAndResolvePath(params.directory_path);
    
    if (!safePath.safe) {
      return { success: false, output: '', error: safePath.error! };
    }

    await fs.mkdir(safePath.path, { recursive: params.recursive || false });
    
    return {
      success: true,
      output: `Directory created: ${safePath.path}`,
      metadata: { directory: safePath.path }
    };
  }

  private async deleteFile(params: { file_path: string; force?: boolean }): Promise<ToolResult> {
    const safePath = this.validateAndResolvePath(params.file_path);
    
    if (!safePath.safe) {
      return { success: false, output: '', error: safePath.error! };
    }

    const stats = await fs.stat(safePath.path);
    
    if (stats.isDirectory()) {
      if (params.force) {
        await fs.rmdir(safePath.path, { recursive: true });
      } else {
        return { success: false, output: '', error: 'Path is a directory. Use force=true to delete recursively.' };
      }
    } else {
      await fs.unlink(safePath.path);
    }
    
    return {
      success: true,
      output: `Deleted: ${safePath.path}`,
      metadata: { deleted_path: safePath.path }
    };
  }

  // Shell operations

  private async runCommand(params: { command: string; args?: string[]; timeout?: number }): Promise<ToolResult> {
    const safeCommand = this.validateCommand(params.command, params.args || []);
    
    if (!safeCommand.safe) {
      return { success: false, output: '', error: safeCommand.error! };
    }

    // Enhanced safety check based on MCP-CLI patterns
    if (this.requiresConfirmation(params.command)) {
      const approvalId = await this.requestApproval({
        id: `shell_${Date.now()}`,
        name: 'run_command',
        parameters: params
      });
      
      return {
        success: false,
        output: '',
        error: `Command requires approval. Approval ID: ${approvalId}`,
        metadata: {
          requires_approval: true,
          approval_id: approvalId,
          command: safeCommand.command
        }
      };
    }

    const timeout = params.timeout || this.availableTools.get('run_command')?.timeout_ms || 30000;
    
    try {
      const { stdout, stderr } = await execAsync(safeCommand.command, {
        timeout,
        cwd: this.context.working_directory,
        env: { ...process.env, ...this.context.environment }
      });

      return {
        success: true,
        output: stdout,
        error: stderr || undefined,
        metadata: {
          command: safeCommand.command,
          execution_time: Date.now(),
          working_directory: this.context.working_directory
        }
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.stdout || '',
        error: error.message,
        metadata: {
          command: safeCommand.command,
          exit_code: error.code,
          working_directory: this.context.working_directory
        }
      };
    }
  }

  private async runScript(params: { script_path: string; interpreter?: string; args?: string[] }): Promise<ToolResult> {
    const safePath = this.validateAndResolvePath(params.script_path);
    
    if (!safePath.safe) {
      return { success: false, output: '', error: safePath.error! };
    }

    const interpreter = params.interpreter || this.detectScriptInterpreter(safePath.path);
    const args = params.args || [];
    const command = `${interpreter} ${safePath.path} ${args.join(' ')}`;

    return await this.runCommand({ command });
  }

  private async checkProcess(params: { process_id: string }): Promise<ToolResult> {
    const process = this.runningProcesses.get(params.process_id);
    
    if (!process) {
      return {
        success: false,
        output: '',
        error: 'Process not found'
      };
    }

    return {
      success: true,
      output: JSON.stringify({
        pid: process.pid,
        running: !process.killed,
        exit_code: process.exitCode
      }),
      metadata: { process_id: params.process_id }
    };
  }

  // Enhanced filesystem operations (from MCP-CLI patterns)

  private async changeDirectory(params: { directory: string }): Promise<ToolResult> {
    try {
      let targetPath = params.directory;

      // Handle special cases
      if (targetPath === '~') {
        targetPath = require('os').homedir();
      } else if (targetPath === '.') {
        return {
          success: true,
          output: `Already in directory: ${this.context.working_directory}`,
          metadata: { directory: this.context.working_directory }
        };
      }

      // Handle both absolute and relative paths
      if (!require('path').isAbsolute(targetPath)) {
        targetPath = require('path').join(this.context.working_directory, targetPath);
      }

      // Validate the target path exists
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          output: '',
          error: `'${params.directory}' is not a directory`
        };
      }

      // Update working directory context
      this.context.working_directory = targetPath;
      process.chdir(targetPath);

      return {
        success: true,
        output: `Changed directory to: ${targetPath}`,
        metadata: { 
          directory: targetPath,
          previous_directory: this.context.working_directory
        }
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          success: false,
          output: '',
          error: `Directory not found: '${params.directory}'`
        };
      }
      return {
        success: false,
        output: '',
        error: error.message
      };
    }
  }

  private async getCurrentDirectory(): Promise<ToolResult> {
    return {
      success: true,
      output: `Current directory: ${this.context.working_directory}`,
      metadata: { directory: this.context.working_directory }
    };
  }

  private async copyFile(params: { source: string; destination: string }): Promise<ToolResult> {
    const sourcePath = this.validateAndResolvePath(params.source);
    const destPath = this.validateAndResolvePath(params.destination);

    if (!sourcePath.safe) {
      return { success: false, output: '', error: sourcePath.error! };
    }
    if (!destPath.safe) {
      return { success: false, output: '', error: destPath.error! };
    }

    try {
      await fs.copyFile(sourcePath.path, destPath.path);
      return {
        success: true,
        output: `Successfully copied ${sourcePath.path} to ${destPath.path}`,
        metadata: {
          source: sourcePath.path,
          destination: destPath.path
        }
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          success: false,
          output: '',
          error: `Source file not found: '${params.source}'`
        };
      }
      return {
        success: false,
        output: '',
        error: error.message
      };
    }
  }

  private async moveFile(params: { source: string; destination: string }): Promise<ToolResult> {
    const sourcePath = this.validateAndResolvePath(params.source);
    const destPath = this.validateAndResolvePath(params.destination);

    if (!sourcePath.safe) {
      return { success: false, output: '', error: sourcePath.error! };
    }
    if (!destPath.safe) {
      return { success: false, output: '', error: destPath.error! };
    }

    try {
      await fs.rename(sourcePath.path, destPath.path);
      return {
        success: true,
        output: `Successfully moved ${sourcePath.path} to ${destPath.path}`,
        metadata: {
          source: sourcePath.path,
          destination: destPath.path
        }
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message
      };
    }
  }

  private async appendToFile(params: { file_path: string; content: string; encoding?: string }): Promise<ToolResult> {
    const safePath = this.validateAndResolvePath(params.file_path);
    
    if (!safePath.safe) {
      return { success: false, output: '', error: safePath.error! };
    }

    await fs.appendFile(safePath.path, params.content, params.encoding || 'utf8');
    
    return {
      success: true,
      output: `Content appended successfully to: ${safePath.path}`,
      metadata: {
        bytes_appended: params.content.length,
        encoding: params.encoding || 'utf8'
      }
    };
  }


  private async getCurrentDateTime(): Promise<ToolResult> {
    const now = new Date();
    const dateTimeInfo = {
      iso_string: now.toISOString(),
      local_string: now.toString(),
      timestamp: now.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds()
    };

    return {
      success: true,
      output: `Current date and time: ${now.toString()}`,
      metadata: dateTimeInfo
    };
  }

  // Web operations

  private async fetchUrl(params: { url: string; method?: string; headers?: Record<string, string> }): Promise<ToolResult> {
    if (!this.config.allowed_operations.web_requests) {
      return { success: false, output: '', error: 'Web requests not allowed' };
    }

    // Simple fetch implementation - would use a proper HTTP client in practice
    try {
      const response = await fetch(params.url, {
        method: params.method || 'GET',
        headers: params.headers
      });

      const content = await response.text();

      return {
        success: response.ok,
        output: content,
        metadata: {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          url: params.url
        }
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message,
        metadata: { url: params.url }
      };
    }
  }

  private async downloadFile(params: { url: string; destination: string }): Promise<ToolResult> {
    const safePath = this.validateAndResolvePath(params.destination);
    
    if (!safePath.safe) {
      return { success: false, output: '', error: safePath.error! };
    }

    try {
      const response = await fetch(params.url);
      
      if (!response.ok) {
        return {
          success: false,
          output: '',
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      await fs.writeFile(safePath.path, buffer);

      return {
        success: true,
        output: `File downloaded to: ${safePath.path}`,
        metadata: {
          url: params.url,
          destination: safePath.path,
          size: buffer.length
        }
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message
      };
    }
  }

  private async urlToMarkdown(params: { url: string }): Promise<ToolResult> {
    if (!this.config.allowed_operations.web_requests) {
      return { success: false, output: '', error: 'Web requests not allowed' };
    }

    try {
      const response = await fetch(params.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Coquette LocalMCP/1.0)'
        }
      });

      if (!response.ok) {
        return {
          success: false,
          output: '',
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      const html = await response.text();
      
      // Simple HTML to text conversion (would use html2text library in production)
      const cleanedText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        success: true,
        output: `Successfully converted ${params.url} to markdown:\n\n${cleanedText}`,
        metadata: {
          url: params.url,
          content_length: cleanedText.length,
          response_status: response.status
        }
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message
      };
    }
  }

  private async webSearch(params: { query: string; num_results?: number }): Promise<ToolResult> {
    if (!this.config.allowed_operations.web_requests) {
      return { success: false, output: '', error: 'Web requests not allowed' };
    }

    // Simple DuckDuckGo search implementation (based on MCP-CLI pattern)
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; Coquette LocalMCP/1.0)'
      };
      
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
      const response = await fetch(searchUrl, { headers });
      
      if (!response.ok) {
        return {
          success: false,
          output: '',
          error: `Search failed: HTTP ${response.status}`
        };
      }

      const html = await response.text();
      
      // Simple result extraction (would use proper HTML parser in production)
      const results = this.extractSearchResults(html, params.num_results || 5);
      
      const output = `Search results for "${params.query}":\n\n` + 
        results.map((result, i) => `${i + 1}. ${result.title}\n   URL: ${result.url}\n   ${result.snippet}\n`).join('\n');

      return {
        success: true,
        output,
        metadata: {
          query: params.query,
          results_count: results.length,
          search_engine: 'duckduckgo'
        }
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: `Search error: ${error.message}`
      };
    }
  }

  // System operations

  private async getSystemInfo(): Promise<ToolResult> {
    const info = {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      user: os.userInfo(),
      node_version: process.version,
      cpu_count: os.cpus().length,
      total_memory: os.totalmem(),
      free_memory: os.freemem()
    };

    return {
      success: true,
      output: JSON.stringify(info, null, 2),
      metadata: { timestamp: Date.now() }
    };
  }

  private async getDiskUsage(params: { path?: string }): Promise<ToolResult> {
    const targetPath = params.path || this.context.working_directory;
    
    try {
      const { stdout } = await execAsync(`df -h "${targetPath}"`);
      
      return {
        success: true,
        output: stdout,
        metadata: { path: targetPath }
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message
      };
    }
  }

  private async getMemoryUsage(): Promise<ToolResult> {
    const usage = process.memoryUsage();
    const systemMem = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem()
    };

    const info = {
      process: usage,
      system: systemMem,
      load_average: os.loadavg()
    };

    return {
      success: true,
      output: JSON.stringify(info, null, 2),
      metadata: { timestamp: Date.now() }
    };
  }

  private async getProcessList(): Promise<ToolResult> {
    try {
      const { stdout } = await execAsync('ps aux');
      
      return {
        success: true,
        output: stdout,
        metadata: { timestamp: Date.now() }
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message
      };
    }
  }

  // Safety and validation methods

  private async validateToolSafety(toolCall: ToolCall): Promise<{ safe: boolean; reason?: string }> {
    const tool = this.availableTools.get(toolCall.name);
    
    if (!tool) {
      return { safe: false, reason: 'Unknown tool' };
    }

    // Check if tool is enabled
    if (!this.config.enabled) {
      return { safe: false, reason: 'Local tools disabled' };
    }

    // Check safety level against context
    if (this.context.safety_mode === 'strict' && tool.safety_level !== 'safe') {
      return { safe: false, reason: `Tool safety level ${tool.safety_level} not allowed in strict mode` };
    }

    // Validate parameters
    const paramValidation = this.validateParameters(toolCall.name, toolCall.parameters);
    if (!paramValidation.valid) {
      return { safe: false, reason: paramValidation.error };
    }

    return { safe: true };
  }

  private validateAndResolvePath(filePath: string): { safe: boolean; path: string; error?: string } {
    try {
      const resolvedPath = path.resolve(this.context.working_directory, filePath);
      const normalizedPath = path.normalize(resolvedPath);

      // Check for path traversal
      if (!normalizedPath.startsWith(this.context.working_directory)) {
        return { safe: false, path: '', error: 'Path traversal detected' };
      }

      // Check blocked paths
      for (const blockedPath of this.config.safety_restrictions.blocked_paths) {
        if (normalizedPath.startsWith(path.resolve(blockedPath))) {
          return { safe: false, path: '', error: `Access to ${blockedPath} is blocked` };
        }
      }

      return { safe: true, path: normalizedPath };
    } catch (error: any) {
      return { safe: false, path: '', error: error.message };
    }
  }

  private validateCommand(command: string, args: string[]): { safe: boolean; command: string; error?: string } {
    const fullCommand = `${command} ${args.join(' ')}`.trim();

    // Check blocked commands
    for (const blockedCmd of this.config.safety_restrictions.blocked_commands) {
      if (fullCommand.toLowerCase().includes(blockedCmd.toLowerCase())) {
        return { safe: false, command: '', error: `Command contains blocked term: ${blockedCmd}` };
      }
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      /sudo\s+rm/,
      />\s*\/dev\/null/,
      /mkfs\./,
      /dd\s+if=/
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(fullCommand)) {
        return { safe: false, command: '', error: 'Potentially dangerous command detected' };
      }
    }

    return { safe: true, command: fullCommand };
  }

  private validateParameters(toolName: string, parameters: any): { valid: boolean; error?: string } {
    const tool = this.availableTools.get(toolName);
    
    if (!tool) {
      return { valid: false, error: 'Tool not found' };
    }

    // Basic parameter validation - would be more comprehensive in practice
    for (const [paramName, paramSchema] of Object.entries(tool.parameters)) {
      if (paramSchema.required && !(paramName in parameters)) {
        return { valid: false, error: `Missing required parameter: ${paramName}` };
      }
    }

    return { valid: true };
  }

  private requiresApproval(toolCall: ToolCall): boolean {
    const tool = this.availableTools.get(toolCall.name);
    
    if (!tool) {
      return true; // Unknown tools require approval
    }

    if (tool.requires_approval) {
      return true;
    }

    // Check if command is in require_confirmation list
    if (toolCall.name === 'run_command' || toolCall.name === 'delete_file') {
      const command = toolCall.parameters.command || toolCall.parameters.file_path;
      
      for (const pattern of this.config.safety_restrictions.require_confirmation) {
        if (command && command.includes(pattern)) {
          return true;
        }
      }
    }

    return false;
  }

  private requiresConfirmation(command: string): boolean {
    // Based on MCP-CLI patterns for dangerous commands
    const dangerousPatterns = [
      'rm ', 'rmdir', 'del ', 'delete',
      'sudo ', 'su ', 'chmod +x',
      'mv ', 'move ', 'cp -r', 'copy',
      'git push', 'git force', 'git reset --hard',
      'npm publish', 'pip install', 'apt install',
      'docker run', 'docker exec',
      'ssh ', 'scp ', 'rsync',
      'curl -X POST', 'wget -O'
    ];

    return dangerousPatterns.some(pattern => 
      command.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  private extractSearchResults(html: string, maxResults: number): Array<{title: string, url: string, snippet: string}> {
    // Simple regex-based extraction (would use proper HTML parser in production)
    const results = [];
    
    // Very basic pattern matching for DuckDuckGo results
    const titlePattern = /<a[^>]+class="result__a"[^>]*>([^<]+)<\/a>/g;
    const urlPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/g;
    
    const titles = [...html.matchAll(titlePattern)];
    const urls = [...html.matchAll(urlPattern)];
    
    for (let i = 0; i < Math.min(titles.length, urls.length, maxResults); i++) {
      results.push({
        title: titles[i]?.[1] || 'No title',
        url: urls[i]?.[1] || 'No URL',
        snippet: `Search result ${i + 1}` // Simplified for now
      });
    }

    return results;
  }

  private async handleApprovalWorkflow(toolCall: ToolCall): Promise<ToolResult> {
    const approvalId = await this.requestApproval(toolCall);
    
    return {
      success: false,
      output: '',
      error: `Tool execution requires approval. Approval ID: ${approvalId}`,
      metadata: {
        requires_approval: true,
        approval_id: approvalId,
        tool_description: this.availableTools.get(toolCall.name)?.description
      }
    };
  }

  private detectScriptInterpreter(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    
    const interpreters: Record<string, string> = {
      '.py': 'python3',
      '.js': 'node',
      '.rb': 'ruby',
      '.sh': 'bash',
      '.pl': 'perl',
      '.php': 'php'
    };

    return interpreters[ext] || 'bash';
  }

  private generateApprovalId(): string {
    return `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Enhanced binary file detection based on gemini-cli patterns
   */
  private async isBinaryFile(filePath: string): Promise<boolean> {
    let fileHandle: fs.promises.FileHandle | undefined;
    try {
      fileHandle = await fs.open(filePath, 'r');

      // Read up to 4KB or file size, whichever is smaller
      const stats = await fileHandle.stat();
      const fileSize = stats.size;
      if (fileSize === 0) {
        return false; // Empty file is not binary
      }
      
      const bufferSize = Math.min(4096, fileSize);
      const buffer = Buffer.alloc(bufferSize);
      const result = await fileHandle.read(buffer, 0, buffer.length, 0);
      const bytesRead = result.bytesRead;

      if (bytesRead === 0) return false;

      let nonPrintableCount = 0;
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) return true; // Null byte is strong indicator
        if (buffer[i] < 9 || (buffer[i] > 13 && buffer[i] < 32)) {
          nonPrintableCount++;
        }
      }
      
      // If >30% non-printable characters, consider it binary
      return nonPrintableCount / bytesRead > 0.3;
    } catch (error: any) {
      // If any error occurs, treat as not binary
      return false;
    } finally {
      if (fileHandle) {
        await fileHandle.close();
      }
    }
  }

  private initializeTools(): void {
    const tools: ToolDefinition[] = [
      {
        name: 'read_file',
        description: 'Read contents of a file',
        parameters: {
          file_path: { type: 'string', required: true },
          encoding: { type: 'string', required: false, default: 'utf8' }
        },
        safety_level: 'safe',
        requires_approval: false,
        timeout_ms: 10000
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        parameters: {
          file_path: { type: 'string', required: true },
          content: { type: 'string', required: true },
          encoding: { type: 'string', required: false, default: 'utf8' }
        },
        safety_level: 'caution',
        requires_approval: true,
        timeout_ms: 15000
      },
      {
        name: 'list_directory',
        description: 'List files and directories',
        parameters: {
          directory_path: { type: 'string', required: true },
          include_hidden: { type: 'boolean', required: false, default: false }
        },
        safety_level: 'safe',
        requires_approval: false,
        timeout_ms: 10000
      },
      {
        name: 'create_directory',
        description: 'Create a directory',
        parameters: {
          directory_path: { type: 'string', required: true },
          recursive: { type: 'boolean', required: false, default: false }
        },
        safety_level: 'caution',
        requires_approval: false,
        timeout_ms: 10000
      },
      {
        name: 'change_directory',
        description: 'Change working directory (cd)',
        parameters: {
          directory: { type: 'string', required: true }
        },
        safety_level: 'safe',
        requires_approval: false,
        timeout_ms: 5000
      },
      {
        name: 'get_current_directory',
        description: 'Get current working directory (pwd)',
        parameters: {},
        safety_level: 'safe',
        requires_approval: false,
        timeout_ms: 1000
      },
      {
        name: 'copy_file',
        description: 'Copy a file from source to destination',
        parameters: {
          source: { type: 'string', required: true },
          destination: { type: 'string', required: true }
        },
        safety_level: 'caution',
        requires_approval: false,
        timeout_ms: 30000
      },
      {
        name: 'move_file',
        description: 'Move/rename a file from source to destination',
        parameters: {
          source: { type: 'string', required: true },
          destination: { type: 'string', required: true }
        },
        safety_level: 'caution',
        requires_approval: true,
        timeout_ms: 30000
      },
      {
        name: 'delete_file',
        description: 'Delete a file or directory',
        parameters: {
          file_path: { type: 'string', required: true },
          force: { type: 'boolean', required: false, default: false }
        },
        safety_level: 'dangerous',
        requires_approval: true,
        timeout_ms: 10000
      },
      {
        name: 'run_command',
        description: 'Execute a shell command (DANGEROUS)',
        parameters: {
          command: { type: 'string', required: true },
          args: { type: 'array', required: false },
          timeout: { type: 'number', required: false, default: 30000 }
        },
        safety_level: 'dangerous',
        requires_approval: true,
        timeout_ms: 360000  // 6 minutes for Ollama thinking time
      },
      {
        name: 'fetch_url',
        description: 'Fetch content from a URL',
        parameters: {
          url: { type: 'string', required: true },
          method: { type: 'string', required: false, default: 'GET' },
          headers: { type: 'object', required: false }
        },
        safety_level: 'caution',
        requires_approval: false,
        timeout_ms: 30000
      },
      {
        name: 'url_to_markdown',
        description: 'Convert web page to markdown text',
        parameters: {
          url: { type: 'string', required: true }
        },
        safety_level: 'safe',
        requires_approval: false,
        timeout_ms: 30000
      },
      {
        name: 'web_search',
        description: 'Search the web using DuckDuckGo',
        parameters: {
          query: { type: 'string', required: true },
          num_results: { type: 'number', required: false, default: 5 }
        },
        safety_level: 'safe',
        requires_approval: false,
        timeout_ms: 30000
      },
      {
        name: 'append_to_file',
        description: 'Append content to an existing file',
        parameters: {
          file_path: { type: 'string', required: true },
          content: { type: 'string', required: true },
          encoding: { type: 'string', required: false, default: 'utf8' }
        },
        safety_level: 'caution',
        requires_approval: false,
        timeout_ms: 15000
      },
      {
        name: 'get_current_datetime',
        description: 'Get current date and time information',
        parameters: {},
        safety_level: 'safe',
        requires_approval: false,
        timeout_ms: 1000
      },
      {
        name: 'system_info',
        description: 'Get system information',
        parameters: {},
        safety_level: 'safe',
        requires_approval: false,
        timeout_ms: 5000
      }
    ];

    for (const tool of tools) {
      this.availableTools.set(tool.name, tool);
    }
  }
}