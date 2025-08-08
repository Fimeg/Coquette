/**
 * Coquette Engine - Main orchestration system for hybrid AI architecture
 * Coordinates between technical AI providers and personality interpretation
 */

import { configManager } from './config/manager.js';
import { ClaudeCodeProvider } from './providers/ClaudeCodeProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';
import { PersonalityProvider } from './providers/PersonalityProvider.js';
import { BaseProvider, ChatMessage, StreamChunk, ProviderResponse } from './providers/BaseProvider.js';
import { WireApi } from './config/types.js';
import { CoquetuteMode } from './types.js';
import { InputRouter } from './InputRouter.js';
import { ContextManager } from './ContextManager.js';
import { RecursivePromptGenerator } from './RecursivePromptGenerator.js';
import { IntelligenceRouter } from './IntelligenceRouter.js';
import { SubconsciousReasoner } from './SubconsciousReasoner.js';
import { ToolsAgent } from './agents/ToolsAgent.js';
import { ErrorAwareStateManager } from './ErrorAwareStateManager.js';
import { DebugLogger } from './DebugLogger.js';
import { ToolRegistry } from './tools/tool-registry.js';


export interface CoquetuteResponse {
  content: string;
  metadata: {
    technical_provider: string;
    personality_used: string;
    routing_reason: string;
    technical_metadata?: any;
    personality_metadata?: any;
    processing_time_ms: number;
  };
  timestamp: Date;
}

export interface CoquetuteStreamChunk {
  content: string;
  isComplete: boolean;
  metadata?: {
    source: 'technical' | 'personality';
    thinking?: string;
  };
}

import { Config } from './config/config.js';

export class CoquetuteEngine {
  private technicalProviders: Map<string, BaseProvider> = new Map();
  private personalityProvider?: PersonalityProvider;
  private conversationHistory: ChatMessage[] = [];
  private currentMode: CoquetuteMode;
  private inputRouter!: InputRouter;
  private contextManager: ContextManager;
  private recursivePromptGenerator!: RecursivePromptGenerator;
  private intelligenceRouter!: IntelligenceRouter;
  private subconsciousReasoner!: SubconsciousReasoner;
  private toolsAgent?: ToolsAgent;
  private errorStateManager: ErrorAwareStateManager;
  private toolRegistry!: ToolRegistry;
  private logger: DebugLogger;
  private config: Config; // Add config property

  // TUI system message emission
  private emitSystemMessage(type: string, message: string, metadata?: any): void {
    const systemMessage = {
      type,
      message,
      metadata: metadata || {},
      timestamp: new Date().toISOString()
    };
    process.stderr.write(JSON.stringify(systemMessage) + '\n');
  }

  constructor(config: Config) { // Accept Config in constructor
    this.config = config; // Store config
    this.currentMode = {
      local_only: false,
      with_tools: false,
      streaming: true,
      debug: false,
      personality_only: false,
      approval_mode: 'auto'
    };
    this.contextManager = new ContextManager();
    this.logger = DebugLogger.getInstance();
    this.errorStateManager = new ErrorAwareStateManager();
  }

