/**
 * Base provider interface for technical AI models
 * Defines the contract for all technical AI providers (Claude, Gemini, OpenAI, etc.)
 */

import { ModelProviderInfo, WireApi } from '../config/types.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

export interface StreamChunk {
  content: string;
  isComplete: boolean;
  metadata?: {
    reasoning?: string;
    thinking?: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };
}

export interface ProviderResponse {
  content: string;
  metadata?: {
    model?: string;
    reasoning?: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    provider_specific?: Record<string, any>;
  };
  timestamp: Date;
}

export interface ProviderOptions {
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  timeout_ms?: number;
  model?: string;
}

export abstract class BaseProvider {
  protected config: ModelProviderInfo;
  protected providerId: string;

  constructor(providerId: string, config: ModelProviderInfo) {
    this.providerId = providerId;
    this.config = config;
  }

  // Core methods that all providers must implement
  abstract isAvailable(): Promise<boolean>;
  abstract sendMessage(
    messages: ChatMessage[],
    options?: ProviderOptions
  ): Promise<ProviderResponse>;
  abstract streamMessage(
    messages: ChatMessage[],
    options?: ProviderOptions
  ): AsyncGenerator<StreamChunk, ProviderResponse>;

  // Provider information
  getName(): string {
    return this.config.name;
  }

  getWireApi(): WireApi {
    return this.config.wire_api;
  }

  getProviderId(): string {
    return this.providerId;
  }

  // Configuration helpers
  protected getApiKey(): string | undefined {
    if (this.config.env_key) {
      return process.env[this.config.env_key];
    }
    return undefined;
  }

  protected getBaseUrl(): string | undefined {
    return this.config.base_url;
  }

  protected getRequestTimeout(): number {
    return this.config.stream_idle_timeout_ms || 300000;
  }

  protected getMaxRetries(): number {
    return this.config.request_max_retries || 4;
  }

  // Utility methods
  protected createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add API key if available
    const apiKey = this.getApiKey();
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Add custom headers
    if (this.config.http_headers) {
      Object.assign(headers, this.config.http_headers);
    }

    // Add environment-based headers
    if (this.config.env_http_headers) {
      for (const [headerName, envVar] of Object.entries(this.config.env_http_headers)) {
        const value = process.env[envVar];
        if (value) {
          headers[headerName] = value;
        }
      }
    }

    return headers;
  }

  protected buildUrl(endpoint?: string): string {
    const baseUrl = this.getBaseUrl() || '';
    const url = endpoint ? `${baseUrl}${endpoint}` : baseUrl;

    // Add query parameters if configured
    if (this.config.query_params) {
      const params = new URLSearchParams(this.config.query_params);
      return `${url}?${params.toString()}`;
    }

    return url;
  }

  // Error handling utilities
  protected handleProviderError(error: any, operation: string): never {
    const errorMessage = error.message || 'Unknown error';
    const providerError = new ProviderError(
      `${this.getName()} ${operation} failed: ${errorMessage}`,
      this.providerId,
      operation,
      error
    );
    throw providerError;
  }

  // Health check utility
  async healthCheck(): Promise<{
    available: boolean;
    latency_ms?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      const isAvailable = await this.isAvailable();
      const latency = Date.now() - startTime;
      
      return {
        available: isAvailable,
        latency_ms: latency
      };
    } catch (error: any) {
      return {
        available: false,
        error: error.message || 'Health check failed'
      };
    }
  }
}

// Custom error class for provider errors
export class ProviderError extends Error {
  public readonly providerId: string;
  public readonly operation: string;
  public readonly originalError: any;

  constructor(
    message: string,
    providerId: string,
    operation: string,
    originalError?: any
  ) {
    super(message);
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.operation = operation;
    this.originalError = originalError;
  }
}

// Utility functions for message handling
export function formatMessagesForProvider(
  messages: ChatMessage[],
  wireApi: WireApi
): any[] {
  switch (wireApi) {
    case WireApi.CHAT:
    case WireApi.RESPONSES:
      return messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
    case WireApi.GEMINI_API:
      return messages
        .filter(msg => msg.role !== 'system') // Gemini handles system differently
        .map(msg => ({
          role: msg.role === 'assistant' ? 'model' : msg.role,
          parts: [{ text: msg.content }]
        }));
        
    default:
      return messages;
  }
}

export function extractSystemMessage(messages: ChatMessage[]): {
  systemMessage?: string;
  otherMessages: ChatMessage[];
} {
  const systemMessages = messages.filter(msg => msg.role === 'system');
  const otherMessages = messages.filter(msg => msg.role !== 'system');
  
  return {
    systemMessage: systemMessages.map(msg => msg.content).join('\\n'),
    otherMessages
  };
}