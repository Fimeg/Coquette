/**
 * OutputCleaner - Strips noise and normalizes CLI returns for better presentation
 * Handles ANSI escape sequences, error formatting, and content sanitization
 */

export interface CleaningConfig {
  remove_ansi_colors: boolean;
  strip_debug_info: boolean;
  normalize_whitespace: boolean;
  max_line_length: number;
  preserve_code_blocks: boolean;
  filter_sensitive_data: boolean;
}

export interface CleaningResult {
  original_content: string;
  cleaned_content: string;
  removed_elements: string[];
  transformations_applied: string[];
  estimated_improvement: number;
}

export class OutputCleaner {
  private config: CleaningConfig;
  private sensitivePatterns: RegExp[] = [];
  private noisePatterns: RegExp[] = [];
  
  constructor(config?: Partial<CleaningConfig>) {
    this.config = {
      remove_ansi_colors: true,
      strip_debug_info: true,
      normalize_whitespace: true,
      max_line_length: 120,
      preserve_code_blocks: true,
      filter_sensitive_data: true,
      ...config
    };

    this.loadNoisePatterns();
    this.loadSensitivePatterns();
  }

  /**
   * Main cleaning method - processes content through all cleaning stages
   */
  clean(content: string, context?: { source: string; type: 'cli_output' | 'ai_response' | 'tool_result' }): CleaningResult {
    const original = content;
    let cleaned = content;
    const removedElements: string[] = [];
    const transformations: string[] = [];

    // Stage 1: Remove ANSI escape sequences
    if (this.config.remove_ansi_colors) {
      const ansiResult = this.removeAnsiSequences(cleaned);
      cleaned = ansiResult.content;
      if (ansiResult.removed.length > 0) {
        removedElements.push(...ansiResult.removed);
        transformations.push('ansi_removal');
      }
    }

    // Stage 2: Strip debug information
    if (this.config.strip_debug_info) {
      const debugResult = this.stripDebugInfo(cleaned);
      cleaned = debugResult.content;
      if (debugResult.removed.length > 0) {
        removedElements.push(...debugResult.removed);
        transformations.push('debug_stripping');
      }
    }

    // Stage 3: Filter sensitive data
    if (this.config.filter_sensitive_data) {
      const sensitiveResult = this.filterSensitiveData(cleaned);
      cleaned = sensitiveResult.content;
      if (sensitiveResult.removed.length > 0) {
        removedElements.push(...sensitiveResult.removed);
        transformations.push('sensitive_filtering');
      }
    }

    // Stage 4: Remove noise patterns
    const noiseResult = this.removeNoise(cleaned);
    cleaned = noiseResult.content;
    if (noiseResult.removed.length > 0) {
      removedElements.push(...noiseResult.removed);
      transformations.push('noise_removal');
    }

    // Stage 5: Normalize whitespace
    if (this.config.normalize_whitespace) {
      const whitespaceResult = this.normalizeWhitespace(cleaned);
      cleaned = whitespaceResult.content;
      if (whitespaceResult.normalized) {
        transformations.push('whitespace_normalization');
      }
    }

    // Stage 6: Handle line length limits
    if (this.config.max_line_length > 0) {
      const lineResult = this.handleLineLengths(cleaned);
      cleaned = lineResult.content;
      if (lineResult.wrapped_lines > 0) {
        transformations.push('line_wrapping');
      }
    }

    // Stage 7: Context-specific cleaning
    if (context) {
      cleaned = this.applyContextSpecificCleaning(cleaned, context);
    }

    const improvement = this.calculateImprovement(original, cleaned);

    return {
      original_content: original,
      cleaned_content: cleaned,
      removed_elements: removedElements,
      transformations_applied: transformations,
      estimated_improvement: improvement
    };
  }

  /**
   * Quick clean for simple cases
   */
  quickClean(content: string): string {
    return this.clean(content, { source: 'unknown', type: 'ai_response' }).cleaned_content;
  }

  /**
   * Clean CLI command output specifically
   */
  cleanCliOutput(content: string, command?: string): CleaningResult {
    const context = { source: command || 'cli', type: 'cli_output' as const };
    return this.clean(content, context);
  }

  /**
   * Clean tool execution results
   */
  cleanToolResult(content: string, toolName: string): CleaningResult {
    const context = { source: toolName, type: 'tool_result' as const };
    return this.clean(content, context);
  }

  // Private cleaning methods

