/**
 * Input Router - Determines user intent
 * Uses a lightweight Gemma model to classify input as a 'task' or 'chat'.
 */

import { PersonalityProvider } from './providers/PersonalityProvider.js';
import { DebugLogger } from './DebugLogger.js';
import { OllamaRequestQueue } from './OllamaRequestQueue.js';
import { workflowManager, WorkflowPattern } from './WorkflowPatterns.js';

export type Intent = 'task' | 'chat' | 'contextualize';

export interface IntentResult {
  intent: Intent;
  summary: string;
  library_name?: string;
}

export class InputRouter {
  private personalityProvider: PersonalityProvider;
  private logger: DebugLogger;
  private ollamaQueue: OllamaRequestQueue;
  private currentWorkflow: WorkflowPattern | null = null;

  constructor(personalityProvider: PersonalityProvider) {
    this.personalityProvider = personalityProvider;
    this.logger = DebugLogger.getInstance();
    this.ollamaQueue = OllamaRequestQueue.getInstance();
  }

  /**
   * Analyzes the user's input to determine their intent.
   * Uses Software Engineering Workflow for systematic analysis.
   * @param userInput The raw text from the user.
   * @returns A promise that resolves to an IntentResult object.
   */
  async getIntent(userInput: string): Promise<IntentResult> {
    // Initialize software engineering workflow for intent analysis
    this.currentWorkflow = workflowManager.startWorkflow('software_engineering');
    
    this.logger.logEngineEvent('intent_classification_start', { 
      userInput,
      workflow_id: this.currentWorkflow?.name
    });
    const startTime = Date.now();
    
    // Step 1: Understand the user input
    if (this.currentWorkflow) {
      workflowManager.completeStep(this.currentWorkflow, 'understand', {
        user_input: userInput,
        input_length: userInput.length
      });
    }
    
    try {
      // Step 2: Plan the intent classification approach
      if (this.currentWorkflow) {
        workflowManager.completeStep(this.currentWorkflow, 'plan', {
          approach: 'ai_based_classification',
          fallback_available: true
        });
      }
      
      // Check if PersonalityProvider is available
      if (!this.personalityProvider || !(await this.personalityProvider.isAvailable())) {
        this.logger.logEngineEvent('intent_fallback_to_heuristics', { reason: 'personality_provider_unavailable' });
        
        // Mark workflow plan as using fallback
        if (this.currentWorkflow) {
          workflowManager.completeStep(this.currentWorkflow, 'implement', {
            method: 'heuristics_fallback',
            reason: 'personality_provider_unavailable'
          });
          workflowManager.skipStep(this.currentWorkflow, 'verify_tests', 'Heuristics do not require testing');
          workflowManager.skipStep(this.currentWorkflow, 'verify_standards', 'Heuristics do not require standards check');
        }
        
        return this.basicIntentHeuristics(userInput);
      }

      // Create a special lightweight personality config for intent classification
      const intentConfig = {
        name: 'Intent Router',
        file: '', // Not used for custom prompt
        temperature: 0.1,
        context_length: 2048,
        max_tokens: 200
      };

      const intentPrompt = this.buildIntentPrompt(userInput);
      
      this.logger.logEngineEvent('intent_calling_gemma', { 
        prompt_length: intentPrompt.length,
        model: 'via_personality_provider'
      });

      // Use OllamaRequestQueue for intent classification to prevent race conditions
      const queueResult = await this.ollamaQueue.enqueueRequest(
        'gemma3n:e4b',
        intentPrompt,
        {
          temperature: intentConfig.temperature,
          num_ctx: 8192, // Intent classification doesn't need large context
          num_predict: intentConfig.max_tokens,
          num_gpu: 20, // Moderate CPU offload for intent classification
          stop: ['Human:', 'User:', 'Assistant:', '---']
        },
        360000, // 6 minutes timeout
        'InputRouter',
        'high' // High priority for user input routing
      );

      if (!queueResult.success) {
        throw new Error(`Intent classification failed: ${queueResult.error}`);
      }

      // Step 3: Implement AI-based classification
      if (this.currentWorkflow) {
        workflowManager.completeStep(this.currentWorkflow, 'implement', {
          method: 'ai_classification',
          model: 'gemma3n:e4b'
        });
      }
      
      const response = { content: queueResult.data?.response || '' };

      let responseText = '';
      if ('content' in response) {
        responseText = response.content;
      }

      const processingTime = Date.now() - startTime;
      this.logger.logEngineEvent('intent_gemma_response', { 
        responseText, 
        processingTime,
        response_length: responseText.length,
        queue_wait_time: queueResult.queueWaitTime,
        ollama_processing_time: queueResult.processingTime
      });

      const result = this.parseIntentResponse(responseText, userInput);
      
      // Complete workflow verification steps
      if (this.currentWorkflow) {
        workflowManager.completeStep(this.currentWorkflow, 'verify_tests', {
          result_parsed: result.intent !== undefined,
          confidence: result.intent ? 'high' : 'low'
        });
        workflowManager.completeStep(this.currentWorkflow, 'verify_standards', {
          valid_intent: ['task', 'chat', 'contextualize'].includes(result.intent),
          has_summary: !!result.summary
        });
      }
      
      this.logger.logEngineEvent('intent_classification_complete', { 
        result, 
        processingTime,
        method: 'gemma_via_personality_provider',
        workflow: this.currentWorkflow ? workflowManager.getWorkflowStatus(this.currentWorkflow) : null
      });

      return result;
      
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.logError('intent_classification_failed', error);
      console.warn(`Intent classification failed: ${error.message}, falling back to heuristics`);
      
      // Mark workflow as failed and use fallback
      if (this.currentWorkflow) {
        workflowManager.failStep(this.currentWorkflow, 'implement', error.message);
      }
      
      const result = this.basicIntentHeuristics(userInput);
      this.logger.logEngineEvent('intent_classification_complete', { 
        result, 
        processingTime,
        method: 'heuristics_fallback'
      });
      
      return result;
    }
  }

