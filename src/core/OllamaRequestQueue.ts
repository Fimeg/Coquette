/**
 * OllamaRequestQueue - Singleton queue to serialize Ollama requests and prevent race conditions
 * Ensures only one Ollama request runs at a time to avoid model switching conflicts
 */

import axios from 'axios';
import { DebugLogger } from './DebugLogger.js';

export interface OllamaRequest {
  id: string;
  model: string;
  prompt: string;
  options: any;
  timeout: number;
  caller: string; // For debugging which component made the request
  priority: 'low' | 'medium' | 'high'; // Queue priority
}

export interface OllamaResponse {
  success: boolean;
  data?: any;
  error?: string;
  processingTime: number;
  queueWaitTime: number;
}

export class OllamaRequestQueue {
  private static instance: OllamaRequestQueue;
  private queue: OllamaRequest[] = [];
  private processing = false;
  private currentRequest: OllamaRequest | null = null;
  private logger: DebugLogger;
  private baseUrl: string;
  private requestCounter = 0;
  
  // Track model state to minimize switching overhead
  private lastUsedModel: string | null = null;
  private modelSwitchDelay = 2000; // 2 second delay when switching models
  private requestDelay = 500; // 500ms delay between any requests

  private constructor(baseUrl: string = 'http://10.10.20.19:11434') {
    this.logger = DebugLogger.getInstance();
    this.baseUrl = baseUrl;
    this.logger.logEngineEvent('ollama_queue_initialized', { baseUrl });
  }

  // TUI system message emission (same as CoquetuteEngine)
  private emitSystemMessage(type: string, message: string, metadata?: any): void {
    const systemMessage = {
      type,
      message,
      metadata: metadata || {},
      timestamp: new Date().toISOString()
    };
    process.stderr.write(JSON.stringify(systemMessage) + '\n');
  }

  public static getInstance(baseUrl?: string): OllamaRequestQueue {
    if (!OllamaRequestQueue.instance) {
      OllamaRequestQueue.instance = new OllamaRequestQueue(baseUrl);
    }
    return OllamaRequestQueue.instance;
  }

  /**
   * Add request to queue and wait for processing
   */
  async enqueueRequest(
    model: string,
    prompt: string,
    options: any = {},
    timeout: number = 60000,
    caller: string = 'unknown',
    priority: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<OllamaResponse> {
    const requestId = `${caller}_${++this.requestCounter}_${Date.now()}`;
    const request: OllamaRequest = {
      id: requestId,
      model,
      prompt,
      options,
      timeout,
      caller,
      priority
    };

    this.logger.logEngineEvent('ollama_request_enqueued', {
      requestId,
      model,
      caller,
      priority,
      queueLength: this.queue.length,
      promptLength: prompt.length,
      currentlyProcessing: this.processing,
      currentModel: this.currentRequest?.model
    });

    // Emit visual blurb for TUI (match expected TUI format)
    this.emitSystemMessage('tool_activity', `Queued ${model} request (${this.queue.length} in queue)`, { 
      tool_name: caller,
      activity: `Queued ${model} request (${this.queue.length} in queue)`,
      model: model,
      priority: priority
    });

    // Add to queue with priority ordering
    this.addToQueueWithPriority(request);
    
    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }

    // Wait for this specific request to complete
    return this.waitForRequest(requestId);
  }

  private addToQueueWithPriority(request: OllamaRequest) {
    // Insert based on priority: high > medium > low
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    const requestPriority = priorityOrder[request.priority];
    
    let insertIndex = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      if (priorityOrder[this.queue[i].priority] < requestPriority) {
        insertIndex = i;
        break;
      }
    }
    
    this.queue.splice(insertIndex, 0, request);
    
