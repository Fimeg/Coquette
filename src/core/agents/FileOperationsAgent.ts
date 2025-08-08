/**
 * FileOperationsAgent - Specialized recursive agent for file system operations
 * Uses Gemma to recursively plan and execute complex file tasks
 */

import { PersonalityProvider } from '../providers/PersonalityProvider.js';
import { DebugLogger } from '../DebugLogger.js';
import { LocalMCP } from '../tools/LocalMCP.js';
import { ErrorRecoveryAgent } from './ErrorRecoveryAgent.js';
import { ErrorAwareStateManager } from '../ErrorAwareStateManager.js';
import { ErrorContextAgent } from './ErrorContextAgent.js';

export interface FileOperation {
  id: string;
  operation: string;
  parameters: Record<string, any>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface FileOperationPlan {
  goal: string;
  target?: string; // Key intent extracted from user request
  operations: FileOperation[];
  reasoning: string;
}

export interface FileOperationResult {
  success: boolean;
  output: string;
  operations_executed: number;
  plan: FileOperationPlan;
  metadata?: Record<string, any>;
}

export class FileOperationsAgent {
  private personalityProvider: PersonalityProvider;
  private localMCP: LocalMCP;
  private logger: DebugLogger;
  private errorRecoveryAgent: ErrorRecoveryAgent;
  private errorStateManager?: ErrorAwareStateManager;
  private errorContextAgent?: ErrorContextAgent;
  private toolRegistry: Record<string, any>;
  private operationQueue: FileOperation[] = [];
  private executionHistory: FileOperation[] = [];
  private readonly MAX_RECOVERY_ATTEMPTS = 3;

  constructor(personalityProvider: PersonalityProvider, localMCP: LocalMCP, errorStateManager?: ErrorAwareStateManager) {
    this.personalityProvider = personalityProvider;
    this.localMCP = localMCP;
    this.logger = DebugLogger.getInstance();
    this.errorRecoveryAgent = new ErrorRecoveryAgent(personalityProvider);
    this.errorStateManager = errorStateManager;
    
    // Initialize ErrorContextAgent if we have personality provider
    if (personalityProvider) {
      this.errorContextAgent = new ErrorContextAgent(this.logger, personalityProvider);
      this.errorContextAgent.initialize();
    }
    
    // Initialize toolRegistry with available file operations
    this.toolRegistry = {
      'read_file': { description: 'Read content from a file' },
      'write_file': { description: 'Write content to a file' },
      'list_directory': { description: 'List files and directories' },
      'find_file': { description: 'Find files matching a pattern' },
      'create_directory': { description: 'Create a new directory' },
      'delete_file': { description: 'Delete a file' },
      'copy_file': { description: 'Copy a file to another location' },
      'move_file': { description: 'Move/rename a file' },
      'append_to_file': { description: 'Append content to a file' }
    };
  }

