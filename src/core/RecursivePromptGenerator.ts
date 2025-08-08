/**
 * RecursivePromptGenerator - Creates new prompts mid-process for subtask isolation
 * Enables sophisticated multi-step reasoning and task decomposition
 */

import { RecursivePrompt, PromptIntent, ChainOfThoughtState, DesireState, ContextSlice } from './types.js';
import { InputRouter } from './InputRouter.js';
import { ContextManager } from './ContextManager.js';
import { PersonalityProvider } from './providers/PersonalityProvider.js';
import { IntelligenceRouter } from './IntelligenceRouter.js';
import { SubconsciousReasoner } from './SubconsciousReasoner.js';
import { DebugLogger } from './DebugLogger.js';

export interface PromptGenerationContext {
  original_query: string;
  current_response: string;
  conversation_history: any[];
  active_goals: string[];
  chain_of_thought: ChainOfThoughtState;
  desire_state: DesireState;
  available_tools: string[];
  context_window: ContextSlice[];
}

export interface GenerationStrategy {
  name: string;
  description: string;
  trigger_conditions: string[];
  max_depth: number;
  parallel_execution: boolean;
}

export class RecursivePromptGenerator {
  private inputRouter: InputRouter;
  private contextManager: ContextManager;
  private personalityProvider: PersonalityProvider;
  private intelligenceRouter: IntelligenceRouter;
  private subconsciousReasoner: SubconsciousReasoner;
  private logger: DebugLogger;
  private promptTree: Map<string, RecursivePrompt[]> = new Map();
  private executionQueue: RecursivePrompt[] = [];
  private strategies: Map<string, GenerationStrategy> = new Map();

  constructor(
    inputRouter: InputRouter, 
    contextManager: ContextManager, 
    personalityProvider: PersonalityProvider,
    intelligenceRouter?: IntelligenceRouter,
    subconsciousReasoner?: SubconsciousReasoner
  ) {
    this.inputRouter = inputRouter;
    this.contextManager = contextManager;
    this.personalityProvider = personalityProvider;
    this.intelligenceRouter = intelligenceRouter || new IntelligenceRouter(personalityProvider);
    this.subconsciousReasoner = subconsciousReasoner || new SubconsciousReasoner(contextManager);
    this.logger = DebugLogger.getInstance();
    this.loadGenerationStrategies();
  }

  /**
   * Analyze current context and generate recursive prompts if needed
   */
  async generatePrompts(context: PromptGenerationContext): Promise<RecursivePrompt[]> {
    const generatedPrompts: RecursivePrompt[] = [];

    // Analyze for decomposition opportunities
    const decompositionPrompts = await this.analyzeForDecomposition(context);
    generatedPrompts.push(...decompositionPrompts);

    // Analyze for clarification needs
    const clarificationPrompts = await this.analyzeForClarification(context);
    generatedPrompts.push(...clarificationPrompts);

    // Analyze for tool dispatch opportunities
    const toolPrompts = await this.analyzeForToolDispatch(context);
    generatedPrompts.push(...toolPrompts);

    // Analyze for context enrichment needs
    const enrichmentPrompts = await this.analyzeForContextEnrichment(context);
    generatedPrompts.push(...enrichmentPrompts);

    // Apply generation strategies
    for (const strategy of this.strategies.values()) {
      const strategyPrompts = await this.applyGenerationStrategy(strategy, context);
      generatedPrompts.push(...strategyPrompts);
    }

    // Sort by priority and filter by feasibility
    const feasiblePrompts = await this.filterFeasiblePrompts(generatedPrompts, context);
    
    // Add to execution queue
    this.executionQueue.push(...feasiblePrompts);
    
    return feasiblePrompts;
  }

