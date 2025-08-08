# 🧠 Multi-Model Intelligence Integration Plan
*Comprehensive roadmap for subconscious reasoning and model routing*

## 🎯 **CORE PRINCIPLE: OLLAMA IS SOURCE OF TRUTH**
**Critical:** All intelligence decisions, reasoning, and model selection must flow through Ollama models - NO hardcoded NLP/keyword processing. Every decision must be AI-driven through prompt engineering.

---

## 🏗 **TARGET ARCHITECTURE: Multi-Model Intelligence System**

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User Input    │───▶│ IntelligenceRouter│───▶│  Model Selection │
│                 │    │ (Ollama-driven)   │    │   & Execution   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                  ┌─────────────────────────────┐    ┌─────────────────┐
                  │     OLLAMA MODELS:          │    │ SubconsciousAck │
                  │                             │    │    System       │
                  │ 🎭 Gemma3n:e4b             │    │                 │
                  │    - Personality/Chat       │    │ - Thinking logs │
                  │    - Ani character          │    │ - Process ack   │
                  │                             │    │ - Context aware │
                  │ 🧠 DeepSeek:r1-8b          │    │                 │
                  │    - Complex reasoning      │    └─────────────────┘
                  │    - Tool planning          │             │
                  │    - Problem decomposition  │             ▼
                  │                             │    ┌─────────────────┐
                  │ 📚 Context7                │    │  OutputCleaner   │
                  │    - Library docs           │    │                 │
                  │    - Code context           │    │ - Clean results │
                  └─────────────────────────────┘    │ - Format output │
                                                     └─────────────────┘
```

---

## 📋 **IMPLEMENTATION PHASES**

### **Phase 1: Intelligence Router (Ollama-Driven Model Selection)**
**File:** `src/core/IntelligenceRouter.ts`

```typescript
export class IntelligenceRouter {
  // CRITICAL: Uses Ollama to determine optimal model, NOT keywords
  async determineOptimalModel(request: string, context: any): Promise<ModelSelection> {
    // Send to lightweight Gemma for model selection decision
    const selectionPrompt = this.buildModelSelectionPrompt(request, context);
    const decision = await this.ollama.generate('gemma3n:e4b', selectionPrompt);
    
    return this.parseModelDecision(decision);
  }
  
  private buildModelSelectionPrompt(request: string, context: any): string {
    return `You are a model selector. Analyze this request and determine the optimal AI model:

AVAILABLE MODELS:
- gemma3n:e4b - Use for personality, chat, general conversation, character responses
- deepseek:r1-8b - Use for complex reasoning, tool planning, problem solving, analysis  
- context7 - Use for library documentation, code context, technical references

REQUEST: "${request}"
CONTEXT: ${JSON.stringify(context, null, 2)}

Respond with ONLY a JSON object:
{"model": "model_name", "reasoning": "why this model", "confidence": 0.9}`;
  }
}
```

### **Phase 2: Subconscious Reasoning System**
**File:** `src/core/SubconsciousReasoner.ts`

```typescript
export class SubconsciousReasoner {
  // Uses DeepSeek R1-8B for deep thinking before action
  async performSubconsciousAnalysis(request: string, context: any): Promise<SubconsciousResult> {
    const reasoningPrompt = this.buildReasoningPrompt(request, context);
    
    // Use DeepSeek R1-8B with conservative GPU offloading for stability  
    const reasoning = await this.ollama.generate('deepseek:r1-8b', reasoningPrompt, {
      gpu_layers: 15, // Conservative GPU offloading for GTX 1070 Ti
      temperature: 0.3, // More focused reasoning
      context_length: 24000, // Reduced from 128K to prevent OOM
      timeout: 360000  // 6 minutes for deep thinking
    });
    
    return this.parseReasoningOutput(reasoning);
  }
  
  private buildReasoningPrompt(request: string, context: any): string {
    return `<thinking>
You are performing subconscious analysis. Think deeply about this request:

REQUEST: "${request}"
AVAILABLE_CONTEXT: ${JSON.stringify(context, null, 2)}

Analyze:
1. What is the user really asking for?
2. What tools or knowledge are needed?
3. What potential complications exist?
4. What is the optimal execution strategy?
5. How should this be acknowledged to the user?

Think step by step, showing your reasoning process.
</thinking>

Based on your analysis, provide:
- execution_plan: Step-by-step plan
- required_tools: List of needed tools
- expected_challenges: Potential issues
- acknowledgment: How to communicate thinking to user
- confidence: How certain you are (0-1)`;
  }
}
```

### **Phase 3: Subconscious Acknowledgment System**
**File:** `src/core/SubconsciousAcknowledgment.ts`

```typescript
export class SubconsciousAcknowledgment {
  // Provides transparent thinking process to user
  async generateThinkingAcknowledgment(
    reasoning: SubconsciousResult,
    progress: ExecutionProgress
  ): Promise<AcknowledgmentMessage> {
    
    // Use Gemma for personality-aware acknowledgment
    const ackPrompt = this.buildAcknowledgmentPrompt(reasoning, progress);
    const response = await this.ollama.generate('gemma3n:e4b', ackPrompt);
    
    return {
      thinking_summary: response.thinking_summary,
      progress_update: response.progress_update,
      next_steps: response.next_steps,
      personality_context: 'ani' // Maintain Ani's character
    };
  }
  
