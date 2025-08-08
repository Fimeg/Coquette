/**
 * SubconsciousReasoner - Uses DeepSeek R1-8B for deep subconscious analysis
 * Provides the "thinking" layer for complex reasoning before action
 */

import axios from 'axios';
import { DebugLogger } from './DebugLogger.js';
import { ContextManager } from './ContextManager.js';
import { OllamaRequestQueue } from './OllamaRequestQueue.js';

export interface SubconsciousResult {
  execution_plan: string[];
  required_tools: string[];
  expected_challenges: string[];
  acknowledgment_approach: string;
  confidence_level: number;
  processing_notes: string;
  thinking_summary: string;
  true_user_need: string;
  complexity_assessment: {
    level: 'low' | 'medium' | 'high' | 'extreme';
    reasoning_depth_required: number;
    tool_orchestration_complexity: number;
    context_dependencies: string[];
  };
  generated_content?: string;
}

export interface ReasoningContext {
  user_request: string;
  intent_result: any;
  conversation_history: any[];
  available_tools: string[];
  context_summary: string;
  active_goals: string[];
  user_patterns: any;
}

export class SubconsciousReasoner {
  private logger: DebugLogger;
  private contextManager: ContextManager;
  private baseUrl: string;
  private ollamaQueue: OllamaRequestQueue;

  constructor(contextManager: ContextManager, baseUrl: string = 'http://10.10.20.19:11434') {
    this.logger = DebugLogger.getInstance();
    this.contextManager = contextManager;
    this.baseUrl = baseUrl;
    this.ollamaQueue = OllamaRequestQueue.getInstance();
  }

  /**
   * Perform deep subconscious analysis using DeepSeek R1-8B
   * This is the "thinking before acting" component
   */
  async performSubconsciousAnalysis(context: ReasoningContext): Promise<SubconsciousResult> {
    this.logger.logEngineEvent('subconscious_reasoning_start', {
      user_request: context.user_request,
      intent: context.intent_result?.intent,
      available_tools: context.available_tools.length
    });

    try {
      const reasoningPrompt = this.buildReasoningPrompt(context);
      
      // Use OllamaRequestQueue for DeepSeek reasoning to prevent race conditions
      const queueResult = await this.ollamaQueue.enqueueRequest(
        'deepseek-r1:8b',
        reasoningPrompt,
        {
          temperature: 0.3, // Focused reasoning
          num_ctx: 16384, // 16k should be plenty for reasoning
          num_predict: 1024, // Focus on key insights only
          num_gpu: 10, // Heavy CPU offload for stability
          stop: ['Human:', 'User:', 'Assistant:', '</subconscious_analysis>']
        },
        600000, // 10 minutes for deep thinking
        'SubconsciousReasoner',
        'medium' // Medium priority - can wait behind user input routing
      );

      if (!queueResult.success) {
        throw new Error(`Subconscious reasoning failed: ${queueResult.error}`);
      }

      const reasoning = queueResult.data?.response || '';
      
      const result = this.parseReasoningResult(reasoning, context);
      
      // Store reasoning context for future reference
      await this.contextManager.addContext(
        JSON.stringify(result),
        'memory',
        {
          source: 'deepseek_r1_8b',
          complexity: result.complexity_assessment.level,
          tags: ['reasoning', 'subconscious', 'planning']
        }
      );

      this.logger.logEngineEvent('subconscious_reasoning_complete', {
        execution_plan_steps: result.execution_plan.length,
        required_tools: result.required_tools.length,
        confidence: result.confidence_level,
        complexity: result.complexity_assessment.level,
        queue_wait_time: queueResult.queueWaitTime,
        ollama_processing_time: queueResult.processingTime
      });

      return result;

    } catch (error: any) {
      this.logger.logError('subconscious_reasoning_failed', error);
      
      // Return fallback reasoning
      return this.createFallbackReasoning(context);
    }
  }

