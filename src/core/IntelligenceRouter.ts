/**
 * IntelligenceRouter - Ollama-driven model selection for multi-model intelligence
 * NO hardcoded keyword matching - all decisions made by AI
 */

import axios from 'axios';
import { DebugLogger } from './DebugLogger.js';
import { PersonalityProvider } from './providers/PersonalityProvider.js';
import { OllamaRequestQueue } from './OllamaRequestQueue.js';
import { workflowManager, WorkflowPattern } from './WorkflowPatterns.js';

export interface ModelSelection {
  model: 'gemma3n:e4b' | 'deepseek-r1:8b' | 'context7';
  reasoning: string;
  confidence: number;
  expected_processing_time: number;
  complexity_level: 'low' | 'medium' | 'high';
}

export interface IntelligenceContext {
  user_input: string;
  conversation_history: any[];
  intent_result: any;
  active_goals: string[];
  available_tools: string[];
  context_summary: string;
}

export class IntelligenceRouter {
  private personalityProvider: PersonalityProvider;
  private logger: DebugLogger;
  private baseUrl: string;
  private ollamaQueue: OllamaRequestQueue;
  private currentWorkflow: WorkflowPattern | null = null;

  constructor(personalityProvider: PersonalityProvider, baseUrl: string = 'http://10.10.20.19:11434') {
    this.personalityProvider = personalityProvider;
    this.logger = DebugLogger.getInstance();
    this.baseUrl = baseUrl;
    this.ollamaQueue = OllamaRequestQueue.getInstance();
  }

  /**
   * CRITICAL: Uses Ollama AI to determine optimal model - NO keywords/hardcoded logic
   * Follows Software Engineering Workflow for systematic model selection
   */
  async determineOptimalModel(context: IntelligenceContext): Promise<ModelSelection> {
    // Initialize software engineering workflow for model selection
    this.currentWorkflow = workflowManager.startWorkflow('software_engineering');
    
    this.logger.logEngineEvent('intelligence_router_start', { 
      user_input: context.user_input,
      intent: context.intent_result?.intent,
      workflow_id: this.currentWorkflow?.name
    });

    try {
      // Step 1: Understand (workflow step)
      if (this.currentWorkflow) {
        workflowManager.completeStep(this.currentWorkflow, 'understand', {
          user_input: context.user_input,
          intent: context.intent_result?.intent,
          context_analyzed: true
        });
      }
      
      // Step 2: Plan (workflow step) 
      const selectionPrompt = this.buildModelSelectionPrompt(context);
      
      if (this.currentWorkflow) {
        workflowManager.completeStep(this.currentWorkflow, 'plan', {
          prompt_built: true,
          prompt_length: selectionPrompt.length
        });
      }
      
      // Use OllamaRequestQueue for model selection to prevent race conditions
      const queueResult = await this.ollamaQueue.enqueueRequest(
        'gemma3n:e4b',
        selectionPrompt,
        {
          temperature: 0.2, // More focused decision making
          num_ctx: 8192,
          num_predict: 200,
          num_gpu: 23 // Match successful settings
        },
        60000, // 1 minute timeout for quick decisions
        'IntelligenceRouter',
        'high' // High priority for routing decisions
      );

      if (!queueResult.success) {
        throw new Error(`Model selection failed: ${queueResult.error}`);
      }

      const decision = queueResult.data?.response || '';

      const selection = this.parseModelDecision(decision, context);
      
      // Step 3: Implement (workflow step - model selection completed)
      if (this.currentWorkflow) {
        workflowManager.completeStep(this.currentWorkflow, 'implement', {
          selected_model: selection.model,
          reasoning: selection.reasoning,
          confidence: selection.confidence
        });
        
        // Skip verification steps for model selection (not applicable)
        workflowManager.skipStep(this.currentWorkflow, 'verify_tests', 'Not applicable for model selection');
        workflowManager.skipStep(this.currentWorkflow, 'verify_standards', 'Not applicable for model selection');
      }
      
      this.logger.logEngineEvent('intelligence_router_complete', { 
        selected_model: selection.model,
        reasoning: selection.reasoning,
        confidence: selection.confidence,
        queue_wait_time: queueResult.queueWaitTime,
        ollama_processing_time: queueResult.processingTime,
        workflow: this.currentWorkflow ? workflowManager.getWorkflowStatus(this.currentWorkflow) : null
      });

      return selection;

    } catch (error: any) {
      this.logger.logError('intelligence_router_failed', error);
      
      // Mark workflow as failed
      if (this.currentWorkflow) {
        workflowManager.failStep(this.currentWorkflow, 'implement', error.message);
      }
      
      // Fallback to simple heuristics if AI fails
      return this.fallbackModelSelection(context);
    }
  }

