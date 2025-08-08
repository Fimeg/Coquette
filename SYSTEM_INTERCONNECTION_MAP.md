# 🔗 System Interconnection Map
*How all components connect in the multi-model intelligence architecture*

## 🧭 **COMPONENT RELATIONSHIP MATRIX**

### **EXISTING COMPONENTS (WORKING)**
```
┌─────────────────────────────────────────────────────────────────────┐
│                    CURRENT WORKING SYSTEMS                         │
├─────────────────────────────────────────────────────────────────────┤
│ ✅ InputRouter          - AI intent classification (6min timeout)   │
│ ✅ ContextManager       - Memory & context handling                 │  
│ ✅ OutputCleaner        - Content sanitization                      │
│ ✅ ToolsAgent           - Basic tool orchestration                   │
│ ✅ ContextualizingAgent - Context7 integration                      │
│ ✅ CoquetuteEngine      - Main orchestration                        │
│ ✅ OllamaToolProvider   - Updated for clean architecture            │
└─────────────────────────────────────────────────────────────────────┘
```

### **MISSING COMPONENTS (TO BE BUILT)**
```
┌─────────────────────────────────────────────────────────────────────┐
│                    MISSING CRITICAL SYSTEMS                        │
├─────────────────────────────────────────────────────────────────────┤
│ 🔴 IntelligenceRouter    - Multi-model selection (Ollama-driven)    │
│ 🔴 SubconsciousReasoner  - DeepSeek R1-8B integration               │
│ 🔴 SubconsciousAck       - Thinking acknowledgment system           │
│ 🔴 DeepSeekProvider      - R1-8B reasoning provider                 │
│ 🔴 ModelConfigManager    - GPU offloading & model configs           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🌐 **INTERCONNECTION FLOW DIAGRAM**

```
USER INPUT
    │
    ▼
┌─────────────────┐
│ CoquetuteEngine │ ◄────────────── System Orchestrator
└─────────┬───────┘
          │
          ▼
┌─────────────────┐         ┌──────────────────┐
│   InputRouter   │────────▶│ IntelligenceRouter│ ◄── **NEW**
│  (AI Intent)    │         │ (Model Selection) │     Ollama-driven
└─────────────────┘         └─────────┬────────┘
          │                           │
          ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│ ContextManager  │◄────────│ DECISION POINT  │
│  (Memory/Ctx)   │         │                 │
└─────────────────┘         │ Route to:       │
          │                 │ • Gemma3n:e4b   │
          ▼                 │ • DeepSeek:r1-8b│
┌─────────────────┐         │ • Context7      │
│    MODELS:      │◄────────┴─────────────────┘
│                 │
│ 🎭 GEMMA3N:E4B  │ ◄── Personality & Chat
│   (Personality) │     ↕ ContextManager
│                 │     ↕ SubconsciousAck
│                 │
│ 🧠 DEEPSEEK:R1-8B│ ◄── **NEW** Complex Reasoning  
│   (Reasoning)   │     ↕ SubconsciousReasoner
│                 │     ↕ GPU Offloading (15 layers)
│                 │
│ 📚 CONTEXT7     │ ◄── Library Documentation
│   (Docs/Code)   │     ↕ ContextualizingAgent
└─────────┬───────┘
          │
          ▼
┌─────────────────┐         ┌─────────────────┐
│   ToolsAgent    │◄────────│SubconsciousAck  │ ◄── **NEW**
│ (Tool Execution)│         │ (Thinking UI)   │     User transparency
└─────────┬───────┘         └─────────────────┘
          │
          ▼
