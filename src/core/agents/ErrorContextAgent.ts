import { DebugLogger } from '../DebugLogger';
import { PersonalityProvider } from '../providers/PersonalityProvider';
import * as fs from 'fs/promises';
import * as path from 'path';

interface ErrorContext {
  id: string;
  timestamp: string;
  error_signature: string;
  error_message: string;
  stack_trace?: string;
  component: string;
  attempts: ErrorAttempt[];
  resolution_status: 'unresolved' | 'resolved' | 'recurring';
  first_occurrence: string;
  last_occurrence: string;
  occurrence_count: number;
}

interface ErrorAttempt {
  timestamp: string;
  attempted_fix: string;
  fix_description: string;
  outcome: 'failed' | 'partial' | 'successful';
  notes?: string;
}

interface ErrorPattern {
  signature: string;
  occurrences: number;
  last_seen: string;
  common_causes: string[];
  effective_solutions: string[];
}

/**
 * ErrorContextAgent - Provides persistent error context and prevents repeated debugging cycles
 * 
 * Key Functions:
 * 1. Tracks error patterns across sessions
 * 2. Maintains history of attempted fixes and their outcomes
 * 3. Provides context-aware error explanations
 * 4. Detects recurring issues and suggests proven solutions
 * 5. Prevents "amnesia" between debugging sessions
 */
export class ErrorContextAgent {
  private logger: DebugLogger;
  private personalityProvider: PersonalityProvider;
  private errorContextPath: string;
  private errorContexts: Map<string, ErrorContext> = new Map();
  private errorPatterns: Map<string, ErrorPattern> = new Map();

  constructor(logger: DebugLogger, personalityProvider: PersonalityProvider) {
    this.logger = logger;
    this.personalityProvider = personalityProvider;
    this.errorContextPath = path.join(process.cwd(), 'debug', 'error_contexts.json');
  }

  /**
   * Initialize the ErrorContextAgent and load existing error contexts
   */
  async initialize(): Promise<void> {
    this.logger.logEngineEvent('error_context_agent_initializing');
    
    try {
      // Check for existing error contexts file
      const contextFileExists = await this.checkErrorContextsFile();
      
      await this.loadErrorContexts();
      await this.analyzeErrorPatterns();
      
      // Log prominent warning if error contexts were loaded
      if (this.errorContexts.size > 0) {
        this.logger.logEngineEvent('error_contexts_WARNING_LOADED', {
          contexts_loaded: this.errorContexts.size,
          patterns_identified: this.errorPatterns.size,
          warning: 'PREVIOUS ERROR CONTEXTS LOADED - MAY CONTAMINATE PROMPTS',
          file_path: this.errorContextPath,
          contexts_summary: Array.from(this.errorContexts.values()).map(ctx => ({
            component: ctx.component,
            error_signature: ctx.error_signature,
            occurrence_count: ctx.occurrence_count,
            last_occurrence: ctx.last_occurrence
          }))
        });
      }
      
      this.logger.logEngineEvent('error_context_agent_initialized', {
        contexts_loaded: this.errorContexts.size,
        patterns_identified: this.errorPatterns.size,
        file_existed: contextFileExists
      });
    } catch (error: any) {
      this.logger.logError('error_context_agent_init_failed', error);
    }
  }

  /**
   * Check if error contexts file exists and has content
   */
  private async checkErrorContextsFile(): Promise<boolean> {
    try {
      const stats = await fs.stat(this.errorContextPath);
      const hasContent = stats.size > 0;
      
      if (hasContent) {
        this.logger.logEngineEvent('error_contexts_file_detected', {
          file_path: this.errorContextPath,
          file_size: stats.size,
          warning: 'Error contexts file exists - may affect behavior'
        });
      }
      
      return hasContent;
    } catch (error) {
      // File doesn't exist - this is fine
      return false;
    }
  }