  /**
   * Main entry point - handles complex file operation requests
   */
  async executeFileOperations(request: string, conversationHistory?: any[]): Promise<FileOperationResult> {
    this.logger.logEngineEvent('file_operations_agent_start', { request });
    const startTime = Date.now();

    try {
      // Notify TUI of file operations start
      this.notifyFileOperationActivity('Planning file operations');
      
      // Step 1: Use Gemma to analyze and plan file operations
      this.logger.logEngineEvent('file_operations_calling_gemma_for_planning', { 
        timestamp: new Date().toISOString(),
        elapsed_ms: Date.now() - startTime 
      });
      const plan = await this.generateFileOperationPlan(request, conversationHistory);
      this.logger.logEngineEvent('file_operations_gemma_planning_complete', { 
        timestamp: new Date().toISOString(),
        elapsed_ms: Date.now() - startTime 
      });
      
      this.logger.logEngineEvent('file_operations_plan_generated', { 
        plan,
        operations_count: plan.operations.length 
      });

      // Step 2: Execute operations recursively with Gemma oversight
      this.notifyFileOperationActivity(`Executing ${plan.operations.length} operations`);
      this.logger.logEngineEvent('file_operations_executing_plan', { 
        timestamp: new Date().toISOString(),
        elapsed_ms: Date.now() - startTime,
        operations_count: plan.operations.length
      });
      const result = await this.executeFileOperationPlan(plan, conversationHistory);
      this.logger.logEngineEvent('file_operations_plan_execution_complete', { 
        timestamp: new Date().toISOString(),
        elapsed_ms: Date.now() - startTime,
        result_success: result.success
      });

      const processingTime = Date.now() - startTime;
      this.logger.logEngineEvent('file_operations_agent_complete', { 
        result,
        processing_time: processingTime
      });

      // Send completion blurb and clear activity
      this.notifyFileOperationBlurb(`File operations ${result.success ? 'completed' : 'failed'} (${result.operations_executed} operations)`);
      this.notifyFileOperationActivity('');

      return result;

    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.logError('file_operations_agent_failed', error);
      
      // Send error blurb and clear activity
      this.notifyFileOperationBlurb(`File operations failed: ${error.message}`);
      this.notifyFileOperationActivity('');
      
      // Record error in ErrorContextAgent if available
      if (this.errorStateManager) {
        await this.errorStateManager.recordFailedFix(
          error,
          'FileOperationsAgent',
          'file_operations_execution',
          `Failed to execute file operations for request: ${request}`,
          `Error occurred after ${processingTime}ms during file operations execution`
        );
      }
      
      return {
        success: false,
        output: `File operations failed: ${error.message}`,
        operations_executed: this.executionHistory.length,
        plan: { goal: request, operations: [], reasoning: 'Failed during planning' },
        metadata: { 
          processing_time: processingTime,
          error_recorded: !!this.errorStateManager
        }
      };
    }
  }

  /**
   * Use Gemma to generate a plan for file operations
   */
  async generateFileOperationPlan(request: string, conversationHistory?: any[]): Promise<FileOperationPlan> {
    const availableTools = this.localMCP.getAvailableTools();
    const planningPrompt = this.buildFileOperationPlanningPrompt(request, availableTools);

    const config = {
      name: 'File Operations Planner',
      file: '',
      temperature: 0.3, // Low temperature for consistent planning
      context_length: 4096,
      max_tokens: 800
    };

    this.logger.logEngineEvent('file_operations_calling_gemma_for_planning', { 
      prompt_length: planningPrompt.length,
      available_tools: availableTools.length
    });

    // Use direct Ollama call for structured planning (no personality interpretation needed)
    const requestBody = {
      model: this.personalityProvider['config'].model,
      prompt: planningPrompt,
      stream: false,
      options: {
        temperature: config.temperature,
        num_ctx: config.context_length,
        num_predict: config.max_tokens,
        stop: ['Human:', 'User:', 'Assistant:', '---']
      }
    };

    const axios = await import('axios');
    this.logger.logEngineEvent('file_operations_calling_gemma', {
      prompt_length: requestBody.prompt.length,
      available_tools: Object.keys(this.toolRegistry).length,
      // DEBUG: Log exact prompt to trace corruption
      full_prompt: requestBody.prompt
    });
    
    const ollamaResponse = await axios.default.post(
      `${this.personalityProvider['config'].base_url}/api/generate`,
      requestBody,
      {
        timeout: 300000, // 5 minutes for recursive precision
        headers: { 'Content-Type': 'application/json' }
      }
    );

    this.logger.logEngineEvent('file_operations_gemma_response_received', {
      response_length: ollamaResponse.data.response?.length || 0,
      processing_time: Date.now() - performance.now(),
      // DEBUG: Log exact response to trace corruption
      full_response: ollamaResponse.data.response || ''
    });

    const response = { content: ollamaResponse.data.response || '' };

    let responseText = '';
    if ('content' in response) {
      responseText = response.content;
    }

    return this.parseFileOperationPlan(responseText, request);
  }

