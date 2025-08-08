/**
 * ContextManager - Handles memory management, context offloading, and reattachment
 * Implements human-like forgetting and smart context summarization
 */

import { ContextSlice, ContextManagementConfig, MemoryState, ConversationSession } from './types.js';
import { configManager } from './config/manager.js';

export interface ContextWindow {
  active_slices: ContextSlice[];
  total_tokens: number;
  relevance_cutoff: number;
  last_optimization: Date;
}

export interface SummarizationResult {
  summary: string;
  original_token_count: number;
  summary_token_count: number;
  compression_ratio: number;
  key_points: string[];
}

export class ContextManager {
  private memoryState: MemoryState;
  private config: ContextManagementConfig;
  private contextWindow: ContextWindow;
  private summarizationCache: Map<string, SummarizationResult> = new Map();

  constructor(config?: Partial<ContextManagementConfig>) {
    this.config = {
      max_total_tokens: 8000,
      max_history_entries: 50,
      summarization_threshold: 6000,
      relevance_decay_rate: 0.1,
      priority_boost_factors: {
        recent_messages: 1.5,
        user_queries: 2.0,
        tool_results: 1.8,
        personality_hints: 1.2
      },
      ...config
    };

    this.memoryState = {
      working_memory: [],
      long_term_storage: [],
      forgotten_items: [],
      summary_cache: {},
      relevance_index: {}
    };

    this.contextWindow = {
      active_slices: [],
      total_tokens: 0,
      relevance_cutoff: 0.3,
      last_optimization: new Date()
    };
  }

  /**
   * Add new context slice to working memory
   */
  async addContext(
    content: string,
    type: ContextSlice['type'],
    metadata: ContextSlice['metadata']
  ): Promise<ContextSlice> {
    const slice: ContextSlice = {
      id: this.generateSliceId(),
      content,
      timestamp: new Date(),
      relevance_score: this.calculateInitialRelevance(content, type),
      token_estimate: this.estimateTokens(content),
      type,
      metadata
    };

    this.memoryState.working_memory.push(slice);
    await this.optimizeMemory();

    return slice;
  }

  /**
   * Get current context window optimized for the given query
   */
  async getContextForQuery(query: string, max_tokens?: number): Promise<ContextSlice[]> {
    const limit = max_tokens || this.config.max_total_tokens;
    
    // Update relevance scores based on query
    this.updateRelevanceScores(query);
    
    // Sort by relevance and recency
    const sortedSlices = this.memoryState.working_memory
      .sort((a, b) => this.calculateContextPriority(b, query) - this.calculateContextPriority(a, query));

    // Build context window within token limit
    const contextSlices: ContextSlice[] = [];
    let totalTokens = 0;

    for (const slice of sortedSlices) {
      if (totalTokens + slice.token_estimate > limit) {
        // Try to summarize older content if we're hitting limits
        const summarized = await this.trySummarizeForSpace(contextSlices, slice, limit - totalTokens);
        if (summarized) {
          contextSlices.push(...summarized);
        }
        break;
      }

      contextSlices.push(slice);
      totalTokens += slice.token_estimate;
    }

    this.contextWindow = {
      active_slices: contextSlices,
      total_tokens: totalTokens,
      relevance_cutoff: this.calculateDynamicRelevanceCutoff(),
      last_optimization: new Date()
    };

    return contextSlices;
  }

  /**
   * Optimize memory by summarizing, forgetting, and organizing content
   */
  async optimizeMemory(): Promise<void> {
    const totalTokens = this.memoryState.working_memory.reduce(
      (sum, slice) => sum + slice.token_estimate, 
      0
    );

    // Check if optimization is needed
    if (totalTokens < this.config.summarization_threshold && 
        this.memoryState.working_memory.length < this.config.max_history_entries) {
      return;
    }

    // Apply relevance decay
    this.applyRelevanceDecay();

    // Move low-relevance items to long-term storage or forget them
    await this.processLowRelevanceItems();

    // Summarize related context groups
    await this.summarizeRelatedContexts();

    // Clean up expired contexts
    this.cleanupExpiredContexts();
  }

