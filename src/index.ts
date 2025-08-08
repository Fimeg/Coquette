/**
 * Coquette - AI Personality Wrapper System
 * Main entry point with CLI interface
 */

import React from 'react';
import { render } from 'ink';
import meow from 'meow';

import { CoquetuteApp } from './ui/components/CoquetuteApp.js';
import { CoquetuteEngine } from './core/CoquetuteEngine.js';

const cli = meow(`
    Usage
      $ coquette [input]

    Options
      --provider, -p      Force specific provider (claude, gemini, etc.)
      --personality, -P   Force specific personality (ani, professional, etc.)
      --stream, -s        Enable streaming mode
      --local-only        Run in local-only mode (no external providers)
      --with-tools        Enable local tool dispatch (requires --local-only)
      --toggle-provider   Toggle between providers
      --toggle-personality Toggle between personalities  
      --status            Show system status
      --config            Show configuration path
      --debug             Enable debug mode
      --version, -v       Show version

    Examples
      $ coquette
      $ coquette "How does this project work?"
      $ coquette --provider gemini "Explain the code structure"
      $ coquette --local-only "Chat without external AI"
      $ coquette --local-only --with-tools "Local chat with tool access"
      $ coquette --toggle-provider
      $ coquette --status
`, {
  importMeta: import.meta,
  flags: {
    provider: {
      type: 'string',
      shortFlag: 'p'
    },
    personality: {
      type: 'string',
      shortFlag: 'P'
    },
    stream: {
      type: 'boolean',
      shortFlag: 's',
      default: true
    },
    localOnly: {
      type: 'boolean',
      default: false
    },
    withTools: {
      type: 'boolean',
      default: false
    },
    toggleProvider: {
      type: 'boolean',
      default: false
    },
    togglePersonality: {
      type: 'boolean',
      default: false
    },
    status: {
      type: 'boolean',
      default: false
    },
    config: {
      type: 'boolean',
      default: false
    },
    debug: {
      type: 'boolean',
      default: false
    }
  }
});

