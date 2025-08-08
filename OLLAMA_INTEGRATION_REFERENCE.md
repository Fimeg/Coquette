# 🤖 Ollama Integration Reference
*Complete guide for Ollama-driven intelligence decisions*

## 🎯 **CORE PRINCIPLE: OLLAMA IS THE BRAIN**

**CRITICAL RULE:** Every decision, classification, and routing MUST go through Ollama models. No hardcoded logic, no keyword matching, no NLP libraries. **Ollama AI makes ALL intelligence decisions.**

---

## 🧠 **OLLAMA MODEL ROLES**

### **🎭 Gemma3n:E4b - The Personality & Coordinator**
```typescript
// Primary uses:
- Personality interpretation (Ani character)
- Intent classification (task/chat/contextualize)
- Model selection decisions
- General conversation
- Coordination between systems

// Configuration:
model: 'gemma3n:e4b'
temperature: 0.7 // Creative for personality
gpu_layers: 'auto' // Optional GPU acceleration
timeout: 360000 // 6 minutes
```

### **🧠 DeepSeek:R1-8b - The Subconscious Reasoner**
```typescript
// Primary uses:
- Complex problem analysis
- Tool planning and strategy
- Subconscious reasoning processes
- Architecture analysis
- Deep thinking tasks

// Configuration:
model: 'deepseek:r1-8b'
temperature: 0.3 // Focused reasoning
gpu_layers: 15 // AMA GPU offloading for performance
timeout: 360000 // 6 minutes for deep thinking
```

### **📚 Context7 - The Knowledge Specialist** 
```typescript
// Primary uses:
- Library documentation queries
- Code context analysis
- Technical reference lookup
- API documentation

// Integration:
// Runs as separate service via ContextualizingAgent
// Port: 3000
// Called when IntelligenceRouter determines library context needed
```

---

## 🚀 **OLLAMA PROMPT PATTERNS**

### **Pattern 1: Intent Classification**
```typescript
const intentPrompt = `You are an intent classifier. Analyze this user request:

REQUEST: "${userInput}"
CONVERSATION_CONTEXT: ${conversationSummary}
USER_PATTERNS: ${userBehaviorPatterns}

Classify the intent as:
- "task" - Requires tools, file operations, system commands, or actions
- "chat" - General conversation, questions, personality interaction
- "contextualize" - Needs library docs, code references, technical context

Consider the full context, not just keywords. What does the user actually need?

Respond with ONLY a JSON object:
{
  "intent": "task|chat|contextualize",
  "confidence": 0.95,
  "reasoning": "brief explanation",
  "library_name": "if contextualize, what library/topic"
}`;
```

### **Pattern 2: Model Selection**
```typescript
const modelSelectionPrompt = `You are a model selection expert. Choose the optimal AI model:

USER_REQUEST: "${request}"
CLASSIFIED_INTENT: ${intentResult.intent}
COMPLEXITY_INDICATORS: ${complexityAnalysis}
AVAILABLE_CONTEXT: ${contextSummary}

AVAILABLE MODELS:
1. gemma3n:e4b 
   - Best for: personality, chat, coordination, simple tasks
   - Strengths: fast, conversational, character consistency
   
2. deepseek:r1-8b
   - Best for: complex reasoning, analysis, problem-solving, planning
   - Strengths: deep thinking, logical analysis, step-by-step reasoning
   
3. context7
   - Best for: library docs, API references, code context
   - Strengths: specific technical knowledge, documentation lookup

Which model should handle this request? Consider:
- Complexity level
- Type of thinking required
- Response style needed
- Processing time acceptable

Respond with ONLY:
{
  "selected_model": "model_name",
  "reasoning": "why this model is optimal", 
  "confidence": 0.90,
  "expected_processing_time": "estimated seconds"
}`;
```

### **Pattern 3: Subconscious Reasoning**
```typescript
const subconsciousPrompt = `<subconscious_analysis>
You are performing deep subconscious reasoning. Think step-by-step about:

REQUEST: "${request}"
FULL_CONTEXT: ${JSON.stringify(context, null, 2)}
AVAILABLE_TOOLS: ${availableTools}
USER_HISTORY: ${relevantHistory}

DEEP ANALYSIS PROCESS:
1. What is the user REALLY asking for? (Look beyond surface request)
2. What knowledge or tools are required?
3. What are the potential challenges or edge cases?
4. What's the optimal step-by-step approach?
5. How should I acknowledge my thinking process to the user?
6. What personality elements should guide the response?

Think through each step carefully. Show your reasoning process.
</subconscious_analysis>