  private removeAnsiSequences(content: string): { content: string; removed: string[] } {
    const ansiRegex = /\u001b\[[0-9;]*[mGKHF]/g;
    const removed: string[] = [];
    
    const cleaned = content.replace(ansiRegex, (match) => {
      removed.push(match);
      return '';
    });

    return { content: cleaned, removed };
  }

  private stripDebugInfo(content: string): { content: string; removed: string[] } {
    const debugPatterns = [
      /^\[DEBUG\].*$/gm,
      /^\[TRACE\].*$/gm,
      /^DEBUG:.*$/gm,
      /^TRACE:.*$/gm,
      /^.*\s+\|\s+DEBUG\s+\|.*$/gm,
      /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}.*DEBUG.*$/gm
    ];

    let cleaned = content;
    const removed: string[] = [];

    for (const pattern of debugPatterns) {
      cleaned = cleaned.replace(pattern, (match) => {
        removed.push(match.trim());
        return '';
      });
    }

    return { content: cleaned, removed };
  }

  private filterSensitiveData(content: string): { content: string; removed: string[] } {
    let cleaned = content;
    const removed: string[] = [];

    for (const pattern of this.sensitivePatterns) {
      cleaned = cleaned.replace(pattern, (match, ...groups) => {
        removed.push('REDACTED_SENSITIVE_DATA');
        
        // Different replacement strategies based on pattern
        if (match.includes('password') || match.includes('secret')) {
          return match.replace(/[a-zA-Z0-9]/g, '*');
        } else if (match.includes('token') || match.includes('key')) {
          return match.substring(0, 8) + '***';
        } else {
          return '[REDACTED]';
        }
      });
    }

    return { content: cleaned, removed };
  }

  private removeNoise(content: string): { content: string; removed: string[] } {
    let cleaned = content;
    const removed: string[] = [];

    for (const pattern of this.noisePatterns) {
      cleaned = cleaned.replace(pattern, (match) => {
        removed.push(match.trim());
        return '';
      });
    }

    return { content: cleaned, removed };
  }

  private normalizeWhitespace(content: string): { content: string; normalized: boolean } {
    const original = content;
    
    // Remove trailing whitespace from lines
    let cleaned = content.replace(/[ \t]+$/gm, '');
    
    // Collapse multiple consecutive empty lines into at most 2
    cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');
    
    // Remove leading/trailing whitespace from entire content
    cleaned = cleaned.trim();
    
    return { content: cleaned, normalized: cleaned !== original };
  }

  private handleLineLengths(content: string): { content: string; wrapped_lines: number } {
    const lines = content.split('\n');
    let wrappedCount = 0;
    
    const processedLines = lines.map(line => {
      if (line.length <= this.config.max_line_length) {
        return line;
      }

      // Don't wrap code blocks or URLs
      if (this.config.preserve_code_blocks && this.isCodeBlock(line)) {
        return line;
      }

      if (this.isUrl(line)) {
        return line;
      }

      // Smart wrapping at word boundaries
      wrappedCount++;
      return this.wrapLine(line, this.config.max_line_length);
    });

    return { content: processedLines.join('\n'), wrapped_lines: wrappedCount };
  }

  private applyContextSpecificCleaning(content: string, context: { source: string; type: string }): string {
    let cleaned = content;

    switch (context.type) {
      case 'cli_output':
        // Remove common CLI noise
        cleaned = this.cleanCliSpecificNoise(cleaned);
        break;
        
      case 'tool_result':
        // Clean tool-specific output
        cleaned = this.cleanToolSpecificNoise(cleaned, context.source);
        break;
        
      case 'ai_response':
        // Clean AI response formatting
        cleaned = this.cleanAiResponseNoise(cleaned);
        break;
    }

    return cleaned;
  }