  async initialize(mode?: CoquetuteMode): Promise<void> {
    try {
      this.errorStateManager.updateState('initializing', 'Starting Coquette system...');
      
      if (mode) {
        this.currentMode = mode;
      }
      
      await configManager.load();
      this.errorStateManager.updateState('loading_personality', 'Loading Ani personality...');
      
      // Emit system message for TUI
      this.emitSystemMessage('engine', 'loading_personality', { message: 'Loading Ani personality...' });
      
      await this.initializeProviders();
    
      // Create InputRouter AFTER PersonalityProvider is initialized
      if (!this.personalityProvider) {
        throw new Error('PersonalityProvider must be initialized before InputRouter');
      }
      
      // Set personality provider in error state manager
      this.errorStateManager.setPersonalityProvider(this.personalityProvider);
      
      this.inputRouter = new InputRouter(this.personalityProvider);
      this.errorStateManager.updateComponentStatus('input_router', true);
      
      // Initialize ToolRegistry using Config's method to register core tools
      this.toolRegistry = await this.config.createToolRegistry();

      // Emit system ready message
      const activeProvider = await configManager.getActiveProvider();
      this.emitSystemMessage('engine', 'system_state_changed', { 
        status: 'ready', 
        message: `🎭 Ani is ready! Provider: ${configManager.currentConfig.model_providers[activeProvider.id]?.name || 'local'}` 
      });
      
      // Initialize multi-model intelligence system
      this.intelligenceRouter = new IntelligenceRouter(this.personalityProvider);
      this.subconsciousReasoner = new SubconsciousReasoner(this.contextManager);
      
      // Initialize RecursivePromptGenerator with multi-model intelligence components
      this.recursivePromptGenerator = new RecursivePromptGenerator(
        this.inputRouter,
        this.contextManager,
        this.personalityProvider,
        this.intelligenceRouter,
        this.subconsciousReasoner
      );
    
    // Initialize agents if tools are enabled
    if (mode?.with_tools) {
      // ToolRegistry already created with core tools registered
      this.toolsAgent = new ToolsAgent(this.toolRegistry);
      this.errorStateManager.updateComponentStatus('tool_registry', true);
      this.errorStateManager.updateComponentStatus('tools_agent', true);
    }

    this.errorStateManager.updateState('ready', 'Ani is ready to help! 🎭');
    
    } catch (error: any) {
      const errorMessage = await this.errorStateManager.handleError(
        error,
        'System initialization failed',
        'engine'
      );
      console.error('🎭 Coquette initialization failed:', errorMessage);
      throw error;
    }
  }


  
  async processMessage(
    userInput: string,
    options: {
      stream?: boolean;
      forceProvider?: string;
      forcePersonality?: boolean;
      mode?: CoquetuteMode;
    } = {}
  ): Promise<CoquetuteResponse | AsyncGenerator<CoquetuteStreamChunk, CoquetuteResponse>> {
    this.logger.logEngineEvent('processMessage_start', { userInput, options });
    
    // Register execution with ErrorAwareStateManager for active monitoring
    const executionId = `processMessage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.errorStateManager.registerExecution(executionId, 'CoquetuteEngine', 120000);
    
    try {
      const startTime = Date.now();
    
    // Update mode if provided
    const effectiveMode = options.mode || this.currentMode;
    
    // Add user message to conversation history and context
    const userMessage: ChatMessage = {
      role: 'user',
      content: userInput,
      timestamp: new Date()
    };
    
    this.conversationHistory.push(userMessage);
    
    // Emit user message immediately for TUI display
    this.emitSystemMessage('user_message_received', userInput, {
      timestamp: userMessage.timestamp.toISOString(),
      immediate_display: true
    });
    
    await this.contextManager.addContext(
      userInput,
      'conversation',
      {
        source: 'user_input',
        tags: ['user_query'],
      }
    );

    // Pre-execution check with ErrorAwareStateManager
    this.errorStateManager.updateExecution(executionId, 'pre_execution_check');
    const preCheck = await this.errorStateManager.preExecutionCheck('CoquetuteEngine', 'processMessage');
    
    if (!preCheck.canProceed) {
      this.logger.logEngineEvent('pre_execution_check_failed', {
        warnings: preCheck.warnings,
        suggestions: preCheck.suggestions
      });
      
      this.errorStateManager.completeExecution(executionId, false);
      throw new Error(`Pre-execution check failed: ${preCheck.warnings.join(', ')}`);
    }
    
    if (preCheck.warnings.length > 0) {
      this.emitSystemMessage('engine', 'warnings_detected', {
        warnings: preCheck.warnings,
        suggestions: preCheck.suggestions
      });
    }
    
    // Use InputRouter for sophisticated routing decision
    this.errorStateManager.updateExecution(executionId, 'routing_input');
    this.emitSystemMessage('engine', 'thinking', { message: 'Routing input...' });
    const routingDecision = await this.inputRouter.routeInput({
      user_input: userInput,
      conversation_history: this.conversationHistory,
      current_mode: effectiveMode,
      active_goals: [],
      recent_failures: [],
      force_provider: options.forceProvider,
      force_personality: options.forcePersonality
    });
    
    this.errorStateManager.updateExecution(executionId, 'processing_message');
    
    if (options.stream) {
      const result = await this.streamProcessMessage(userMessage, routingDecision, startTime, effectiveMode);
      this.errorStateManager.completeExecution(executionId, true);
      return result;
    } else {
      const result = await this.blockingProcessMessage(userMessage, routingDecision, startTime, effectiveMode);
      this.errorStateManager.completeExecution(executionId, true);
      return result;
    }
    } catch (error: any) {
      console.error(`[Engine] processMessage error:`, error);
      this.logger.logError('processMessage', error);
      
      // Complete execution as failed
      this.errorStateManager.completeExecution(executionId, false);
      
      // Generate user-friendly error explanation
      const errorExplanation = await this.errorStateManager.handleError(
        error,
        'Processing user message',
        'engine',
        userInput
      );
      
      // Return error as a response instead of throwing
      return {
        content: errorExplanation,
        metadata: {
          technical_provider: 'none',
          personality_used: 'error_handler', 
          routing_reason: 'System error occurred',
          processing_time_ms: Date.now() - Date.now(),
          error: true
        },
        timestamp: new Date()
      };
    }
  }

  /**
   * Toggle between available providers
   */
  async toggleProvider(): Promise<string> {
    return await configManager.toggleProvider();
  }

  /**
   * Toggle between available personalities  
   */
  async togglePersonality(): Promise<string> {
    return await configManager.togglePersonality();
  }

  /**
   * Get current system status
   */
  async getStatus(): Promise<{
    mode: CoquetuteMode;
    providers: Record<string, { available: boolean; latency_ms?: number }>;
    fallback_chain: { chain: string[]; current: string; statuses: Record<string, string> };
    personality: { current: string; provider_available: boolean };
    conversation_length: number;
    local_tools?: { available: boolean; tool_count: number };
    memory_stats?: any;
  }> {
    const providerStatus: Record<string, { available: boolean; latency_ms?: number }> = {};
    
    // Check all technical providers
    for (const [id, provider] of this.technicalProviders) {
      const health = await provider.healthCheck();
      providerStatus[id] = {
        available: health.available,
        latency_ms: health.latency_ms
      };
    }

    const status: any = {
      mode: this.currentMode,
      providers: providerStatus,
      fallback_chain: configManager.getFallbackChainStatus(),
      personality: {
        current: configManager.currentPersonality,
        provider_available: await this.personalityProvider?.isAvailable() || false
      },
      conversation_length: this.conversationHistory.length
    };

    // Add tool registry status if applicable
    if (this.toolRegistry) {
      const availableTools = this.toolRegistry.getAllTools();
      status.tool_registry = {
        available: true,
        tool_count: availableTools.length
      };
    }

    // Add memory stats
    status.memory_stats = this.contextManager.getMemoryStats();

    return status;
  }

  /**
   * Get welcome message based on current system state
   */
  async getWelcomeMessage(): Promise<string> {
    return await this.errorStateManager.generateWelcomeMessage();
  }

  /**
   * Get current system state for debugging
   */
  getSystemState() {
    return this.errorStateManager.getSystemState();
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get conversation history
   */
  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  // Private methods

  /**
   * Check if user intent is satisfied based on subconscious analysis
   */
  private isIntentSatisfied(
    userRequest: string, 
    toolResultsSummary: string, 
    subconsciousAnalysis: any
  ): boolean {
    const lowerRequest = userRequest.toLowerCase();
    const lowerSummary = toolResultsSummary.toLowerCase();

    // High-confidence analysis suggests satisfaction
    if (subconsciousAnalysis.confidence_level >= 0.8) {
      return true;
    }

    // Check if specific file read requests are satisfied
    if (lowerRequest.includes('read') || lowerRequest.includes('show') || lowerRequest.includes('view')) {
      // If summary contains file content or mentions reading a file
      const hasFileContent = lowerSummary.includes('read') && 
                           (lowerSummary.includes('.md') || 
                            lowerSummary.includes('.txt') || 
                            lowerSummary.includes('.json') ||
                            lowerSummary.includes('content') ||
                            lowerSummary.includes('file'));
      
      if (hasFileContent) {
        return true;
      }
    }

    // Check if directory/listing requests are satisfied
    if (lowerRequest.includes('list') || lowerRequest.includes('directory') || lowerRequest.includes('folder')) {
      const hasDirectoryListing = lowerSummary.includes('directory') || 
                                 lowerSummary.includes('list') ||
                                 lowerSummary.includes('files') ||
                                 lowerSummary.includes('contents');
      if (hasDirectoryListing) {
        return true;
      }
    }

    // Check if the subconscious analysis indicates the true user need is met
    if (subconsciousAnalysis.true_user_need && subconsciousAnalysis.true_user_need.length > 0) {
      const trueNeed = subconsciousAnalysis.true_user_need.toLowerCase();
      // Simple check if the true need contains similar keywords as the summary
      const needWords = trueNeed.split(' ').filter(word => word.length > 3);
      const summaryWords = lowerSummary.split(' ');
      const matchingWords = needWords.filter(word => summaryWords.includes(word));
      
      if (matchingWords.length >= Math.min(2, needWords.length * 0.5)) {
        return true;
      }
    }

    // Low confidence suggests more work needed
    if (subconsciousAnalysis.confidence_level < 0.5) {
      return false;
    }

    // Medium confidence - check if we have substantial content
    return toolResultsSummary.length > 200; // At least some substantial response
  }

  /**
   * Convert execution plan from SubconsciousReasoner to tool steps
   */
  private convertExecutionPlanToToolSteps(executionPlan: string[], requiredTools: string[]): any[] {
    const toolSteps = [];
    
    for (let i = 0; i < executionPlan.length; i++) {
      const step = executionPlan[i];
      const stepLower = step.toLowerCase();
      
      // Map execution steps to tool operations
      if (stepLower.includes('read') && stepLower.includes('file')) {
        // Extract filename if possible
        const fileMatch = step.match(/read\s+([^\s]+)/i);
        if (fileMatch) {
          toolSteps.push({
            id: `additional_step_${i}`,
            tool: 'read_file',
            parameters: { file_path: fileMatch[1] },
            description: `Read ${fileMatch[1]} as suggested by analysis`
          });
        }
      } else if (stepLower.includes('list') || stepLower.includes('directory')) {
        toolSteps.push({
          id: `additional_step_${i}`,
          tool: 'list_directory', 
          parameters: { path: process.cwd() },
          description: 'List directory as suggested by analysis'
        });
      } else if (stepLower.includes('search') || stepLower.includes('find')) {
        // Extract search term if possible
        const searchMatch = step.match(/(?:search|find)\s+([^\s]+)/i);
        if (searchMatch) {
          toolSteps.push({
            id: `additional_step_${i}`,
            tool: 'search_file_content',
            parameters: { pattern: searchMatch[1], path: process.cwd() },
            description: `Search for ${searchMatch[1]} as suggested by analysis`
          });
        }
      }
    }
    
    return toolSteps;
  }

  /**
   * Execute additional tool steps based on recursive analysis
   */
  private async executeAdditionalToolSteps(steps: any[]): Promise<any> {
    if (steps.length === 0) {
      return {
        success: true,
        summary: 'No additional steps to execute',
        details: '',
        stepsExecuted: 0,
        executionTime: 0
      };
    }

    const results = [];
    let totalExecutionTime = 0;
    const startTime = Date.now();

    for (const step of steps) {
      try {
        this.logger.logEngineEvent('executing_additional_step', { step });
        
        const tool = this.toolRegistry.getTool(step.tool);
        if (tool) {
          const result = await tool.execute(step.parameters, new AbortController().signal);
          results.push({
            step,
            result,
            success: result.success
          });
        } else {
          results.push({
            step,
            result: { success: false, error: `Tool ${step.tool} not found` },
            success: false
          });
        }
      } catch (error: any) {
        results.push({
          step,
          result: { success: false, error: error.message },
          success: false
        });
      }
    }

    totalExecutionTime = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;

    // Create summary of additional results
    let summary = `Executed ${successCount}/${results.length} additional steps successfully.`;
    for (const result of results.filter(r => r.success)) {
      if (result.result.output && result.result.output.length > 0) {
        const preview = result.result.output.length > 200 
          ? result.result.output.substring(0, 200) + '...' 
          : result.result.output;
        summary += `\n\n${result.step.description}: ${preview}`;
      }
    }

    return {
      success: successCount > 0,
      summary,
      details: results.map(r => `${r.success ? '✅' : '❌'} ${r.step.description}`).join('\n'),
      stepsExecuted: results.length,
      executionTime: totalExecutionTime,
      metadata: { additional_results: results }
    };
  }

  /**
   * Merge tool results from initial execution and additional steps
   */
  private mergeToolResults(initial: any, additional: any): any {
    return {
      success: initial.success || additional.success,
      summary: `${initial.summary}\n\nAdditional Analysis:\n${additional.summary}`,
      details: `${initial.details}\n\nAdditional Steps:\n${additional.details}`,
      stepsExecuted: initial.stepsExecuted + additional.stepsExecuted,
      executionTime: initial.executionTime + additional.executionTime,
      metadata: {
        ...initial.metadata,
        additional_metadata: additional.metadata,
        recursive_enhancement: true
      }
    };
  }

  /**
   * Extract tool requests from user input
   */
  private extractToolCallsFromResponse(response: string): any[] {
    const toolCalls = [];
    
    // Extract JSON from response using MCP-CLI pattern
    const jsonPattern = /```(?:json|tool_code)\n(.*?)```|({[^{}]*(?:{[^{}]*}[^{}]*)*})|({.*?})/gs;
    const matches = response.match(jsonPattern);
    
    if (matches) {
      for (const match of matches) {
        try {
          // Clean up the match
          const cleanMatch = match
            .replace(/```(?:json|tool_code)\n?/g, '')
            .replace(/```/g, '')
            .trim();
          
          const parsed = JSON.parse(cleanMatch);
          
          // Validate MCP-CLI format: {"tool": "name", "args": {...}}
          if (parsed.tool && typeof parsed.tool === 'string') {
            toolCalls.push({
              id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              name: parsed.tool,
              parameters: parsed.args || {}
            });
          }
        } catch (e) {
          // Ignore invalid JSON
          continue;
        }
      }
    }
    
    return toolCalls;
  }

  private truncateForPersonality(text: string, maxChars: number = 2000): string {
    if (text.length <= maxChars) {
      return text;
    }
    // Take the LAST maxChars characters, which is more likely to contain the result.
    return '... [truncated] ' + text.substring(text.length - maxChars);
  }

  private async initializeProviders(): Promise<void> {
    // Skip technical providers in local-only mode
    if (this.currentMode.local_only) {
      this.technicalProviders.clear();
    } else {
      const config = configManager.currentConfig;
      const { id: activeProviderId } = await configManager.getActiveProvider();
      
      // Initialize only the active technical provider
      this.technicalProviders.clear();
      
      const providerConfig = config.model_providers[activeProviderId];

      if (providerConfig && providerConfig.enabled) {
        let provider: BaseProvider | undefined;
        
        switch (providerConfig.wire_api) {
          case WireApi.CLAUDE_CODE:
            provider = new ClaudeCodeProvider(activeProviderId, providerConfig);
            break;
          case WireApi.GEMINI_API:
            provider = new GeminiProvider(activeProviderId, providerConfig);
            break;
          case WireApi.OLLAMA_TOOLS:
            // TODO: Replace with new ToolsAgent integration
            console.warn(`OLLAMA_TOOLS provider ${activeProviderId} temporarily disabled during architecture update`);
            break;
          // Add other providers as needed
          default:
            console.warn(`Unsupported wire API: ${providerConfig.wire_api} for provider ${activeProviderId}`);
        }

        if (provider) {
            this.technicalProviders.set(activeProviderId, provider);
        }
      }
    }

    // Initialize personality provider (always available)
    const config = configManager.currentConfig;
    if (config.personality_provider.enabled) {
      this.personalityProvider = new PersonalityProvider(config.personality_provider);
    }
  }


  private async blockingProcessMessage(
    userMessage: ChatMessage,
    routing: any,
    startTime: number,
    mode: CoquetuteMode
  ): Promise<CoquetuteResponse> {
    let technicalResponse: ProviderResponse | null = null;
    let technicalProvider = '';

    // Handle technical AI processing (skip if in local-only mode)
    if (routing.use_technical && !mode.local_only) {
      console.log('[CoquetuteEngine] Processing technical AI request...');
      this.emitSystemMessage('tool_activity', 'processing technical request', { tool_name: 'provider' });
      
      try {
        const { id, info } = await configManager.getActiveProvider();
        console.log('[CoquetuteEngine] Active provider:', id);
        const provider = this.technicalProviders.get(id);
        console.log('[CoquetuteEngine] Provider found:', !!provider);
        
        if (!provider) {
          throw new Error(`Provider ${id} not available`);
        }

        technicalProvider = id;
        console.log('[CoquetuteEngine] Calling provider.sendMessage...');
        technicalResponse = await provider.sendMessage(this.conversationHistory);
        console.log('[CoquetuteEngine] Provider response received, length:', technicalResponse.content.length);
      } catch (error: any) {
        console.warn(`Technical AI failed: ${error.message}`);
        configManager.markProviderUnavailable(routing.provider_id, 'error');
        
        // Fallback to personality-only response
        routing.use_technical = false;
        routing.reasoning += ` (fallback due to technical AI failure)`;
      }
    } else if (mode.local_only && mode.with_tools && this.toolsAgent) {
      // Handle local tool execution with ToolsAgent and multi-model intelligence
      try {
        this.emitSystemMessage('tool_activity', 'planning', { tool_name: 'ToolsAgent', message: 'Planning the next steps...' });
        
        // Use IntelligenceRouter to determine if we need subconscious reasoning
        const intelligenceContext = {
          user_input: userMessage.content,
          conversation_history: this.conversationHistory,
          intent_result: { intent: 'task' }, // We know this is a task if tools are involved
          active_goals: [],
          available_tools: this.toolRegistry.getAllTools().map(t => t.name),
          context_summary: 'Tool execution request'
        };
        
        const modelSelection = await this.intelligenceRouter.determineOptimalModel(intelligenceContext);
        this.logger.logEngineEvent('tool_intelligence_routing', {
          selected_model: modelSelection.model,
          reasoning: modelSelection.reasoning,
          complexity: modelSelection.complexity_level
        });
        
        // RECURSIVE VALIDATION LOOP: Execute tools and validate intent satisfaction
        let toolResults = await this.toolsAgent.executeTools(userMessage.content);
        
        // Recursive validation loop to ensure user intent is satisfied
        for (let iteration = 0; iteration < 3; iteration++) {
          this.logger.logEngineEvent('recursive_validation_iteration', { 
            iteration, 
            userRequest: userMessage.content,
            currentResultSuccess: toolResults.success,
            summaryLength: toolResults.summary.length
          });

          // Use SubconsciousReasoner to validate if user intent is satisfied
          const validation = await this.subconsciousReasoner.performSubconsciousAnalysis({
            user_request: userMessage.content,
            intent_result: { intent: 'task' },
            conversation_history: this.conversationHistory,
            available_tools: this.toolRegistry.getAllTools().map(t => t.name),
            context_summary: toolResults.summary,
            active_goals: [],
            user_patterns: {}
          });

          this.logger.logEngineEvent('recursive_validation_analysis', {
            iteration,
            confidence: validation.confidence_level,
            trueUserNeed: validation.true_user_need,
            executionPlanSteps: validation.execution_plan.length,
            satisfied: this.isIntentSatisfied(userMessage.content, toolResults.summary, validation)
          });

          // Check if user intent is satisfied based on subconscious analysis
          const intentSatisfied = this.isIntentSatisfied(userMessage.content, toolResults.summary, validation);
          
          if (intentSatisfied) {
            this.logger.logEngineEvent('recursive_validation_satisfied', { 
              iteration, 
              finalConfidence: validation.confidence_level 
            });
            break; // User intent is satisfied, exit the loop
          }

          // If not satisfied and we have more execution steps suggested, execute them
          if (validation.execution_plan.length > 0 && iteration < 2) {
            this.emitSystemMessage('tool_activity', 'refining', { 
              tool_name: 'ToolsAgent', 
              message: `Refining approach based on analysis (iteration ${iteration + 1})` 
            });

            // Execute additional steps based on subconscious reasoning
            const additionalSteps = this.convertExecutionPlanToToolSteps(validation.execution_plan, validation.required_tools);
            const additionalResults = await this.executeAdditionalToolSteps(additionalSteps);
            
            // Merge results
            toolResults = this.mergeToolResults(toolResults, additionalResults);
          } else {
            // No more steps to execute or max iterations reached
            break;
          }
        }
        
        // Always process tool results if they succeed, regardless of complexity
        if (toolResults.success) {
          let enhancedContent = toolResults.summary;
          
          // Try to enhance with subconscious reasoning if complexity is high
          if (modelSelection.complexity_level === 'high') {
            try {
              this.emitSystemMessage('tool_activity', 'Analyzing tool results...', { 
                tool_name: 'SubconsciousReasoner', 
                activity: 'Analyzing tool results...' 
              });
              
              const promptContext = {
                original_query: userMessage.content,
                current_response: toolResults.summary,
                conversation_history: this.conversationHistory,
                active_goals: [],
                chain_of_thought: { 
                  current_reasoning: [],
                  confidence_level: 0.8,
                  alternative_approaches: [],
                  risk_assessment: {
                    safety_score: 0.9,
                    complexity_score: 0.5,
                    resource_requirements: []
                  }
                },
                desire_state: { 
                  primary_goals: [],
                  active_objectives: [],
                  completion_criteria: {},
                  priority_weights: {},
                  estimated_completion: {}
                },
                available_tools: toolResults.metadata?.plan?.steps?.map((s: any) => s.tool) || [],
                context_window: []
              };
              
              const recursivePrompts = await this.recursivePromptGenerator.generatePrompts(promptContext);
              
              // Execute recursive prompts for deeper analysis
              if (recursivePrompts.length > 0) {
                this.emitSystemMessage('tool_activity', 'reasoning', { 
                  tool_name: 'SubconsciousReasoner', 
                  activity: 'Performing deep analysis...' 
                });
                // Process the most relevant recursive prompt
                const mainPrompt = recursivePrompts[0];
                const deepAnalysis = await this.recursivePromptGenerator.executeNext();
                if (deepAnalysis) {
                  enhancedContent = `${toolResults.summary}\n\nDeep Analysis: ${deepAnalysis.generated_content || ''}`;
                }
              }
            } catch (error: any) {
              // If recursive enhancement fails, use basic tool results
              console.warn(`Recursive enhancement failed: ${error.message}`);
              enhancedContent = toolResults.summary;
            }
          }
          
          technicalResponse = {
            content: enhancedContent,
            metadata: { 
              ...toolResults.metadata, 
              recursive_analysis: modelSelection.complexity_level === 'high',
              tool_results_included: true
            }
          };
          technicalProvider = 'tools_agent_with_results';
        } else {
          // Fallback to personality-only response
          routing.use_technical = false;
        }
      } catch (error: any) {
        console.warn(`ToolsAgent execution failed: ${error.message}`);
        // Fallback to personality-only response
        routing.use_technical = false;
      }
    }

    // Get personality interpretation
    let finalContent: string;
    let personalityMetadata: any = {};

    if (technicalResponse && this.personalityProvider) {
      // Skip personality interpretation if this is already an acknowledgment from personality
      if (technicalResponse.metadata?.source === 'file_operations_acknowledgment') {
        finalContent = technicalResponse.content;
        personalityMetadata = technicalResponse.metadata;
      } else {
        const personalityConfig = configManager.getCurrentPersonalityConfig();
        
        // Emit system message for personality interpretation
        this.emitSystemMessage('engine', 'personalizing', { message: 'Personalizing response...' });
        
        try {
          const truncatedContent = this.truncateForPersonality(technicalResponse.content);
          
          // Add retry logic for personality interpretation (like InputRouter)
          let personalityResponse;
          let lastError;
          const maxRetries = 3;
          
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              this.logger.logEngineEvent('personality_interpretation_attempt', {
                attempt,
                maxRetries,
                content_length: truncatedContent.length,
                model: this.personalityProvider.config?.model || 'unknown'
              });
              
              personalityResponse = await this.personalityProvider.interpretWithPersonality(
                truncatedContent,
                configManager.currentPersonality,
                personalityConfig,
                userMessage.content,
                false,
                this.conversationHistory
              );
              
              this.logger.logEngineEvent('personality_interpretation_success', { attempt });
              break; // Success, exit retry loop
              
            } catch (error: any) {
              lastError = error;
              this.logger.logEngineEvent('personality_interpretation_retry', {
                attempt,
                error: error.message,
                statusCode: error.response?.status
              });
              
              if (attempt < maxRetries) {
                // Brief pause between attempts
                this.logger.logEngineEvent('personality_interpretation_delay', { nextAttempt: attempt + 1 });
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          }
          
          if (!personalityResponse) {
            throw new Error(`Personality interpretation failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
          }

