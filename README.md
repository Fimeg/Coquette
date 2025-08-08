# 🎭 Coquette

> **Multi-Model AI Orchestration with Subconscious Reasoning**

Coquette is a revolutionary AI architecture that thinks before it acts. Unlike single-model systems, Coquette creates a "cognitive chain" where different AI models handle different aspects of intelligence - routing decisions, deep reasoning, personality interpretation, and tool orchestration - resulting in more nuanced and human-like AI interactions.

## 🧠 What Makes Coquette Different

**Traditional AI**: User → Single Model → Response  
**Coquette**: User → Intelligence Router → Model Selection → Subconscious Reasoning → Tool Orchestration → Personality Filter → Response

### Key Innovations

- **🔄 Recursive Reasoning**: Keeps refining responses until user intent is truly satisfied
- **🧠 AI-Driven Model Selection**: Uses AI to analyze complexity and route to optimal models
- **💭 Subconscious Processing**: DeepSeek R1 "thinks" in the background before responding
- **🎭 Personality Consistency**: Technical responses filtered through character personalities
- **⚡ Smart Context Management**: Human-like forgetting, summarization, and memory rehydration
- **🔧 Intelligent Tool Orchestration**: Context-aware tool selection and execution

## 🏗️ Architecture Overview

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ User Input  │───▶│ Intelligence     │───▶│ Model Selection │
│             │    │ Router (Gemma)   │    │ & Execution     │
└─────────────┘    └──────────────────┘    └─────────────────┘
                            │                        │
                            ▼                        ▼
                   ┌─────────────────────────────────────────┐
                   │        SPECIALIZED MODELS:              │
                   │  • DeepSeek R1: Complex reasoning       │
                   │  • Gemma 3: Chat & coordination         │
                   │  • Gemini: Tool operations              │
                   │  • Context7: Document processing        │
                   └─────────────────────────────────────────┘
                            │
                            ▼
                   ┌─────────────────────────────────────────┐
                   │     Subconscious Reasoner               │
                   │  (Validates & refines responses)        │
                   └─────────────────────────────────────────┘
                            │
                            ▼
                   ┌─────────────────────────────────────────┐
                   │     Personality Manager                 │
                   │  (Ani, Professional, Casual modes)     │
                   └─────────────────────────────────────────┘
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Python 3.8+ (for TUI interface)
- [Ollama](https://ollama.ai) with models: `gemma2:27b`, `deepseek-r1:8b`
- Optional: Claude/Gemini API keys for enhanced capabilities

### Installation

```bash
git clone https://github.com/yourusername/coquette.git
cd coquette
npm install

# Copy configuration
cp config/config.example.toml config/config.toml
# Edit config.toml with your preferences
```

### Quick Start

```bash
# Terminal interface (recommended)
npm run tui

# Direct execution
npm run dev

# Development with debug logging
npm run dev:debug
```

## ⚙️ Configuration

Edit `config/config.toml`:

```toml
[models]
primary = "gemma2:27b"      # Chat & coordination
reasoning = "deepseek-r1:8b" # Deep thinking
tools = "gemini-1.5-pro"    # Function calling

[personality]
default = "ani"  # ani, professional, casual
```

## 🎯 Core Components

### Intelligence Router
AI-driven routing that analyzes query complexity and selects optimal models:
- **Simple queries** → Gemma (fast local response)
- **Complex reasoning** → DeepSeek R1 (deep analysis) 
- **Tool operations** → Gemini (function calling)

### Subconscious Reasoner
Background validation using DeepSeek R1's chain-of-thought:
- Validates responses before delivery
- Recursive improvement until satisfaction
- Metacognitive error detection

### Context Manager
Human-like memory management:
- Smart forgetting of irrelevant details
- Conversation summarization
- Context rehydration based on relevance

### Ollama Request Queue
Prevents race conditions in model switching:
- Priority-based request handling
- Model loading coordination
- Memory optimization

## 🛠️ Use Cases

- **Development**: Multi-step reasoning for complex coding problems
- **Research**: Deep analysis with source validation
- **Creative Work**: Personality-consistent character responses
- **Problem Solving**: Recursive refinement until resolution

## 🔧 Development

```bash
npm test          # Run tests
npm run typecheck # Type checking
npm run lint      # Code linting
npm run build     # Production build
```

### Architecture Deep Dive

See the documentation in the project:
- `COQUETTE_SYSTEM_ARCHITECTURE_MAP.md` - Complete system overview
- `MULTIMODEL_INTELLIGENCE_INTEGRATION_PLAN.md` - Model routing strategies
- `OLLAMA_INTEGRATION_REFERENCE.md` - Ollama-specific optimizations

## 🎭 Personality System

Coquette includes three built-in personalities:

- **Ani**: Playful, direct, uses modern language
- **Professional**: Formal, structured responses
- **Casual**: Relaxed, conversational tone

Personalities filter technical responses while preserving accuracy.

## 🔄 How It Thinks

1. **Intent Analysis**: Router determines complexity and required capabilities
2. **Model Selection**: AI chooses optimal model based on analysis
3. **Subconscious Processing**: DeepSeek validates and refines in background
4. **Tool Orchestration**: Context-aware tool selection if needed
5. **Personality Filtering**: Response adjusted for character consistency
6. **Recursive Validation**: Continues refining until user intent satisfied

## 🤝 Contributing

This is an experimental system exploring novel AI orchestration patterns. Contributions welcome!

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Make changes following existing patterns
4. Test with `npm test`
5. Submit pull request

## 📄 License

Apache 2.0 License - see [LICENSE](LICENSE) for details.

## 💭 Philosophy

Coquette is inspired by human cognitive architecture - we don't just respond immediately to stimuli. We route different types of problems to different mental processes, validate our thinking, and maintain personality consistency across interactions.

The goal isn't just better AI responses, but more human-like AI reasoning.

---

*Ready to experience AI that actually thinks? Try Coquette.*