  /**
   * Clear all error contexts (useful for debugging)
   */
  async clearErrorContexts(): Promise<void> {
    try {
      this.errorContexts.clear();
      this.errorPatterns.clear();
      
      // Remove the file
      try {
        await fs.unlink(this.errorContextPath);
        this.logger.logEngineEvent('error_contexts_cleared', {
          file_path: this.errorContextPath,
          message: 'All error contexts cleared successfully'
        });
      } catch (error) {
        // File might not exist, that's fine
        this.logger.logEngineEvent('error_contexts_cleared', {
          file_path: this.errorContextPath,
          message: 'Error contexts cleared (file did not exist)'
        });
      }
    } catch (error: any) {
      this.logger.logError('error_contexts_clear_failed', error);
      throw error;
    }
  }

  /**
   * Get summary of current error contexts for display
   */
  getErrorContextsSummary(): { count: number; hasContexts: boolean; filePath: string } {
    return {
      count: this.errorContexts.size,
      hasContexts: this.errorContexts.size > 0,
      filePath: this.errorContextPath
    };
  }

  /**
   * Record a new error occurrence with context
   */
  async recordError(
    error: Error,
    component: string,
    additionalContext?: Record<string, any>
  ): Promise<string> {
    const errorSignature = this.generateErrorSignature(error, component);
    const timestamp = new Date().toISOString();
    
    let context = this.errorContexts.get(errorSignature);
    
    if (context) {
      // Update existing error context
      context.last_occurrence = timestamp;
      context.occurrence_count++;
      context.resolution_status = context.resolution_status === 'resolved' ? 'recurring' : 'unresolved';
      
      this.logger.logEngineEvent('error_context_recurring_error', {
        error_signature: errorSignature,
        occurrence_count: context.occurrence_count,
        time_since_last: this.getTimeSince(context.last_occurrence)
      });
    } else {
      // Create new error context
      context = {
        id: this.generateErrorId(),
        timestamp,
        error_signature: errorSignature,
        error_message: error.message,
        stack_trace: error.stack,
        component,
        attempts: [],
        resolution_status: 'unresolved',
        first_occurrence: timestamp,
        last_occurrence: timestamp,
        occurrence_count: 1
      };
      
      this.errorContexts.set(errorSignature, context);
      
      this.logger.logEngineEvent('error_context_new_error', {
        error_signature: errorSignature,
        component
      });
    }

    await this.saveErrorContexts();
    return context.id;
  }

  /**
   * Record an attempted fix for an error
   */
  async recordAttempt(
    errorSignature: string,
    attemptedFix: string,
    description: string,
    outcome: 'failed' | 'partial' | 'successful',
    notes?: string
  ): Promise<void> {
    const context = this.errorContexts.get(errorSignature);
    if (!context) {
      this.logger.logError('error_context_attempt_record_failed', 
        new Error(`No context found for error signature: ${errorSignature}`));
      return;
    }

    const attempt: ErrorAttempt = {
      timestamp: new Date().toISOString(),
      attempted_fix: attemptedFix,
      fix_description: description,
      outcome,
      notes
    };

    context.attempts.push(attempt);
    
    if (outcome === 'successful') {
      context.resolution_status = 'resolved';
    }

    await this.saveErrorContexts();
    await this.updateErrorPatterns(errorSignature, attempt);

    this.logger.logEngineEvent('error_context_attempt_recorded', {
      error_signature: errorSignature,
      attempted_fix: attemptedFix,
      outcome
    });
  }

  /**
   * Get contextual error explanation with previous attempt history
   */
  async getErrorExplanation(error: Error, component: string): Promise<string> {
    const errorSignature = this.generateErrorSignature(error, component);
    const context = this.errorContexts.get(errorSignature);

    if (!context) {
      return await this.generateBasicErrorExplanation(error, component);
    }

    // Build context-aware explanation
    const prompt = this.buildContextualErrorPrompt(error, context);
    
    try {
      const response = await this.personalityProvider.interpretWithPersonality(
        prompt,
        'professional', // Use professional personality for error explanations
        {
          name: 'Professional',
          description: 'Formal technical consultant',
          file: '',
          temperature: 0.5,
          max_tokens: 512,
          context_length: 4096,
          enabled: true
        },
        prompt,
        false, // non-streaming
        []
      );

      return response.content;
    } catch (explanationError: any) {
      this.logger.logError('error_context_explanation_failed', explanationError);
      return this.buildFallbackExplanation(context);
    }
  }

