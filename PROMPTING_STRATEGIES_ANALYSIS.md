# 🎯 Prompting Strategies Analysis: Gemini-CLI vs Coquette
## The Secret Sauce: How We Tell AI Agents What To Do

---

## 🎭 **Overview**

This document extracts and compares the prompting strategies used in both Gemini-CLI and our Coquette system. These prompts are the **"programming languages"** we use to instruct AI models to behave as specialized agents.

---

## 🏗️ **Gemini-CLI Core Prompting Architecture**

### **📋 Master System Prompt** (`getCoreSystemPrompt()`)

**Purpose**: Transform the AI model into a specialized CLI software engineering agent

**Key Components**:

1. **Role Definition**:
```
You are an interactive CLI agent specializing in software engineering tasks. Your primary goal is to help users safely and efficiently, adhering strictly to the following instructions and utilizing your available tools.
```

2. **Core Mandates** (The Rules):
- **Conventions**: "Rigorously adhere to existing project conventions"
- **Libraries/Frameworks**: "NEVER assume a library/framework is available"
- **Style & Structure**: "Mimic the style, structure, framework choices"
- **Idiomatic Changes**: "Understand the local context"
- **Comments**: "Add code comments sparingly. Focus on *why*"
- **Proactiveness**: "Fulfill the user's request thoroughly"

3. **Primary Workflows**:
   - **Software Engineering Tasks**: 5-step process (Understand → Plan → Implement → Verify Tests → Verify Standards)
   - **New Applications**: 6-step process (Understand → Propose → Approve → Implement → Verify → Feedback)

4. **Operational Guidelines**:
   - **Tone**: "Concise & Direct", "Minimal Output", "No Chitchat"
   - **Security**: "Explain Critical Commands", "Security First"
   - **Tool Usage**: "Always use absolute paths", "Execute in parallel"

5. **Examples Section**: 
   - Shows the exact tone and workflow patterns expected
   - Demonstrates tool usage patterns
   - Sets response length expectations

**Pattern**: **Comprehensive Instruction Manual** - Everything the agent needs to know in one massive prompt

---

### **📊 History Compression Prompt** (`getCompressionPrompt()`)

**Purpose**: Intelligently summarize conversation history when context window fills up

**Structure**:
```xml
<scratchpad>
<!-- Private reasoning space -->
</scratchpad>

<state_snapshot>
    <overall_goal><!-- Single sentence objective --></overall_goal>
    <key_knowledge><!-- Crucial facts in bullet points --></key_knowledge>
    <file_system_state><!-- Files created/modified/deleted --></file_system_state>
    <recent_actions><!-- Last few significant actions --></recent_actions>
    <current_plan><!-- Step-by-step plan with [DONE/IN PROGRESS/TODO] --></current_plan>
</state_snapshot>
```

**Pattern**: **Structured Memory Preservation** - Ensures no critical information is lost during compression

---

## 🎭 **Coquette Multi-Agent Prompting Architecture**

### **🎯 InputRouter Prompting** (`buildIntentPrompt()`)

**Purpose**: Fast, efficient intent classification

**Prompt Strategy**:
```typescript
`You are a silent, efficient intent router. Analyze the user's request and determine if it is a simple chat message, a task that requires using tools, or a request for information about a specific library.

- A 'task' involves actions like finding files, reading content, running commands, or searching the web.
- A 'chat' is a conversational query, a question, or a statement.
- A 'contextualize' request is when the user asks for information, documentation, or examples for a specific software library.

Respond ONLY with a single, minified JSON object with the following structure:
{"intent": "task" | "chat" | "contextualize", "summary": "<brief summary>", "library_name": "<library if contextualize>"}

User Request: "${userInput}"

Response:`;
```

**Pattern**: **Minimal Classification Agent** - Single-purpose, fast decisions with structured output

---

### **🧠 IntelligenceRouter Prompting** (`buildModelSelectionPrompt()`)

**Purpose**: Meta-reasoning about which AI model to use

**Prompt Strategy**:
```typescript
`You are a model selection expert. Choose the optimal AI model for this request:

AVAILABLE MODELS:
1. gemma3n:e4b
   - Best for: personality, chat, general conversation, simple questions
   - Strengths: fast, conversational, character consistency
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
[...context details...]

DECISION CRITERIA:
- Complexity: How complex is the reasoning required?
- Type: Is this chat, technical analysis, or documentation lookup?
- Tools: Does this require tool orchestration and planning?
- Time: Can this be answered quickly or needs deep thinking?

Choose the most appropriate model and explain your reasoning.