  /**
   * Execute the next prompt in the queue using multi-model intelligence
   */
  async executeNext(): Promise<RecursivePrompt | null> {
    const prompt = this.executionQueue.shift();
    
    if (!prompt) {
      return null;
    }

    this.logger.logEngineEvent('recursive_prompt_execution_start', { 
      prompt_id: prompt.id,
      content: prompt.content,
      priority: prompt.priority 
    });

    prompt.status = 'processing';

    try {
      // Use InputRouter to determine intent
      const intentResult = await this.inputRouter.getIntent(prompt.content);
      
      this.logger.logEngineEvent('recursive_prompt_intent_determined', { 
        prompt_id: prompt.id,
        intent: intentResult.intent,
        summary: intentResult.summary 
      });

      // Use IntelligenceRouter to determine optimal model
      const intelligenceContext = {
        user_input: prompt.content,
        conversation_history: [],
        intent_result: intentResult,
        active_goals: [],
        available_tools: prompt.tool_requirements || [],
        context_summary: prompt.expected_outcome
      };

      const modelSelection = await this.intelligenceRouter.determineOptimalModel(intelligenceContext);

      this.logger.logEngineEvent('recursive_prompt_model_selected', {
        prompt_id: prompt.id,
        selected_model: modelSelection.model,
        reasoning: modelSelection.reasoning,
        confidence: modelSelection.confidence
      });

      let result = '';

      // Execute based on selected model and complexity
      if (modelSelection.model === 'deepseek-r1:8b' || modelSelection.complexity_level === 'high') {
        // Use subconscious reasoning for complex prompts
        result = await this.executeWithSubconsciousReasoning(prompt, intelligenceContext);
      } else if (intentResult.intent === 'task' && prompt.tool_requirements && prompt.tool_requirements.length > 0) {
        // Execute as task with tools
        result = await this.executeTaskPrompt(prompt);
      } else {
        // Execute as conversational prompt via PersonalityProvider
        result = await this.executeChatPrompt(prompt);
      }

      // Store result in context with model information
      if (result) {
        await this.contextManager.addContext(
          result,
          'recursive_prompt_result',
          {
            source: 'recursive_prompt_generator',
            prompt_id: prompt.id,
            model_used: modelSelection.model,
            complexity: modelSelection.complexity_level,
            tags: ['generated_result', 'recursive_prompt', modelSelection.model]
          }
        );
      }

      prompt.status = 'completed';
      prompt.generated_content = result;
      
      this.logger.logEngineEvent('recursive_prompt_execution_complete', { 
        prompt_id: prompt.id,
        result_length: result.length,
        model_used: modelSelection.model
      });
      
      return prompt;
    } catch (error: any) {
      prompt.status = 'failed';
      this.logger.logError('recursive_prompt_execution_failed', error);
      console.warn(`Recursive prompt execution failed: ${error.message}`);
      return prompt;
    }
  }

  /**
   * Execute with subconscious reasoning using DeepSeek R1-8B
   */
  private async executeWithSubconsciousReasoning(prompt: RecursivePrompt, context: any): Promise<string> {
    this.logger.logEngineEvent('recursive_subconscious_reasoning_start', {
      prompt_id: prompt.id,
      content_length: prompt.content.length
    });

    try {
      // Prepare reasoning context
      const reasoningContext = {
        user_request: prompt.content,
        intent_result: context.intent_result,
        conversation_history: context.conversation_history || [],
        available_tools: prompt.tool_requirements || [],
        context_summary: prompt.expected_outcome,
        active_goals: context.active_goals || [],
        user_patterns: {}
      };

      // Perform deep subconscious analysis
      const reasoningResult = await this.subconsciousReasoner.performSubconsciousAnalysis(reasoningContext);

      this.logger.logEngineEvent('recursive_subconscious_reasoning_complete', {
        prompt_id: prompt.id,
        confidence: reasoningResult.confidence_level,
        complexity: reasoningResult.complexity_assessment.level,
        execution_steps: reasoningResult.execution_plan.length
      });

      // Return the reasoning result with acknowledgment
      let result = `${reasoningResult.thinking_summary}\n\nExecution Plan:\n`;
      result += reasoningResult.execution_plan.map((step, index) => 
        `${index + 1}. ${step}`
      ).join('\n');

      if (reasoningResult.expected_challenges.length > 0) {
        result += `\n\nPotential Challenges:\n`;
        result += reasoningResult.expected_challenges.map(challenge => 
          `- ${challenge}`
        ).join('\n');
      }

      if (reasoningResult.generated_content) {
        result += `\n\nDetailed Analysis:\n${reasoningResult.generated_content}`;
      }

      return result;

    } catch (error: any) {
      this.logger.logError('recursive_subconscious_reasoning_failed', error);
      return `Subconscious reasoning failed for: ${prompt.content}. Fallback: ${prompt.expected_outcome}`;
    }
  }