    this.logger.logEngineEvent('ollama_queue_reordered', {
      insertedAt: insertIndex,
      queueLength: this.queue.length,
      priority: request.priority
    });
  }

  private async processQueue() {
    if (this.processing) return;
    
    this.processing = true;
    this.logger.logEngineEvent('ollama_queue_processing_start', {
      queueLength: this.queue.length
    });

    while (this.queue.length > 0) {
      const request = this.queue.shift()!;
      this.currentRequest = request;
      
      await this.processRequest(request);
      this.currentRequest = null;
      
      // Delay between requests to prevent overwhelming Ollama
      await this.delay(this.requestDelay);
    }

    this.processing = false;
    this.logger.logEngineEvent('ollama_queue_processing_complete', {});
  }

  private async processRequest(request: OllamaRequest) {
    const startTime = Date.now();
    const queueWaitTime = startTime - parseInt(request.id.split('_')[2]);
    
    this.logger.logEngineEvent('ollama_request_processing_start', {
      requestId: request.id,
      model: request.model,
      caller: request.caller,
      queueWaitTime,
      modelSwitch: this.lastUsedModel !== request.model
    });

    // Emit visual blurb for TUI - processing start
    this.emitSystemMessage('tool_activity', `Processing with ${request.model}`, {
      tool_name: request.caller,
      activity: `Processing with ${request.model}`,
      model: request.model,
      queue_wait: `${Math.round(queueWaitTime / 1000)}s`
    });

    try {
      // Add delay if switching models to let Ollama settle
      if (this.lastUsedModel && this.lastUsedModel !== request.model) {
        this.logger.logEngineEvent('ollama_model_switch_delay', {
          from: this.lastUsedModel,
          to: request.model,
          delayMs: this.modelSwitchDelay
        });

        // Emit model switch blurb
        this.emitSystemMessage('tool_activity', `Switching from ${this.lastUsedModel} to ${request.model}`, {
          tool_name: request.caller,
          activity: `Switching from ${this.lastUsedModel} to ${request.model}`,
          delay: `${this.modelSwitchDelay / 1000}s`
        });

        await this.delay(this.modelSwitchDelay);
      }

      // Check if Ollama is healthy before making request
      await this.healthCheck();

      const requestBody = {
        model: request.model,
        prompt: request.prompt,
        stream: false,
        options: request.options
      };

      this.logger.logEngineEvent('ollama_api_call_start', {
        requestId: request.id,
        model: request.model,
        promptLength: request.prompt.length,
        timeout: request.timeout,
        options: request.options
      });

      const response = await axios.post(
        `${this.baseUrl}/api/generate`,
        requestBody,
        {
          timeout: request.timeout,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      this.lastUsedModel = request.model;
      const processingTime = Date.now() - startTime;

      this.logger.logEngineEvent('ollama_request_success', {
        requestId: request.id,
        model: request.model,
        caller: request.caller,
        processingTime,
        queueWaitTime,
        responseLength: response.data.response?.length || 0,
        evalCount: response.data.eval_count || 0,
        totalDuration: response.data.total_duration || 0
      });

      // Emit completion blurb for TUI
      this.emitSystemMessage('tool_activity', `Completed ${request.model} request`, {
        tool_name: request.caller,
        activity: `Completed ${request.model} request`,
        processing_time: `${Math.round(processingTime / 1000)}s`,
        tokens: response.data.eval_count || 0
      });

      // Store result for waiting client
      this.storeResult(request.id, {
        success: true,
        data: response.data,
        processingTime,
        queueWaitTime
      });

    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      
      this.logger.logEngineEvent('ollama_request_failed', {
        requestId: request.id,
        model: request.model,
        caller: request.caller,
        error: error.message,
        statusCode: error.response?.status,
        processingTime,
        queueWaitTime,
        timeout: error.code === 'ECONNABORTED'
      });

      // Emit error blurb for TUI
      this.emitSystemMessage('tool_activity', `Failed: ${error.message}`, {
        tool_name: request.caller,
        activity: `Failed: ${error.message}`,
        model: request.model,
        processing_time: `${Math.round(processingTime / 1000)}s`
      });

      // Store error result
      this.storeResult(request.id, {
        success: false,
        error: error.message,
        processingTime,
        queueWaitTime
      });
    }
  }

  private async healthCheck(): Promise<void> {
    try {
      await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5000 });
    } catch (error: any) {
      this.logger.logEngineEvent('ollama_health_check_failed', {
        error: error.message,
        baseUrl: this.baseUrl
      });
      throw new Error(`Ollama health check failed: ${error.message}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Simple in-memory result storage (could be enhanced with Redis/DB for scale)
  private results = new Map<string, OllamaResponse>();

  private storeResult(requestId: string, result: OllamaResponse) {
    this.results.set(requestId, result);
    
    // Clean up old results after 5 minutes to prevent memory leaks
    setTimeout(() => {
      this.results.delete(requestId);
    }, 300000);
  }

  private async waitForRequest(requestId: string): Promise<OllamaResponse> {
    // Poll for result completion
    return new Promise((resolve) => {
      const checkResult = () => {
        const result = this.results.get(requestId);
        if (result) {
          resolve(result);
        } else {
          setTimeout(checkResult, 100); // Check every 100ms
        }
      };
      checkResult();
    });
  }

  /**
   * Get queue status for debugging
   */
  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      currentRequest: this.currentRequest ? {
        id: this.currentRequest.id,
        model: this.currentRequest.model,
        caller: this.currentRequest.caller
      } : null,
      lastUsedModel: this.lastUsedModel,
      pendingRequests: this.queue.map(req => ({
        id: req.id,
        model: req.model,
        caller: req.caller,
        priority: req.priority
      }))
    };
  }

  /**
   * Emergency queue flush (for debugging/recovery)
   */
  flushQueue() {
    this.logger.logEngineEvent('ollama_queue_flushed', {
      droppedRequests: this.queue.length,
      wasProcessing: this.processing
    });
    
    this.queue = [];
    this.processing = false;
    this.currentRequest = null;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      totalRequests: this.requestCounter,
      queueLength: this.queue.length,
      processing: this.processing,
      lastModel: this.lastUsedModel,
      avgWaitTime: 0 // Could be calculated from stored results
    };
  }
}