async function main() {
  // Handle local-only mode validation
  if (cli.flags.withTools && !cli.flags.localOnly) {
    console.error('Error: --with-tools flag requires --local-only mode');
    process.exit(1);
  }

  const { Config } = await import('./core/config/config.js');
  
  // Create a basic config for the engine
  const config = new Config({
    sessionId: 'coquette-session',
    targetDir: process.cwd(),
    debugMode: cli.flags.debug,
    coreTools: undefined, // Enable all core tools
    excludeTools: undefined,
    toolDiscoveryCommand: undefined,
    toolCallCommand: undefined,
    mcpServerCommand: undefined,
    mcpServers: undefined,
    model: 'gemini-1.5-flash',
    cwd: process.cwd(),
    extensions: [],
    blockedMcpServers: []
  });
  
  const engine = new CoquetuteEngine(config);
  
  try {
    await engine.initialize({
      local_only: cli.flags.localOnly,
      with_tools: cli.flags.withTools,
      streaming: cli.flags.stream,
      debug: cli.flags.debug,
      personality_only: false,
      approval_mode: 'auto'
    });
  } catch (error: any) {
    console.error('Failed to initialize Coquette:', error.message);
    process.exit(1);
  }

  // Handle command-line flags
  if (cli.flags.debug) {
    process.env.DEBUG = '1';
    console.log('Debug mode enabled');
  }

  if (cli.flags.localOnly) {
    console.log('🏠 Local-only mode enabled - no external AI providers will be used');
    if (cli.flags.withTools) {
      console.log('🔧 Local tool dispatch enabled');
    }
  }

  if (cli.flags.status) {
    const status = await engine.getStatus();
    console.log('\\n🎭 Coquette System Status');
    console.log('========================');
    
    console.log('\\n📡 Technical Providers:');
    for (const [id, info] of Object.entries(status.providers)) {
      const icon = info.available ? '✅' : '❌';
      const latency = info.latency_ms ? ` (${info.latency_ms}ms)` : '';
      console.log(`  ${icon} ${id}${latency}`);
    }
    
    console.log('\\n🔄 Fallback Chain:');
    const { chain, current, statuses } = status.fallback_chain;
    chain.forEach(provider => {
      const isCurrent = provider === current;
      const status_icon = statuses[provider] === 'available' ? '🟢' : 
                         statuses[provider] === 'timeout' ? '🟡' : '🔴';
      const arrow = isCurrent ? ' ← current' : '';
      console.log(`  ${status_icon} ${provider}${arrow}`);
    });
    
    console.log('\\n🎭 Personality System:');
    console.log(`  Current: ${status.personality.current}`);
    console.log(`  Provider: ${status.personality.provider_available ? '✅' : '❌'} Available`);
    
    console.log('\\n💬 Conversation:');
    console.log(`  History: ${status.conversation_length} messages`);
    
    return;
  }

  if (cli.flags.config) {
    const { homedir } = await import('os');
    const { join } = await import('path');
    console.log(join(homedir(), '.coquette', 'config.toml'));
    return;
  }

  if (cli.flags.toggleProvider) {
    try {
      const newProvider = await engine.toggleProvider();
      console.log(`🔄 Switched to provider: ${newProvider}`);
    } catch (error: any) {
      console.error('Failed to toggle provider:', error.message);
      process.exit(1);
    }
    return;
  }

  if (cli.flags.togglePersonality) {
    try {
      const newPersonality = await engine.togglePersonality();
      console.log(`🎭 Switched to personality: ${newPersonality}`);
    } catch (error: any) {
      console.error('Failed to toggle personality:', error.message);
      process.exit(1);
    }
    return;
  }

  // Handle direct input
  if (cli.input.length > 0) {
    const input = cli.input.join(' ');
    
    try {
      const response = await engine.processMessage(input, {
        stream: false,
        forceProvider: cli.flags.provider,
        forcePersonality: cli.flags.personality === 'true',
        mode: {
          local_only: cli.flags.localOnly,
          with_tools: cli.flags.withTools,
          streaming: cli.flags.stream,
          debug: cli.flags.debug,
          personality_only: false,
          approval_mode: 'auto'
        }
      });

      if ('content' in response) {
        console.log('\\n' + response.content + '\\n');
        
        if (cli.flags.debug) {
          console.log('\\n🔍 Debug Info:');
          console.log(`Provider: ${response.metadata.technical_provider}`);
          console.log(`Personality: ${response.metadata.personality_used}`);
          console.log(`Routing: ${response.metadata.routing_reason}`);
          console.log(`Processing Time: ${response.metadata.processing_time_ms}ms`);
        }
      }
    } catch (error: any) {
      console.error('Error processing message:', error.message);
      process.exit(1);
    }
    
    return;
  }

  // Start interactive mode
  const modeDescription = cli.flags.localOnly 
    ? cli.flags.withTools 
      ? 'local-only mode with tools'
      : 'local-only mode'
    : 'hybrid AI mode';
  
  console.log(`🎭 Starting Coquette interactive mode (${modeDescription})...`);
  console.log('Press Ctrl+C to exit, /help for commands\\n');

  const app = render(
    React.createElement(CoquetuteApp, {
      engine,
      initialStream: cli.flags.stream,
      debug: cli.flags.debug,
      mode: {
        local_only: cli.flags.localOnly,
        with_tools: cli.flags.withTools,
        streaming: cli.flags.stream,
        debug: cli.flags.debug,
        personality_only: false,
        approval_mode: 'auto'
      }
    })
  );

  // Handle process termination
  process.on('SIGINT', () => {
    app.unmount();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    app.unmount();
    process.exit(0);
  });
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Start the application
main().catch((error) => {
  console.error('Failed to start Coquette:', error);
  process.exit(1);
});