Respond with ONLY this JSON format:
{
  "model": "gemma3n:e4b|deepseek:r1-8b|context7",
  "reasoning": "brief explanation why this model is optimal",
  "confidence": 0.95,
  "complexity_level": "low|medium|high",
  "expected_processing_time": 30
}`;
```

**Pattern**: **Expert Advisor Agent** - Provides reasoning about optimal tool/model selection

---

### **🧠 SubconsciousReasoner Prompting** (`buildReasoningPrompt()`)

**Purpose**: Deep thinking and planning before action (inspired by human "System 2" thinking)

**Prompt Strategy**:
```typescript
`<subconscious_analysis>
You are performing deep subconscious reasoning using advanced AI capabilities. Think deeply and systematically about this request.

REQUEST CONTEXT:
User Request: "${context.user_request}"
Intent Classification: ${context.intent_result?.intent || 'unknown'}
Available Tools: ${context.available_tools.join(', ') || 'none'}
Conversation History: ${context.conversation_history.length} messages
Active Goals: ${context.active_goals.join(', ') || 'none'}
Context Summary: ${context.context_summary}

DEEP ANALYSIS PROCESS:
Think through each of these questions carefully:

1. UNDERSTANDING: What is the user REALLY asking for? Look beyond the surface request to understand their true need.

2. COMPLEXITY: How complex is this request? What level of reasoning, tool orchestration, and planning is required?

3. STRATEGY: What is the optimal step-by-step approach? What tools are needed and in what order?

4. CHALLENGES: What potential complications, edge cases, or failure points exist?

5. CONTEXT: What additional context or information might be needed?

6. ACKNOWLEDGMENT: How should I communicate my thinking process to the user while maintaining Ani's personality?

7. EXECUTION: What is the precise execution plan with contingencies?

8. VALIDATION: How will I know if the approach is working correctly?

Think step-by-step through your reasoning process. Show your work.
</subconscious_analysis>

Based on your deep analysis, provide a comprehensive reasoning result that will guide the execution:

FORMAT YOUR RESPONSE AS:
{
  "true_user_need": "what the user actually needs beyond surface request",
  "execution_plan": ["step 1", "step 2", "step 3", "..."],
  "required_tools": ["tool1", "tool2", "..."],
  "expected_challenges": ["challenge 1", "challenge 2", "..."],
  "acknowledgment_approach": "how to communicate thinking process to user naturally",
  "confidence_level": 0.85,
  "complexity_assessment": {
    "level": "low|medium|high|extreme",
    "reasoning_depth_required": 3,
    "tool_orchestration_complexity": 2,
    "context_dependencies": ["dependency1", "dependency2"]
  },
  "thinking_summary": "brief summary of your reasoning process",
  "processing_notes": "internal notes for system optimization"
}`;
```

**Pattern**: **Deliberate Thinking Agent** - Encourages deep analysis with explicit thinking steps and structured output

---

### **🎭 PersonalityProvider Prompting** (`buildInterpretationPrompt()`)

**Purpose**: Filter technical responses through character personalities

**Two-Mode Strategy**:

**Full Personality Mode** (for complex interactions):
```typescript
`${personalityPrompt}

## Conversation Context
${conversationContext}

## Current Context
You have received a technical analysis that you need to interpret through your personality.

**User Query:** ${originalQuery}
**Technical Response:** ${technicalResponse}

## Task
Interpret the technical response in your characteristic style while maintaining accuracy. Reference specific details from the analysis and maintain continuity with the conversation.

Response:`;
```

**Short Reminder Mode** (for efficiency):
```typescript
`${personalityPrompt}

${conversationContext}

**Query:** ${originalQuery}
**Tech Response:** ${technicalResponse}

Interpret in your style:`;
```

**Pattern**: **Character Interpretation Agent** - Maintains personality consistency while preserving technical accuracy

---

## 🎯 **Key Prompting Pattern Differences**

### **Gemini-CLI Pattern: Single Comprehensive Agent**
- **One massive system prompt** (~266 lines)
- **Everything in one place**: workflows, rules, examples, tone
- **Monolithic instruction manual**
- **Heavy upfront context loading**

### **Coquette Pattern: Specialized Agent Chain**
- **Multiple focused prompts** for different cognitive tasks
- **Each agent has specific purpose** and prompt strategy
- **Modular prompt architecture**
- **Dynamic context management**

---

## 🧠 **Cognitive Prompting Innovations in Coquette**

