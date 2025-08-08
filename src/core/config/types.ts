/**
 * Configuration types for Coquette - adapted from OpenAI Codex CLI
 * Focuses on provider management and personality system integration
 */

import { z } from 'zod';

// Wire protocol enum - determines API compatibility
export enum WireApi {
  RESPONSES = 'responses',  // OpenAI Responses API (with reasoning)
  CHAT = 'chat',           // Standard Chat Completions
  CLAUDE_CODE = 'claude_code', // Claude Code CLI integration
  GEMINI_API = 'gemini_api',   // Google Gemini API
  GEMINI_CLI = 'gemini_cli',   // Gemini CLI integration
  OLLAMA_TOOLS = 'ollama_tools' // Ollama with MCP-CLI tool calling
}

// Provider configuration schema
export const ModelProviderInfoSchema = z.object({
  name: z.string(),
  base_url: z.string().optional(),
  env_key: z.string().optional(),
  env_key_instructions: z.string().optional(),
  wire_api: z.nativeEnum(WireApi).default(WireApi.CHAT),
  query_params: z.record(z.string()).optional(),
  http_headers: z.record(z.string()).optional(),
  env_http_headers: z.record(z.string()).optional(),
  request_max_retries: z.number().default(4),
  stream_max_retries: z.number().default(10),
  stream_idle_timeout_ms: z.number().default(300000),
  enabled: z.boolean().default(true)
});

export type ModelProviderInfo = z.infer<typeof ModelProviderInfoSchema>;

// Personality configuration
export const PersonalityConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  file: z.string(),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().positive().default(2048),
  context_length: z.number().positive().default(4000),
  enabled: z.boolean().default(true)
});

export type PersonalityConfig = z.infer<typeof PersonalityConfigSchema>;

// Personality provider (usually local Ollama)
export const PersonalityProviderSchema = z.object({
  name: z.string().default('Local Ollama'),
  base_url: z.string().default(process.env.OLLAMA_BASE_URL || 'http://10.10.20.19:11434'),
  model: z.string().default('deepseek-r1:8b'),
  temperature: z.number().min(0).max(2).default(0.8),
  enabled: z.boolean().default(true)
});

export type PersonalityProvider = z.infer<typeof PersonalityProviderSchema>;

// Detection configuration - keywords that trigger technical vs personality modes
export const DetectionConfigSchema = z.object({
  technical_keywords: z.array(z.string()).default([
    'files', 'project', 'code', 'error', 'debug', 'git', 'build', 'test',
    'function', 'variable', 'class', 'import', 'export', 'npm', 'install',
    'directory', 'folder', 'path', 'config', 'package'
  ]),
  personality_keywords: z.array(z.string()).default([
    'how are you', 'feeling', 'think about', 'opinion', 'like', 'prefer',
    'personality', 'character', 'chat', 'talk', 'conversation'
  ]),
  technical_threshold: z.number().min(0).max(1).default(0.3),
  always_personality: z.boolean().default(false)
});

export type DetectionConfig = z.infer<typeof DetectionConfigSchema>;

// UI/Terminal configuration
export const TuiConfigSchema = z.object({
  disable_mouse_capture: z.boolean().default(false),
  enable_streaming: z.boolean().default(true),
  show_thinking: z.boolean().default(true),
  max_history_entries: z.number().positive().default(100),
  theme: z.enum(['default', 'dark', 'light']).default('default')
});

export type TuiConfig = z.infer<typeof TuiConfigSchema>;

// History and persistence
export const HistoryConfigSchema = z.object({
  persistence: z.enum(['save-all', 'none']).default('save-all'),
  max_bytes: z.number().positive().optional(),
  location: z.string().default('~/.coquette/history.jsonl')
});

export type HistoryConfig = z.infer<typeof HistoryConfigSchema>;

// Main application configuration
export const ConfigSchema = z.object({
  // Model providers
  model_providers: z.record(ModelProviderInfoSchema).default({}),
  default_provider: z.string().default('claude'),
  
  // Personality system
  personality_provider: PersonalityProviderSchema.default({}),
  personalities: z.record(PersonalityConfigSchema).default({}),
  default_personality: z.string().default('ani'),
  
  // Detection and routing
  detection: DetectionConfigSchema.default({}),
  
  // UI and interface
  tui: TuiConfigSchema.default({}),
  
  // History and persistence
  history: HistoryConfigSchema.default({}),
  
  // Working directory
  cwd: z.string().default(process.cwd()),
  
  // Debug and logging
  debug: z.boolean().default(false),
  log_level: z.enum(['error', 'warn', 'info', 'debug']).default('info')
});

