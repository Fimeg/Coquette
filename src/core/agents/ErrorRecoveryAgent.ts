
import { PersonalityProvider } from '../providers/PersonalityProvider.js';
import { DebugLogger } from '../DebugLogger.js';
import { FileOperation } from './FileOperationsAgent.js';
import { OllamaRequestQueue } from '../OllamaRequestQueue.js';

export interface RecoveryAttempt {
  recovery_possible: boolean;
  reasoning: string;
  operations?: FileOperation[];
  user_question?: string; // This will be a prompt for the personality provider
}

export class ErrorRecoveryAgent {
  private personalityProvider: PersonalityProvider;
  private logger: DebugLogger;
  private ollamaQueue: OllamaRequestQueue;

  constructor(personalityProvider: PersonalityProvider) {
    this.personalityProvider = personalityProvider;
    this.logger = DebugLogger.getInstance();
    this.ollamaQueue = OllamaRequestQueue.getInstance();
  }

  async attemptRecovery(failedOperation: FileOperation, originalGoal: string): Promise<RecoveryAttempt> {
    const recoveryPrompt = this.buildRecoveryPrompt(failedOperation, originalGoal);

    const config = {
      name: 'Error Recovery Specialist',
      file: '',
      temperature: 0.4,
      context_length: 2048,
      max_tokens: 400,
    };

    try {
      // Use OllamaRequestQueue for error recovery to prevent race conditions
      const queueResult = await this.ollamaQueue.enqueueRequest(
        this.personalityProvider['config'].model,
        recoveryPrompt,
        {
          temperature: config.temperature,
          num_ctx: config.context_length,
          num_predict: config.max_tokens,
          stop: ['Human:', 'User:', 'Assistant:', '---'],
        },
        30000, // 30 second timeout for recovery
        'ErrorRecoveryAgent',
        'low' // Low priority - error recovery can wait
      );

      if (!queueResult.success) {
        throw new Error(`Error recovery failed: ${queueResult.error}`);
      }

      const responseText = queueResult.data?.response || '';
      return this.parseRecoveryResponse(responseText);

    } catch (error: any) {
      this.logger.logError('error_recovery_agent_failed', error);
      return {
        recovery_possible: false,
        reasoning: 'Failed to consult with the recovery specialist.',
        user_question: "I'm having trouble recovering from an error. Could you please provide more information or suggest a different approach?",
      };
    }
  }

  private buildRecoveryPrompt(failedOperation: FileOperation, originalGoal: string): string {
    return `You are an error recovery specialist. A file operation has failed, and you need to decide if it's possible to recover from the error.

**Original Goal:** ${originalGoal}
**Failed Operation:** ${failedOperation.operation}
**Parameters:** ${JSON.stringify(failedOperation.parameters)}
**Error:** ${failedOperation.error}

**Your Task:**
1.  Analyze the error and determine if it's something that can be fixed by trying a different approach (e.g., different parameters, a different tool).
2.  If recovery is possible, provide a new set of operations to try.
3.  If recovery is not possible, formulate a concise, factual question for the user that will help resolve the issue. This question will be given to a personality engine to be stylized, so it should be direct and un-styled.

**Respond ONLY with a JSON object in this format:**
{
  "recovery_possible": true/false,
  "reasoning": "Explain why you think recovery is or is not possible.",
  "operations": [
    // Only if recovery_possible is true
    {"id": "recovery_1", "operation": "tool_name", "parameters": {...}}
  ],
  "user_question": "A clear, concise, un-styled question for the user if recovery is not possible. e.g., 'The file was not found. Please provide the correct path.'"
}

Response:`;
  }

  private parseRecoveryResponse(response: string): RecoveryAttempt {
    try {
      // Extract all JSON objects from response
      const allJsonObjects = this.extractAllJsonObjects(response);
      
      for (const jsonObj of allJsonObjects) {
        try {
          const parsed = JSON.parse(jsonObj);
          
          // Look for recovery_possible field in any JSON object
          if (parsed.hasOwnProperty('recovery_possible')) {
            this.logger.logEngineEvent('recovery_json_parsed_successfully', {
              json_objects_found: allJsonObjects.length,
              recovery_possible: parsed.recovery_possible
            });
            
            return {
              recovery_possible: parsed.recovery_possible,
              reasoning: parsed.reasoning || 'Recovery attempt processed',
              operations: parsed.operations || [],
              user_question: parsed.user_question || null,
            };
          }
        } catch (parseError: any) {
          this.logger.logError('recovery_json_object_parse_failed', parseError);
          // Continue processing other JSON objects
        }
      }
    } catch (error: any) {
      this.logger.logError('recovery_response_parse_failed', error);
    }

    return {
      recovery_possible: false,
      reasoning: "The recovery specialist's response was not in the expected format.",
      user_question: "I'm having trouble understanding the recovery instructions. Could you please clarify?",
    };
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
        /\{[^{}]*"recovery_possible"[^{}]*\}/g,
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
}
