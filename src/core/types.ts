/**
 * Core TypeScript interfaces and types for Coquette system
 * Following the design specification from claude.md
 */

export interface PromptIntent {
  type: 'technical' | 'personality' | 'hybrid';
  confidence: number;
  keywords_matched: string[];
  context_hints: string[];
  requires_tools?: boolean;
}

export interface ContextSlice {
  id: string;
  content: string;
  timestamp: Date;
  relevance_score: number;
  token_estimate: number;
  type: 'conversation' | 'summary' | 'task' | 'memory' | 'recursive_prompt_result';
  metadata: {
    source: string;
    tags: string[];
    expires_at?: Date;
    [key: string]: any;
  };
}

export interface ProviderResult {
  content: string;
  metadata: {
    provider_id: string;
    model_used: string;
    tokens_used?: number;
    latency_ms: number;
    cost_estimate?: number;
    confidence_score?: number;
  };
  thinking?: string;
  tool_calls?: ToolCall[];
}

export interface PersonalityProfile {
  name: string;
  description: string;
  reminder_short: string;
  reminder_full: string;
  traits: {
    formality: 'casual' | 'professional' | 'academic';
    verbosity: 'concise' | 'balanced' | 'detailed';
    creativity: 'logical' | 'balanced' | 'creative';
    empathy: 'low' | 'moderate' | 'high';
  };
  refresh_triggers: {
    exchange_count: number;
    keyword_patterns: string[];
    context_drift_threshold: number;
  };
  context_preferences: {
    max_history_length: number;
    prioritize_recent: boolean;
    maintain_thread_coherence: boolean;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, any>;
  approved?: boolean;
  result?: ToolResult;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface ConversationSession {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  message_count: number;
  context_slices: ContextSlice[];
  active_goals: string[];
  personality_state: {
    current: string;
    refresh_count: number;
    last_refresh: Date;
  };
  metadata: {
    tags: string[];
    archived: boolean;
    export_format?: 'jsonl' | 'markdown';
  };
}

export interface RecursivePrompt {
  id: string;
  parent_id?: string;
  content: string;
  intent: PromptIntent;
  generated_at: Date;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  context_requirements: string[];
  tool_requirements?: string[];
  expected_outcome: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  generated_content?: string;
}

export interface ContextManagementConfig {
  max_total_tokens: number;
  max_history_entries: number;
  summarization_threshold: number;
  relevance_decay_rate: number;
  priority_boost_factors: {
    recent_messages: number;
    user_queries: number;
    tool_results: number;
    personality_hints: number;
  };
}

export interface LocalToolConfig {
  enabled: boolean;
  allowed_operations: {
    filesystem: boolean;
    shell_commands: boolean;
    web_requests: boolean;
    system_info: boolean;
  };
  safety_restrictions: {
    max_file_size_mb: number;
    blocked_paths: string[];
    blocked_commands: string[];
    require_confirmation: string[];
  };
}

export interface CoquetuteMode {
  local_only: boolean;
  with_tools: boolean;
  streaming: boolean;
  debug: boolean;
  personality_only: boolean;
  approval_mode: 'auto' | 'manual' | 'strict';
}

export interface SystemStatus {
  mode: CoquetuteMode;
  providers: Record<string, ProviderHealthCheck>;
  personality: PersonalityStatus;
  context: ContextStats;
  session: SessionInfo;
  tools: ToolsStatus;
}

export interface ProviderHealthCheck {
  id: string;
  available: boolean;
  latency_ms?: number;
  last_check: Date;
  error_count: number;
  rate_limit_remaining?: number;
}

export interface PersonalityStatus {
  current: string;
  available_personalities: string[];
  refresh_count: number;
  drift_score: number;
  last_refresh: Date;
  provider_available: boolean;
}

export interface ContextStats {
  total_slices: number;
  total_tokens: number;
  memory_usage_mb: number;
  oldest_slice: Date;
  summarized_count: number;
}

export interface SessionInfo {
  current_session: string;
  message_count: number;
  duration_minutes: number;
  active_goals: string[];
  pending_prompts: number;
}

export interface ToolsStatus {
  local_tools_enabled: boolean;
  available_tools: string[];
  pending_approvals: number;
  safety_violations: number;
}

export interface ChainOfThoughtState {
  current_reasoning: string[];
  confidence_level: number;
  alternative_approaches: string[];
  risk_assessment: {
    safety_score: number;
    complexity_score: number;
    resource_requirements: string[];
  };
}

export interface DesireState {
  primary_goals: string[];
  active_objectives: string[];
  completion_criteria: Record<string, string>;
  priority_weights: Record<string, number>;
  estimated_completion: Record<string, Date>;
}

export interface MemoryState {
  working_memory: ContextSlice[];
  long_term_storage: string[];
  forgotten_items: string[];
  summary_cache: Record<string, string>;
  relevance_index: Record<string, number>;
}