  private buildAcknowledgmentPrompt(reasoning: SubconsciousResult, progress: ExecutionProgress): string {
    return `You are Ani. You've been thinking deeply about the user's request. 
    
REASONING PERFORMED: ${reasoning.execution_plan}
CURRENT PROGRESS: ${progress.current_step}
TOOLS BEING USED: ${progress.active_tools}

As Ani, acknowledge your thinking process to the user in a natural, helpful way. 
Show that you're processing their request thoughtfully without being too technical.
Keep it conversational and maintain your personality.

Provide a brief acknowledgment that shows:
1. You understand what they're asking
2. What you're currently thinking about/working on  
3. What to expect next

Keep it concise but reassuring.`;
  }
}
```

---

## 🔗 **SYSTEM INTERCONNECTIONS**

### **1. Request Flow Through Multi-Model System:**
```typescript
// Updated ToolsAgent.ts integration
async processRequest(request: string): Promise<ToolResult> {
  // 1. Intelligence Router determines optimal model (Ollama-driven)
  const modelSelection = await this.intelligenceRouter.determineOptimalModel(request, context);
  
  // 2. If complex reasoning needed, use DeepSeek subconscious analysis
  if (modelSelection.model === 'deepseek:r1-8b') {
    const reasoning = await this.subconsciousReasoner.performSubconsciousAnalysis(request, context);
    
    // 3. Generate thinking acknowledgment to user
    const acknowledgment = await this.acknowledgmentSystem.generateThinkingAcknowledgment(reasoning, progress);
    this.emitThinkingUpdate(acknowledgment);
    
    // 4. Execute with reasoning guidance
    return this.executeWithReasoning(reasoning);
  }
  
  // 5. If library context needed, route to Context7
  if (modelSelection.model === 'context7') {
    return this.contextualizingAgent.processLibraryRequest(request);
  }
  
  // 6. Otherwise use standard Gemma personality processing
  return this.processWithGemma(request);
}
```

### **2. Context Manager Integration:**
```typescript
// ContextManager gets subconscious processing hooks
async getSubconsciousContext(request: string): Promise<SubconsciousContext> {
  // Use Ollama to determine relevant context, not keyword matching
  const contextPrompt = `Given this request: "${request}"
  
  What context from memory would be most relevant?
  Consider conversation history, recent tasks, user patterns.
  
  Return specific context elements that would help with reasoning.`;
  
  const contextDecision = await this.ollama.generate('gemma3n:e4b', contextPrompt);
  return this.retrieveRelevantContext(contextDecision);
}
```

---

## 🎯 **INTEGRATION CHECKPOINTS**

### **Checkpoint 1: Ollama Model Selection Working**
- [ ] IntelligenceRouter created
- [ ] Ollama-driven model selection (no keywords)
- [ ] Proper model routing to Gemma/DeepSeek/Context7

### **Checkpoint 2: Subconscious Reasoning Active**  
- [ ] DeepSeek R1-8B configured with GPU offloading
- [ ] SubconsciousReasoner performing deep analysis
- [ ] Reasoning results feeding into tool execution

### **Checkpoint 3: Acknowledgment System Live**
- [ ] User sees thinking process transparently
- [ ] Ani personality maintained in acknowledgments  
- [ ] Progress updates during complex operations

### **Checkpoint 4: Full Integration**
- [ ] All systems working together seamlessly
- [ ] Context7 integrated with ToolsAgent
- [ ] OutputCleaner processing all results
- [ ] End-to-end multi-model intelligence flow

---

## ⚡ **PERFORMANCE NOTES**

- **GPU Offloading:** DeepSeek R1-8B uses 15 GPU layers to prevent system strain
- **Timeout Management:** 6-minute timeouts for complex reasoning operations
- **Context Efficiency:** Subconscious processing prioritizes relevant context only
- **Model Switching:** Intelligent routing minimizes unnecessary model switching

This creates a **true multi-model intelligence system** where each AI model handles what it does best, orchestrated by Ollama-driven decisions rather than primitive rule-based routing.