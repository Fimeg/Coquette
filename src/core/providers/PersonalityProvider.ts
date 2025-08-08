/**
 * Personality Provider - handles local AI for personality interpretation
 * Usually connects to Ollama for local Gemma/Llama models
 */

import axios from 'axios';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

import { PersonalityProvider as PersonalityProviderConfig, PersonalityConfig } from '../config/types.js';
import { PersonalityManager } from '../personality/PersonalityManager.js';
import { ChatMessage } from './BaseProvider.js';
import { DebugLogger } from '../DebugLogger.js';
import { OllamaRequestQueue } from '../OllamaRequestQueue.js';
import { workflowManager, WorkflowPattern } from '../WorkflowPatterns.js';

export interface PersonalityResponse {
  content: string;
  metadata?: {
    model?: string;
    temperature?: number;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };
  timestamp: Date;
}

export interface PersonalityStreamChunk {
  content: string;
  isComplete: boolean;
}

export class PersonalityProvider {
  private config: PersonalityProviderConfig;
  private personalityManager: PersonalityManager;
  private personalityCache: Map<string, string> = new Map();
  private ollamaQueue: OllamaRequestQueue;
  private currentWorkflow: WorkflowPattern | null = null;

  constructor(config: PersonalityProviderConfig) {
    this.config = config;
    this.personalityManager = new PersonalityManager();
    this.ollamaQueue = OllamaRequestQueue.getInstance();
    
    // Load user character on initialization
    this.personalityManager.loadUserCharacter().catch(err => 
      console.warn('No user character file found (optional):', err.message)
    );
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled) return false;