  /**
   * Execute the file operation plan with recursive oversight
   */
  private async executeFileOperationPlan(plan: FileOperationPlan, conversationHistory?: any[]): Promise<FileOperationResult> {
    this.operationQueue = [...plan.operations];
    const results: string[] = [];
    let operationsExecuted = 0;
    const recoveryAttempts = new Map<string, number>(); // Track recovery attempts per operation

    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift()!;
      
      this.logger.logEngineEvent('file_operation_executing', { 
        operation_id: operation.id,
        operation: operation.operation,
        parameters: operation.parameters
      });

      operation.status = 'processing';

      try {
        // Execute the file operation via LocalMCP
        const toolResult = await this.localMCP.executeTool({
          id: operation.id,
          name: operation.operation,
          parameters: operation.parameters
        });

        if (toolResult.success) {
          operation.status = 'completed';
          operation.result = toolResult.output;
          results.push(toolResult.output);
          operationsExecuted++;

          // Check if we need recursive refinement based on result
          await this.considerRecursiveRefinement(operation, toolResult, plan.goal, plan);
        } else {
          operation.status = 'failed';
          operation.error = toolResult.error;
          
          // Check recovery attempt limit to prevent infinite loops
          const attemptCount = recoveryAttempts.get(operation.id) || 0;
          if (attemptCount >= this.MAX_RECOVERY_ATTEMPTS) {
            this.logger.logEngineEvent('file_operations_max_recovery_attempts_reached', {
              operation_id: operation.id,
              attempt_count: attemptCount,
              error: toolResult.error
            });
            
            // Give up on this operation after max attempts
            throw new Error(`Operation ${operation.id} failed after ${attemptCount} recovery attempts: ${toolResult.error}`);
          }
          
          // Increment recovery attempt counter
          recoveryAttempts.set(operation.id, attemptCount + 1);
          
          // Try to recover or suggest alternative approach
          await this.handleOperationFailure(operation, plan.goal);
        }

        this.executionHistory.push(operation);

      } catch (error: any) {
        operation.status = 'failed';
        operation.error = error.message;
        this.executionHistory.push(operation);
        
        // Record error in ErrorContextAgent for learning
        if (this.errorContextAgent) {
          await this.errorContextAgent.recordError(error, 'FileOperationsAgent', {
            operation: operation.operation,
            parameters: operation.parameters,
            operation_id: operation.id
          });
        }
        
        this.logger.logError('file_operation_execution_failed', error);
      }
    }

    // Generate final consolidated output using Gemma
    const consolidatedOutput = await this.consolidateResults(plan.goal, results, this.executionHistory, conversationHistory);

    return {
      success: operationsExecuted > 0,
      output: consolidatedOutput,
      operations_executed: operationsExecuted,
      plan,
      metadata: {
        execution_history: this.executionHistory.map(op => ({
          id: op.id,
          operation: op.operation,
          status: op.status,
          error: op.error
        }))
      }
    };
  }