  private buildReasoningPrompt(context: ReasoningContext): string {
    return `You are performing deep subconscious reasoning using advanced AI capabilities. Think deeply and systematically about this request.

REQUEST CONTEXT:
User Request: "${context.user_request}"
Intent Classification: ${context.intent_result?.intent || 'unknown'}
Available Tools: ${context.available_tools.join(', ') || 'none'}
Conversation History: ${context.conversation_history.length} messages
Active Goals: ${context.active_goals.join(', ') || 'none'}
Context Summary: ${context.context_summary}

<thinking>
Think through each of these questions carefully in this private reasoning space:

1. UNDERSTANDING: What is the user REALLY asking for? Look beyond the surface request to understand their true need.

2. COMPLEXITY: How complex is this request? What level of reasoning, tool orchestration, and planning is required?

3. STRATEGY: What is the optimal step-by-step approach? What tools are needed and in what order?

4. CHALLENGES: What potential complications, edge cases, or failure points exist?

5. CONTEXT: What additional context or information might be needed?

6. ACKNOWLEDGMENT: How should I communicate my thinking process to the user while maintaining Ani's personality?

7. EXECUTION: What is the precise execution plan with contingencies?

8. VALIDATION: How will I know if the approach is working correctly?

## TOOL USAGE GUIDELINES:

**Available Core Tools:**
- list_directory: List directory contents (ALWAYS use absolute paths)
- read_file: Read file contents (supports text, images, PDFs)
- search_file_content: Search text in files using regex patterns
- glob: Find files by pattern matching
- edit_file: Edit existing files with precise text replacement
- write_file: Create new files or overwrite existing ones
- web_fetch: Fetch content from URLs
- read_many_files: Batch read multiple files efficiently
- run_shell_command: Execute system commands (use with caution)
- memory: Store and retrieve conversation context
- web_search: Search the web for information

**Tool Execution Rules:**
- ALWAYS use absolute file paths (e.g., /home/user/project/file.txt)
- NEVER use relative paths (e.g., ./file.txt, ../other.txt)
- When possible, use multiple tools in parallel for efficiency
- For file operations, verify paths exist before writing
- For shell commands, explain impact before execution
- Use appropriate tools for the task (don't use read_file for directory listing)

**Common Tool Patterns:**
- File reading: Use list_directory first, then read_file for specific files
- Search operations: Use glob for file discovery, search_file_content for content
- Code analysis: Combine glob + read_many_files + search_file_content
- System exploration: Use list_directory + read_file for configuration files

Think step-by-step through your reasoning process. Show your work. Don't worry about formatting here - just think freely.
</thinking>

Based on your deep analysis above, now provide a comprehensive reasoning result that will guide the execution.

CRITICAL: Respond with ONLY valid JSON in this exact format (no extra text, no markdown, no explanations):
{
  "true_user_need": "what the user actually needs beyond surface request",
  "execution_plan": ["step 1", "step 2", "step 3"],
  "required_tools": ["tool1", "tool2"],
  "expected_challenges": ["challenge 1", "challenge 2"],
  "acknowledgment_approach": "how to communicate thinking process to user naturally",
  "confidence_level": 0.85,
  "complexity_assessment": {
    "level": "low",
    "reasoning_depth_required": 3,
    "tool_orchestration_complexity": 2,
    "context_dependencies": ["dependency1", "dependency2"]
  },
  "thinking_summary": "brief summary of your reasoning process",
  "processing_notes": "internal notes for system optimization"
}

EXAMPLES OF VALID RESPONSES:

Example 1 - Simple Request:
{
  "true_user_need": "User wants to understand available system capabilities",
  "execution_plan": ["List all available tools", "Explain their functions"],
  "required_tools": ["tool_inventory"],
  "expected_challenges": ["None - straightforward information request"],
  "acknowledgment_approach": "Acknowledge curiosity and provide comprehensive overview",
  "confidence_level": 0.95,
  "complexity_assessment": {
    "level": "low",
    "reasoning_depth_required": 1,
    "tool_orchestration_complexity": 1,
    "context_dependencies": []
  },
  "thinking_summary": "Simple information request requiring basic tool listing",
  "processing_notes": "High confidence, minimal complexity"
}

Example 2 - Complex Analysis:
{
  "true_user_need": "User needs comprehensive codebase analysis and refactoring strategy",
  "execution_plan": ["Scan codebase structure", "Identify patterns", "Analyze dependencies", "Propose refactoring plan"],
  "required_tools": ["glob", "read_many_files", "search_file_content", "list_directory"],
  "expected_challenges": ["Large codebase scope", "Complex dependencies", "Multiple refactoring approaches"],
  "acknowledgment_approach": "Acknowledge complexity and explain step-by-step approach",
  "confidence_level": 0.75,
  "complexity_assessment": {
    "level": "high",
    "reasoning_depth_required": 4,
    "tool_orchestration_complexity": 3,
    "context_dependencies": ["project_structure", "coding_standards", "existing_patterns"]
  },
  "thinking_summary": "Multi-step analysis requiring systematic codebase exploration",
  "processing_notes": "High complexity requiring careful tool orchestration"
}`;
  }