  private buildModelSelectionPrompt(context: IntelligenceContext): string {
    return `You are a model selection expert. Choose the optimal AI model for this request:

AVAILABLE MODELS:
1. gemma3n:e4b
   - Best for: personality, chat, general conversation, simple questions
   - Strengths: fast, conversational, character consistency (Ani personality)
   - Use when: casual chat, simple questions, personality interpretation needed

2. deepseek:r1-8b  
   - Best for: complex reasoning, analysis, problem-solving, tool planning
   - Strengths: deep thinking, logical analysis, step-by-step reasoning
   - Use when: complex problems, architecture analysis, multi-step planning

3. context7
   - Best for: library documentation, API references, code context
   - Strengths: specific technical knowledge, documentation lookup
   - Use when: user asks about specific libraries, frameworks, APIs

REQUEST ANALYSIS:
User Input: "${context.user_input}"
Intent: ${context.intent_result?.intent || 'unknown'}
Conversation Context: ${context.conversation_history.length} messages
Active Goals: ${context.active_goals.join(', ') || 'none'}
Available Tools: ${context.available_tools.length} tools
Context: ${context.context_summary}

DECISION CRITERIA:
- Complexity: How complex is the reasoning required?
- Type: Is this chat, technical analysis, or documentation lookup?
- Tools: Does this require tool orchestration and planning?
- Time: Can this be answered quickly or needs deep thinking?

EXAMPLES:

Example 1 - Simple Chat (Use gemma3n:e4b):
Input: "Hey Ani, how are you today?"
Intent: chat
Decision: {"model": "gemma3n:e4b", "reasoning": "Simple conversational query best handled by fast personality model", "confidence": 0.95, "complexity_level": "low", "expected_processing_time": 10}

Example 2 - Complex Technical Analysis (Use deepseek:r1-8b):
Input: "Analyze the system architecture and suggest optimizations for our multi-model AI chain"
Intent: task
Decision: {"model": "deepseek:r1-8b", "reasoning": "Complex architectural analysis requiring deep reasoning and systematic thinking", "confidence": 0.90, "complexity_level": "high", "expected_processing_time": 120}

Example 3 - Library Documentation (Use context7):
Input: "Show me how to use React Query for data fetching"
Intent: contextualize
Decision: {"model": "context7", "reasoning": "Specific library documentation request best handled by specialized knowledge model", "confidence": 0.85, "complexity_level": "medium", "expected_processing_time": 45}

Example 4 - Tool Planning (Use deepseek:r1-8b):
Input: "Read the system interconnection map and list available tools"
Intent: task
Decision: {"model": "deepseek:r1-8b", "reasoning": "Multi-step task requiring tool orchestration and systematic analysis", "confidence": 0.88, "complexity_level": "medium", "expected_processing_time": 60}

Example 5 - Personal Reflection (Use gemma3n:e4b):
Input: "What do you think about our debugging session yesterday?"
Intent: chat
Decision: {"model": "gemma3n:e4b", "reasoning": "Personal conversational reflection requiring personality consistency and memory", "confidence": 0.92, "complexity_level": "low", "expected_processing_time": 15}

Example 6 - Code Analysis (Use deepseek:r1-8b):
Input: "Find all the race conditions in our codebase and suggest fixes"
Intent: task
Decision: {"model": "deepseek:r1-8b", "reasoning": "Complex code analysis requiring deep technical reasoning and systematic evaluation", "confidence": 0.87, "complexity_level": "high", "expected_processing_time": 180}

SELECTION RULES:
- Use gemma3n:e4b for: chat, personality questions, simple queries, emotional responses
- Use deepseek:r1-8b for: complex analysis, multi-step tasks, architecture decisions, debugging
- Use context7 for: library documentation, API references, framework questions
- Consider tool requirements: complex tool orchestration → deepseek:r1-8b
- Consider time sensitivity: quick responses → gemma3n:e4b
- Consider reasoning depth: deep analysis → deepseek:r1-8b

Choose the most appropriate model and explain your reasoning.

Respond with ONLY this JSON format:
{
  "model": "gemma3n:e4b|deepseek:r1-8b|context7",
  "reasoning": "brief explanation why this model is optimal",
  "confidence": 0.95,
  "complexity_level": "low|medium|high",
  "expected_processing_time": 30
}`;
  }