  private buildIntentPrompt(userInput: string): string {
    return `You are a silent, efficient intent router. Analyze the user's request and determine if it is a simple chat message, a task that requires using tools, or a request for information about a specific library.

INTENT CATEGORIES:
- A 'task' involves actions like finding files, reading content, running commands, or searching the web.
- A 'chat' is a conversational query, a question, or a statement.
- A 'contextualize' request is when the user asks for information, documentation, or examples for a specific software library.

RESPONSE FORMAT:
Respond ONLY with a single, minified JSON object with the following structure:
{"intent": "task" | "chat" | "contextualize", "summary": "<brief, one-sentence summary>", "library_name": "<library name if contextualize>"}

EXAMPLES:

Example 1 - Task Intent:
Input: "Hey Ani, can you read the system interconnection map please? I'm also curious what tools you have available?"
Output: {"intent": "task", "summary": "User wants to read system documentation and list available tools", "library_name": null}

Example 2 - Chat Intent:
Input: "How are you feeling today, Ani?"
Output: {"intent": "chat", "summary": "User asking about AI's emotional state in conversational manner", "library_name": null}

Example 3 - Contextualize Intent:
Input: "How do I use axios to make HTTP requests in React?"
Output: {"intent": "contextualize", "summary": "User needs information about using axios library for HTTP requests", "library_name": "axios"}

Example 4 - Task Intent (File Operations):
Input: "Find all TypeScript files in the src directory and show me their exports"
Output: {"intent": "task", "summary": "User wants file system search and code analysis of TypeScript exports", "library_name": null}

Example 5 - Chat Intent (Personal):
Input: "What do you think about the refactoring we did yesterday?"
Output: {"intent": "chat", "summary": "User seeking conversational reflection on previous work", "library_name": null}

Example 6 - Contextualize Intent (Framework):
Input: "Show me examples of Next.js routing"
Output: {"intent": "contextualize", "summary": "User needs documentation and examples for Next.js routing system", "library_name": "Next.js"}

CLASSIFICATION RULES:
- Use "task" if the request involves file operations, system commands, web searches, or tool usage
- Use "chat" for personal questions, opinions, casual conversation, or general inquiries
- Use "contextualize" only when specifically asking about a library, framework, or API documentation
- Keep summaries concise but descriptive
- Set library_name to null unless intent is "contextualize"

User Request: "${userInput}"

Response:`;
  }