  /**
   * Execute a task-oriented recursive prompt
   */
  private async executeTaskPrompt(prompt: RecursivePrompt): Promise<string> {
    // For now, simulate task execution
    // In full implementation, this would integrate with ToolsAgent
    this.logger.logEngineEvent('recursive_task_prompt_simulated', { 
      prompt_id: prompt.id,
      tool_requirements: prompt.tool_requirements 
    });
    
    return `Task executed: ${prompt.expected_outcome}`;
  }

  /**
   * Execute a conversational recursive prompt via PersonalityProvider
   */
  private async executeChatPrompt(prompt: RecursivePrompt): Promise<string> {
    if (!this.personalityProvider || !(await this.personalityProvider.isAvailable())) {
      return `Simple response to: ${prompt.content}`;
    }

    const config = {
      name: 'Recursive Prompt Handler',
      description: 'Handles recursive prompt processing',
      file: '',
      temperature: 0.7,
      context_length: 2048,
      max_tokens: 400,
      enabled: true
    };

    try {
      const response = await this.personalityProvider.interpretWithPersonality(
        prompt.content,
        'recursive_chat',
        config,
        prompt.content,
        false // no streaming
      );

      if ('content' in response) {
        return response.content;
      }
      
      return `Processed: ${prompt.content}`;
    } catch (error: any) {
      this.logger.logError('recursive_chat_prompt_failed', error);
      return `Failed to process: ${prompt.content}`;
    }
  }

  /**
   * Get all prompts for a given parent or root level
   */
  getPromptTree(parentId?: string): RecursivePrompt[] {
    if (parentId) {
      return this.promptTree.get(parentId) || [];
    }
    
    // Return root-level prompts (no parent)
    return Array.from(this.promptTree.values())
      .flat()
      .filter(prompt => !prompt.parent_id);
  }