  private parseModelDecision(response: string, context: IntelligenceContext): ModelSelection {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[^}]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate the response
        if (parsed.model && ['gemma3n:e4b', 'deepseek:r1-8b', 'context7'].includes(parsed.model)) {
          return {
            model: parsed.model,
            reasoning: parsed.reasoning || 'AI decision',
            confidence: parsed.confidence || 0.8,
            complexity_level: parsed.complexity_level || 'medium',
            expected_processing_time: parsed.expected_processing_time || 30
          };
        }
      }
      
      // Fallback if parsing fails
      return this.fallbackModelSelection(context);
      
    } catch (error) {
      this.logger.logError('model_decision_parse_failed', error);
      return this.fallbackModelSelection(context);
    }
  }

  private fallbackModelSelection(context: IntelligenceContext): ModelSelection {
    // Simple fallback based on intent
    if (context.intent_result?.intent === 'contextualize') {
      return {
        model: 'context7',
        reasoning: 'Fallback: contextualize intent detected',
        confidence: 0.6,
        complexity_level: 'medium',
        expected_processing_time: 60
      };
    }
    
    if (context.intent_result?.intent === 'task' && context.available_tools.length > 0) {
      return {
        model: 'deepseek:r1-8b',
        reasoning: 'Fallback: complex task with tools',
        confidence: 0.6,
        complexity_level: 'high',
        expected_processing_time: 120
      };
    }
    
    // Default to personality model
    return {
      model: 'gemma3n:e4b',
      reasoning: 'Fallback: default personality model',
      confidence: 0.5,
      complexity_level: 'low',
      expected_processing_time: 30
    };
  }

  /**
   * Get model configuration for selected model
   */
  getModelConfig(modelSelection: ModelSelection): any {
    switch (modelSelection.model) {
      case 'gemma3n:e4b':
        return {
          temperature: 0.7,
          num_ctx: 16384, // Reduced from 32k - personality doesn't need huge context
          num_predict: 1024, // Reduced for more focused responses
          num_gpu: 18, // More CPU offload
          timeout: 180000 // 3 minutes
        };
        
      case 'deepseek-r1:8b':
        return {
          temperature: 0.3, // More focused for reasoning
          num_ctx: 24576, // Reduced from 32k - accommodate large but don't force
          num_predict: 2048, // Reduced from 4k - focused reasoning
          num_gpu: 15, // Much more CPU offload for stability
          timeout: 600000 // 10 minutes for deep thinking - allow for longer reasoning
        };
        
      case 'context7':
        return {
          // Context7 runs as separate service
          port: 3000,
          timeout: 120000 // 2 minutes
        };
        
      default:
        return {
          temperature: 0.7,
          num_ctx: 16384, // Conservative default
          num_predict: 1024, // Conservative default
          num_gpu: 18, // More CPU offload
          timeout: 180000
        };
    }
  }

  /**
   * Health check for available models
   */
  async checkModelAvailability(): Promise<{ [key: string]: boolean }> {
    const models = ['gemma3n:e4b', 'deepseek-r1:8b'];
    const availability: { [key: string]: boolean } = {};
    
    for (const model of models) {
      try {
        await axios.get(`${this.baseUrl}/api/tags`);
        // Check if specific model is available
        const response = await axios.get(`${this.baseUrl}/api/tags`);
        const modelList = response.data.models || [];
        availability[model] = modelList.some((m: any) => 
          m.name === model || m.name.startsWith(model.split(':')[0])
        );
      } catch {
        availability[model] = false;
      }
    }
    
    // Check Context7 separately (different service)
    try {
      await axios.get('http://localhost:3000/health', { timeout: 5000 });
      availability['context7'] = true;
    } catch {
      availability['context7'] = false;
    }
    
    return availability;
  }
}