  private parseReasoningResult(response: string, context: ReasoningContext): SubconsciousResult {
    try {
      // Try to extract JSON from response - look for the cleanest JSON block
      const jsonMatches = response.match(/\{[\s\S]*?\}/g);
      
      if (jsonMatches && jsonMatches.length > 0) {
        // Try parsing each JSON block, use the first valid one
        let parsed = null;
        let lastError = null;
        
        for (const jsonMatch of jsonMatches) {
          try {
            // Enhanced JSON cleanup for DeepSeek's quirky formatting
            let cleanJson = jsonMatch
              // First, handle <think> tags that might be embedded in JSON
              .replace(/<think>[\s\S]*?<\/think>/g, '') // Remove think tags from JSON
              .replace(/<[^>]+>/g, '') // Remove any other XML-like tags
              
              // Handle incomplete/broken strings
              .replace(/"\s*\n\s*[^"}]/g, '" ') // Fix broken multi-line strings
              .replace(/([^"\\])\n([^"])/g, '$1 $2') // Join broken lines within strings
              
              // Handle missing quotes around property names
              .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // Add quotes to unquoted keys
              
              // Handle trailing commas and malformed endings
              .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
              .replace(/,\s*}/g, '}') // Remove trailing commas before closing braces  
              .replace(/,\s*]/g, ']') // Remove trailing commas before closing brackets
              
              // Handle incomplete JSON (common with DeepSeek)
              .replace(/("[^"]*"):\s*"[^"]*$/g, '$1: "incomplete"') // Close incomplete string values
              .replace(/\}\s*$/, '}') // Ensure proper closing
              
              // Handle spacing and newlines
              .replace(/\n\s*/g, ' ') // Remove problematic newlines
              .replace(/\s+/g, ' ') // Normalize whitespace
              .trim();
            
            // Try to auto-complete incomplete JSON
            const openBraces = (cleanJson.match(/\{/g) || []).length;
            const closeBraces = (cleanJson.match(/\}/g) || []).length;
            const openBrackets = (cleanJson.match(/\[/g) || []).length;
            const closeBrackets = (cleanJson.match(/\]/g) || []).length;
            
            // Add missing closing braces/brackets
            for (let i = closeBraces; i < openBraces; i++) {
              cleanJson += '}';
            }
            for (let i = closeBrackets; i < openBrackets; i++) {
              cleanJson += ']';
            }
            
            // Handle unescaped quotes in string values
            cleanJson = cleanJson.replace(/(":\s*")([^"]*)"([^"]*)"([^"]*")/g, '$1$2\\"$3\\"$4');
            
            parsed = JSON.parse(cleanJson);
            break; // Success, exit loop
          } catch (error: any) {
            lastError = error;
            continue; // Try next JSON block
          }
        }
        
        if (!parsed) {
          this.logger.logError('all_json_blocks_failed', lastError);
          this.logger.logEngineEvent('deepseek_json_debug', {
            response_preview: response.substring(0, 500),
            json_matches_count: jsonMatches.length,
            first_json_attempt: jsonMatches[0]?.substring(0, 200),
            last_error: lastError?.message
          });
          return this.extractReasoningFromText(response, context);
        }
        
        // Validate and construct result
        return {
          true_user_need: parsed.true_user_need || context.user_request,
          execution_plan: Array.isArray(parsed.execution_plan) ? parsed.execution_plan : [context.user_request],
          required_tools: Array.isArray(parsed.required_tools) ? parsed.required_tools : [],
          expected_challenges: Array.isArray(parsed.expected_challenges) ? parsed.expected_challenges : [],
          acknowledgment_approach: parsed.acknowledgment_approach || 'I\'m thinking about your request...',
          confidence_level: parsed.confidence_level || 0.7,
          complexity_assessment: {
            level: parsed.complexity_assessment?.level || 'medium',
            reasoning_depth_required: parsed.complexity_assessment?.reasoning_depth_required || 2,
            tool_orchestration_complexity: parsed.complexity_assessment?.tool_orchestration_complexity || 1,
            context_dependencies: Array.isArray(parsed.complexity_assessment?.context_dependencies) 
              ? parsed.complexity_assessment.context_dependencies : []
          },
          thinking_summary: parsed.thinking_summary || 'Analyzed the request and created execution plan',
          processing_notes: parsed.processing_notes || 'Standard reasoning process completed',
          generated_content: response // Store full reasoning for debugging
        };
      }
      
      // Fallback if JSON parsing fails but we have response content
      return this.extractReasoningFromText(response, context);
      
    } catch (error) {
      this.logger.logError('reasoning_parse_failed', error);
      return this.createFallbackReasoning(context);
    }
  }

  private extractReasoningFromText(response: string, context: ReasoningContext): SubconsciousResult {
    // Extract actual reasoning content from DeepSeek's response, even if JSON is broken
    
    // Extract thinking content from <think> tags
    const thinkMatch = response.match(/<think>([\s\S]*?)<\/think>/);
    const thinkingContent = thinkMatch ? thinkMatch[1].trim() : '';
    
    // Extract insights from the thinking content
    let userNeedInsight = context.user_request;
    let executionSteps = [`Process request: ${context.user_request}`];
    let challenges = ['Standard execution challenges'];
    let acknowledgment = 'I\'m working on your request...';
    
    if (thinkingContent) {
      // Look for actual insights in the thinking content
      const lines = thinkingContent.split('\n').filter(line => line.trim());
      
      // Extract user need analysis
      const needMatches = lines.filter(line => 
        line.toLowerCase().includes('user') && 
        (line.toLowerCase().includes('want') || line.toLowerCase().includes('need') || line.toLowerCase().includes('asking'))
      );
      if (needMatches.length > 0) {
        userNeedInsight = needMatches[0].trim();
      }
      
      // Extract execution insights
      const actionLines = lines.filter(line => 
        line.toLowerCase().includes('should') || 
        line.toLowerCase().includes('need to') ||
        line.toLowerCase().includes('can') ||
        line.toLowerCase().includes('will')
      );
      if (actionLines.length > 0) {
        executionSteps = actionLines.slice(0, 3).map(line => line.trim());
      }
      
      // Extract challenges/considerations
      const challengeLines = lines.filter(line => 
        line.toLowerCase().includes('challenge') ||
        line.toLowerCase().includes('difficult') ||
        line.toLowerCase().includes('problem') ||
        line.toLowerCase().includes('but') ||
        line.toLowerCase().includes('however')
      );
      if (challengeLines.length > 0) {
        challenges = challengeLines.slice(0, 2).map(line => line.trim());
      }
      
      // Create acknowledgment from the thinking tone
      if (thinkingContent.length > 50) {
        acknowledgment = `I can see what you're asking for here. Let me work through this systematically.`;
      }
    }
    
    // Try to extract any JSON fragments that might be valid
    const jsonMatches = response.match(/\{[^}]*"true_user_need"[^}]*\}/g);
    let extractedNeed = userNeedInsight;
    if (jsonMatches && jsonMatches.length > 0) {
      try {
        const partial = JSON.parse(jsonMatches[0] + '}'); // Try to close it
        if (partial.true_user_need) {
          extractedNeed = partial.true_user_need;
        }
      } catch {
        // Keep the extracted insight
      }
    }
    
    return {
      true_user_need: extractedNeed,
      execution_plan: executionSteps,
      required_tools: context.available_tools.slice(0, Math.min(3, context.available_tools.length)),
      expected_challenges: challenges,
      acknowledgment_approach: acknowledgment,
      confidence_level: thinkingContent ? 0.7 : 0.5, // Higher confidence if we extracted thinking
      complexity_assessment: {
        level: thinkingContent.length > 200 ? 'medium' : 'low',
        reasoning_depth_required: Math.min(3, Math.floor(thinkingContent.length / 100) + 1),
        tool_orchestration_complexity: executionSteps.length > 1 ? 2 : 1,
        context_dependencies: []
      },
      thinking_summary: thinkingContent ? 
        `DeepSeek reasoning: ${thinkingContent.substring(0, 200)}${thinkingContent.length > 200 ? '...' : ''}` :
        'Extracted reasoning from text response',
      processing_notes: `Preserved DeepSeek thinking content (${thinkingContent.length} chars)`,
      generated_content: response // Keep full response for debugging
    };
  }