  /**
   * Get queue status and statistics
   */
  getQueueStatus() {
    const statusCounts = this.executionQueue.reduce((counts, prompt) => {
      counts[prompt.status] = (counts[prompt.status] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    return {
      total_prompts: this.executionQueue.length,
      status_breakdown: statusCounts,
      next_priority: this.executionQueue[0]?.priority || null,
      estimated_completion: this.estimateCompletionTime()
    };
  }

  // Private methods

  /**
   * Analyze if the current task should be decomposed into subtasks
   */
  private async analyzeForDecomposition(context: PromptGenerationContext): Promise<RecursivePrompt[]> {
    const { original_query, chain_of_thought } = context;
    const prompts: RecursivePrompt[] = [];

    // Check for complex multi-part queries
    if (this.isComplexMultiPartQuery(original_query)) {
      const subtasks = this.extractSubtasks(original_query);
      
      for (const subtask of subtasks) {
        prompts.push(this.createRecursivePrompt(
          subtask,
          'high',
          ['decomposition'],
          `Execute subtask: ${subtask}`
        ));
      }
    }

    // Check for high complexity indicators in chain of thought
    if (chain_of_thought.risk_assessment.complexity_score > 0.7) {
      const simplificationPrompt = this.createRecursivePrompt(
        `Simplify and break down: ${original_query}`,
        'high',
        ['simplification'],
        'Break complex query into manageable steps'
      );
      prompts.push(simplificationPrompt);
    }

    return prompts;
  }

  /**
   * Analyze if clarification is needed before proceeding
   */
  private async analyzeForClarification(context: PromptGenerationContext): Promise<RecursivePrompt[]> {
    const { original_query, current_response } = context;
    const prompts: RecursivePrompt[] = [];

    // Check for ambiguous terms
    const ambiguousTerms = this.detectAmbiguousTerms(original_query);
    
    if (ambiguousTerms.length > 0) {
      for (const term of ambiguousTerms) {
        const clarificationPrompt = this.createRecursivePrompt(
          `Clarify the meaning of "${term}" in the context of: ${original_query}`,
          'medium',
          ['clarification'],
          `Resolve ambiguity for term: ${term}`
        );
        prompts.push(clarificationPrompt);
      }
    }

    // Check for missing context
    if (this.detectsMissingContext(original_query, current_response)) {
      const contextPrompt = this.createRecursivePrompt(
        `Identify what additional context is needed to fully address: ${original_query}`,
        'medium',
        ['context_gathering'],
        'Gather missing context information'
      );
      prompts.push(contextPrompt);
    }

    return prompts;
  }

  /**
   * Analyze if specific tools should be dispatched
   */
  private async analyzeForToolDispatch(context: PromptGenerationContext): Promise<RecursivePrompt[]> {
    const { original_query, available_tools, desire_state } = context;
    const prompts: RecursivePrompt[] = [];

    // Check if file operations are needed
    if (this.requiresFileOperations(original_query)) {
      const filePrompt = this.createRecursivePrompt(
        `Identify and execute file operations needed for: ${original_query}`,
        'high',
        ['file_operations'],
        'Execute required file operations',
        ['filesystem']
      );
      prompts.push(filePrompt);
    }

    // Check if web requests are needed
    if (this.requiresWebRequests(original_query)) {
      const webPrompt = this.createRecursivePrompt(
        `Identify and execute web requests needed for: ${original_query}`,
        'high',
        ['web_requests'],
        'Execute required web requests',
        ['web_client']
      );
      prompts.push(webPrompt);
    }

    // Check if system commands are needed
    if (this.requiresSystemCommands(original_query)) {
      const systemPrompt = this.createRecursivePrompt(
        `Identify and execute system commands needed for: ${original_query}`,
        'high',
        ['system_commands'],
        'Execute required system commands',
        ['shell']
      );
      prompts.push(systemPrompt);
    }

    return prompts;
  }

  /**
   * Analyze if context needs to be enriched with additional information
   */
  private async analyzeForContextEnrichment(context: PromptGenerationContext): Promise<RecursivePrompt[]> {
    const { original_query, context_window } = context;
    const prompts: RecursivePrompt[] = [];

    // Check for references to external knowledge
    if (this.referencesExternalKnowledge(original_query)) {
      const knowledgePrompt = this.createRecursivePrompt(
        `Research and provide context for external references in: ${original_query}`,
        'medium',
        ['knowledge_enrichment'],
        'Enrich context with external knowledge'
      );
      prompts.push(knowledgePrompt);
    }

    // Check if historical context is needed
    if (this.needsHistoricalContext(original_query, context_window)) {
      const historyPrompt = this.createRecursivePrompt(
        `Retrieve and integrate relevant historical context for: ${original_query}`,
        'medium',
        ['historical_context'],
        'Integrate historical context'
      );
      prompts.push(historyPrompt);
    }

    return prompts;
  }

  /**
   * Apply specific generation strategies
   */
  private async applyGenerationStrategy(
    strategy: GenerationStrategy, 
    context: PromptGenerationContext
  ): Promise<RecursivePrompt[]> {
    const prompts: RecursivePrompt[] = [];

    // Check if strategy conditions are met
    const conditionsMet = strategy.trigger_conditions.some(condition => 
      this.evaluateCondition(condition, context)
    );

    if (!conditionsMet) {
      return prompts;
    }

    switch (strategy.name) {
      case 'divide_and_conquer':
        return this.applyDivideAndConquerStrategy(context);
        
      case 'progressive_refinement':
        return this.applyProgressiveRefinementStrategy(context);
        
      case 'parallel_exploration':
        return this.applyParallelExplorationStrategy(context);
        
      case 'error_recovery':
        return this.applyErrorRecoveryStrategy(context);
        
      default:
        return prompts;
    }
  }

  /**
   * Filter prompts based on feasibility and resource constraints
   */
  private async filterFeasiblePrompts(
    prompts: RecursivePrompt[], 
    context: PromptGenerationContext
  ): Promise<RecursivePrompt[]> {
    const feasible: RecursivePrompt[] = [];

    for (const prompt of prompts) {
      // Check resource requirements
      if (prompt.tool_requirements) {
        const hasRequiredTools = prompt.tool_requirements.every(tool => 
          context.available_tools.includes(tool)
        );
        
        if (!hasRequiredTools) {
          continue;
        }
      }

      // Check complexity constraints
      const currentDepth = this.calculatePromptDepth(prompt);
      if (currentDepth > 5) { // Max recursion depth
        continue;
      }

      // Check context requirements
      if (prompt.context_requirements.length > 0) {
        const hasRequiredContext = prompt.context_requirements.every(req =>
          context.context_window.some(slice => slice.metadata.tags.includes(req))
        );
        
        if (!hasRequiredContext) {
          continue;
        }
      }

      feasible.push(prompt);
    }

    // Sort by priority
    return feasible.sort((a, b) => {
      const priorityOrder = { 'urgent': 4, 'high': 3, 'medium': 2, 'low': 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  // Strategy implementations

  private applyDivideAndConquerStrategy(context: PromptGenerationContext): RecursivePrompt[] {
    const { original_query } = context;
    const prompts: RecursivePrompt[] = [];

    // Split complex query into independent parts
    const parts = this.splitIntoIndependentParts(original_query);
    
    for (const part of parts) {
      prompts.push(this.createRecursivePrompt(
        part,
        'high',
        ['divide_and_conquer'],
        `Process independent part: ${part}`
      ));
    }

    return prompts;
  }

  private applyProgressiveRefinementStrategy(context: PromptGenerationContext): RecursivePrompt[] {
    const { original_query, current_response } = context;
    
    const refinementPrompt = this.createRecursivePrompt(
      `Refine and improve the response to: ${original_query}\n\nCurrent response: ${current_response}`,
      'medium',
      ['refinement'],
      'Refine and improve current response'
    );

    return [refinementPrompt];
  }

  private applyParallelExplorationStrategy(context: PromptGenerationContext): RecursivePrompt[] {
    const { original_query } = context;
    const prompts: RecursivePrompt[] = [];

    // Create multiple approaches to the same problem
    const approaches = [
      `Approach 1 - Direct solution: ${original_query}`,
      `Approach 2 - Alternative method: ${original_query}`,
      `Approach 3 - Creative solution: ${original_query}`
    ];

    for (const approach of approaches) {
      prompts.push(this.createRecursivePrompt(
        approach,
        'medium',
        ['parallel_exploration'],
        `Explore alternative approach: ${approach}`
      ));
    }

    return prompts;
  }

  private applyErrorRecoveryStrategy(context: PromptGenerationContext): RecursivePrompt[] {
    const { chain_of_thought } = context;
    
    if (chain_of_thought.risk_assessment.safety_score < 0.5) {
      const recoveryPrompt = this.createRecursivePrompt(
        `Identify and resolve safety concerns in the current approach`,
        'urgent',
        ['error_recovery'],
        'Resolve safety concerns'
      );
      
      return [recoveryPrompt];
    }

    return [];
  }

  // Helper methods

  private createRecursivePrompt(
    content: string,
    priority: RecursivePrompt['priority'],
    contextRequirements: string[],
    expectedOutcome: string,
    toolRequirements?: string[],
    parentId?: string
  ): RecursivePrompt {
    const prompt: RecursivePrompt = {
      id: this.generatePromptId(),
      parent_id: parentId,
      content,
      intent: {
        type: 'technical', // Default, would be determined by analysis
        confidence: 0.8,
        keywords_matched: [],
        context_hints: contextRequirements
      },
      generated_at: new Date(),
      priority,
      context_requirements: contextRequirements,
      tool_requirements: toolRequirements,
      expected_outcome: expectedOutcome,
      status: 'pending'
    };

    // Add to prompt tree
    if (parentId) {
      if (!this.promptTree.has(parentId)) {
        this.promptTree.set(parentId, []);
      }
      this.promptTree.get(parentId)!.push(prompt);
    }

    return prompt;
  }

  private generatePromptId(): string {
    return `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private isComplexMultiPartQuery(query: string): boolean {
    const multiPartIndicators = [
      /\band\b/gi,
      /\balso\b/gi,
      /\bplus\b/gi,
      /\badditionaily\b/gi,
      /\bthen\b/gi,
      /\bafter that\b/gi,
      /\d+\./g // numbered lists
    ];

    return multiPartIndicators.some(indicator => indicator.test(query));
  }

  private extractSubtasks(query: string): string[] {
    // Simple extraction - would be enhanced with NLP
    const sentences = query.split(/[.!?]+/).filter(s => s.trim().length > 10);
    return sentences.length > 1 ? sentences : [query];
  }

  private detectAmbiguousTerms(query: string): string[] {
    const ambiguousWords = ['it', 'this', 'that', 'they', 'them', 'there', 'here'];
    const words = query.toLowerCase().split(/\s+/);
    return words.filter(word => ambiguousWords.includes(word));
  }

  private detectsMissingContext(query: string, response: string): boolean {
    const missingContextIndicators = [
      'need more information',
      'could you clarify',
      'not sure what you mean',
      'ambiguous',
      'unclear'
    ];

    return missingContextIndicators.some(indicator => 
      response.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  private requiresFileOperations(query: string): boolean {
    return /\b(file|directory|folder|read|write|create|delete|edit|save)\b/i.test(query);
  }

  private requiresWebRequests(query: string): boolean {
    return /\b(fetch|download|api|url|http|website|web|search online)\b/i.test(query);
  }

  private requiresSystemCommands(query: string): boolean {
    return /\b(run|execute|command|terminal|shell|install|system)\b/i.test(query);
  }

  private referencesExternalKnowledge(query: string): boolean {
    return /\b(according to|research|studies show|experts say|latest|current)\b/i.test(query);
  }

  private needsHistoricalContext(query: string, contextWindow: ContextSlice[]): boolean {
    return /\b(previously|earlier|before|last time|history)\b/i.test(query) && 
           contextWindow.length > 5;
  }

  private evaluateCondition(condition: string, context: PromptGenerationContext): boolean {
    switch (condition) {
      case 'complex_query':
        return context.chain_of_thought.risk_assessment.complexity_score > 0.7;
      case 'multiple_goals':
        return context.active_goals.length > 1;
      case 'low_confidence':
        return context.chain_of_thought.confidence_level < 0.6;
      case 'tool_available':
        return context.available_tools.length > 0;
      default:
        return false;
    }
  }

  private splitIntoIndependentParts(query: string): string[] {
    // Enhanced splitting logic would go here
    return query.split(/\band\b/i).map(part => part.trim()).filter(part => part.length > 0);
  }

  private calculatePromptDepth(prompt: RecursivePrompt): number {
    let depth = 0;
    let currentPrompt = prompt;

    while (currentPrompt.parent_id) {
      depth++;
      const parentPrompts = Array.from(this.promptTree.values()).flat();
      currentPrompt = parentPrompts.find(p => p.id === currentPrompt.parent_id)!;
      
      if (!currentPrompt || depth > 10) break; // Prevent infinite loops
    }

    return depth;
  }

  private estimateCompletionTime(): Date {
    // Simple estimation - would be more sophisticated in practice
    const avgTimePerPrompt = 30000; // 30 seconds
    const totalTime = this.executionQueue.length * avgTimePerPrompt;
    
    return new Date(Date.now() + totalTime);
  }

  private loadGenerationStrategies(): void {
    const strategies: GenerationStrategy[] = [
      {
        name: 'divide_and_conquer',
        description: 'Split complex tasks into smaller, manageable parts',
        trigger_conditions: ['complex_query', 'multiple_goals'],
        max_depth: 3,
        parallel_execution: true
      },
      {
        name: 'progressive_refinement',
        description: 'Iteratively improve responses through multiple passes',
        trigger_conditions: ['low_confidence'],
        max_depth: 2,
        parallel_execution: false
      },
      {
        name: 'parallel_exploration',
        description: 'Explore multiple solution approaches simultaneously',
        trigger_conditions: ['complex_query', 'tool_available'],
        max_depth: 2,
        parallel_execution: true
      },
      {
        name: 'error_recovery',
        description: 'Handle and recover from errors or unsafe operations',
        trigger_conditions: ['low_confidence'],
        max_depth: 1,
        parallel_execution: false
      }
    ];

    for (const strategy of strategies) {
      this.strategies.set(strategy.name, strategy);
    }
  }
}