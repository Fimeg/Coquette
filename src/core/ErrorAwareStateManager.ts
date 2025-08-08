/**
 * ErrorAwareStateManager - Handles system errors with Gemma awareness
 * Provides graceful error explanations to users and system state monitoring
 */

import { PersonalityProvider } from './providers/PersonalityProvider.js';
import { DebugLogger } from './DebugLogger.js';
import { ErrorContextAgent } from './agents/ErrorContextAgent.js';

export interface SystemError {
  id: string;
  timestamp: Date;
  error: Error;
  context: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  component: string;
  userVisible: boolean;
}

export interface SystemState {
  status: 'initializing' | 'loading_personality' | 'ready' | 'error' | 'degraded';
  errors: SystemError[];
  components: {
    personality_provider: boolean;
    technical_providers: boolean;
    file_operations: boolean;
    input_router: boolean;
  };
  loading_message?: string;
}

export class ErrorAwareStateManager {
  private personalityProvider?: PersonalityProvider;
  private errorContextAgent?: ErrorContextAgent;
  private logger: DebugLogger;
  private systemState: SystemState;
  private errorHistory: SystemError[] = [];
  private activeMonitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;
  private executionContext: Map<string, any> = new Map();

  constructor() {
    this.logger = DebugLogger.getInstance();
    this.systemState = {
      status: 'initializing',
      errors: [],
      components: {
        personality_provider: false,
        technical_providers: false,
        file_operations: false,
        input_router: false
      },
      loading_message: 'System initializing...'
    };
    
    // Start active monitoring
    this.startActiveMonitoring();
  }

  /**
   * Set the personality provider for error explanations
   */
  setPersonalityProvider(provider: PersonalityProvider): void {
    this.personalityProvider = provider;
    this.updateComponentStatus('personality_provider', true);
    
    // Initialize ErrorContextAgent when personality provider is available
    if (!this.errorContextAgent) {
      this.errorContextAgent = new ErrorContextAgent(this.logger, provider);
      this.errorContextAgent.initialize().catch(error => {
        this.logger.logError('error_context_agent_init_failed', error);
      });
    }
  }

  /**
   * Update system state during initialization phases
   */
  updateState(status: SystemState['status'], message?: string): void {
    this.systemState.status = status;
    this.systemState.loading_message = message;
    
    this.logger.logEngineEvent('system_state_changed', {
      status,
      message,
      components: this.systemState.components
    });

    console.log(`🎭 Coquette: ${message || status}`);
  }

  /**
   * Update individual component status
   */
  updateComponentStatus(component: keyof SystemState['components'], status: boolean): void {
    this.systemState.components[component] = status;
    
    this.logger.logEngineEvent('component_status_changed', {
      component,
      status,
      all_components: this.systemState.components
    });
  }

  /**
   * Handle and explain system errors to users
   */
  async handleError(
    error: Error,
    context: string,
    component: string,
    userMessage?: string
  ): Promise<string> {
    const systemError: SystemError = {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      error,
      context,
      severity: this.classifyErrorSeverity(error, component),
      component,
      userVisible: true
    };

    this.errorHistory.push(systemError);
    this.systemState.errors.push(systemError);
    
    // Update system status based on error severity
    if (systemError.severity === 'critical') {
      this.systemState.status = 'error';
    } else if (systemError.severity === 'high') {
      this.systemState.status = 'degraded';
    }

    this.logger.logError('system_error_handled', {
      error_id: systemError.id,
      severity: systemError.severity,
      component,
      context,
      error_message: error.message
    });

    // Record error in ErrorContextAgent and generate contextual explanation
    if (this.errorContextAgent) {
      const errorId = await this.errorContextAgent.recordError(error, component, { context, userMessage });
      systemError.id = errorId; // Use the ErrorContextAgent's ID
      
      // Check if this is a recurring error
      if (this.errorContextAgent.isRecurringError(error, component)) {
        this.logger.logEngineEvent('recurring_error_detected', {
          error_signature: `${component}:${error.constructor.name}:${error.message}`,
          suggested_solutions: this.errorContextAgent.getSuggestedSolutions(error, component),
          failed_attempts: this.errorContextAgent.getFailedAttempts(error, component)
        });
      }
      
      return await this.errorContextAgent.getErrorExplanation(error, component);
    }

    // Fallback to original explanation if ErrorContextAgent not available
    return await this.generateErrorExplanation(systemError, userMessage);
  }