  /**
   * Force summarization of conversation segments
   */
  async summarizeConversation(slices: ContextSlice[]): Promise<SummarizationResult> {
    const cacheKey = this.generateCacheKey(slices);
    
    if (this.summarizationCache.has(cacheKey)) {
      return this.summarizationCache.get(cacheKey)!;
    }

    const content = slices.map(slice => slice.content).join('\n\n');
    const originalTokens = this.estimateTokens(content);

    // Create summary using available AI provider
    const summary = await this.createSummary(content, slices);
    const summaryTokens = this.estimateTokens(summary);

    const result: SummarizationResult = {
      summary,
      original_token_count: originalTokens,
      summary_token_count: summaryTokens,
      compression_ratio: originalTokens / summaryTokens,
      key_points: this.extractKeyPoints(content)
    };

    this.summarizationCache.set(cacheKey, result);
    return result;
  }

  /**
   * Rehydrate summarized content when relevant to current query
   */
  async rehydrateContext(query: string): Promise<ContextSlice[]> {
    const rehydratedSlices: ContextSlice[] = [];

    // Check long-term storage for relevant items
    for (const storageKey of this.memoryState.long_term_storage) {
      const relevance = this.calculateStorageRelevance(storageKey, query);
      
      if (relevance > 0.6) {
        const rehydrated = await this.loadFromStorage(storageKey);
        if (rehydrated) {
          rehydratedSlices.push(...rehydrated);
        }
      }
    }

    // Re-integrate rehydrated content into working memory
    this.memoryState.working_memory.push(...rehydratedSlices);
    
    return rehydratedSlices;
  }

  /**
   * Save current session to persistent storage
   */
  async saveSession(sessionInfo: Partial<ConversationSession>): Promise<string> {
    const session: ConversationSession = {
      id: sessionInfo.id || this.generateSessionId(),
      name: sessionInfo.name || `Session ${new Date().toLocaleDateString()}`,
      created_at: sessionInfo.created_at || new Date(),
      updated_at: new Date(),
      message_count: this.memoryState.working_memory.length,
      context_slices: [...this.memoryState.working_memory],
      active_goals: sessionInfo.active_goals || [],
      personality_state: sessionInfo.personality_state || {
        current: configManager.currentPersonality,
        refresh_count: 0,
        last_refresh: new Date()
      },
      metadata: sessionInfo.metadata || {
        tags: [],
        archived: false
      }
    };

    // Save to filesystem or external storage
    await this.persistSession(session);
    
    return session.id;
  }