### **1. Meta-Reasoning Prompts**
- **IntelligenceRouter**: AI choosing which AI to use
- **SubconsciousReasoner**: Explicit "thinking before acting"
- **Pattern**: Recursive intelligence - AI reasoning about AI reasoning

### **2. Structured Thinking Process**
- **8-step analysis framework** in SubconsciousReasoner
- **Explicit reasoning validation**: "How will I know if this works?"
- **Pattern**: Guided cognitive process instead of freeform generation

### **3. Personality Separation**
- **Technical analysis separate from personality interpretation**
- **Two-mode personality prompting** (full vs minimal)
- **Pattern**: Accuracy first, personality second

### **4. Context-Aware Prompting**
- **Dynamic prompt construction** based on conversation history
- **Token-aware context management** (18k token budget)
- **Smart truncation** with recent message priority
- **Pattern**: Adaptive prompting based on available context

---

## 🔧 **Technical Prompting Strategies**

### **JSON Output Enforcement**
Both systems use structured JSON output:

**Gemini-CLI Pattern**:
```
Respond ONLY with a single, minified JSON object with the following structure:
```

**Coquette Pattern**:
```
FORMAT YOUR RESPONSE AS:
{...detailed JSON schema...}
```

### **Error Recovery Prompting**
**Gemini-CLI**: Comprehensive error handling in system prompt
**Coquette**: Enhanced JSON parsing with multiple fallback strategies:
- Strip `<think>` tags from JSON
- Auto-complete incomplete JSON
- Extract reasoning from text when JSON fails
- Preserve intelligence even when formatting breaks

### **Tool Integration Prompting**
**Gemini-CLI**: Tool names dynamically inserted into prompts:
```typescript
Use '${ReadFileTool.Name}' or '${WriteFileTool.Name}'
```

**Coquette**: Tool listing in context:
```typescript
Available Tools: ${context.available_tools.join(', ') || 'none'}
```

---

## 🎯 **Prompting Best Practices Extracted**

### **From Gemini-CLI**:
1. **Comprehensive System Prompts**: Include everything needed upfront
2. **Explicit Examples**: Show exact expected behavior
3. **Safety First**: Explain dangerous operations before execution
4. **Tool Integration**: Dynamic tool name insertion
5. **Workflow Definition**: Step-by-step processes for complex tasks

### **From Coquette**:
1. **Specialized Agents**: Single-purpose prompts for specific cognitive tasks
2. **Structured Thinking**: Explicit reasoning frameworks
3. **Meta-Reasoning**: AI choosing optimal AI for the task
4. **Personality Separation**: Technical accuracy separate from character
5. **Enhanced Error Recovery**: Preserve intelligence when formatting fails

---

## 🚀 **Advanced Prompting Techniques**

### **1. Thinking Tags** (Coquette Innovation)
```xml
<subconscious_analysis>
[Deep thinking space for reasoning]
</subconscious_analysis>

<think>
[DeepSeek's internal reasoning preserved even when JSON fails]
</think>
```

### **2. Dynamic Context Windows** (Coquette)
- Token-aware conversation history management
- Recent message priority preservation
- Smart truncation algorithms

### **3. Multi-Modal Intelligence** (Coquette)
- Different prompting strategies for different models
- Model-specific optimization (DeepSeek vs Gemma)
- Confidence-based decision making

### **4. Prompt Chaining** (Coquette)
- Output of one agent becomes input to next
- Reasoning flows through the intelligence chain
- Context accumulation across agents

---

## 📊 **Prompt Performance Metrics**

### **Token Efficiency**:
- **InputRouter**: ~200 tokens → JSON response
- **IntelligenceRouter**: ~400 tokens → Model selection  
- **SubconsciousReasoner**: ~600 tokens → Deep analysis
- **PersonalityProvider**: 300-3000 tokens (adaptive)

### **Response Quality**:
- **Structured JSON**: Enforced through schema validation
- **Fallback Strategies**: Multiple parsing attempts
- **Intelligence Preservation**: Reasoning saved even when formatting fails

---

## 🎯 **Conclusion: The Art of AI Instruction**

**Gemini-CLI teaches us**: How to create comprehensive, single-agent systems with clear workflows and safety measures.

**Coquette innovates with**: Multi-agent cognitive architectures where different AI models handle different aspects of thinking, with sophisticated prompting strategies for each cognitive layer.

**The Future**: Combining Gemini-CLI's comprehensive instruction patterns with Coquette's multi-agent cognitive specialization for even more powerful AI systems.

---

*These prompting strategies represent the current state-of-the-art in AI agent instruction, showing how careful prompt engineering can create sophisticated, reliable, and specialized AI behaviors.*