  /**
   * Record a successful fix attempt for an error
   */
  async recordSuccessfulFix(
    error: Error,
    component: string,
    fixMethod: string,
    description: string,
    notes?: string
  ): Promise<void> {
    if (this.errorContextAgent) {
      const errorSignature = `${component}:${error.constructor.name}:${error.message.replace(/\d+/g, 'N').replace(/['"]/g, '')}`;
      await this.errorContextAgent.recordAttempt(errorSignature, fixMethod, description, 'successful', notes);
      
      this.logger.logEngineEvent('successful_fix_recorded', {
        error_signature: errorSignature,
        fix_method: fixMethod
      });
    }
  }

  /**
   * Record a failed fix attempt for an error
   */
  async recordFailedFix(
    error: Error,
    component: string,
    fixMethod: string,
    description: string,
    notes?: string
  ): Promise<void> {
    if (this.errorContextAgent) {
      const errorSignature = `${component}:${error.constructor.name}:${error.message.replace(/\d+/g, 'N').replace(/['"]/g, '')}`;
      await this.errorContextAgent.recordAttempt(errorSignature, fixMethod, description, 'failed', notes);
      
      this.logger.logEngineEvent('failed_fix_recorded', {
        error_signature: errorSignature,
        fix_method: fixMethod
      });
    }
  }

  /**
   * Generate user-friendly error explanations using Gemma
   */
  private async generateErrorExplanation(
    systemError: SystemError,
    userMessage?: string
  ): Promise<string> {
    if (!this.personalityProvider || !(await this.personalityProvider.isAvailable())) {
      // Fallback if personality provider is not available
      return this.generateBasicErrorExplanation(systemError);
    }

    const errorExplanationPrompt = this.buildErrorExplanationPrompt(systemError, userMessage);
    
    const config = {
      name: 'Error Explainer',
      file: '',
      temperature: 0.6, // Slightly creative for user-friendly explanations
      context_length: 2048,
      max_tokens: 300
    };

    try {
      this.logger.logEngineEvent('generating_error_explanation', {
        error_id: systemError.id,
        using_gemma: true
      });

      const response = await this.personalityProvider.interpretWithPersonality(
        errorExplanationPrompt,
        'error_explainer',
        config,
        userMessage || 'System error occurred',
        false // No streaming for error explanations
      );

      if ('content' in response) {
        return response.content;
      }

    } catch (explanationError: any) {
      this.logger.logError('error_explanation_failed', explanationError);
      // Fall back to basic explanation if Gemma fails
    }

    return this.generateBasicErrorExplanation(systemError);
  }

  /**
   * Start active monitoring of system execution
   */
  private startActiveMonitoring(): void {
    if (this.activeMonitoring) return;
    
    this.activeMonitoring = true;
    this.logger.logEngineEvent('error_aware_monitoring_started', {});
    
    // Monitor every 500ms for issues
    this.monitoringInterval = setInterval(() => {
      this.performActiveCheck();
    }, 500);
  }
  
