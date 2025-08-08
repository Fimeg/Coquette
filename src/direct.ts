#!/usr/bin/env node

/**
 * Direct CLI interface for Coquette - bypasses the broken React/Ink TUI
 * This provides a simple interface that the Python TUI can call
 */

import { CoquetuteEngine } from './core/CoquetuteEngine.js';
import { Config } from './core/config/config.js';

async function main() {
  const args = process.argv.slice(2);
  const messageIndex = args.findIndex(arg => arg === '--message');
  
  if (messageIndex === -1 || messageIndex === args.length - 1) {
    console.error(JSON.stringify({ error: 'Usage: --message "your message here"' }));
    process.exit(1);
  }
  
  const userMessage = args[messageIndex + 1];
  
  // Parse additional flags
  const toolsEnabled = args.includes('--tools') && args[args.indexOf('--tools') + 1] === 'enabled';
  const contextEnabled = args.includes('--context') && args[args.indexOf('--context') + 1] === 'enabled';
  
  // Parse provider and personality flags
  const providerIndex = args.indexOf('--provider');
  const provider = providerIndex !== -1 && providerIndex < args.length - 1 ? args[providerIndex + 1] : undefined;
  
  const personalityIndex = args.indexOf('--personality');
  const personality = personalityIndex !== -1 && personalityIndex < args.length - 1 ? args[personalityIndex + 1] : undefined;
  
  try {
    // Initialize engine with proper mode based on flags
    const config = new Config({
      sessionId: 'direct-cli-session',
      model: 'default',
      targetDir: process.cwd(),
      debugMode: false,
      cwd: process.cwd(),
      // Add other config parameters as needed based on your Config class constructor
    });
    await config.initialize();
    const engine = new CoquetuteEngine(config);
    
    // Set provider and personality if specified (before initialization)
    const configManager = (await import('./core/config/manager.js')).configManager;
    await configManager.load();
    
    if (provider) {
      if (provider.toLowerCase() === 'local') {
        configManager.setProvider('ollama_local');
      } else {
        configManager.setProvider(provider);
      }
    }
    
    if (personality) {
      configManager.setPersonality(personality);
    }
    
    // Set mode based on tools/context flags
    const mode = {
      local_only: toolsEnabled, // When tools are enabled, use local mode
      with_tools: toolsEnabled,
      streaming: false,
      debug: false,
      personality_only: false,
      approval_mode: 'auto' as const,
      personality_interpretation: true,
      context_persistence: contextEnabled
    };
    
    await engine.initialize(mode);
    
    // Process message with tool and context options
    const response = await engine.processMessage(userMessage, { 
      stream: false
    });
    
    // Output ONLY JSON for Python TUI to parse - suppress all other output
    if ('content' in response) {
      // Keep stderr for debug messages that TUI processes, stdout ONLY for clean JSON
      process.stdout.write(JSON.stringify({
        content: response.content,
        metadata: response.metadata,
        timestamp: response.timestamp
      }) + '\n');
    } else {
      console.error(JSON.stringify({ error: 'Invalid response format' }));
      process.exit(1);
    }
    
  } catch (error: any) {
    console.error(JSON.stringify({ 
      error: error.message || 'Unknown error occurred',
      details: error.stack 
    }));
    process.exit(1);
  }
}

main().catch(error => {
  console.error(JSON.stringify({ 
    error: 'Fatal error: ' + (error.message || String(error)) 
  }));
  process.exit(1);
});