export type Config = z.infer<typeof ConfigSchema>;

// Built-in provider definitions
export const BUILT_IN_PROVIDERS: Record<string, ModelProviderInfo> = {
  claude: {
    name: 'Claude Code CLI',
    wire_api: WireApi.CLAUDE_CODE,
    env_key_instructions: 'Ensure Claude Code CLI is installed and configured',
    request_max_retries: 3,
    stream_max_retries: 5,
    stream_idle_timeout_ms: 180000,
    enabled: true
  },
  gemini: {
    name: 'Google Gemini',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    wire_api: WireApi.GEMINI_API,
    env_key: 'GEMINI_API_KEY',
    env_key_instructions: 'Get your API key from https://makersuite.google.com/app/apikey',
    request_max_retries: 4,
    stream_max_retries: 10,
    stream_idle_timeout_ms: 300000,
    enabled: false
  },
  openai: {
    name: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    wire_api: WireApi.RESPONSES,
    env_key: 'OPENAI_API_KEY',
    env_key_instructions: 'Get your API key from https://platform.openai.com/api-keys',
    request_max_retries: 4,
    stream_max_retries: 10,
    stream_idle_timeout_ms: 300000,
    enabled: false
  },
  anthropic: {
    name: 'Anthropic Claude API',
    base_url: 'https://api.anthropic.com/v1',
    wire_api: WireApi.CHAT,
    env_key: 'ANTHROPIC_API_KEY',
    env_key_instructions: 'Get your API key from https://console.anthropic.com/',
    request_max_retries: 4,
    stream_max_retries: 10,
    stream_idle_timeout_ms: 300000,
    enabled: false
  }
};

// Built-in personality definitions
export const BUILT_IN_PERSONALITIES: Record<string, PersonalityConfig> = {
  ani: {
    name: 'Ani',
    description: 'Technical but playful coding assistant',
    file: '~/.coquette/personalities/ani.txt',
    temperature: 0.7,
    max_tokens: 2048,
    context_length: 4000,
    enabled: true
  },
  professional: {
    name: 'Professional',
    description: 'Formal technical consultant',
    file: '~/.coquette/personalities/professional.txt',
    temperature: 0.5,
    max_tokens: 2048,
    context_length: 4000,
    enabled: true
  },
  casual: {
    name: 'Casual',
    description: 'Friendly and relaxed assistant',
    file: '~/.coquette/personalities/casual.txt',
    temperature: 0.8,
    max_tokens: 2048,
    context_length: 4000,
    enabled: true
  }
};

// Default configuration
export const DEFAULT_CONFIG: Config = {
  model_providers: BUILT_IN_PROVIDERS,
  default_provider: 'claude',
  personality_provider: {
    name: 'Local Ollama',
    base_url: 'http://localhost:11434/v1',
    model: 'gemma2:2b',
    temperature: 0.8,
    enabled: true
  },
  personalities: BUILT_IN_PERSONALITIES,
  default_personality: 'ani',
  detection: {
    technical_keywords: [
      'files', 'project', 'code', 'error', 'debug', 'git', 'build', 'test',
      'function', 'variable', 'class', 'import', 'export', 'npm', 'install',
      'directory', 'folder', 'path', 'config', 'package'
    ],
    personality_keywords: [
      'how are you', 'feeling', 'think about', 'opinion', 'like', 'prefer',
      'personality', 'character', 'chat', 'talk', 'conversation'
    ],
    technical_threshold: 0.3,
    always_personality: false
  },
  tui: {
    disable_mouse_capture: false,
    enable_streaming: true,
    show_thinking: true,
    max_history_entries: 100,
    theme: 'default'
  },
  history: {
    persistence: 'save-all',
    location: '~/.coquette/history.jsonl'
  },
  cwd: process.cwd(),
  debug: false,
  log_level: 'info'
};