  /**
   * Stop active monitoring
   */
  private stopActiveMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.activeMonitoring = false;
    this.logger.logEngineEvent('error_aware_monitoring_stopped', {});
  }
  
  /**
   * Perform active system health check
   */
  private performActiveCheck(): void {
    try {
      // Check for stalled executions
      const now = Date.now();
      for (const [contextId, context] of this.executionContext.entries()) {
        if (context.startTime && (now - context.startTime) > context.timeout) {
          this.handleStalledExecution(contextId, context);
        }
      }
      
      // Check for error patterns
      if (this.errorHistory.length > 0) {
        this.detectErrorPatterns();
      }
    } catch (error: any) {
      this.logger.logError('active_monitoring_check_failed', error);
    }
  }
  
  /**
   * Register an execution context for monitoring
   */
  registerExecution(contextId: string, component: string, timeout: number = 120000): void {
    this.executionContext.set(contextId, {
      component,
      startTime: Date.now(),
      timeout,
      status: 'running'
    });
    
    this.logger.logEngineEvent('execution_registered_for_monitoring', {
      contextId,
      component,
      timeout
    });
  }
  
  /**
   * Update execution context
   */
  updateExecution(contextId: string, status: string, metadata?: any): void {
    const context = this.executionContext.get(contextId);
    if (context) {
      context.status = status;
      context.lastUpdate = Date.now();
      if (metadata) {
        context.metadata = metadata;
      }
      
      this.logger.logEngineEvent('execution_context_updated', {
        contextId,
        status,
        metadata
      });
    }
  }
  
  /**
   * Unregister completed execution
   */
  completeExecution(contextId: string, success: boolean = true): void {
    const context = this.executionContext.get(contextId);
    if (context) {
      const duration = Date.now() - context.startTime;
      this.executionContext.delete(contextId);
      
      this.logger.logEngineEvent('execution_completed', {
        contextId,
        component: context.component,
        duration,
        success
      });
    }
  }
  
  /**
   * Handle stalled execution
   */
  private async handleStalledExecution(contextId: string, context: any): Promise<void> {
    this.logger.logEngineEvent('stalled_execution_detected', {
      contextId,
      component: context.component,
      duration: Date.now() - context.startTime
    });
    
    // Attempt proactive intervention
    if (this.errorContextAgent) {
      try {
        const intervention = await this.errorContextAgent.suggestIntervention(
          context.component,
          'stalled_execution',
          `Execution has been running for ${Date.now() - context.startTime}ms`
        );
        
        this.logger.logEngineEvent('proactive_intervention_suggested', {
          contextId,
          intervention
        });
      } catch (error: any) {
        this.logger.logError('intervention_suggestion_failed', error);
      }
    }
    
    // Remove from monitoring to prevent spam
    this.executionContext.delete(contextId);
  }
  
  /**
   * Detect error patterns in recent history
   */
  private detectErrorPatterns(): void {
    const recentErrors = this.errorHistory.slice(-5); // Last 5 errors
    const components = recentErrors.map(e => e.component);
    const patterns = new Map<string, number>();
    
    components.forEach(component => {
      patterns.set(component, (patterns.get(component) || 0) + 1);
    });
    
    // Alert on patterns
    for (const [component, count] of patterns.entries()) {
      if (count >= 3) {
        this.logger.logEngineEvent('error_pattern_detected', {
          component,
          frequency: count,
          pattern: 'repeated_failures'
        });
      }
    }
  }
  
  /**
   * Proactively check system health before operations
   */
  async preExecutionCheck(component: string, operation: string): Promise<{
    canProceed: boolean;
    warnings: string[];
    suggestions: string[];
  }> {
    const warnings: string[] = [];
    const suggestions: string[] = [];
    let canProceed = true;
    
    // Check component health
    if (!this.systemState.components[component as keyof typeof this.systemState.components]) {
      warnings.push(`Component ${component} is not ready`);
      canProceed = false;
    }
    
    // Check recent error history for this component
    const recentComponentErrors = this.errorHistory
      .filter(e => e.component === component)
      .slice(-3);
      
    if (recentComponentErrors.length >= 2) {
      warnings.push(`Recent failures detected in ${component}`);
      suggestions.push('Consider using fallback methods or retry with backoff');
    }
    
    // Use ErrorContextAgent for deeper analysis if available
    if (this.errorContextAgent) {
      try {
        const contextualAdvice = await this.errorContextAgent.getPreExecutionAdvice(
          component,
          operation
        );
        suggestions.push(...contextualAdvice.suggestions);
        warnings.push(...contextualAdvice.warnings);
      } catch (error: any) {
        this.logger.logError('pre_execution_context_check_failed', error);
      }
    }
    
    this.logger.logEngineEvent('pre_execution_check_completed', {
      component,
      operation,
      canProceed,
      warnings: warnings.length,
      suggestions: suggestions.length
    });
    
    return { canProceed, warnings, suggestions };
  }
  
  /**
   * Cleanup and shutdown monitoring
   */
  shutdown(): void {
    this.stopActiveMonitoring();
    this.executionContext.clear();
    this.logger.logEngineEvent('error_aware_state_manager_shutdown', {});
  }
  
  /**
   * Build a prompt for Gemma to explain the error to the user
   */
  private buildErrorExplanationPrompt(systemError: SystemError, userMessage?: string): string {
    const componentDescriptions = {
      personality_provider: 'the personality system (local Gemma model)',
      technical_providers: 'the technical AI providers (Claude, etc.)',
      file_operations: 'the file operations system',
      input_router: 'the intent classification system',
      engine: 'the main coordination engine'
    };

    const componentName = componentDescriptions[systemError.component as keyof typeof componentDescriptions] || systemError.component;

    return `You need to explain a system error to a user in a friendly, helpful way. You are Ani, the technical but playful assistant.

**System Error Details:**
- Component: ${componentName}
- Error: ${systemError.error.message}
- Context: ${systemError.context}
- Severity: ${systemError.severity}
- When: ${systemError.timestamp.toLocaleString()}

**User's Request:** ${userMessage || 'User was trying to use the system'}

**Your Task:**
Explain what went wrong in simple terms, acknowledge the inconvenience, and suggest what the user should do next. Be helpful but don't get too technical. Keep it under 3 sentences.

Examples of good responses:
- "Oops! I'm having trouble loading my personality system right now. Give me a moment to get back on track, or try your request again in a few seconds."
- "Something went wrong with my file operations - it looks like I can't access files properly at the moment. This might be a permissions issue that needs to be fixed."
- "I ran into a technical hiccup while processing your request. Let me try a different approach, or you could rephrase what you're looking for."

Response:`;
  }

  /**
   * Generate basic error explanation when Gemma is not available
   */
  private generateBasicErrorExplanation(systemError: SystemError): string {
    const severityMessages = {
      low: "I encountered a minor issue",
      medium: "I'm having some technical difficulties", 
      high: "I've run into a significant problem",
      critical: "I'm experiencing critical system issues"
    };

    const componentMessages = {
      personality_provider: "with my personality system",
      technical_providers: "with my AI providers",
      file_operations: "with file operations",
      input_router: "with understanding your request",
      engine: "with my core systems"
    };

    const severityMsg = severityMessages[systemError.severity];
    const componentMsg = componentMessages[systemError.component as keyof typeof componentMessages] || "with system operations";

    return `${severityMsg} ${componentMsg}. Error: ${systemError.error.message}. Please try again in a moment, or contact support if this persists.`;
  }

  /**
   * Classify error severity based on error type and component
   */
  private classifyErrorSeverity(error: Error, component: string): SystemError['severity'] {
    const errorMessage = error.message.toLowerCase();
    
    // Critical errors that break core functionality
    if (errorMessage.includes('cannot read properties of undefined') ||
        errorMessage.includes('typeerror') ||
        component === 'engine') {
      return 'critical';
    }

    // High severity - major features broken
    if (component === 'personality_provider' ||
        errorMessage.includes('not available') ||
        errorMessage.includes('failed to initialize')) {
      return 'high';
    }

    // Medium severity - some features affected
    if (component === 'file_operations' ||
        component === 'technical_providers' ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection')) {
      return 'medium';
    }

    // Low severity - minor issues
    return 'low';
  }

  /**
   * Get current system state
   */
  getSystemState(): SystemState {
    return { ...this.systemState };
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 5): SystemError[] {
    return this.errorHistory.slice(-limit);
  }

  /**
   * Clear resolved errors
   */
  clearResolvedErrors(): void {
    this.systemState.errors = [];
    this.logger.logEngineEvent('errors_cleared', {
      cleared_count: this.systemState.errors.length
    });
  }

  /**
   * Generate welcome message based on system state
   */
  async generateWelcomeMessage(): Promise<string> {
    if (this.systemState.status === 'ready') {
      return "🎭 Hi! I'm Ani, and I'm ready to help you with whatever you need.";
    }

    if (this.systemState.status === 'loading_personality') {
      return "🎭 Hi! I'm Ani, and I'm just loading up my personality system. Give me a moment...";
    }

    if (this.systemState.status === 'degraded') {
      const errorCount = this.systemState.errors.length;
      return `🎭 Hi! I'm Ani. I'm running, but I've encountered ${errorCount} issue${errorCount > 1 ? 's' : ''} that might affect some features. I'll do my best to help!`;
    }

    if (this.systemState.status === 'error') {
      return "🎭 Hi! I'm Ani, but I'm having some serious technical difficulties right now. Some features might not work properly.";
    }

    return "🎭 Hi! I'm Ani, and I'm still starting up. Please bear with me...";
  }
}