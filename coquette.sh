#!/bin/bash

# Coquette - AI Personality Wrapper System
# Quick start script

set -e

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m' # No Color

echo -e "${BLUE}🎭 Coquette Setup${NC}"
echo "=================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is required but not installed.${NC}"
    echo "Please install Node.js 18+ and try again."
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
fi

# Check if config exists
CONFIG_DIR="$HOME/.coquette"
CONFIG_FILE="$CONFIG_DIR/config.toml"

if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}⚙️ Creating initial configuration...${NC}"
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$CONFIG_DIR/personalities"
    
    # Copy example config
    cp config/config.example.toml "$CONFIG_FILE"
    
    # Copy personality files
    cp config/personalities/*.txt "$CONFIG_DIR/personalities/"
    
    echo -e "${GREEN}✅ Configuration created at $CONFIG_FILE${NC}"
    echo -e "${BLUE}💡 Edit this file to customize your providers and API keys${NC}"
fi

# Check for Claude Code CLI
if command -v claude &> /dev/null; then
    echo -e "${GREEN}✅ Claude Code CLI detected${NC}"
else
    echo -e "${YELLOW}⚠️ Claude Code CLI not found${NC}"
    echo "Install from: https://github.com/anthropics/claude-code"
fi

# Check for Gemini CLI
if command -v gemini &> /dev/null; then
    echo -e "${GREEN}✅ Gemini CLI detected${NC}"
else
    echo -e "${YELLOW}⚠️ Gemini CLI not found (optional)${NC}"
    echo "Install gemini-cli for Gemini support"
fi

# Check for Ollama
if command -v ollama &> /dev/null && curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo -e "${GREEN}✅ Ollama detected and running${NC}"
else
    echo -e "${YELLOW}⚠️ Ollama not found or not running${NC}"
    echo "Install Ollama and run 'ollama pull gemma2:2b' for personality features"
fi

echo ""
echo -e "${GREEN}🚀 Ready to start Coquette!${NC}"
echo ""
echo "Commands:"
echo "  npm run dev          - Start interactive mode"
echo "  npm run dev -- --help - Show CLI options"
echo "  npm run dev -- \"your message here\" - Direct input"
echo "  npm run dev -- --status - Show system status"
echo "  npm run dev -- --toggle-provider - Switch providers"
echo ""

# Start if requested
if [ "$1" = "start" ] || [ "$1" = "run" ]; then
    echo -e "${BLUE}Starting Coquette...${NC}"
    npm run dev "${@:2}"
fi