  private cleanCliSpecificNoise(content: string): string {
    // Remove common CLI progress indicators, warnings that aren't critical
    const cliNoisePatterns = [
      /^Warning: .*deprecated.*$/gmi,
      /^\s*\[.*\]\s*\d+%.*$/gm, // Progress bars
      /^npm WARN.*$/gm,
      /^\s*✓.*installed.*$/gm // Package manager success messages
    ];

    let cleaned = content;
    for (const pattern of cliNoisePatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    return cleaned;
  }

  private cleanToolSpecificNoise(content: string, toolName: string): string {
    let cleaned = content;

    switch (toolName) {
      case 'git':
        // Remove git verbose output
        cleaned = cleaned.replace(/^On branch .*$/gm, '');
        cleaned = cleaned.replace(/^Your branch is .*$/gm, '');
        break;
        
      case 'npm':
      case 'yarn':
        // Remove package manager noise
        cleaned = cleaned.replace(/^added \d+ packages.*$/gm, '');
        cleaned = cleaned.replace(/^audited \d+ packages.*$/gm, '');
        break;
        
      case 'docker':
        // Remove docker build noise
        cleaned = cleaned.replace(/^Step \d+\/\d+ :.*$/gm, '');
        break;
    }

    return cleaned;
  }

  private cleanAiResponseNoise(content: string): string {
    // Remove common AI response artifacts
    let cleaned = content;
    
    // Remove excessive politeness markers
    cleaned = cleaned.replace(/^(I understand that|I see that|I notice that)/gmi, '');
    cleaned = cleaned.replace(/(Please note that|It's worth noting that)/gmi, '');
    
    // Clean up response formatting
    cleaned = cleaned.replace(/^\*\*(.*?)\*\*$/gm, '$1'); // Remove bold formatting from headings
    
    return cleaned;
  }

  private isCodeBlock(line: string): boolean {
    return /^\s{4,}/.test(line) || // Indented code
           /^```/.test(line) ||      // Fenced code block
           /^`.*`$/.test(line.trim()); // Inline code
  }

  private isUrl(line: string): boolean {
    return /https?:\/\/[^\s]+/.test(line);
  }

  private wrapLine(line: string, maxLength: number): string {
    if (line.length <= maxLength) return line;
    
    const words = line.split(' ');
    const wrapped: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      if ((currentLine + ' ' + word).length <= maxLength) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) wrapped.push(currentLine);
        currentLine = word;
      }
    }
    
    if (currentLine) wrapped.push(currentLine);
    
    return wrapped.join('\n');
  }

  private calculateImprovement(original: string, cleaned: string): number {
    const originalLength = original.length;
    const cleanedLength = cleaned.length;
    
    if (originalLength === 0) return 0;
    
    const reduction = originalLength - cleanedLength;
    return Math.round((reduction / originalLength) * 100);
  }

  private loadNoisePatterns(): void {
    this.noisePatterns = [
      // Empty lines with only whitespace
      /^\s*$/gm,
      
      // Common progress indicators
      /^\s*[▸▹►▻⏵⏷⏴⏶]\s*/gm,
      
      // Loading animations
      /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/gm,
      
      // Timestamp prefixes that aren't useful
      /^\d{2}:\d{2}:\d{2}\s+/gm,
      
      // Generic "OK" or "Done" messages
      /^\s*(OK|Done|Success)\s*$/gmi,
      
      // Build/compile noise
      /^.*\s+compiled successfully.*$/gmi,
      /^.*\s+build completed.*$/gmi
    ];
  }

  private loadSensitivePatterns(): void {
    this.sensitivePatterns = [
      // API keys and tokens
      /\b[a-zA-Z0-9]{32,}\b/g,
      
      // Password patterns
      /password[=:\s]*[^\s]+/gi,
      /pwd[=:\s]*[^\s]+/gi,
      
      // Secret keys
      /secret[_-]?key[=:\s]*[^\s]+/gi,
      /api[_-]?key[=:\s]*[^\s]+/gi,
      /access[_-]?token[=:\s]*[^\s]+/gi,
      
      // Database connection strings
      /[a-z]+:\/\/[^@]+:[^@]+@[^\s]+/gi,
      
      // Email addresses (sometimes sensitive)
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      
      // IP addresses in certain contexts
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      
      // Common secret patterns
      /bearer\s+[a-zA-Z0-9_-]+/gi,
      /authorization:\s*[^\s]+/gi
    ];
  }

  /**
   * Configure cleaning rules dynamically
   */
  updateConfig(newConfig: Partial<CleaningConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Add custom noise patterns
   */
  addNoisePattern(pattern: RegExp): void {
    this.noisePatterns.push(pattern);
  }

  /**
   * Add custom sensitive data patterns
   */
  addSensitivePattern(pattern: RegExp): void {
    this.sensitivePatterns.push(pattern);
  }

  /**
   * Get current cleaning statistics
   */
  getStats(): {
    noise_patterns: number;
    sensitive_patterns: number;
    config: CleaningConfig;
  } {
    return {
      noise_patterns: this.noisePatterns.length,
      sensitive_patterns: this.sensitivePatterns.length,
      config: { ...this.config }
    };
  }
}