Based on your deep analysis, provide:
{
  "true_user_need": "what they actually need",
  "execution_strategy": ["step1", "step2", "step3"],
  "required_tools": ["tool1", "tool2"],
  "potential_challenges": ["challenge1", "challenge2"],
  "acknowledgment_approach": "how to communicate thinking to user",
  "confidence_level": 0.85,
  "processing_notes": "internal notes for system"
}`;
```

### **Pattern 4: Context Relevance**
```typescript
const contextRelevancePrompt = `You are a context relevance analyzer. Determine what historical context is relevant:

CURRENT_REQUEST: "${request}"
CONVERSATION_HISTORY: ${recentHistory}
USER_PATTERNS: ${userPatterns}
AVAILABLE_MEMORY: ${memorySlices}

Which pieces of context would be most helpful for understanding and responding to this request?
Consider:
- Direct relevance to current topic
- User's demonstrated interests/patterns
- Previous similar requests
- Emotional/personality context
- Technical context from past interactions

Select the most relevant context elements and explain why each is important.

Respond with:
{
  "relevant_contexts": [
    {
      "context_id": "id",
      "relevance_score": 0.9,
      "reason": "why this context helps"
    }
  ],
  "context_summary": "brief summary of selected context",
  "context_influence": "how this should influence the response"
}`;
```

---

## 🔧 **OLLAMA API INTEGRATION PATTERNS**

### **Standard API Call Structure:**
```typescript
async function callOllama(
  model: string, 
  prompt: string, 
  options?: OllamaOptions
): Promise<OllamaResponse> {
  
  const response = await axios.post(`${this.baseUrl}/api/generate`, {
    model: model,
    prompt: prompt,
    stream: false,
    options: {
      temperature: options?.temperature || 0.7,
      num_ctx: options?.context_length || 131072,
      num_predict: options?.max_tokens || 4096,
      num_gpu: options?.gpu_layers || 0,
      ...options
    }
  }, {
    timeout: 360000, // 6 minutes
    headers: { 'Content-Type': 'application/json' }
  });
  
  return {
    content: response.data.response,
    metadata: {
      model: model,
      processing_time: response.data.total_duration,
      tokens_evaluated: response.data.eval_count
    }
  };
}
```

### **Error Handling with Ollama:**
```typescript
async function robustOllamaCall(model: string, prompt: string): Promise<OllamaResponse> {
  try {
    return await this.callOllama(model, prompt);
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Ollama server not running. Please start with: ollama serve`);
    }
    if (error.response?.status === 404) {
      throw new Error(`Model ${model} not available. Pull with: ollama pull ${model}`);
    }
    if (error.response?.status === 500) {
      // Retry once for server errors
      await new Promise(resolve => setTimeout(resolve, 2000));
      return await this.callOllama(model, prompt);
    }
    throw error;
  }
}
```

---

## 📊 **OLLAMA PERFORMANCE OPTIMIZATION**

### **GPU Configuration for DeepSeek:**
```bash
# Ollama Modelfile for DeepSeek R1-8B
FROM deepseek:r1-8b

# GPU offloading - use 15 layers for AMA GPU
PARAMETER num_gpu 15

# Memory optimization
PARAMETER num_ctx 131072
PARAMETER num_batch 512

# Reasoning optimization
PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.1
```

### **Performance Monitoring:**
```typescript
interface OllamaPerformanceMetrics {
  model: string;
  processing_time_ms: number;
  tokens_per_second: number;
  gpu_utilization: number;
  memory_usage_mb: number;
  context_tokens: number;
}

// Track performance for optimization
async function monitorOllamaPerformance(call: OllamaCall): Promise<OllamaPerformanceMetrics> {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  
  const result = await call();
  
  return {
    model: call.model,
    processing_time_ms: Date.now() - startTime,
    tokens_per_second: result.tokens / ((Date.now() - startTime) / 1000),
    memory_usage_mb: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
    // ... other metrics
  };
}
```

---

## 🎯 **INTEGRATION VALIDATION**

### **Test Ollama Decision Making:**
```bash
# Test 1: Intent classification
curl -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma3n:e4b",
    "prompt": "Classify intent: \"read the readme file\"",
    "stream": false
  }'

# Test 2: Model selection  
curl -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma3n:e4b", 
    "prompt": "Choose model for complex architecture analysis",
    "stream": false
  }'

# Test 3: DeepSeek reasoning
curl -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek:r1-8b",
    "prompt": "Analyze this system architecture problem...",
    "stream": false,
    "options": {"num_gpu": 15}
  }'
```

This reference ensures that every component in the system relies on **Ollama's AI intelligence** rather than hardcoded logic, creating a truly AI-driven decision-making architecture.