          if ('content' in personalityResponse) {
            finalContent = personalityResponse.content;
            personalityMetadata = personalityResponse.metadata;
          } else {
            throw new Error('Unexpected personality response format');
          }
        } catch (error: any) {
          console.warn(`Personality interpretation failed: ${error.message}`);
          
          // Enhanced error recovery using ErrorAwareStateManager
          const errorExplanation = await this.errorStateManager.handleError(
            error,
            'Personality interpretation failed',
            'personality_provider',
            userMessage.content
          );
          
          // Fallback to raw technical response with error context
          finalContent = `${technicalResponse.content}\n\n[Note: Personality interpretation encountered an issue: ${errorExplanation}]`;
          routing.reasoning += ` (personality interpretation failed after ${3} attempts - using fallback)`;
        }
      }
    } else if (this.personalityProvider) {
      // Direct personality response (no technical AI)
      const personalityConfig = configManager.getCurrentPersonalityConfig();
      
      const personalityResponse = await this.personalityProvider.interpretWithPersonality(
        userMessage.content, // Use user input directly for personality-only responses
        configManager.currentPersonality,
        personalityConfig,
        userMessage.content,
        false,
        this.conversationHistory
      );

      if ('content' in personalityResponse) {
        finalContent = personalityResponse.content;
        personalityMetadata = personalityResponse.metadata;
      } else {
        throw new Error('Unexpected personality response format');
      }
    } else {
      // No personality provider - use technical response or generic fallback
      finalContent = technicalResponse?.content || 'I apologize, but I am not configured properly to respond.';
    }

    // Add assistant response to conversation history
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: finalContent,
      timestamp: new Date()
    };
    this.conversationHistory.push(assistantMessage);

    const processingTime = Date.now() - startTime;

    return {
      content: finalContent,
      metadata: {
        technical_provider: technicalProvider || 'none',
        personality_used: configManager.currentPersonality,
        routing_reason: routing.reasoning,
        technical_metadata: technicalResponse?.metadata,
        personality_metadata: personalityMetadata,
        processing_time_ms: processingTime
      },
      timestamp: new Date()
    };
  }

  private async* streamProcessMessage(
    userMessage: ChatMessage,
    routing: any,
    startTime: number,
    mode: CoquetuteMode
  ): AsyncGenerator<CoquetuteStreamChunk, CoquetuteResponse> {
    let technicalResponse = '';
    let technicalMetadata: any = {};
    let technicalProvider = '';

    if (routing.use_technical) {
      // Stream technical AI response
      try {
        const { id, info } = await configManager.getActiveProvider();
        const provider = this.technicalProviders.get(id);
        
        if (!provider) {
          throw new Error(`Provider ${id} not available`);
        }

        technicalProvider = id;
        
        // Yield thinking indicator
        yield {
          content: '',
          isComplete: false,
          metadata: {
            source: 'technical',
            thinking: `Getting technical analysis from ${provider.getName()}...`
          }
        };

        const streamGenerator = provider.streamMessage(this.conversationHistory);
        
        for await (const chunk of streamGenerator) {
          technicalResponse += chunk.content;
          yield {
            content: chunk.content,
            isComplete: false,
            metadata: { source: 'technical' }
          };
        }

        // Get final metadata from stream return
        const finalResponse = await streamGenerator.return();
        technicalMetadata = finalResponse?.value?.metadata || {};

      } catch (error: any) {
        console.warn(`Technical AI streaming failed: ${error.message}`);
        configManager.markProviderUnavailable(routing.provider, 'error');
        routing.use_technical = false;
        routing.reason += ` (fallback due to streaming failure)`;
      }
    }

    // Stream personality interpretation
    let finalContent = '';
    let personalityMetadata: any = {};

    if (this.personalityProvider) {
      const personalityConfig = configManager.getCurrentPersonalityConfig();
      
      yield {
        content: '',
        isComplete: false,
        metadata: {
          source: 'personality',
          thinking: `Interpreting through ${personalityConfig.name} personality...`
        }
      };

      try {
        const interpretationInput = this.truncateForPersonality(technicalResponse) || userMessage.content;
        const personalityStream = await this.personalityProvider.interpretWithPersonality(
          interpretationInput,
          configManager.currentPersonality,
          personalityConfig,
          userMessage.content,
          true, // stream mode
          this.conversationHistory
        );

        if (Symbol.asyncIterator in personalityStream) {
          for await (const chunk of personalityStream) {
            finalContent += chunk.content;
            yield {
              content: chunk.content,
              isComplete: chunk.isComplete,
              metadata: { source: 'personality' }
            };
          }

          // Get final metadata
          const finalResponse = await personalityStream.return();
          personalityMetadata = finalResponse?.value?.metadata || {};
        }
      } catch (error: any) {
        console.warn(`Personality streaming failed: ${error.message}`);
        finalContent = technicalResponse || 'I apologize, but I encountered an error processing your request.';
      }
    } else {
      finalContent = technicalResponse || 'No personality provider configured.';
    }

    // Add to conversation history
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: finalContent,
      timestamp: new Date()
    };
    this.conversationHistory.push(assistantMessage);

    const processingTime = Date.now() - startTime;

    return {
      content: finalContent,
      metadata: {
        technical_provider: technicalProvider || 'none',
        personality_used: configManager.currentPersonality,
        routing_reason: routing.reasoning,
        technical_metadata: technicalMetadata,
        personality_metadata: personalityMetadata,
        processing_time_ms: processingTime
      },
      timestamp: new Date()
    };
  }

  
}