  /**
   * Check if this is a recurring error with known patterns
   */
  isRecurringError(error: Error, component: string): boolean {
    const errorSignature = this.generateErrorSignature(error, component);
    const context = this.errorContexts.get(errorSignature);
    
    return context !== undefined && context.occurrence_count > 1;
  }

  /**
   * Get suggested solutions based on previous successful attempts
   */
  getSuggestedSolutions(error: Error, component: string): string[] {
    const errorSignature = this.generateErrorSignature(error, component);
    const context = this.errorContexts.get(errorSignature);
    
    if (!context) return [];

    const successfulAttempts = context.attempts.filter(a => a.outcome === 'successful');
    return successfulAttempts.map(a => `${a.attempted_fix}: ${a.fix_description}`);
  }

  /**
   * Get failed attempts to avoid repeating them
   */
  getFailedAttempts(error: Error, component: string): string[] {
    const errorSignature = this.generateErrorSignature(error, component);
    const context = this.errorContexts.get(errorSignature);
    
    if (!context) return [];

    const failedAttempts = context.attempts.filter(a => a.outcome === 'failed');
    return failedAttempts.map(a => `${a.attempted_fix}: ${a.fix_description} (${a.notes || 'no notes'})`);
  }

  // Private helper methods

  private generateErrorSignature(error: Error, component: string): string {
    // Create a stable signature for this type of error
    const errorType = error.constructor.name;
    const messageKey = error.message.replace(/\d+/g, 'N').replace(/['"]/g, ''); // Normalize numbers and quotes
    return `${component}:${errorType}:${messageKey}`;
  }

  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async loadErrorContexts(): Promise<void> {
    try {
      const data = await fs.readFile(this.errorContextPath, 'utf-8');
      const contexts = JSON.parse(data);
      
      for (const [signature, context] of Object.entries(contexts)) {
        this.errorContexts.set(signature, context as ErrorContext);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        this.logger.logError('error_context_load_failed', error);
      }
      // File doesn't exist yet, that's okay
    }
  }

  private async saveErrorContexts(): Promise<void> {
    try {
      const contexts = Object.fromEntries(this.errorContexts);
      await fs.writeFile(this.errorContextPath, JSON.stringify(contexts, null, 2));
    } catch (error: any) {
      this.logger.logError('error_context_save_failed', error);
    }
  }

  private async analyzeErrorPatterns(): Promise<void> {
    for (const [signature, context] of this.errorContexts) {
      const successfulFixes = context.attempts
        .filter(a => a.outcome === 'successful')
        .map(a => a.attempted_fix);

      const pattern: ErrorPattern = {
        signature,
        occurrences: context.occurrence_count,
        last_seen: context.last_occurrence,
        common_causes: [], // Could be enhanced with AI analysis
        effective_solutions: successfulFixes
      };

      this.errorPatterns.set(signature, pattern);
    }
  }

  private async updateErrorPatterns(errorSignature: string, attempt: ErrorAttempt): Promise<void> {
    let pattern = this.errorPatterns.get(errorSignature);
    if (!pattern) {
      pattern = {
        signature: errorSignature,
        occurrences: 1,
        last_seen: attempt.timestamp,
        common_causes: [],
        effective_solutions: []
      };
    }

    if (attempt.outcome === 'successful' && !pattern.effective_solutions.includes(attempt.attempted_fix)) {
      pattern.effective_solutions.push(attempt.attempted_fix);
    }

    pattern.last_seen = attempt.timestamp;
    this.errorPatterns.set(errorSignature, pattern);
  }

  private buildContextualErrorPrompt(error: Error, context: ErrorContext): string {
    const failedAttempts = context.attempts.filter(a => a.outcome === 'failed');
    const successfulAttempts = context.attempts.filter(a => a.outcome === 'successful');

    return `Explain this recurring error with context from previous debugging sessions:

**Error**: ${error.message}
**Component**: ${context.component}
**Occurrences**: ${context.occurrence_count} times
**First Seen**: ${context.first_occurrence}
**Last Seen**: ${context.last_occurrence}

**Previous Failed Attempts** (${failedAttempts.length}):
${failedAttempts.map(a => `- ${a.attempted_fix}: ${a.fix_description} (${a.notes || 'failed'})`).join('\n')}

**Previous Successful Fixes** (${successfulAttempts.length}):
${successfulAttempts.map(a => `- ${a.attempted_fix}: ${a.fix_description}`).join('\n')}

**Current Status**: ${context.resolution_status}

Provide a context-aware explanation that:
1. Acknowledges this is a recurring issue
2. References what has been tried before
3. Suggests why previous fixes may have failed
4. Recommends next steps that haven't been attempted yet`;
  }

  private async generateBasicErrorExplanation(error: Error, component: string): Promise<string> {
    const prompt = `Explain this error in a user-friendly way:

**Error**: ${error.message}
**Component**: ${component}
**Stack**: ${error.stack?.split('\n').slice(0, 3).join('\n')}

Provide a clear explanation of what went wrong and potential solutions.`;

    try {
      const response = await this.personalityProvider.interpretWithPersonality(
        prompt,
        'professional',
        {
          name: 'Professional',
          description: 'Formal technical consultant',
          file: '',
          temperature: 0.5,
          max_tokens: 512,
          context_length: 4096,
          enabled: true
        },
        prompt,
        false,
        []
      );
      return response.content;
    } catch (explanationError: any) {
      return `Error in ${component}: ${error.message}. Unable to generate detailed explanation.`;
    }
  }

  private buildFallbackExplanation(context: ErrorContext): string {
    const recentAttempts = context.attempts.slice(-3);
    
    return `Recurring error in ${context.component} (occurred ${context.occurrence_count} times).

Error: ${context.error_message}

Recent attempts:
${recentAttempts.map(a => `- ${a.attempted_fix}: ${a.outcome}`).join('\n')}

This error has been seen before. Check previous debugging sessions for context.`;
  }

  private getTimeSince(timestamp: string): string {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`;
    return `${Math.floor(diffMins / 1440)} days ago`;
  }

  /**
   * Suggest intervention for stalled executions
   */
  async suggestIntervention(component: string, issueType: string, description: string): Promise<string> {
    const prompt = `Suggest intervention for a system issue:

**Component**: ${component}
**Issue Type**: ${issueType}
**Description**: ${description}

Based on the issue type and component, suggest specific actions to resolve this problem.
Provide concrete, actionable steps.`;

    try {
      const response = await this.personalityProvider.interpretWithPersonality(
        prompt,
        'professional',
        {
          name: 'Technical Advisor',
          description: 'System intervention specialist',
          file: '',
          temperature: 0.3,
          max_tokens: 256,
          context_length: 2048,
          enabled: true
        },
        prompt,
        false,
        []
      );
      return response.content;
    } catch (error: any) {
      this.logger.logError('intervention_suggestion_failed', error);
      return `Consider restarting ${component} or checking system resources for ${issueType}`;
    }
  }

  /**
   * Get pre-execution advice for operations
   */
  async getPreExecutionAdvice(component: string, operation: string): Promise<{
    warnings: string[];
    suggestions: string[];
  }> {
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Check historical issues with this component/operation
    for (const [signature, context] of this.errorContexts.entries()) {
      if (context.component === component) {
        const recentFailures = context.attempts.filter(a => 
          a.outcome === 'failed' && 
          Date.now() - new Date(a.timestamp).getTime() < 3600000 // Last hour
        );
        
        if (recentFailures.length > 0) {
          warnings.push(`Recent failures detected in ${component}`);
          suggestions.push('Consider using retry logic or fallback methods');
        }
      }
    }

    // Operation-specific advice
    if (operation.includes('ollama') || operation.includes('model')) {
      suggestions.push('Ensure model is loaded and responsive before proceeding');
    }
    
    if (operation.includes('file') || operation.includes('read') || operation.includes('write')) {
      suggestions.push('Verify file paths are absolute and accessible');
    }

    return { warnings, suggestions };
  }
}