  /**
   * Load session from persistent storage
   */
  async loadSession(sessionId: string): Promise<ConversationSession | null> {
    try {
      const session = await this.retrieveSession(sessionId);
      
      if (session) {
        // Restore memory state
        this.memoryState.working_memory = session.context_slices;
        this.updateRelevanceIndex();
      }
      
      return session;
    } catch (error) {
      console.warn(`Failed to load session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Export conversation in specified format
   */
  async exportConversation(format: 'jsonl' | 'markdown'): Promise<string> {
    const slices = this.memoryState.working_memory
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (format === 'jsonl') {
      return slices.map(slice => JSON.stringify({
        timestamp: slice.timestamp.toISOString(),
        type: slice.type,
        content: slice.content,
        metadata: slice.metadata
      })).join('\n');
    }

    // Markdown format
    let markdown = `# Conversation Export\n\nExported: ${new Date().toISOString()}\n\n`;
    
    for (const slice of slices) {
      const timestamp = slice.timestamp.toLocaleString();
      const typeLabel = slice.type.charAt(0).toUpperCase() + slice.type.slice(1);
      
      markdown += `## ${typeLabel} - ${timestamp}\n\n${slice.content}\n\n`;
      
      if (slice.metadata.tags.length > 0) {
        markdown += `*Tags: ${slice.metadata.tags.join(', ')}*\n\n`;
      }
    }

    return markdown;
  }

  /**
   * Get current memory statistics
   */
  getMemoryStats() {
    const totalTokens = this.memoryState.working_memory.reduce(
      (sum, slice) => sum + slice.token_estimate, 
      0
    );

    return {
      working_memory_size: this.memoryState.working_memory.length,
      total_tokens: totalTokens,
      long_term_storage_count: this.memoryState.long_term_storage.length,
      forgotten_count: this.memoryState.forgotten_items.length,
      summary_cache_size: this.summarizationCache.size,
      memory_usage_percent: (totalTokens / this.config.max_total_tokens) * 100,
      oldest_context: this.memoryState.working_memory.length > 0 
        ? Math.min(...this.memoryState.working_memory.map(s => s.timestamp.getTime()))
        : null
    };
  }

  // Private helper methods

  private generateSliceId(): string {
    return `slice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private estimateTokens(content: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(content.length / 4);
  }

  private calculateInitialRelevance(content: string, type: ContextSlice['type']): number {
    let baseScore = 0.5;
    
    switch (type) {
      case 'conversation':
        baseScore = 0.8;
        break;
      case 'task':
        baseScore = 0.9;
        break;
      case 'memory':
        baseScore = 0.7;
        break;
      case 'summary':
        baseScore = 0.6;
        break;
    }

    // Boost for certain patterns
    if (/\b(important|remember|note|key|crucial)\b/i.test(content)) {
      baseScore += 0.1;
    }

    return Math.min(baseScore, 1.0);
  }

  private updateRelevanceScores(query: string): void {
    const queryTokens = query.toLowerCase().split(/\s+/);
    
    for (const slice of this.memoryState.working_memory) {
      const contentTokens = slice.content.toLowerCase().split(/\s+/);
      const overlap = queryTokens.filter(token => contentTokens.includes(token)).length;
      const overlapScore = overlap / Math.max(queryTokens.length, contentTokens.length);
      
      // Adjust relevance based on query similarity
      slice.relevance_score = Math.min(
        slice.relevance_score + overlapScore * 0.3,
        1.0
      );
    }
  }

  private calculateContextPriority(slice: ContextSlice, query: string): number {
    let priority = slice.relevance_score;
    
    // Apply time-based decay
    const ageMinutes = (Date.now() - slice.timestamp.getTime()) / (1000 * 60);
    const timeFactor = Math.exp(-ageMinutes / 60); // Decay over hours
    
    priority *= timeFactor;
    
    // Apply priority boosts
    if (slice.type === 'conversation') {
      priority *= this.config.priority_boost_factors.user_queries;
    } else if (slice.type === 'task') {
      priority *= this.config.priority_boost_factors.tool_results;
    }
    
    return priority;
  }

  private applyRelevanceDecay(): void {
    for (const slice of this.memoryState.working_memory) {
      const ageHours = (Date.now() - slice.timestamp.getTime()) / (1000 * 60 * 60);
      const decayFactor = Math.exp(-ageHours * this.config.relevance_decay_rate);
      
      slice.relevance_score *= decayFactor;
    }
  }

  private async processLowRelevanceItems(): Promise<void> {
    const lowRelevanceSlices = this.memoryState.working_memory
      .filter(slice => slice.relevance_score < this.contextWindow.relevance_cutoff);

    for (const slice of lowRelevanceSlices) {
      if (slice.relevance_score < 0.1) {
        // Forget completely
        this.memoryState.forgotten_items.push(slice.id);
      } else {
        // Move to long-term storage
        const storageKey = await this.moveToLongTermStorage(slice);
        this.memoryState.long_term_storage.push(storageKey);
      }
    }

    // Remove from working memory
    this.memoryState.working_memory = this.memoryState.working_memory
      .filter(slice => !lowRelevanceSlices.includes(slice));
  }

  private async summarizeRelatedContexts(): Promise<void> {
    // Group related contexts by tags and timestamp proximity
    const groups = this.groupRelatedContexts();
    
    for (const group of groups) {
      if (group.length >= 3) {
        const summary = await this.summarizeConversation(group);
        
        // Replace group with summary slice
        const summarySlice: ContextSlice = {
          id: this.generateSliceId(),
          content: summary.summary,
          timestamp: new Date(),
          relevance_score: Math.max(...group.map(s => s.relevance_score)),
          token_estimate: summary.summary_token_count,
          type: 'summary',
          metadata: {
            source: 'context_manager_summary',
            tags: [...new Set(group.flatMap(s => s.metadata.tags))],
            original_slice_ids: group.map(s => s.id)
          } as any
        };

        // Remove original slices and add summary
        this.memoryState.working_memory = this.memoryState.working_memory
          .filter(slice => !group.includes(slice));
        this.memoryState.working_memory.push(summarySlice);
      }
    }
  }

  private groupRelatedContexts(): ContextSlice[][] {
    const groups: ContextSlice[][] = [];
    const processed = new Set<string>();

    for (const slice of this.memoryState.working_memory) {
      if (processed.has(slice.id)) continue;

      const group = [slice];
      processed.add(slice.id);

      // Find related slices by tags and time proximity
      for (const other of this.memoryState.working_memory) {
        if (processed.has(other.id)) continue;

        const timeProximity = Math.abs(slice.timestamp.getTime() - other.timestamp.getTime()) < 30 * 60 * 1000; // 30 minutes
        const tagOverlap = slice.metadata.tags.some(tag => other.metadata.tags.includes(tag));

        if (timeProximity || tagOverlap) {
          group.push(other);
          processed.add(other.id);
        }
      }

      if (group.length > 1) {
        groups.push(group);
      }
    }

    return groups;
  }

  private cleanupExpiredContexts(): void {
    const now = Date.now();
    
    this.memoryState.working_memory = this.memoryState.working_memory
      .filter(slice => {
        if (slice.metadata.expires_at) {
          return slice.metadata.expires_at.getTime() > now;
        }
        return true;
      });
  }

  private calculateDynamicRelevanceCutoff(): number {
    const memoryPressure = this.memoryState.working_memory.length / this.config.max_history_entries;
    return 0.2 + (memoryPressure * 0.4); // Range from 0.2 to 0.6
  }

  private async trySummarizeForSpace(
    currentSlices: ContextSlice[], 
    newSlice: ContextSlice, 
    availableTokens: number
  ): Promise<ContextSlice[] | null> {
    // Try to summarize oldest slices to make room
    const oldSlices = currentSlices
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(0, Math.floor(currentSlices.length / 2));

    if (oldSlices.length >= 2) {
      const summary = await this.summarizeConversation(oldSlices);
      
      if (summary.summary_token_count + newSlice.token_estimate <= availableTokens) {
        const summarySlice: ContextSlice = {
          id: this.generateSliceId(),
          content: summary.summary,
          timestamp: new Date(),
          relevance_score: Math.max(...oldSlices.map(s => s.relevance_score)),
          token_estimate: summary.summary_token_count,
          type: 'summary',
          metadata: {
            source: 'space_optimization_summary',
            tags: [...new Set(oldSlices.flatMap(s => s.metadata.tags))],
            original_slice_ids: oldSlices.map(s => s.id)
          } as any
        };

        return [
          ...currentSlices.filter(slice => !oldSlices.includes(slice)),
          summarySlice,
          newSlice
        ];
      }
    }

    return null;
  }

  private generateCacheKey(slices: ContextSlice[]): string {
    return slices.map(s => s.id).sort().join('|');
  }

  private async createSummary(content: string, slices: ContextSlice[]): Promise<string> {
    // This would integrate with available AI providers for summarization
    // For now, return a simple extractive summary
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const topSentences = sentences.slice(0, Math.max(3, Math.floor(sentences.length * 0.3)));
    
    return topSentences.join('. ') + '.';
  }

  private extractKeyPoints(content: string): string[] {
    // Simple key point extraction - would be enhanced with NLP
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const keyPoints = lines
      .filter(line => /\b(important|key|note|remember|crucial|main)\b/i.test(line))
      .slice(0, 5);
    
    return keyPoints.length > 0 ? keyPoints : lines.slice(0, 3);
  }

  private calculateStorageRelevance(storageKey: string, query: string): number {
    // This would check stored metadata against query
    // For now, return a default relevance
    return 0.5;
  }

  private async loadFromStorage(storageKey: string): Promise<ContextSlice[] | null> {
    // This would load from actual storage (filesystem, database, etc.)
    return null;
  }

  private async moveToLongTermStorage(slice: ContextSlice): Promise<string> {
    // This would persist the slice to long-term storage
    return `storage_${slice.id}`;
  }

  private async persistSession(session: ConversationSession): Promise<void> {
    // This would save to actual persistent storage
    console.log(`Persisting session: ${session.id}`);
  }

  private async retrieveSession(sessionId: string): Promise<ConversationSession | null> {
    // This would load from actual persistent storage
    return null;
  }

  private updateRelevanceIndex(): void {
    for (const slice of this.memoryState.working_memory) {
      this.memoryState.relevance_index[slice.id] = slice.relevance_score;
    }
  }
}