    try {
      const response = await axios.get(`${this.config.base_url}/api/tags`, {
        timeout: 5000
      });
      
      // Check if our target model is available
      const models = response.data.models || [];
      return models.some((model: any) => 
        model.name === this.config.model || 
        model.name.startsWith(this.config.model.split(':')[0])
      );
    } catch {
      return false;
    }
  }

  async interpretWithPersonality(
    technicalResponse: string,
    personalityName: string,
    personalityConfig: PersonalityConfig,
    originalQuery: string,
    stream: boolean = false,
    conversationHistory?: ChatMessage[]
  ): Promise<PersonalityResponse | AsyncGenerator<PersonalityStreamChunk, PersonalityResponse>> {
    // Initialize personality interpretation workflow
    this.currentWorkflow = workflowManager.startWorkflow('personality_interpretation');
    
    // Step 1: Load personality (workflow step)
    if (this.currentWorkflow) {
      workflowManager.completeStep(this.currentWorkflow, 'load_personality', {
        personality_name: personalityName,
        config: personalityConfig
      });
    }
    
    // Check if we should trigger full personality reload
    const shouldTriggerFull = this.personalityManager.shouldTriggerFullPersonality(
      personalityName,
      originalQuery,
      technicalResponse
    );
    
    // Get personality context (smart loading based on exchange count and triggers)
    const personalityContext = await this.personalityManager.getPersonalityContext(
      personalityName,
      shouldTriggerFull
    );
    
    // Step 2: Analyze context (workflow step)
    if (this.currentWorkflow) {
      workflowManager.completeStep(this.currentWorkflow, 'analyze_context', {
        should_trigger_full: shouldTriggerFull,
        exchange_count: personalityContext.exchangeCount,
        conversation_history_length: conversationHistory?.length || 0
      });
    }
    
    // Determine whether to use full personality or short reminder
    const useFullPersonality = shouldTriggerFull || personalityContext.exchangeCount === 1;
    
    // Build efficient interpretation prompt
    const personalityPrompt = this.personalityManager.buildPrompt(
      personalityName,
      personalityContext,
      useFullPersonality
    );
    
    // Step 3: Preserve accuracy (workflow step)
    if (this.currentWorkflow) {
      workflowManager.completeStep(this.currentWorkflow, 'preserve_accuracy', {
        technical_response_length: technicalResponse.length,
        use_full_personality: useFullPersonality
      });
    }
    
    // Build interpretation prompt
    const interpretationPrompt = this.buildInterpretationPrompt(
      personalityPrompt,
      originalQuery,
      technicalResponse,
      useFullPersonality,
      conversationHistory
    );

    // Debug logging
    const logger = DebugLogger.getInstance();
    const conversationContextLength = this.buildConversationContext(conversationHistory).length;
    const estimatedContextTokens = this.estimateTokens(conversationContextLength.toString());
    
    logger.logEngineEvent('personality_interpretation_start', {
      personalityName,
      useFullPersonality,
      exchangeCount: personalityContext.exchangeCount,
      shouldTriggerFull,
      originalQuery,
      technicalResponseLength: technicalResponse.length,
      interpretationPromptLength: interpretationPrompt.length,
      conversationHistoryLength: conversationHistory?.length || 0,
      conversationContextLength,
      estimatedContextTokens
    });

    const requestBody = {
      model: this.config.model,
      prompt: interpretationPrompt,
      stream,
      options: {
        temperature: personalityConfig.temperature || this.config.temperature || 0.8,
        num_ctx: 8192, // Match successful InputRouter/IntelligenceRouter settings
        num_predict: 1024, // Much smaller, more reasonable for personality responses
        num_gpu: 20, // Match successful settings from InputRouter/IntelligenceRouter
        stop: ['Human:', 'User:', 'Assistant:', '---']
      }
    };

    if (stream) {
      return this.streamInterpretation(requestBody, personalityConfig);
    } else {
      const result = await this.generateInterpretation(requestBody, personalityConfig);
      
      // Complete workflow steps
      if (this.currentWorkflow) {
        workflowManager.completeStep(this.currentWorkflow, 'apply_tone', {
          result_length: result.content.length
        });
        workflowManager.completeStep(this.currentWorkflow, 'validate_consistency', {
          personality_name: personalityName,
          interpretation_complete: true
        });
      }
      
      return result;
    }
  }

  private async generateInterpretation(
    requestBody: any,
    personalityConfig: PersonalityConfig
  ): Promise<PersonalityResponse> {
    try {
      // Use OllamaRequestQueue for personality interpretation to prevent race conditions
      const queueResult = await this.ollamaQueue.enqueueRequest(
        requestBody.model,
        requestBody.prompt,
        requestBody.options,
        360000, // 6 minutes for personality interpretation
        'PersonalityProvider',
        'medium' // Medium priority - important but can wait behind routing
      );

      if (!queueResult.success) {
        throw new Error(`Personality interpretation failed: ${queueResult.error}`);
      }

      return {
        content: queueResult.data?.response || '',
        metadata: {
          model: this.config.model,
          temperature: personalityConfig.temperature,
          usage: {
            prompt_tokens: queueResult.data?.prompt_eval_count || 0,
            completion_tokens: queueResult.data?.eval_count || 0,
            total_tokens: (queueResult.data?.prompt_eval_count || 0) + (queueResult.data?.eval_count || 0)
          },
          queue_wait_time: queueResult.queueWaitTime,
          ollama_processing_time: queueResult.processingTime,
          workflow: this.currentWorkflow ? workflowManager.getWorkflowStatus(this.currentWorkflow) : null
        },
        timestamp: new Date()
      };
    } catch (error: any) {
      throw new Error(`Personality interpretation failed: ${error.message}`);
    }
  }

  private async* streamInterpretation(
    requestBody: any,
    personalityConfig: PersonalityConfig
  ): AsyncGenerator<PersonalityStreamChunk, PersonalityResponse> {
    try {
      const response = await axios.post(
        `${this.config.base_url}/api/generate`,
        requestBody,
        {
          responseType: 'stream',
          timeout: 360000, // 6 minutes for Ollama thinking time
          headers: { 'Content-Type': 'application/json' }
        }
      );

      let fullContent = '';
      let finalMetadata: any = {};

      // Parse the stream of JSON objects
      let buffer = '';
      
      response.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        
        // Process complete JSON lines
        const lines = buffer.split('\\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              
              if (data.response) {
                fullContent += data.response;
                
                // Yield the chunk
                // Note: This would need to be called from an async generator context
                // For now, we'll collect and return
              }
              
              if (data.done) {
                finalMetadata = {
                  model: this.config.model,
                  temperature: personalityConfig.temperature,
                  usage: {
                    prompt_tokens: data.prompt_eval_count || 0,
                    completion_tokens: data.eval_count || 0,
                    total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                  }
                };
              }
            } catch (parseError) {
              console.warn('Failed to parse streaming response line:', line);
            }
          }
        }
      });

      // Wait for stream to complete
      await new Promise((resolve, reject) => {
        response.data.on('end', resolve);
        response.data.on('error', reject);
      });

      // For now, yield the complete content as a single chunk
      // In a real implementation, this would yield incremental chunks
      yield {
        content: fullContent,
        isComplete: true
      };

      return {
        content: fullContent,
        metadata: finalMetadata,
        timestamp: new Date()
      };
    } catch (error: any) {
      throw new Error(`Personality streaming failed: ${error.message}`);
    }
  }

  private async loadPersonalityPrompt(personalityConfig: PersonalityConfig): Promise<string> {
    // Check cache first
    const cacheKey = personalityConfig.file;
    if (this.personalityCache.has(cacheKey)) {
      return this.personalityCache.get(cacheKey)!;
    }

    try {
      // Expand tilde to home directory
      const filePath = personalityConfig.file.startsWith('~')
        ? join(homedir(), personalityConfig.file.slice(1))
        : personalityConfig.file;

      const content = await readFile(filePath, 'utf-8');
      
      // Cache the content
      this.personalityCache.set(cacheKey, content);
      
      return content;
    } catch (error) {
      throw new Error(`Failed to load personality file ${personalityConfig.file}: ${error}`);
    }
  }

  private buildInterpretationPrompt(
    personalityPrompt: string,
    originalQuery: string,
    technicalResponse: string,
    useFullPersonality: boolean = false,
    conversationHistory?: ChatMessage[]
  ): string {
    // Build conversation context if available
    const conversationContext = this.buildConversationContext(conversationHistory);
    
    if (useFullPersonality) {
      // Full personality context - more detailed instructions
      return `${personalityPrompt}

## Conversation Context
${conversationContext}

## Current Context
You have received a technical analysis that you need to interpret through your personality.

**User Query:** ${originalQuery}
**Technical Response:** ${technicalResponse}

## Task
Interpret the technical response in your characteristic style while maintaining accuracy. Reference specific details from the analysis and maintain continuity with the conversation.

## Tone Consistency Examples:

Example 1 - Technical Information (Ani Style):
Tech Response: "Available tools: read_file, write_file, list_directory, search_content, run_shell_command"
Ani Interpretation: "Darling, I have quite the toolkit at my disposal. I can read your files with precision, write new content with... flair, explore directories like wandering through hidden chambers, search for exactly what you need, and even execute commands with a touch of digital elegance. What would you like me to do for you?"

Example 2 - Complex Analysis (Professional Style):
Tech Response: "System architecture analysis shows 5 components with potential race conditions in the queue management system."
Professional Interpretation: "I've completed a comprehensive analysis of your system architecture. The evaluation identified five core components, with particular attention needed on the queue management system where race conditions may occur. I recommend implementing serialization patterns to address these concurrency issues."

Example 3 - Simple Response (Casual Style):
Tech Response: "File 'config.json' contains 45 lines of configuration data."
Casual Interpretation: "Hey! I checked out that config.json file - it's got 45 lines of configuration stuff in there. Pretty standard setup from what I can see!"

## Style Guidelines:
- Maintain your character's voice throughout the response
- Keep technical accuracy intact - never change facts or details
- Reference specific information from the technical response
- Adapt tone to match the complexity of the query
- Show personality in how you present information, not in what information you present

Response:`;
    } else {
      // Short reminder mode - minimal token usage  
      return `${personalityPrompt}

${conversationContext}

**Query:** ${originalQuery}
**Tech Response:** ${technicalResponse}

GUIDELINES: Maintain your character voice while keeping technical accuracy. Reference specific details from the tech response.

Interpret in your style:`;
    }
  }

  private buildConversationContext(conversationHistory?: ChatMessage[]): string {
    if (!conversationHistory || conversationHistory.length <= 1) {
      return "This is the start of our conversation.";
    }

    // Get all messages except the current one being processed
    const availableHistory = conversationHistory.slice(0, -1);
    
    if (availableHistory.length === 0) {
      return "This is the start of our conversation.";
    }

    // Use dynamic context window management - target ~18k tokens for conversation history 
    const maxContextTokens = 18000; // Leave ~6k for personality prompt + current query (reduced from 28k)
    
    // Keep the last 5 messages completely intact (most important for continuity)
    const recentCount = Math.min(5, availableHistory.length);
    const recentMessages = availableHistory.slice(-recentCount);
    const olderMessages = availableHistory.slice(0, -recentCount);
    
    let context = "Conversation history:\n";
    let totalTokens = this.estimateTokens(context);
    
    // Add all recent messages first (these are most important)
    for (const message of recentMessages) {
      const role = message.role === 'user' ? 'User' : 'Assistant';
      const messageText = `${role}: ${message.content}\n`;
      const messageTokens = this.estimateTokens(messageText);
      
      if (totalTokens + messageTokens <= maxContextTokens) {
        context += messageText;
        totalTokens += messageTokens;
      } else {
        // Even recent messages are too big, need to truncate
        const availableTokens = maxContextTokens - totalTokens;
        if (availableTokens > 100) {
          const truncatedContent = this.smartTruncate(message.content, availableTokens - 20); // Reserve tokens for role prefix
          context += `${role}: ${truncatedContent}...\n`;
        }
        break;
      }
    }
    
    // Add older messages with progressive truncation as space allows
    for (let i = olderMessages.length - 1; i >= 0; i--) {
      const message = olderMessages[i];
      const role = message.role === 'user' ? 'User' : 'Assistant';
      let messageContent = message.content;
      
      const baseMessageText = `${role}: ${messageContent}\n`;
      const messageTokens = this.estimateTokens(baseMessageText);
      
      if (totalTokens + messageTokens <= maxContextTokens) {
        // Full message fits
        context = `${baseMessageText}${context}`;
        totalTokens += messageTokens;
      } else {
        // Try to fit a truncated version
        const availableTokens = maxContextTokens - totalTokens;
        if (availableTokens > 150) { // Need reasonable space for meaningful content
          const truncatedContent = this.smartTruncate(messageContent, availableTokens - 50);
          const truncatedMessage = `${role}: ${truncatedContent}...\n`;
          context = `${truncatedMessage}${context}`;
          totalTokens += this.estimateTokens(truncatedMessage);
        } else {
          // Not enough space left, stop adding older messages
          break;
        }
      }
    }
    
    return context.trim();
  }

  /**
   * Estimate token count (rough approximation: 1 token ≈ 4 characters for English)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Smart truncation that preserves important content
   */
  private smartTruncate(content: string, maxTokens: number): string {
    const maxChars = maxTokens * 4; // Convert tokens to approximate characters
    
    if (content.length <= maxChars) {
      return content;
    }

    // Try to truncate at sentence boundaries first
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
    let result = "";
    
    for (const sentence of sentences) {
      if ((result + sentence).length <= maxChars) {
        result += sentence;
      } else {
        break;
      }
    }
    
    // If we got at least some sentences, return that
    if (result.length > maxChars * 0.3) {
      return result.trim();
    }
    
    // Otherwise, just do character truncation at word boundary
    const truncated = content.substring(0, maxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxChars * 0.7) {
      return truncated.substring(0, lastSpace);
    }
    
    return truncated;
  }

  // Utility methods
  async clearPersonalityCache(): Promise<void> {
    this.personalityCache.clear();
  }

  async reloadPersonality(personalityConfig: PersonalityConfig): Promise<void> {
    this.personalityCache.delete(personalityConfig.file);
    await this.loadPersonalityPrompt(personalityConfig);
  }

  // Enhanced personality system methods
  getPersonalityStats(personalityId: string): { 
    exchanges: number; 
    lastFullReload: Date | null; 
    nextFullReload: number; 
  } | null {
    return this.personalityManager.getContextStats(personalityId);
  }

  resetPersonalityContext(personalityId: string): void {
    this.personalityManager.resetPersonalityContext(personalityId);
  }

  async createUserCharacterTemplate(): Promise<string> {
    return await this.personalityManager.createUserCharacterTemplate();
  }

  getAvailablePersonalities(): Array<{ id: string; name: string; description: string }> {
    return this.personalityManager.getPersonalityList().map(({ id, profile }) => ({
      id,
      name: profile.name,
      description: profile.description
    }));
  }

  async reloadUserCharacter(): Promise<boolean> {
    try {
      await this.personalityManager.loadUserCharacter();
      return true;
    } catch {
      return false;
    }
  }

  async listAvailableModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.config.base_url}/api/tags`);
      const models = response.data.models || [];
      return models.map((model: any) => model.name);
    } catch {
      return [];
    }
  }

  async getModelInfo(modelName?: string): Promise<any> {
    try {
      const model = modelName || this.config.model;
      const response = await axios.post(`${this.config.base_url}/api/show`, {
        name: model
      });
      return response.data;
    } catch {
      return null;
    }
  }
}