  private parseIntentResponse(response: string, userInput: string): IntentResult {
    this.logger.logEngineEvent('intent_parsing_response', { raw_response: response });
    
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[^}]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        if (parsed.intent && (parsed.intent === 'task' || parsed.intent === 'chat' || parsed.intent === 'contextualize')) {
          this.logger.logEngineEvent('intent_parsed_successfully', { parsed });
          return {
            intent: parsed.intent,
            summary: parsed.summary || userInput,
            library_name: parsed.library_name
          };
        }
      }
      
      // Fallback if JSON parsing fails
      this.logger.logEngineEvent('intent_parsing_failed', { reason: 'no_valid_json' });
      return this.basicIntentHeuristics(userInput);
      
    } catch (error: any) {
      this.logger.logError('intent_json_parse_error', error);
      return this.basicIntentHeuristics(userInput);
    }
  }

  private basicIntentHeuristics(userInput: string): IntentResult {
    this.logger.logEngineEvent('intent_using_heuristics', { userInput });
    
    const input = userInput.toLowerCase();

    // Contextualize indicators
    const contextualizeKeywords = ['library', 'documentation', 'docs', 'api', 'sdk'];
    const hasContextualizeKeywords = contextualizeKeywords.some(keyword => input.includes(keyword));
    if (hasContextualizeKeywords) {
      const libraryMatch = input.match(/(?:library|docs for|documentation for|about) ([\w\s-]+)/);
      return {
        intent: 'contextualize',
        summary: userInput,
        library_name: libraryMatch ? libraryMatch[1].trim() : userInput
      };
    }
    
    // Task indicators
    const taskKeywords = [
      'find', 'search', 'look for', 'get', 'fetch', 'download',
      'read', 'open', 'show', 'display', 'list',
      'create', 'make', 'write', 'edit', 'update', 'modify',
      'delete', 'remove', 'install', 'run', 'execute',
      'help me', 'can you', 'please', 'i need',
      'file', 'folder', 'directory', 'command', 'terminal',
      'web', 'website', 'url', 'http'
    ];
    
    const matchedKeywords = taskKeywords.filter(keyword => input.includes(keyword));
    const hasTaskKeywords = matchedKeywords.length > 0;
    
    // Question indicators (usually chat)
    const questionStarters = ['what', 'how', 'why', 'when', 'where', 'who'];
    const isQuestion = input.includes('?') || 
      questionStarters.some(starter => input.startsWith(starter));
    
    // Determine intent
    const intent: Intent = hasTaskKeywords && !isQuestion ? 'task' : 'chat';
    
    const result = {
      intent,
      summary: userInput.length > 100 ? userInput.substring(0, 100) + '...' : userInput
    };

    this.logger.logEngineEvent('intent_heuristics_result', { 
      result, 
      matched_keywords: matchedKeywords,
      is_question: isQuestion,
      has_task_keywords: hasTaskKeywords
    });
    
    return result;
  }

  /**
   * Full routing decision with context awareness
   * Handles conversation history, active goals, and other contextual factors
   */
  async routeInput(context: {
    user_input: string;
    conversation_history: any[];
    current_mode: any;
    active_goals: string[];
    recent_failures: any[];
    force_provider?: string;
    force_personality?: boolean;
  }): Promise<{
    use_technical: boolean;
    use_personality: boolean;
    provider_id: string;
    reasoning: string;
    complexity_score: number;
  }> {
    this.logger.logEngineEvent('input_routing_start', { 
      user_input: context.user_input,
      conversation_length: context.conversation_history.length,
      active_goals: context.active_goals,
      current_mode: context.current_mode 
    });

    const startTime = Date.now();

    // Get basic intent classification
    const intentResult = await this.getIntent(context.user_input);
    
    // Analyze conversation context for routing hints (with better context management)
    const conversationContext = this.analyzeConversationContext(context.conversation_history);
    
    // Check for complexity indicators
    const complexityScore = this.calculateComplexityScore(
      context.user_input,
      context.active_goals,
      conversationContext
    );

    // Determine if technical AI is needed
    let useTechnical = false;
    let reasoning = `Basic intent: ${intentResult.intent}`;

    if (context.force_provider) {
      useTechnical = true;
      reasoning += ` (forced provider: ${context.force_provider})`;
    } else if (intentResult.intent === 'task') {
      useTechnical = true;
      reasoning += ' (task requires technical analysis)';
    } else if (complexityScore > 0.7) {
      useTechnical = true;
      reasoning += ' (high complexity detected)';
    } else if (context.active_goals.length > 0) {
      useTechnical = true;
      reasoning += ' (active goals require technical coordination)';
    } else if (context.current_mode.with_tools) {
      useTechnical = true;
      reasoning += ' (tools mode enabled)';
    }

    // Always use personality unless explicitly disabled
    const usePersonality = !context.current_mode.personality_only_disabled;

    const processingTime = Date.now() - startTime;
    
    const decision = {
      use_technical: useTechnical,
      use_personality: usePersonality,
      provider_id: context.force_provider || 'default',
      reasoning,
      complexity_score: complexityScore
    };

    this.logger.logEngineEvent('input_routing_complete', { 
      decision,
      processing_time: processingTime,
      intent_result: intentResult
    });

    return decision;
  }

  /**
   * Analyze conversation history for routing context
   */
  private analyzeConversationContext(history: any[]): {
    recent_topics: string[];
    interaction_pattern: string;
    context_continuity: number;
  } {
    if (!history || history.length === 0) {
      return {
        recent_topics: [],
        interaction_pattern: 'new_conversation',
        context_continuity: 0
      };
    }

    // Analyze recent messages for topics and patterns
    const recentMessages = history.slice(-5);
    const topics = recentMessages
      .map(msg => msg.content || '')
      .join(' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 4);

    // Determine interaction pattern
    let pattern = 'mixed';
    if (recentMessages.length >= 3) {
      const hasQuestions = recentMessages.some(msg => (msg.content || '').includes('?'));
      const hasCommands = recentMessages.some(msg => 
        /\b(find|create|run|execute|show|list)\b/i.test(msg.content || '')
      );
      
      if (hasCommands && !hasQuestions) pattern = 'task_focused';
      else if (hasQuestions && !hasCommands) pattern = 'conversational';
    }

    // Calculate context continuity (0-1)
    const continuity = Math.min(history.length / 10, 1);

    return {
      recent_topics: [...new Set(topics)].slice(0, 5),
      interaction_pattern: pattern,
      context_continuity: continuity
    };
  }

  /**
   * Calculate complexity score based on multiple factors
   */
  private calculateComplexityScore(
    userInput: string,
    activeGoals: string[],
    conversationContext: any
  ): number {
    let score = 0;

    // Input complexity
    const inputLength = userInput.length;
    if (inputLength > 200) score += 0.2;
    if (inputLength > 500) score += 0.2;

    // Multi-part requests
    if (this.detectMultiPartQuery(userInput)) {
      score += 0.3;
    }

    // Technical terms
    const technicalTerms = /\b(algorithm|database|api|server|function|class|variable|configuration|deployment|architecture)\b/gi;
    const technicalMatches = (userInput.match(technicalTerms) || []).length;
    score += Math.min(technicalMatches * 0.1, 0.3);

    // Active goals influence
    if (activeGoals.length > 0) {
      score += Math.min(activeGoals.length * 0.1, 0.2);
    }

    // Conversation continuity influence
    if (conversationContext.context_continuity > 0.5) {
      score += 0.1;
    }

    // Task-focused conversation pattern
    if (conversationContext.interaction_pattern === 'task_focused') {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Detect multi-part queries (helper from advanced analysis)
   */
  private detectMultiPartQuery(input: string): boolean {
    const multiPartIndicators = [
      /\band\b/gi,
      /\bthen\b/gi,
      /\bafter that\b/gi,
      /\d+\./g, // numbered lists
      /first.+second/gi,
      /also/gi
    ];
    return multiPartIndicators.some(indicator => indicator.test(input));
  }
}
