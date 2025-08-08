/**
 * ToolsAgent - Dedicated agent for tool orchestration and execution
 * Separates tool concerns from personality AI (Gemma/Ani)
 * Based on Gemini CLI CoreToolScheduler patterns
 */

import { DebugLogger } from '../DebugLogger.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { workflowManager, WorkflowPattern } from '../WorkflowPatterns.js';

export interface ToolRequest {
  id: string;
  intent: string;
  context: string;
  requiredCapabilities: string[];
}

export interface ToolPlan {
  steps: ToolStep[];
  reasoning: string;
  estimatedTime: number;
}

export interface ToolStep {
  id: string;
  tool: string;
  parameters: Record<string, any>;
  description: string;
}

export interface ToolsResult {
  success: boolean;
  summary: string;
  details: string;
  stepsExecuted: number;
  executionTime: number;
  metadata?: Record<string, any>;
}

export class ToolsAgent {
  private logger: DebugLogger;
  private toolRegistry: ToolRegistry;
  private currentWorkflow: WorkflowPattern | null = null;
  
  // Core tool mappings - simplified and focused
  private readonly CORE_TOOLS = {
    // File operations
    read: { tool: 'read_file', description: 'Read file contents' },
    write: { tool: 'write_file', description: 'Write file contents' },
    list: { tool: 'list_directory', description: 'List directory contents' },
    find: { tool: 'find_files', description: 'Find files by pattern' },
    search: { tool: 'search_content', description: 'Search text in files' },
    
    // System operations  
    run: { tool: 'run_command', description: 'Execute shell command' },
    info: { tool: 'system_info', description: 'Get system information' },
    
    // Web operations
    fetch: { tool: 'fetch_url', description: 'Fetch web content' },
    download: { tool: 'download_file', description: 'Download file from web' }
  };

  constructor(toolRegistry: ToolRegistry) {
    this.logger = DebugLogger.getInstance();
    this.toolRegistry = toolRegistry;
  }