  /**
   * Consider if we need additional operations based on current result
   */
  private async considerRecursiveRefinement(
    completedOperation: FileOperation,
    result: any,
    originalGoal: string,
    plan: FileOperationPlan
  ): Promise<void> {
    // Use Gemma to determine if we need follow-up operations
    const refinementPrompt = this.buildRefinementPrompt(completedOperation, result, originalGoal, plan.target);
    
    const config = {
      name: 'File Operations Refiner',
      file: '',
      temperature: 0.2,
      context_length: 2048,
      max_tokens: 400
    };

    try {
      // Use direct Ollama call for structured refinement (no personality interpretation needed)
      const requestBody = {
        model: this.personalityProvider['config'].model,
        prompt: refinementPrompt,
        stream: false,
        options: {
          temperature: config.temperature,
          num_ctx: config.context_length,
          num_predict: config.max_tokens,
          stop: ['Human:', 'User:', 'Assistant:', '---']
        }
      };

      const axios = await import('axios');
      const ollamaResponse = await axios.default.post(
        `${this.personalityProvider['config'].base_url}/api/generate`,
        requestBody,
        {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = { content: ollamaResponse.data.response || '' };

      let responseText = '';
      if ('content' in response) {
        responseText = response.content;
      }

      const additionalOperations = this.parseRefinementResponse(responseText);
      
      if (additionalOperations.length > 0) {
        this.logger.logEngineEvent('file_operations_recursive_refinement', {
          additional_operations: additionalOperations.length,
          trigger_operation: completedOperation.id
        });
        
        // Add to front of queue for immediate execution
        this.operationQueue.unshift(...additionalOperations);
      }

    } catch (error: any) {
      this.logger.logError('file_operations_refinement_failed', error);
      // Continue without refinement
    }
  }

  /**
   * Handle operation failures with potential recovery
   */
  private async handleOperationFailure(failedOperation: FileOperation, originalGoal: string): Promise<void> {
    const recoveryAttempt = await this.errorRecoveryAgent.attemptRecovery(failedOperation, originalGoal);

    if (recoveryAttempt.recovery_possible && recoveryAttempt.operations) {
      this.logger.logEngineEvent('file_operations_recovery_attempt', {
        recovery_operations: recoveryAttempt.operations.length,
        failed_operation: failedOperation.id,
      });
      this.operationQueue.unshift(...recoveryAttempt.operations);
    } else {
      this.logger.logEngineEvent('file_operations_recovery_failed', {
        failed_operation: failedOperation.id,
        reason: recoveryAttempt.reasoning,
      });
      // This error will be caught by the main engine and the user will be asked the question.
      throw new Error(recoveryAttempt.user_question);
    }
  }

  /**
   * Consolidate all results into a coherent final output
   */
  private async consolidateResults(
    originalGoal: string,
    results: string[],
    executionHistory: FileOperation[],
    conversationHistory?: any[]
  ): Promise<string> {
    if (results.length === 0) {
      return 'No file operations completed successfully.';
    }

    if (results.length === 1) {
      return results[0];
    }

    // Use Gemma to consolidate multiple results
    const consolidationPrompt = this.buildConsolidationPrompt(originalGoal, results, executionHistory);
    
    const config = {
      name: 'File Operations Consolidator',
      file: '',
      temperature: 0.5,
      context_length: 4096,
      max_tokens: 600
    };

    try {
      // Use selected personality for final consolidation (this is user-facing output)
      const { configManager } = await import('../config/manager.js');
      const currentPersonality = configManager.currentPersonality;
      
      const response = await this.personalityProvider.interpretWithPersonality(
        consolidationPrompt,
        currentPersonality, // Use actual selected personality (e.g., 'ani') for final output
        config,
        originalGoal,
        false,
        conversationHistory
      );

      if ('content' in response) {
        return response.content;
      }

    } catch (error: any) {
      this.logger.logError('file_operations_consolidation_failed', error);
    }

    // Fallback: simple concatenation
    return results.join('\n\n---\n\n');
  }

  // Prompt building methods

  private buildFileOperationPlanningPrompt(request: string, availableTools: string[]): string {
    let errorContext = '';
    
    // Add error context if available
    if (this.errorContextAgent) {
      const recentFailures = this.getRecentFailureContext();
      if (recentFailures.length > 0) {
        errorContext = `\n\nIMPORTANT - Previous failures to avoid:\n${recentFailures.map(f => `- ${f}`).join('\n')}\n`;
      }
    }
    
    return `My job is to plan file operations step by step. I should ALWAYS start with listing the directory to see actual filenames and path.

Available tools: ${availableTools.join(', ')}

User wants: "${request}"${errorContext}

Using filenames from directory listing.

First I'll identify what they're looking for, then create simple steps from this pattern:

{"target": "what the user is specifically looking for"}

{
  "goal": "what we're trying to achieve", 
  "operations": [
    {"id": "step1", "operation": "list_directory", "parameters": {"directory_path": "."}},
    {"id": "step2", "operation": "read_file", "parameters": {"file_path": "readme.md"}},
    {"id": "step3", "operation": "search_content", "parameters": {"pattern": "search term", "path": "."}},
    {"id": "step4", "operation": "find_files", "parameters": {"pattern": "*.md", "path": "."}}
  ]
}

Response:`;
  }

  private buildRefinementPrompt(
    completedOperation: FileOperation,
    result: any,
    originalGoal: string,
    target?: string
  ): string {
    const targetContext = target ? `\n**Target:** ${target}` : '';
    
    return `You are analyzing the result of a file operation to determine if additional operations are needed.

**Original Goal:** ${originalGoal}${targetContext}

**Completed Operation:** ${completedOperation.operation}
**Parameters:** ${JSON.stringify(completedOperation.parameters)}
**Result:** ${JSON.stringify(result).substring(0, 500)}

**Question:** Based on this result, do we need additional file operations to fully achieve the original goal${target ? ` (focusing on: ${target})` : ''}?

Consider:
- Is the result complete or do we need more information?
- Should we process the result further (e.g., filter, format, combine with other data)?
- Are there follow-up operations that would be helpful?

Respond with JSON:
{
  "additional_needed": true/false,
  "operations": [
    // Only if additional_needed is true
    {"id": "follow_up_1", "operation": "tool_name", "parameters": {...}}
  ]
}

Response:`;
  }

  private buildConsolidationPrompt(
    originalGoal: string,
    results: string[],
    executionHistory: FileOperation[]
  ): string {
    return `Consolidate multiple file operation results into a coherent response.

**Original Goal:** ${originalGoal}

**Operations Executed:**
${executionHistory.map(op => `- ${op.operation} (${op.status})`).join('\n')}

**Results to Consolidate:**
${results.map((result, i) => `Result ${i + 1}:\n${result}\n`).join('\n---\n')}

**Task:** Create a single, coherent response that addresses the original goal using all the results. Format it clearly and remove any redundancy.

Response:`;
  }

  // Parsing methods

  private parseFileOperationPlan(response: string, request: string): FileOperationPlan {
    try {
      // Extract all JSON objects - target should be first, plan should be second
      const allJsonObjects = this.extractAllJsonObjects(response);
      let target = request; // fallback to original request
      let planJson = null;
      
      for (const jsonObj of allJsonObjects) {
        try {
          const parsed = JSON.parse(jsonObj);
          
          // First JSON with "target" field
          if (parsed.hasOwnProperty('target') && !planJson) {
            target = parsed.target;
            this.logger.logEngineEvent('file_operations_target_extracted', { target });
          }
          
          // JSON with operations (the actual plan)
          if (parsed.operations && Array.isArray(parsed.operations)) {
            planJson = parsed;
            break;
          }
        } catch (parseError: any) {
          // Continue to next JSON object
        }
      }
      
      if (planJson) {
        return {
          goal: planJson.goal || request,
          target: target, // Add target to the plan
          operations: planJson.operations.map((op: any, index: number) => ({
            id: op.id || `operation_${index + 1}`,
            operation: op.operation,
            parameters: op.parameters || {},
            status: 'pending' as const
          })),
          reasoning: planJson.reasoning || 'Plan generated by Gemma'
        };
      }
    } catch (error: any) {
      this.logger.logError('file_operation_plan_parse_failed', error);
    }

    // Fallback: simple heuristic plan
    return this.generateHeuristicPlan(request);
  }

  private parseRefinementResponse(response: string): FileOperation[] {
    try {
      // Extract all JSON objects from response
      const allJsonObjects = this.extractAllJsonObjects(response);
      const allOperations: FileOperation[] = [];
      
      for (const jsonObj of allJsonObjects) {
        try {
          const parsed = JSON.parse(jsonObj);
          
          if (parsed.additional_needed && parsed.operations) {
            const operations = parsed.operations.map((op: any, index: number) => ({
              id: op.id || `refinement_${allOperations.length + index + 1}`,
              operation: op.operation,
              parameters: op.parameters || {},
              status: 'pending' as const
            }));
            allOperations.push(...operations);
          }
        } catch (parseError: any) {
          this.logger.logError('refinement_json_object_parse_failed', parseError);
          // Continue processing other JSON objects
        }
      }
      
      if (allOperations.length > 0) {
        this.logger.logEngineEvent('refinement_multiple_json_processed', {
          json_objects_found: allJsonObjects.length,
          operations_extracted: allOperations.length
        });
      }
      
      return allOperations;
    } catch (error: any) {
      this.logger.logError('refinement_response_parse_failed', error);
    }

    return [];
  }

  private parseRecoveryResponse(response: string): FileOperation[] {
    try {
      // Extract all JSON objects from response
      const allJsonObjects = this.extractAllJsonObjects(response);
      const allOperations: FileOperation[] = [];
      
      for (const jsonObj of allJsonObjects) {
        try {
          const parsed = JSON.parse(jsonObj);
          
          if (parsed.recovery_possible && parsed.operations) {
            const operations = parsed.operations.map((op: any, index: number) => ({
              id: op.id || `recovery_${allOperations.length + index + 1}`,
              operation: op.operation,
              parameters: op.parameters || {},
              status: 'pending' as const
            }));
            allOperations.push(...operations);
          }
        } catch (parseError: any) {
          this.logger.logError('recovery_json_object_parse_failed', parseError);
          // Continue processing other JSON objects
        }
      }
      
      if (allOperations.length > 0) {
        this.logger.logEngineEvent('recovery_multiple_json_processed', {
          json_objects_found: allJsonObjects.length,
          operations_extracted: allOperations.length
        });
      }
      
      return allOperations;
    } catch (error: any) {
      this.logger.logError('recovery_response_parse_failed', error);
    }

    return [];
  }

  /**
   * Extract all valid JSON objects from a response string
   * Handles multiple JSON objects that Gemma might return
   */
  private extractAllJsonObjects(response: string): string[] {
    const jsonObjects: string[] = [];
    
    // Remove code blocks and markdown formatting
    const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Strategy 1: Find JSON objects with proper bracket matching
    let searchIndex = 0;
    while (searchIndex < cleaned.length) {
      const openBrace = cleaned.indexOf('{', searchIndex);
      if (openBrace === -1) break;
      
      let braceCount = 0;
      let currentIndex = openBrace;
      let inString = false;
      let escapeNext = false;
      
      // Find matching closing brace
      while (currentIndex < cleaned.length) {
        const char = cleaned[currentIndex];
        
        if (escapeNext) {
          escapeNext = false;
        } else if (char === '\\') {
          escapeNext = true;
        } else if (char === '"' && !escapeNext) {
          inString = !inString;
        } else if (!inString) {
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              // Found complete JSON object
              const jsonStr = cleaned.substring(openBrace, currentIndex + 1);
              try {
                JSON.parse(jsonStr); // Validate it's valid JSON
                jsonObjects.push(jsonStr);
              } catch (error) {
                // Invalid JSON, skip it
              }
              break;
            }
          }
        }
        currentIndex++;
      }
      
      searchIndex = currentIndex + 1;
    }
    
    // Strategy 2: Fallback to regex patterns if bracket matching failed
    if (jsonObjects.length === 0) {
      const patterns = [
        /\{[^{}]*"(?:additional_needed|recovery_possible|goal)"[^{}]*\}/g,
        /\{[^{}]*"operations"[^{}]*\}/g,
        /\{[^{}]*\}/g
      ];
      
      for (const pattern of patterns) {
        const matches = cleaned.match(pattern);
        if (matches) {
          for (const match of matches) {
            try {
              JSON.parse(match);
              jsonObjects.push(match);
            } catch (error) {
              // Invalid JSON, skip
            }
          }
          if (jsonObjects.length > 0) break;
        }
      }
    }
    
    return jsonObjects;
  }

