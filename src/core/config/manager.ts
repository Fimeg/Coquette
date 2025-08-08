/**
 * Configuration manager with provider fallback chains and runtime toggling
 * Inspired by Codex CLI's configuration system
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml';

import { 
  Config, 
  ConfigSchema, 
  DEFAULT_CONFIG, 
  ModelProviderInfo, 
  PersonalityConfig,
  WireApi 
} from './types.js';

interface ProviderFallbackChain {
  primary: string;
  fallbacks: string[];
  timeout_ms: number;
  retry_attempts: number;
}

interface RuntimeState {
  current_provider: string;
  current_personality: string;
  provider_status: Record<string, 'available' | 'unavailable' | 'timeout'>;
  last_fallback_time: Record<string, number>;
}

export class ConfigManager {
  private config: Config;
  private configPath: string;
  private runtimeState: RuntimeState;
  private fallbackChain: ProviderFallbackChain;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    
    // Try development config first, then installed config
    const devConfigPath = join(process.cwd(), 'config', 'config.toml');
    const installedConfigPath = join(homedir(), '.coquette', 'config.toml');
    
    this.configPath = existsSync(devConfigPath) ? devConfigPath : installedConfigPath;
    
    this.runtimeState = {
      current_provider: this.config.default_provider,
      current_personality: this.config.default_personality,
      provider_status: {},
      last_fallback_time: {}
    };

    this.fallbackChain = {
      primary: 'claude',
      fallbacks: ['gemini', 'openai'],
      timeout_ms: 30000,
      retry_attempts: 2
    };

    // Initialize provider status
    Object.keys(this.config.model_providers).forEach(id => {
      this.runtimeState.provider_status[id] = 'available';
    });
  }

  /**
   * Load configuration from disk, merging with defaults
   */
  async load(): Promise<void> {
    try {
      if (!existsSync(this.configPath)) {
        await this.createDefaultConfig();
        return;
      }

      const configContent = await readFile(this.configPath, 'utf-8');
      const parsedConfig = parseToml(configContent);
      
      // Validate and merge with defaults
      const mergedConfig = this.mergeConfigs(DEFAULT_CONFIG, parsedConfig as any);
      this.config = ConfigSchema.parse(mergedConfig);
      
      // Update fallback chain from config if present
      if (parsedConfig.fallback_chain) {
        this.fallbackChain = { ...this.fallbackChain, ...parsedConfig.fallback_chain as any };
      }

      console.log(`✓ Loaded configuration from ${this.configPath}`);
    } catch (error) {
      console.warn(`Warning: Could not load config from ${this.configPath}:`, error);
      console.log('Using default configuration');
    }
  }

  /**
   * Save current configuration to disk
   */
  async save(): Promise<void> {
    try {
      const configDir = join(homedir(), '.coquette');
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true });
      }

      // Include fallback chain in saved config
      const configToSave = {
        ...this.config,
        fallback_chain: this.fallbackChain
      };

      const tomlContent = stringifyToml(configToSave);
      await writeFile(this.configPath, tomlContent, 'utf-8');
      
      console.log(`✓ Saved configuration to ${this.configPath}`);
    } catch (error) {
      console.error('Failed to save configuration:', error);
      throw error;
    }
  }

  /**
   * Get current active provider with fallback logic
   */
  async getActiveProvider(): Promise<{ id: string; info: ModelProviderInfo }> {
    const primaryId = this.runtimeState.current_provider;
    const primaryProvider = this.config.model_providers[primaryId];

    // Try primary provider first
    if (primaryProvider && await this.isProviderAvailable(primaryId)) {
      return { id: primaryId, info: primaryProvider };
    }

    // Try fallback chain
    for (const fallbackId of this.fallbackChain.fallbacks) {
      const fallbackProvider = this.config.model_providers[fallbackId];
      
      if (fallbackProvider?.enabled && await this.isProviderAvailable(fallbackId)) {
        console.log(`🔄 Falling back from ${primaryId} to ${fallbackId}`);
        return { id: fallbackId, info: fallbackProvider };
      }
    }

    // No providers available - return primary anyway for error handling
    console.warn(`⚠️ No providers available, attempting primary: ${primaryId}`);
    return { id: primaryId, info: primaryProvider };
  }

  /**
   * Set current provider directly
   */
  setProvider(providerId: string): void {
    if (this.config.model_providers[providerId]?.enabled) {
      this.runtimeState.current_provider = providerId;
      console.log(`🔀 Set provider to: ${providerId}`);
    } else {
      console.warn(`⚠️ Provider ${providerId} not available, keeping current: ${this.runtimeState.current_provider}`);
    }
  }

  /**
   * Set current personality directly  
   */
  setPersonality(personalityId: string): void {
    if (this.config.personalities[personalityId]) {
      this.runtimeState.current_personality = personalityId;
      console.log(`🎭 Set personality to: ${personalityId} (${this.config.personalities[personalityId].name})`);
    } else {
      console.warn(`⚠️ Personality ${personalityId} not available, keeping current: ${this.runtimeState.current_personality}`);
    }
  }

  /**
   * Toggle between providers manually
   */
  async toggleProvider(): Promise<string> {
    const availableProviders = Object.keys(this.config.model_providers)
      .filter(id => this.config.model_providers[id].enabled);

    const currentIndex = availableProviders.indexOf(this.runtimeState.current_provider);
    const nextIndex = (currentIndex + 1) % availableProviders.length;
    const nextProvider = availableProviders[nextIndex];

    this.runtimeState.current_provider = nextProvider;
    
    console.log(`🔄 Toggled to provider: ${nextProvider} (${this.config.model_providers[nextProvider].name})`);
    return nextProvider;
  }

  /**
   * Toggle between personalities
   */
  async togglePersonality(): Promise<string> {
    const availablePersonalities = Object.keys(this.config.personalities)
      .filter(id => this.config.personalities[id].enabled);

    const currentIndex = availablePersonalities.indexOf(this.runtimeState.current_personality);
    const nextIndex = (currentIndex + 1) % availablePersonalities.length;
    const nextPersonality = availablePersonalities[nextIndex];

    this.runtimeState.current_personality = nextPersonality;
    
    console.log(`🎭 Toggled to personality: ${nextPersonality} (${this.config.personalities[nextPersonality].name})`);
    return nextPersonality;
  }

  /**
   * Set fallback chain order
   */
  setFallbackChain(primary: string, fallbacks: string[]): void {
    this.fallbackChain.primary = primary;
    this.fallbackChain.fallbacks = fallbacks;
    this.runtimeState.current_provider = primary;
    
    console.log(`🔗 Set fallback chain: ${primary} → ${fallbacks.join(' → ')}`);
  }

  /**
   * Get current fallback chain status
   */
  getFallbackChainStatus(): { 
    chain: string[];
    current: string;
    statuses: Record<string, string>;
  } {
    const chain = [this.fallbackChain.primary, ...this.fallbackChain.fallbacks];
    
    return {
      chain,
      current: this.runtimeState.current_provider,
      statuses: this.runtimeState.provider_status
    };
  }

  /**
   * Mark provider as unavailable (for fallback logic)
   */
  markProviderUnavailable(providerId: string, reason: 'timeout' | 'error'): void {
    this.runtimeState.provider_status[providerId] = reason === 'timeout' ? 'timeout' : 'unavailable';
    this.runtimeState.last_fallback_time[providerId] = Date.now();
    
    console.log(`❌ Provider ${providerId} marked as ${reason}`);
  }

  /**
   * Reset provider status (re-enable for retry)
   */
  resetProviderStatus(providerId?: string): void {
    if (providerId) {
      this.runtimeState.provider_status[providerId] = 'available';
      delete this.runtimeState.last_fallback_time[providerId];
      console.log(`✓ Reset status for provider: ${providerId}`);
    } else {
      // Reset all providers
      Object.keys(this.config.model_providers).forEach(id => {
        this.runtimeState.provider_status[id] = 'available';
      });
      this.runtimeState.last_fallback_time = {};
      console.log('✓ Reset all provider statuses');
    }
  }

  // Getters for current configuration
  get currentConfig(): Config { return this.config; }
  get currentProvider(): string { return this.runtimeState.current_provider; }
  get currentPersonality(): string { return this.runtimeState.current_personality; }
  
  getProvider(id: string): ModelProviderInfo | undefined {
    return this.config.model_providers[id];
  }
  
  getPersonality(id: string): PersonalityConfig | undefined {
    return this.config.personalities[id];
  }

  getCurrentPersonalityConfig(): PersonalityConfig {
    return this.config.personalities[this.runtimeState.current_personality];
  }

  // Private helper methods

  private async createDefaultConfig(): Promise<void> {
    console.log('Creating default configuration...');
    await this.save();
  }

  private mergeConfigs(defaults: Config, overrides: any): Config {
    return {
      ...defaults,
      ...overrides,
      model_providers: {
        ...defaults.model_providers,
        ...overrides.model_providers
      },
      personalities: {
        ...defaults.personalities,
        ...overrides.personalities
      }
    };
  }

  private async isProviderAvailable(providerId: string): Promise<boolean> {
    const status = this.runtimeState.provider_status[providerId];
    
    // If marked unavailable, check if enough time has passed for retry
    if (status === 'unavailable' || status === 'timeout') {
      const lastFailTime = this.runtimeState.last_fallback_time[providerId] || 0;
      const retryDelay = status === 'timeout' ? 60000 : 300000; // 1min for timeout, 5min for error
      
      if (Date.now() - lastFailTime < retryDelay) {
        return false;
      }
      
      // Reset status for retry
      this.runtimeState.provider_status[providerId] = 'available';
    }

    const provider = this.config.model_providers[providerId];
    
    if (!provider?.enabled) {
      return false;
    }

    // For Claude Code, check if CLI is available
    if (provider.wire_api === WireApi.CLAUDE_CODE) {
      return await this.checkClaudeCodeAvailable();
    }

    // For API-based providers, check if API key is set
    if (provider.env_key) {
      return !!process.env[provider.env_key];
    }

    return true;
  }

  private async checkClaudeCodeAvailable(): Promise<boolean> {
    try {
      const { spawn } = await import('child_process');
      
      return new Promise((resolve) => {
        const child = spawn('claude', ['--version'], { stdio: 'ignore', detached: true });
        child.unref();
        
        child.on('close', (code) => {
          resolve(code === 0);
        });
        
        child.on('error', () => {
          resolve(false);
        });
        
        // Timeout after 2 seconds
        setTimeout(() => {
          child.kill();
          resolve(false);
        }, 2000);
      });
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const configManager = new ConfigManager();