┌─────────────────┐
│  OutputCleaner  │ ◄────── Clean all outputs
│  (Sanitization) │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│  FINAL OUTPUT   │ ◄────── To user via TUI
│   (To User)     │
└─────────────────┘
```

---

## 🔄 **DETAILED INTERCONNECTION PATTERNS**

### **Pattern 1: Simple Chat (Personality Only)**
```
User: "How are you today?"
├─ InputRouter → intent: 'chat'
├─ IntelligenceRouter → model: 'gemma3n:e4b'  
├─ ContextManager → personality context
├─ Gemma3n:e4b → Ani personality response
├─ OutputCleaner → clean response
└─ User ← "I'm doing well! Thanks for asking ☺️"
```

### **Pattern 2: Complex Reasoning (Multi-Model)**
```
User: "Analyze the architecture and suggest improvements"
├─ InputRouter → intent: 'task' 
├─ IntelligenceRouter → model: 'deepseek:r1-8b'
├─ SubconsciousReasoner → deep analysis (6min timeout)
├─ SubconsciousAck → "I'm analyzing the architecture..."
├─ ContextManager → relevant code context
├─ ToolsAgent → file reading, analysis tools
├─ DeepSeek:r1-8b → reasoning with GPU offloading
├─ SubconsciousAck → "Found several improvement areas..."
├─ Gemma3n:e4b → personality interpretation of results
├─ OutputCleaner → formatted recommendations
└─ User ← Detailed architectural analysis with Ani's personality
```

### **Pattern 3: Library Documentation (Context7)**
```
User: "How do I use React Query?"
├─ InputRouter → intent: 'contextualize'
├─ IntelligenceRouter → model: 'context7'
├─ ContextualizingAgent → library: 'react-query'
├─ Context7 → documentation lookup
├─ ContextManager → user's coding context
├─ Gemma3n:e4b → personality interpretation
├─ OutputCleaner → formatted examples
└─ User ← React Query examples with Ani's explanations
```

---

## 🧠 **SUBCONSCIOUS SYSTEM INTEGRATION**

### **Acknowledgment Flow:**
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Deep Reasoning  │───▶│ Thinking Status │───▶│ User Interface  │
│   (DeepSeek)    │    │ (SubconsciousAck)│    │     (TUI)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
"Analyzing request..."   "I'm thinking about..."   "💭 Ani is thinking..."
"Considering tools..."   "Found complexity..."     "🔧 Planning approach..."
"Planning approach..."   "Executing strategy..."   "⚡ Working on it..."
```

### **Context Integration:**
```
ContextManager ◄────────┐
     │                  │
     ▼                  │
┌─────────────────┐    │
│ Subconscious    │    │
│ Context Hooks   │────┘
│                 │
│ • Recent memory │
│ • User patterns │  
│ • Task history  │
│ • Emotional state│
└─────────────────┘
```

---

## 🎯 **INTEGRATION VALIDATION POINTS**

### **System Health Checks:**
1. **Model Routing:** IntelligenceRouter correctly selects models via Ollama
2. **Reasoning Flow:** DeepSeek R1-8B performs subconscious analysis
3. **Acknowledgment:** User sees thinking process transparently
4. **Context Continuity:** ContextManager maintains conversation coherence
5. **Output Quality:** OutputCleaner produces clean, formatted results
6. **Performance:** GPU offloading prevents system strain

### **Integration Test Flows:**
```bash
# Test 1: Simple chat (Gemma only)
Input: "Tell me a joke"
Expected: Gemma3n:e4b → Ani personality → Clean joke

# Test 2: Complex reasoning (Multi-model)  
Input: "Debug this complex codebase issue"
Expected: DeepSeek reasoning → Tool execution → Gemma interpretation

# Test 3: Library context (Context7)
Input: "Explain TypeScript generics"
Expected: Context7 docs → Gemma explanation → Clean examples
```

---

## 📊 **PERFORMANCE INTERCONNECTION MATRIX**

| Component | CPU Usage | GPU Usage | Memory | Timeout |
|-----------|-----------|-----------|--------|---------|
| InputRouter | Low | None | 50MB | 6min |
| IntelligenceRouter | Low | None | 25MB | 30sec |
| Gemma3n:e4b | Medium | Optional | 200MB | 6min |
| DeepSeek:r1-8b | High | 15 layers | 500MB | 6min |
| Context7 | Low | None | 100MB | 2min |
| ContextManager | Low | None | 150MB | - |
| OutputCleaner | Minimal | None | 10MB | - |

This interconnection map ensures that when we implement the missing components, they'll integrate seamlessly with the existing architecture while maintaining the **Ollama-as-source-of-truth** principle.