  /**
   * Main entry point - converts natural language request to tool execution
   * Follows Tool Safety Workflow for systematic execution
   */
  async executeTools(request: string): Promise<ToolsResult> {
    const startTime = Date.now();
    
    // Initialize tool safety workflow
    this.currentWorkflow = workflowManager.startWorkflow('tool_safety');
    
    this.logger.logEngineEvent('tools_agent_start', { 
      request, 
      workflow_id: this.currentWorkflow?.name 
    });
    
    try {
      // Step 1: Analyze request and create execution plan
      if (this.currentWorkflow) {
        workflowManager.completeStep(this.currentWorkflow, 'classify_danger', {
          danger_level: this.assessDangerLevel(request)
        });
      }
      
      const plan = await this.createToolPlan(request);
      
      // Step 2: Execute plan steps with safety workflow
      const results = await this.executePlan(plan);
      
      // Step 3: Create clean summary for personality AI
      const summary = this.createSummary(results, plan);
      
      const executionTime = Date.now() - startTime;
      
      if (this.currentWorkflow) {
        workflowManager.completeStep(this.currentWorkflow, 'execute_safely', {
          steps_executed: results.length,
          execution_time: executionTime
        });
      }
      
      return {
        success: true,
        summary: summary,
        details: this.createDetailedReport(results),
        stepsExecuted: results.length,
        executionTime,
        metadata: { plan, results, workflow: this.currentWorkflow }
      };
      
    } catch (error: any) {
      this.logger.logError('tools_agent_failed', error);
      
      if (this.currentWorkflow) {
        workflowManager.failStep(this.currentWorkflow, 'execute_safely', error.message);
      }
      
      return {
        success: false,
        summary: `Tool execution failed: ${error.message}`,
        details: `Error occurred during tool execution: ${error.message}`,
        stepsExecuted: 0,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Create execution plan using simple pattern matching with recursive validation
   * NO AI needed - just smart parsing with fallback chains
   * 
   * TOOL USAGE GUIDELINES:
   * - Use absolute paths for all file operations (never relative paths)
   * - Use 'list_available_tools' for tool inventory requests
   * - Use 'list_directory' for directory listing
   * - Use 'read_file' for specific file reading
   * - Use 'glob' for file pattern matching
   * - Use 'search_file_content' for text search operations
   */
  private async createToolPlan(request: string): Promise<ToolPlan> {
    const lowerRequest = request.toLowerCase();
    const steps: ToolStep[] = [];
    
    // Check for tool inventory requests first
    if (lowerRequest.includes('tools') && (lowerRequest.includes('access') || lowerRequest.includes('available') || lowerRequest.includes('have'))) {
      // This is a request to list available tools
      return {
        steps: [{
          id: 'tools_inventory',
          tool: 'list_available_tools',
          parameters: {},
          description: 'List all available tools in the ToolRegistry'
        }],
        reasoning: `Tool inventory request detected: "${request}"`,
        estimatedTime: 1000
      };
    }
    
    // Enhanced file reading detection with recursive logic
    if (lowerRequest.includes('read') || lowerRequest.includes('show') || lowerRequest.includes('view')) {
      if (lowerRequest.includes('directory') || lowerRequest.includes('folder') || lowerRequest.includes('list')) {
        steps.push({
          id: 'step1',
          tool: 'list_directory',
          parameters: { path: process.cwd() },
          description: 'List current directory contents'
        });
      } else {
        // Only try to extract EXACT filenames with extensions (no fuzzy matching)
        const exactFilename = this.extractExactFilename(request);
        
        if (exactFilename && this.hasValidExtension(exactFilename)) {
          // Direct file read if exact filename with extension detected
          steps.push({
            id: 'step1', 
            tool: 'read_file',
            parameters: { file_path: exactFilename },
            description: `Read ${exactFilename}`
          });
        } else {
          // Recursive validation approach: list directory first, then validate intent
          steps.push({
            id: 'step1',
            tool: 'list_directory',
            parameters: { 
              path: process.cwd(),
              original_request: request // Pass through original request for validation
            },
            description: 'List directory to identify target file'
          });
          
          // Add validation step metadata for recursive processing
          steps.push({
            id: 'step2_validation',
            tool: 'recursive_validation',
            parameters: { 
              original_request: request,
              validation_prompt: `User requested: "${request}". Based on the directory listing, what specific file should I read to fulfill this request?`
            },
            description: 'Validate if directory listing matches user intent and determine next action'
          });
        }
      }
    }
    
    if (lowerRequest.includes('find') || lowerRequest.includes('search')) {
      if (lowerRequest.includes('file')) {
        steps.push({
          id: 'step_find',
          tool: 'glob', 
          parameters: { pattern: '*.md', path: process.cwd() },
          description: 'Find files by pattern'
        });
      } else {
        steps.push({
          id: 'step_search',
          tool: 'search_file_content',
          parameters: { pattern: 'search_term', path: process.cwd() },
          description: 'Search text in files'
        });
      }
    }
    
    if (lowerRequest.includes('write') || lowerRequest.includes('create')) {
      steps.push({
        id: 'step_write',
        tool: 'write_file',
        parameters: { file_path: 'output.txt', content: 'Generated content' },
        description: 'Write file'
      });
    }
    
    if (lowerRequest.includes('run') || lowerRequest.includes('execute') || lowerRequest.includes('command')) {
      steps.push({
        id: 'step_run',
        tool: 'run_command', 
        parameters: { command: 'ls -la' },
        description: 'Execute command'
      });
    }
    
    // Default fallback - list directory to understand context
    if (steps.length === 0) {
      steps.push({
        id: 'step_default',
        tool: 'list_directory',
        parameters: { path: process.cwd() },
        description: 'Explore current directory'
      });
    }
    
    return {
      steps,
      reasoning: `Pattern-matched request "${request}" to ${steps.length} tool steps`,
      estimatedTime: steps.length * 2000 // ~2 seconds per step
    };
  }

  /**
   * Execute plan steps sequentially with recursive validation
   */
  private async executePlan(plan: ToolPlan): Promise<any[]> {
    const results = [];
    
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      this.logger.logEngineEvent('tools_agent_executing_step', { step, stepIndex: i });
      
      try {
        // Special handling for virtual tools
        if (step.tool === 'list_available_tools') {
          const availableTools = this.toolRegistry.getAllTools();
          const toolList = availableTools.map(tool => `- ${tool.name}: ${tool.description || 'No description available'}`).join('\n');
          
          const result = {
            success: true,
            output: `Available tools in ToolRegistry (${availableTools.length} total):\n\n${toolList}`,
            metadata: { tool_count: availableTools.length, tools: availableTools.map(t => t.name) }
          };
          
          results.push({
            step,
            result,
            success: true
          });
          
          continue; // Skip normal tool execution
        }

        // Special handling for recursive validation steps
        if (step.tool === 'recursive_validation') {
          const validationResult = await this.performRecursiveValidation(step, results);
          results.push({
            step,
            result: validationResult,
            success: validationResult.success
          });
          
          // If validation determines a next action, add it to the plan
          if (validationResult.success && validationResult.metadata?.next_action) {
            const nextAction = validationResult.metadata.next_action;
            const nextStep: ToolStep = {
              id: `step_recursive_${Date.now()}`,
              tool: nextAction.tool,
              parameters: nextAction.parameters,
              description: nextAction.description
            };
            
            // Insert the next step after current position
            plan.steps.splice(i + 1, 0, nextStep);
            this.logger.logEngineEvent('recursive_step_added', { nextStep, insertedAt: i + 1 });
          }
          
          continue;
        }
        
        // Use ToolRegistry to get the tool and execute it
        const tool = this.toolRegistry.getTool(step.tool);
        if (!tool) {
          // Debug: List available tools for troubleshooting
          const availableTools = this.toolRegistry.getAllTools().map(t => t.name);
          this.logger.logEngineEvent('tool_not_found_debug', { 
            requested: step.tool, 
            available: availableTools 
          });
          throw new Error(`Tool '${step.tool}' not found in registry. Available: ${availableTools.join(', ')}`);
        }
        
        // Safety check: Explain potentially dangerous operations
        this.checkToolSafety(step);
        
        const result = await tool.execute(step.parameters, new AbortController().signal);
        
        results.push({
          step,
          result,
          success: result.success
        });

        // RECURSIVE LOGIC: After directory listing, validate intent and determine next action
        if (step.tool === 'list_directory' && result.success) {
          this.logger.logEngineEvent('directory_listing_completed', { 
            output_length: result.output?.length || 0,
            checking_for_recursive_validation: true
          });
          
          // Check if this was a directory listing intended to find a specific file
          const hasValidationStep = plan.steps.some(s => s.tool === 'recursive_validation');
          if (!hasValidationStep) {
            // Look for the original request context
            const originalRequest = step.parameters.original_request || 
                                    step.description || 
                                    'directory listing';
            
            // If the directory listing seems like it was meant to find something specific
            if (this.seemsLikeFileSearchIntent(originalRequest, result.output)) {
              // Add recursive validation step
              const validationStep: ToolStep = {
                id: `step_recursive_validation_${Date.now()}`,
                tool: 'recursive_validation',
                parameters: {
                  original_request: originalRequest,
                  directory_output: result.output,
                  validation_prompt: `User requested: "${originalRequest}". Directory contains: ${result.output}. What specific file should I read to fulfill this request?`
                },
                description: 'Validate directory listing against user intent and determine next action'
              };
              
              // Insert validation step after current directory listing
              plan.steps.splice(i + 1, 0, validationStep);
              this.logger.logEngineEvent('recursive_validation_step_added', { 
                originalRequest, 
                insertedAt: i + 1 
              });
            }
          }
        }
        
      } catch (error: any) {
        results.push({
          step,
          result: { success: false, error: error.message },
          success: false
        });
      }
    }
    
    return results;
  }

  /**
   * Create clean summary for personality AI
   * This is what Gemma/Ani will receive - clean and focused
   */
  private createSummary(results: any[], plan: ToolPlan): string {
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;
    
    if (successCount === 0) {
      return `Tool execution failed. No steps completed successfully.`;
    }
    
    const summaryParts = [`Executed ${successCount}/${totalCount} tool operations successfully.`];
    
    // Add key results
    for (const result of results.filter(r => r.success)) {
      const output = result.result.output;
      if (output && output.length > 0) {
        // Truncate long outputs for summary
        const preview = output.length > 200 ? output.substring(0, 200) + '...' : output;
        summaryParts.push(`${result.step.description}: ${preview}`);
      }
    }
    
    return summaryParts.join('\n\n');
  }

  /**
   * Create detailed report (for debugging/logs)
   */
  private createDetailedReport(results: any[]): string {
    return results.map((result, i) => {
      const status = result.success ? '✅' : '❌';
      return `${status} Step ${i + 1}: ${result.step.description}\n   Result: ${JSON.stringify(result.result, null, 2)}`;
    }).join('\n\n');
  }

  /**
   * Perform recursive validation using simple pattern matching
   * This determines the next action based on directory listing and user intent
   */
  private async performRecursiveValidation(step: ToolStep, previousResults: any[]): Promise<any> {
    this.logger.logEngineEvent('recursive_validation_start', { 
      stepId: step.id,
      originalRequest: step.parameters.original_request
    });

    try {
      const originalRequest = step.parameters.original_request || '';
      const directoryOutput = step.parameters.directory_output || '';
      
      // Simple pattern matching to find files that match the user's intent
      const nextAction = this.determineNextActionFromDirectory(originalRequest, directoryOutput);
      
      if (nextAction) {
        this.logger.logEngineEvent('recursive_validation_success', { 
          originalRequest,
          determinedAction: nextAction.tool,
          targetFile: nextAction.parameters.file_path || 'unknown'
        });

        return {
          success: true,
          output: `Based on user request "${originalRequest}", determined next action: ${nextAction.description}`,
          metadata: { next_action: nextAction }
        };
      } else {
        this.logger.logEngineEvent('recursive_validation_no_match', { 
          originalRequest,
          directoryContained: directoryOutput.length
        });

        return {
          success: true,
          output: `Could not determine specific file from directory listing for request: "${originalRequest}"`,
          metadata: { next_action: null }
        };
      }
      
    } catch (error: any) {
      this.logger.logError('recursive_validation_failed', error);
      return {
        success: false,
        error: `Recursive validation failed: ${error.message}`
      };
    }
  }

  /**
   * Determine next action based on user request and directory contents
   * Uses simple pattern matching instead of AI to avoid recursive AI calls
   */
  private determineNextActionFromDirectory(originalRequest: string, directoryOutput: string): any | null {
    const lowerRequest = originalRequest.toLowerCase();
    const lowerOutput = directoryOutput.toLowerCase();
    
    // Extract potential filenames from the request
    const fileMatches = [
      lowerRequest.match(/read\s+([^\s]+)/),
      lowerRequest.match(/show\s+([^\s]+)/),
      lowerRequest.match(/view\s+([^\s]+)/),
      lowerRequest.match(/([^\s]+\.md)/),
      lowerRequest.match(/([^\s]+\.txt)/),
      lowerRequest.match(/([^\s]+\.json)/),
      lowerRequest.match(/([^\s]+\.yaml)/),
      lowerRequest.match(/([^\s]+\.yml)/),
      lowerRequest.match(/immediatesteps/),
      lowerRequest.match(/immediate.?steps/),
      lowerRequest.match(/multimodel/),
      lowerRequest.match(/integration.?plan/)
    ];
    
    // Find the first matching filename pattern
    for (const match of fileMatches) {
      if (match && match[1]) {
        const requestedFile = match[1];
        
        // Check if this file (or similar) exists in directory output
        const lines = directoryOutput.split('\n');
        for (const line of lines) {
          if (line.toLowerCase().includes(requestedFile.toLowerCase())) {
            // Extract the actual filename from the directory listing line
            const fileMatch = line.match(/([^\s\/]+\.(md|txt|json|yaml|yml))/i);
            if (fileMatch) {
              return {
                tool: 'read_file',
                parameters: { 
                  file_path: fileMatch[1] 
                },
                description: `Read ${fileMatch[1]} as requested by user`
              };
            }
          }
        }
      }
    }
    
    // Enhanced keyword-based file matching for common requests
    const keywordMappings = [
      {
        keywords: ['immediate', 'step'],
        searchTerms: ['immediatestep', 'immediate', 'step'],
        description: 'immediate steps file'
      },
      {
        keywords: ['multimodel', 'integration'],
        searchTerms: ['multimodel', 'integration', 'intelligence'],
        description: 'multimodel integration file'
      },
      {
        keywords: ['system', 'interconnect', 'map'],
        searchTerms: ['system', 'interconnect', 'interconnection', 'map'],
        description: 'system interconnection map file'
      },
      {
        keywords: ['tool', 'architecture', 'analysis'],
        searchTerms: ['tool', 'architecture', 'analysis'],
        description: 'tools architecture analysis file'
      }
    ];

    // Check each keyword mapping
    for (const mapping of keywordMappings) {
      const hasAllKeywords = mapping.keywords.every(keyword => 
        lowerRequest.includes(keyword.toLowerCase())
      );
      
      if (hasAllKeywords) {
        const lines = directoryOutput.split('\n');
        for (const line of lines) {
          const lowerLine = line.toLowerCase();
          // Check if line contains any of the search terms
          const matchesSearchTerms = mapping.searchTerms.some(term => 
            lowerLine.includes(term.toLowerCase())
          );
          
          if (matchesSearchTerms) {
            const fileMatch = line.match(/([^\s\/]+\.(md|txt|json|yaml|yml))/i);
            if (fileMatch) {
              return {
                tool: 'read_file',
                parameters: { file_path: fileMatch[1] },
                description: `Read ${fileMatch[1]} (${mapping.description})`
              };
            }
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Extract EXACT filename with extension only (no fuzzy matching)
   */
  private extractExactFilename(request: string): string | null {
    // Only match complete filenames with extensions (e.g., "config.toml", "README.md")
    const exactFileMatch = request.match(/\b([a-zA-Z0-9_-]+\.[a-zA-Z]{2,4})\b/);
    return exactFileMatch ? exactFileMatch[1] : null;
  }

  /**
   * Check if filename has a valid extension
   */
  private hasValidExtension(filename: string): boolean {
    const validExtensions = ['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.js', '.ts', '.py'];
    return validExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  /**
   * Check if a directory listing request seems intended to find specific files
   */
  private seemsLikeFileSearchIntent(originalRequest: string, directoryOutput: string): boolean {
    const lowerRequest = originalRequest.toLowerCase();
    
    // Check if the request contains file-seeking keywords
    const fileSeekingKeywords = [
      'read', 'show', 'view', 'find', 'get', 
      '.md', '.txt', '.json', '.yaml', '.yml',
      'immediatestep', 'multimodel', 'integration', 'plan'
    ];
    
    const hasFileSeekingIntent = fileSeekingKeywords.some(keyword => 
      lowerRequest.includes(keyword.toLowerCase())
    );
    
    // Check if directory output contains files that could match the intent
    const hasRelevantFiles = directoryOutput.toLowerCase().includes('.md') || 
                           directoryOutput.toLowerCase().includes('.txt') ||
                           directoryOutput.toLowerCase().includes('.json');
    
    return hasFileSeekingIntent && hasRelevantFiles;
  }

  /**
   * Check tool safety and log explanations for potentially dangerous operations
   * Following Gemini-CLI pattern of explaining critical commands before execution
   * Integrates with Tool Safety Workflow
   */
  private checkToolSafety(step: ToolStep): void {
    // Complete workflow steps for safety checking
    if (this.currentWorkflow) {
      workflowManager.completeStep(this.currentWorkflow, 'explain_operation');
      workflowManager.completeStep(this.currentWorkflow, 'check_paths');
    }
    const dangerousTools = ['run_shell_command', 'write_file', 'replace'];
    const modifyingTools = ['write_file', 'replace', 'run_shell_command'];
    
    if (dangerousTools.includes(step.tool)) {
      let explanation = '';
      let impact = '';
      
      switch (step.tool) {
        case 'run_shell_command':
          explanation = `Executing shell command: ${step.parameters.command || 'unknown'}`;
          impact = 'This command will run on the system and may modify files, install packages, or change system state';
          break;
          
        case 'write_file':
          explanation = `Writing to file: ${step.parameters.file_path || 'unknown'}`;
          impact = 'This will create or overwrite the specified file with new content';
          break;
          
        case 'replace':
          explanation = `Replacing text in file: ${step.parameters.file_path || 'unknown'}`;
          impact = 'This will modify the existing file by replacing specified text patterns';
          break;
          
        default:
          explanation = `Executing potentially modifying tool: ${step.tool}`;
          impact = 'This operation may modify files or system state';
      }
      
      // Log the safety explanation (complete workflow step)
      this.logger.logEngineEvent('tool_safety_explanation', {
        tool: step.tool,
        explanation,
        impact,
        parameters: step.parameters,
        description: step.description
      });
      
      // Complete workflow logging step
      if (this.currentWorkflow) {
        workflowManager.completeStep(this.currentWorkflow, 'log_safety', {
          tool: step.tool,
          explanation,
          impact
        });
      }
      
      // Emit safety message for TUI display
      this.emitSystemMessage('tool_safety', explanation, {
        tool_name: step.tool,
        impact: impact,
        parameters: step.parameters
      });
    }
    
    // Additional safety checks for file paths
    if (modifyingTools.includes(step.tool) && step.parameters.file_path) {
      const filePath = step.parameters.file_path;
      
      // Warn about system files or important directories
      const criticalPaths = ['/etc/', '/usr/', '/var/', '/sys/', '/proc/', '/boot/'];
      const isCriticalPath = criticalPaths.some(path => filePath.startsWith(path));
      
      if (isCriticalPath) {
        this.logger.logEngineEvent('tool_safety_warning', {
          tool: step.tool,
          file_path: filePath,
          warning: 'Attempting to modify critical system path',
          recommendation: 'Ensure this operation is intentional and safe'
        });
        
        this.emitSystemMessage('tool_safety_warning', `⚠️  Modifying critical system path: ${filePath}`, {
          tool_name: step.tool,
          severity: 'high',
          file_path: filePath
        });
      }
    }
  }

  /**
   * Assess danger level of tool request for workflow classification
   */
  private assessDangerLevel(request: string): 'low' | 'medium' | 'high' {
    const lowerRequest = request.toLowerCase();
    
    // High danger indicators
    const highDangerKeywords = ['delete', 'remove', 'rm ', 'sudo', 'chmod', 'chown', 'format'];
    if (highDangerKeywords.some(keyword => lowerRequest.includes(keyword))) {
      return 'high';
    }
    
    // Medium danger indicators
    const mediumDangerKeywords = ['write', 'create', 'modify', 'install', 'run', 'execute'];
    if (mediumDangerKeywords.some(keyword => lowerRequest.includes(keyword))) {
      return 'medium';
    }
    
    // Default to low danger for read operations
    return 'low';
  }

  /**
   * Emit system message for TUI display (matching CoquetuteEngine pattern)
   */
  private emitSystemMessage(type: string, message: string, metadata?: any): void {
    const systemMessage = {
      type,
      message,
      metadata: metadata || {},
      timestamp: new Date().toISOString()
    };
    process.stderr.write(JSON.stringify(systemMessage) + '\n');
  }
}