  private createFallbackReasoning(context: ReasoningContext): SubconsciousResult {
    return {
      true_user_need: context.user_request,
      execution_plan: [`Execute: ${context.user_request}`],
      required_tools: context.available_tools.slice(0, 2),
      expected_challenges: ['Unknown challenges - reasoning failed'],
      acknowledgment_approach: 'Let me work on that for you...',
      confidence_level: 0.4,
      complexity_assessment: {
        level: 'medium',
        reasoning_depth_required: 1,
        tool_orchestration_complexity: 1,
        context_dependencies: []
      },
      thinking_summary: 'Fallback reasoning due to system limitation',
      processing_notes: 'DeepSeek reasoning unavailable - using fallback',
      generated_content: 'Fallback reasoning'
    };
  }

  /**
   * Quick complexity assessment without full reasoning
   */
  async assessComplexity(request: string): Promise<{ level: string; score: number }> {
    try {
      const complexityPrompt = `Analyze the complexity of this request on a scale of 1-10:

REQUEST: "${request}"

Consider:
- Reasoning depth required
- Number of steps needed
- Tool orchestration complexity
- Context dependencies

Respond with ONLY: {"level": "low|medium|high|extreme", "score": 5.5}`;

      const queueResult = await this.ollamaQueue.enqueueRequest(
        'deepseek-r1:8b',
        complexityPrompt,
        {
          temperature: 0.3,
          num_ctx: 4096, // Smaller context for quick assessment
          num_predict: 100, // Just need simple JSON response
          num_gpu: 10
        },
        60000, // 1 minute for quick assessment
        'SubconsciousReasoner_complexity',
        'low' // Low priority for complexity assessment
      );

      if (!queueResult.success) {
        throw new Error(`Complexity assessment failed: ${queueResult.error}`);
      }

      const response = queueResult.data?.response || '';
      const match = response.match(/\{[^}]*\}/);
      
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          level: parsed.level || 'medium',
          score: parsed.score || 5.0
        };
      }
    } catch (error) {
      this.logger.logError('complexity_assessment_failed', error);
    }
    
    return { level: 'medium', score: 5.0 };
  }

  /**
   * Health check for DeepSeek availability
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5000 });
      const models = response.data.models || [];
      return models.some((model: any) => 
        model.name === 'deepseek-r1:8b' || 
        model.name.startsWith('deepseek') && model.name.includes('r1')
      );
    } catch {
      return false;
    }
  }
}