  private generateHeuristicPlan(request: string): FileOperationPlan {
    // Simple fallback: list directory first, then let user clarify
    return {
      goal: request,
      target: request,
      operations: [{
        id: 'list_directory',
        operation: 'list_directory',
        parameters: { directory_path: '.' },
        status: 'pending'
      }],
      reasoning: 'Simple fallback plan'
    };
  }

  private getAvailableFileTools(): string[] {
    return [
      'read_file',
      'write_file', 
      'list_directory',
      'create_directory',
      'delete_file',
      'copy_file',
      'move_file',
      'append_to_file',
      'find_file'
    ];
  }
  
  /**
   * Get recent failure context to avoid repeating mistakes
   */
  private getRecentFailureContext(): string[] {
    if (!this.errorContextAgent) return [];
    
    const failures: string[] = [];
    
    // Get failed operations from recent execution history
    const recentFailures = this.executionHistory
      .filter(op => op.status === 'failed' && op.error)
      .slice(-5); // Last 5 failures
    
    for (const failure of recentFailures) {
      if (failure.operation && failure.parameters) {
        const failureDesc = `Operation "${failure.operation}" with parameters ${JSON.stringify(failure.parameters)} failed: ${failure.error}`;
        failures.push(failureDesc);
      }
    }
    
    return failures;
  }

  /**
   * Send file operation activity notification to TUI
   */
  private notifyFileOperationActivity(activity: string) {
    const message = {
      type: 'tool_activity',
      activity: activity,
      tool_name: 'file_operations',
      timestamp: new Date().toISOString()
    };
    
    process.stderr.write(JSON.stringify(message) + '\n');
  }

  /**
   * Send file operation blurb to TUI
   */
  private notifyFileOperationBlurb(content: string) {
    const message = {
      type: 'tool_blurb',
      content: content,
      tool_name: 'file_operations',
      timestamp: new Date().toISOString()
    };
    
    process.stderr.write(JSON.stringify(message) + '\n');
  }
}
