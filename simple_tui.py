#!/usr/bin/env python3
"""
Coquette TUI - Stolen from working claude-condom patterns
Simple Python curses TUI that calls the TypeScript backend
"""

import curses
import json
import subprocess
import threading
import queue
import time
import os
import pty
import select
import fcntl
from datetime import datetime

class CoquetteTUI:
    def __init__(self):
        self.current_input = ""
        self.messages = []
        self.status = "Ready"
        self.provider = "claude"
        self.personality = "ani"
        self.streaming = True
        self.thinking = False
        self.copy_mode = False  # Pause refresh for copy/paste
        self.conversation_context = True  # Keep conversation history in context
        self.tools_enabled = False  # When provider=local: False=chat, True=MCP+tools
        self.view_mode = "personality"  # "personality" or "claude_raw"
        
        # Enhanced TUI state tracking
        self.error_contexts_loaded = False
        self.error_context_count = 0
        self.file_operations_active = False
        self.recovery_attempts = 0
        self.connection_status = "unknown"  # "ok", "error", "unknown"
        self.last_engine_event = ""
        
        # Tool activity tracking
        self.current_tool_activity = ""
        self.tool_progress_dots = 0
        self.tool_start_time = None
        
        # Performance metrics
        self.last_response_time = 0
        self.total_messages_processed = 0
        
        # Claude PTY session for raw view
        self.claude_process = None
        self.claude_master = None
        self.claude_output_buffer = []
        
        # Input queue for threaded processing
        self.input_queue = queue.Queue()
        self.response_queue = queue.Queue()
        
        # Debug logging
        self.debug_file = None
        self.setup_debug_logging()
        
        # Start Claude PTY session for raw view
        self.start_claude_pty()
        
    def init_colors(self):
        curses.start_color()
        curses.init_pair(1, curses.COLOR_CYAN, curses.COLOR_BLACK)    # User messages
        curses.init_pair(2, curses.COLOR_GREEN, curses.COLOR_BLACK)   # Assistant messages
        curses.init_pair(3, curses.COLOR_YELLOW, curses.COLOR_BLACK)  # Status/System
        curses.init_pair(4, curses.COLOR_RED, curses.COLOR_BLACK)     # Tools/Errors
        curses.init_pair(5, curses.COLOR_MAGENTA, curses.COLOR_BLACK) # Thinking/Cursor
        curses.init_pair(6, curses.COLOR_MAGENTA, curses.COLOR_BLACK) # Ani personality
        
    def setup_debug_logging(self):
        """Setup debug logging for Python TUI"""
        debug_dir = "./debug"
        if not os.path.exists(debug_dir):
            os.makedirs(debug_dir)
            
        # Create timestamped debug file
        timestamp = int(time.time() * 1000)
        debug_filename = f"python_tui_session_{timestamp}.json"
        self.debug_file = os.path.join(debug_dir, debug_filename)
        
        # Log session start
        self.log_debug("session", "Python TUI session started", {
            "provider": self.provider,
            "personality": self.personality,
            "streaming": self.streaming,
            "conversation_context": self.conversation_context,
            "tools_enabled": self.tools_enabled
        })
        
    def log_debug(self, event_type, message, metadata=None):
        """Log debug information"""
        if not self.debug_file:
            return
            
        debug_entry = {
            "type": event_type,
            "message": message,
            "metadata": metadata or {},
            "timestamp": datetime.now().isoformat()
        }
        
        try:
            with open(self.debug_file, "a") as f:
                f.write(json.dumps(debug_entry) + "\n")
        except Exception as e:
            # Don't let debug logging break the TUI
            pass
    
    def start_claude_pty(self):
        """Start Claude Code as PTY subprocess for raw view"""
        try:
            # Create PTY for Claude Code
            self.claude_master, claude_slave = pty.openpty()
            
            # Start Claude Code process
            self.claude_process = subprocess.Popen(
                ['claude'],
                stdin=claude_slave,
                stdout=claude_slave,
                stderr=claude_slave,
                start_new_session=True
            )
            
            # Close slave end in parent
            os.close(claude_slave)
            
            # Make master non-blocking
            fcntl.fcntl(self.claude_master, fcntl.F_SETFL, os.O_NONBLOCK)
            
            # Start thread to read Claude output
            self.claude_reader_thread = threading.Thread(target=self.read_claude_output, daemon=True)
            self.claude_reader_thread.start()
            
            self.log_debug("claude_pty", "Claude PTY session started", {
                "pid": self.claude_process.pid,
                "status": "running"
            })
            
        except Exception as e:
            self.log_debug("claude_pty_error", "Failed to start Claude PTY", {
                "error": str(e)
            })
            self.claude_process = None
    
    def read_claude_output(self):
        """Background thread to read output from Claude PTY"""
        while self.claude_process and self.claude_process.poll() is None:
            try:
                if select.select([self.claude_master], [], [], 0.1)[0]:
                    data = os.read(self.claude_master, 1024).decode('utf-8', errors='ignore')
                    if data:
                        self.claude_output_buffer.extend(data.splitlines())
                        # Keep buffer manageable
                        if len(self.claude_output_buffer) > 1000:
                            self.claude_output_buffer = self.claude_output_buffer[-500:]
            except:
                break
    
    def send_to_claude_pty(self, text):
        """Send text to Claude PTY session"""
        if self.claude_master:
            try:
                os.write(self.claude_master, (text + '\n').encode('utf-8'))
                self.log_debug("claude_pty_input", "Sent input to Claude PTY", {
                    "message": text[:50] + "..." if len(text) > 50 else text
                })
            except Exception as e:
                self.log_debug("claude_pty_send_error", "Failed to send to Claude PTY", {
                    "error": str(e)
                })
        
    def update_status(self):
        """Update status line with current state - Enhanced with system indicators"""
        context_icon = "🧠" if self.conversation_context else "🔄"
        
        # Compact status display
        tools_display = ""
        if self.provider == "local":
            tools_icon = "🔧" if self.tools_enabled else "💬"
            tools_display = f" {tools_icon}"
        
        # Add view mode indicator
        view_icon = "🔧" if self.view_mode == "claude_raw" else "🎭"
        status_text = f"{self.provider} | {view_icon}{self.personality} | {context_icon}{tools_display}"
        
        # Add enhanced system status indicators
        status_indicators = []
        
        # Error contexts warning
        if self.error_contexts_loaded:
            status_indicators.append(f"⚠️{self.error_context_count}")
        
        # File operations status
        if self.file_operations_active:
            status_indicators.append("📁")
        
        # Recovery attempts
        if self.recovery_attempts > 0:
            status_indicators.append(f"🔄{self.recovery_attempts}")
        
        # Connection status
        if self.connection_status == "error":
            status_indicators.append("🔌❌")
        elif self.connection_status == "ok":
            status_indicators.append("🔌✅")
        
        # Performance indicator
        if self.last_response_time > 0:
            if self.last_response_time > 10:
                status_indicators.append(f"⏱️{self.last_response_time:.1f}s")
        
        # Add indicators to status
        if status_indicators:
            status_text += " | " + " ".join(status_indicators)
        
        if self.view_mode == "claude_raw":
            status_text += " | RAW VIEW"
        
        # Enhanced thinking/activity display
        if self.current_tool_activity:
            # Animated progress dots
            dots = "." * (self.tool_progress_dots % 4)
            elapsed = ""
            if self.tool_start_time:
                elapsed_sec = time.time() - self.tool_start_time
                if elapsed_sec > 2:  # Show timing after 2 seconds
                    elapsed = f" ({elapsed_sec:.1f}s)"
            status_text += f" | 🔧 {self.current_tool_activity}{dots}{elapsed}"
        elif self.thinking:
            status_text += " | 💭 thinking..."
            
        if self.copy_mode:
            status_text += " | 📋 COPY MODE (Ctrl+R to resume)"
        
        self.status = status_text
        
    def draw_screen(self):
        """Draw the main screen"""
        self.stdscr.clear()
        height, width = self.stdscr.getmaxyx()
        
        if self.view_mode == "claude_raw":
            self.draw_claude_raw_screen(height, width)
            return
        
        # Draw enhanced title with message count and performance
        msg_count = len([m for m in self.messages if m['role'] == 'user'])
        sys_count = len([m for m in self.messages if m['role'] == 'system'])
        
        title_parts = [f"🎭 Coquette Enhanced ({msg_count} msgs"]
        if sys_count > 0:
            title_parts.append(f", {sys_count} sys")
        if self.last_response_time > 0:
            title_parts.append(f", {self.last_response_time:.1f}s")
        title_parts.append(")")
        
        title = "".join(title_parts)
        if len(title) > width - 4:
            title = title[:width-7] + "..."
        self.stdscr.addstr(0, max(1, (width - len(title)) // 2), title, curses.color_pair(3) | curses.A_BOLD)
        
        # Calculate areas - be more conservative with space
        messages_height = height - 8  # Leave more room for status wrapping
        messages_start = 2
        
        # Display messages with proper line counting
        visible_messages = []
        total_lines_used = 0
        
        for msg in reversed(self.messages):
            # Calculate how many lines this message will use
            content_lines = self.wrap_text(msg['content'], width - 20)
            message_lines = max(1, len(content_lines))  # At least 1 line per message
            
            if total_lines_used + message_lines <= messages_height:
                visible_messages.insert(0, {'msg': msg, 'lines': message_lines})
                total_lines_used += message_lines
            else:
                break
                
        # Draw messages
        current_line = messages_start
        for msg_data in visible_messages:
            msg = msg_data['msg']
            if current_line >= messages_start + messages_height:
                break
                
            timestamp = msg['timestamp'].strftime("%H:%M:%S")
            
            # Enhanced role and icon detection
            if msg['role'] == 'user':
                role_icon = "👤"
                color = curses.color_pair(1)
            elif msg['role'] == 'system':
                # Check if it's a tool blurb
                if msg.get('tool'):
                    role_icon = "🔧"
                    color = curses.color_pair(4)  # Cyan for tools
                else:
                    role_icon = "🎭"
                    color = curses.color_pair(3)  # Yellow for system
            else:  # assistant
                # Check if it's an immediate personality acknowledgment
                if msg.get('immediate') and msg.get('source') == 'personality_acknowledgment':
                    role_icon = "🎭"
                    color = curses.color_pair(6)  # Magenta for Ani
                else:
                    role_icon = "🤖"
                    color = curses.color_pair(2)  # Blue for assistant
            
            # Wrap long messages
            content_lines = self.wrap_text(msg['content'], width - 20)
            
            # Draw first line with timestamp and icon
            if content_lines and current_line < messages_start + messages_height:
                first_line = f"{timestamp} {role_icon} {content_lines[0]}"
                if len(first_line) > width - 2:
                    first_line = first_line[:width-2]
                self.stdscr.addstr(current_line, 1, first_line, color)
                current_line += 1
                
                # Draw additional lines for wrapped content
                for line in content_lines[1:]:
                    if current_line < messages_start + messages_height:
                        padded_line = f"           {line}"  # Indent continuation lines
                        if len(padded_line) > width - 2:
                            padded_line = padded_line[:width-2]
                        self.stdscr.addstr(current_line, 1, padded_line, color)
                        current_line += 1
                    else:
                        break
        
        # Draw separator line above status
        separator_y = height - 4
        self.stdscr.addstr(separator_y, 1, "─" * (width - 2), curses.color_pair(3))
        
        # Draw status bar with smart truncation
        status_y = height - 3
        status_text = self.status
        if len(status_text) > width - 4:
            # Truncate status but keep the most important parts
            status_text = status_text[:width-7] + "..."
        self.stdscr.addstr(status_y, 1, status_text, curses.color_pair(3))
        
        # Draw input area with better wrapping
        input_y = height - 2
        prompt = ">>> "
        
        # Handle input text wrapping
        available_width = width - len(prompt) - 3  # Leave space for prompt and margins
        if len(self.current_input) > available_width:
            # Show the end of long input with ellipsis
            display_input = "..." + self.current_input[-(available_width-3):]
        else:
            display_input = self.current_input
            
        # Draw prompt and input
        self.stdscr.addstr(input_y, 1, prompt, curses.color_pair(1) | curses.A_BOLD)
        self.stdscr.addstr(input_y, 1 + len(prompt), display_input)
        
        # Show cursor at the correct position (after the last character)
        cursor_x = 1 + len(prompt) + len(display_input)
        if cursor_x < width - 1:
            self.stdscr.addstr(input_y, cursor_x, "█", curses.color_pair(5) | curses.A_BLINK)
            
        self.stdscr.refresh()
        
    def draw_claude_raw_screen(self, height, width):
        """Draw Claude raw PTY output screen"""
        # Draw title
        title = "🔧 Claude Raw Session (Ctrl+V: back to chat)"
        if len(title) > width - 4:
            title = title[:width-4] + "..."
        self.stdscr.addstr(0, max(1, (width - len(title)) // 2), title, curses.color_pair(4) | curses.A_BOLD)
        
        # Show Claude process status
        status_line = 1
        if self.claude_process and self.claude_process.poll() is None:
            status_text = f"Claude PTY running (PID: {self.claude_process.pid})"
            self.stdscr.addstr(status_line, 2, status_text, curses.color_pair(2))
        else:
            status_text = "Claude PTY not running"
            self.stdscr.addstr(status_line, 2, status_text, curses.color_pair(5))
        
        # Display Claude output buffer
        output_start = 3
        output_height = height - 6
        
        # Show recent Claude output
        if self.claude_output_buffer:
            display_lines = self.claude_output_buffer[-output_height:] if len(self.claude_output_buffer) > output_height else self.claude_output_buffer
            
            for i, line in enumerate(display_lines):
                if i >= output_height:
                    break
                try:
                    # Clean ANSI codes and truncate if needed
                    clean_line = line.replace('\x1b[2K', '').replace('\r', '')
                    if len(clean_line) > width - 4:
                        clean_line = clean_line[:width-7] + "..."
                    self.stdscr.addstr(output_start + i, 2, clean_line, curses.color_pair(4))
                except:
                    # Skip lines that cause display errors
                    pass
        else:
            self.stdscr.addstr(output_start, 2, "No output from Claude yet...", curses.color_pair(3))
            self.stdscr.addstr(output_start + 2, 2, "Try sending a command in chat view (Ctrl+V to switch back)", curses.color_pair(3))
        
        # Draw separator and prompt area
        separator_y = height - 3
        self.stdscr.addstr(separator_y, 1, "─" * (width - 2), curses.color_pair(3))
        
        prompt_y = height - 2
        prompt_text = "Direct Claude input: " + self.current_input
        if len(prompt_text) > width - 2:
            prompt_text = prompt_text[:width-5] + "..."
        self.stdscr.addstr(prompt_y, 1, prompt_text, curses.color_pair(4))
        
        self.stdscr.refresh()
        
    def wrap_text(self, text, max_width):
        """Simple text wrapping"""
        if not text:
            return [""]
        
        lines = []
        current_line = ""
        
        for word in text.split():
            if len(current_line + " " + word) <= max_width:
                current_line = current_line + " " + word if current_line else word
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word
                
        if current_line:
            lines.append(current_line)
            
        return lines if lines else [""]
        
    def send_message(self, message):
        """Send message to TypeScript backend or Claude PTY"""
        start_time = time.time()
        
        self.log_debug("user_input", "User sent message", {
            "message": message,
            "provider": self.provider,
            "personality": self.personality,
            "conversation_context": self.conversation_context,
            "tools_enabled": self.tools_enabled,
            "view_mode": self.view_mode
        })
        
        # If in Claude raw mode, send directly to PTY
        if self.view_mode == "claude_raw":
            self.send_to_claude_pty(message)
            return
        
        self.thinking = True
        self.update_status()
        self.draw_screen()
        
        # Add user message immediately
        self.messages.append({
            'role': 'user',
            'content': message,
            'timestamp': datetime.now()
        })
        
        try:
            # Call the existing TypeScript engine with longer timeout
            cmd = ['npm', 'run', 'dev:direct', '--silent', '--', '--message', message]
            
            # Add provider flag
            cmd.extend(['--provider', self.provider])
            
            # Add personality flag
            cmd.extend(['--personality', self.personality])
            
            # Add tools flag if tools are enabled
            if self.provider == "local" and self.tools_enabled:
                cmd.extend(['--tools', 'enabled'])
            
            # Add conversation context flag
            if self.conversation_context:
                cmd.extend(['--context', 'enabled'])
            
            self.log_debug("subprocess_call", "Calling TypeScript backend", {
                "command": ' '.join(cmd),
                "timeout": 360,
                "tools_enabled": self.tools_enabled,
                "context_enabled": self.conversation_context
            })
            
            # Use streaming subprocess for real-time progress updates
            stdout_lines = []
            stderr_lines = []
            
            process = subprocess.Popen(cmd, 
                                     stdout=subprocess.PIPE, 
                                     stderr=subprocess.PIPE,
                                     text=True,
                                     universal_newlines=True,
                                     cwd='.')
            
            # Set up non-blocking reads
            def make_non_blocking(fd):
                flags = fcntl.fcntl(fd, fcntl.F_GETFL)
                fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
            
            make_non_blocking(process.stdout.fileno())
            make_non_blocking(process.stderr.fileno())
            
            # Process output in real-time
            while True:
                # Check if process is done
                if process.poll() is not None:
                    # Process finished, read any remaining output
                    remaining_stdout = process.stdout.read()
                    remaining_stderr = process.stderr.read()
                    if remaining_stdout:
                        stdout_lines.append(remaining_stdout)
                    if remaining_stderr:
                        stderr_lines.append(remaining_stderr)
                        self.process_system_messages(remaining_stderr)
                    break
                
                # Use select to check for available data
                ready, _, _ = select.select([process.stdout, process.stderr], [], [], 0.1)
                
                for fd in ready:
                    try:
                        if fd == process.stdout:
                            data = fd.read()
                            if data:
                                stdout_lines.append(data)
                        elif fd == process.stderr:
                            data = fd.read()
                            if data:
                                stderr_lines.append(data)
                                # Process system messages in real-time
                                self.process_system_messages(data)
                                # Force screen refresh to show updates
                                if not self.copy_mode:
                                    self.draw_screen()
                    except IOError:
                        # No data available yet
                        pass
                
                # Small delay to prevent CPU spinning
                time.sleep(0.05)
            
            # Wait for process to complete and get return code
            return_code = process.wait()
            
            # Combine all output
            full_stdout = ''.join(stdout_lines)
            full_stderr = ''.join(stderr_lines)
            
            self.log_debug("subprocess_result", "TypeScript backend response", {
                "return_code": return_code,
                "stdout_length": len(full_stdout),
                "stderr_length": len(full_stderr),
                "stdout_preview": full_stdout[:200] if full_stdout else "",
                "stderr_preview": full_stderr[:200] if full_stderr else "",
                "full_stdout": full_stdout if len(full_stdout) < 10000 else full_stdout[:10000] + "...[TRUNCATED]"
            })
                                  
            if return_code == 0:
                # stderr was already processed in real-time, no need to process again
                
                # Clean stdout - remove any npm output lines
                clean_stdout = full_stdout.strip()
                
                # Try to extract the REAL response JSON, not examples from system prompts
                # Look for JSON objects that contain "content" and "metadata" fields
                json_candidates = []
                brace_count = 0
                start_pos = -1
                
                for i, char in enumerate(clean_stdout):
                    if char == '{':
                        if brace_count == 0:
                            start_pos = i
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0 and start_pos != -1:
                            potential_json = clean_stdout[start_pos:i+1]
                            try:
                                parsed = json.loads(potential_json)
                                # Only accept JSON objects that look like real responses
                                if isinstance(parsed, dict) and 'content' in parsed and 'metadata' in parsed:
                                    json_candidates.append((potential_json, start_pos))
                            except:
                                pass
                            start_pos = -1
                
                if json_candidates:
                    # Use the last valid response JSON (most complete)
                    clean_json, json_start = json_candidates[-1]
                else:
                    # Fallback to old method if no valid response found
                    json_start = clean_stdout.find('{')
                    if json_start != -1:
                        json_part = clean_stdout[json_start:]
                        brace_count = 0
                        json_end = -1
                        for i, char in enumerate(json_part):
                            if char == '{':
                                brace_count += 1
                            elif char == '}':
                                brace_count -= 1
                                if brace_count == 0:
                                    json_end = i + 1
                                    break
                        
                        if json_end != -1:
                            clean_json = json_part[:json_end]
                        else:
                            clean_json = json_part
                    else:
                        clean_json = clean_stdout
                
                self.log_debug("json_extraction", "Attempted to extract JSON", {
                    "original_length": len(clean_stdout),
                    "extracted_json": clean_json[:200] + "..." if len(clean_json) > 200 else clean_json,
                    "json_start_pos": json_start
                })
                
                # Parse response (assuming JSON output)
                try:
                    response = json.loads(clean_json)
                    response_content = response.get('content', 'No response')
                    
                    # Clean up response formatting - remove markdown styling
                    response_content = self.clean_response_formatting(response_content)
                    
                    self.log_debug("response_parsed", "Successfully parsed JSON response", {
                        "content_length": len(response_content),
                        "metadata": response.get('metadata', {}),
                        "full_response": response
                    })
                    
                    self.messages.append({
                        'role': 'assistant', 
                        'content': response_content,
                        'timestamp': datetime.now()
                    })
                except json.JSONDecodeError as e:
                    # Fallback to plain text
                    fallback_content = clean_stdout if clean_stdout else "No response"
                    
                    self.log_debug("response_fallback", "JSON parse failed, using plain text", {
                        "json_error": str(e),
                        "fallback_content": fallback_content[:200],
                        "raw_stdout": full_stdout[:500],
                        "cleaned_json": clean_json[:200]
                    })
                    
                    self.messages.append({
                        'role': 'assistant',
                        'content': fallback_content,
                        'timestamp': datetime.now()
                    })
            else:
                error_msg = full_stderr or 'Command failed'
                self.log_debug("subprocess_error", "TypeScript backend failed", {
                    "return_code": return_code,
                    "error": error_msg,
                    "stdout": full_stdout[:200] if full_stdout else ""
                })
                
                self.messages.append({
                    'role': 'assistant',
                    'content': f"Error: {error_msg}",
                    'timestamp': datetime.now()
                })
                
        except subprocess.TimeoutExpired:
            self.log_debug("subprocess_timeout", "TypeScript backend timed out", {
                "timeout": 180
            })
            self.messages.append({
                'role': 'assistant',
                'content': "Error: Request timed out",
                'timestamp': datetime.now()
            })
        except Exception as e:
            self.log_debug("subprocess_exception", "Exception during TypeScript call", {
                "exception": str(e),
                "exception_type": type(e).__name__
            })
            self.messages.append({
                'role': 'assistant',
                'content': f"Error: {str(e)}",
                'timestamp': datetime.now()
            })
            
        self.thinking = False
        self.current_tool_activity = ""  # Clear any tool activity
        self.tool_start_time = None
        
        # Track response time
        self.last_response_time = time.time() - start_time
        self.total_messages_processed += 1
        
        self.update_status()

    def should_ignore_message(self, message, msg_type):
        """Filter out debug noise - only show user-relevant progress updates"""
        if msg_type == 'error':
            # Only show user-relevant errors, not internal debugging ones
            return 'all_json_blocks_failed' in message or 'deepseek_json_debug' in message
        
        if msg_type != 'engine':
            return False  # Always show non-engine messages
            
        # Ignore detailed debugging messages
        debug_noise_keywords = [
            'ollama_request_enqueued',
            'ollama_queue_reordered', 
            'ollama_request_processing_start',
            'ollama_api_call_start',
            'ollama_model_switch_delay',
            'ollama_queue_processing_start',
            'ollama_queue_processing_complete',
            'intent_calling_gemma',
            'intent_gemma_response',
            'intent_parsing_response', 
            'intent_parsed_successfully',
            'deepseek_json_debug',
            'error_context_agent_initializing',
            'error_context_agent_initialized',
            'component_status_changed',
            'processMessage_start',
            'input_routing_start',
            'input_routing_complete',
            'recursive_validation_iteration',
            'recursive_validation_analysis',
            'recursive_validation_satisfied'
        ]
        
        # Show these important progress messages
        important_keywords = [
            'system_state_changed',
            'intelligence_router_start',
            'intelligence_router_complete',
            'tools_agent_start',
            'tools_agent_executing_step',
            'subconscious_reasoning_start',
            'subconscious_reasoning_complete',
            'personality_interpretation_start',
            'personality_interpretation_success',
            'ollama_request_success'  # Show completions but not detailed debug
        ]
        
        # Check if message contains debug noise
        for noise in debug_noise_keywords:
            if noise in message:
                return True
                
        # Check if message contains important updates
        for important in important_keywords:
            if important in message:
                return False
                
        # Default: ignore other engine messages to reduce noise
        return True

    def process_system_messages(self, stderr_output):
        """Process system messages from stderr to update status and show personality responses"""
        try:
            # Split stderr into lines and process each JSON message
            lines = stderr_output.strip().split('\n')
            
            for line in lines:
                if not line.strip():
                    continue
                    
                try:
                    # Try to parse each line as JSON
                    msg = json.loads(line)
                    
                    if isinstance(msg, dict):
                        msg_type = msg.get('type', '')
                        message = msg.get('message', '')
                        metadata = msg.get('metadata', {})
                        
                        # Filter out debug noise - only process user-relevant messages
                        if self.should_ignore_message(message, msg_type):
                            continue
                        
                        # Handle immediate assistant messages (personality acknowledgments)
                        if msg_type == 'assistant_message':
                            content = msg.get('content', '')
                            source = metadata.get('source', '')
                            if content.strip():
                                # Add special prefix for personality acknowledgments
                                if source == 'personality_acknowledgment':
                                    content = f"🎭 {content}"
                                
                                self.messages.append({
                                    'role': 'assistant',
                                    'content': content,
                                    'timestamp': datetime.now(),
                                    'immediate': True,
                                    'source': source
                                })
                                # Force screen refresh to show message immediately
                                if not self.copy_mode:
                                    self.draw_screen()

                        # Handle tool activity updates
                        elif msg_type == 'tool_activity':
                            activity = msg.get('activity', '')
                            tool_name = msg.get('tool_name', '')
                            if activity.strip():
                                self.current_tool_activity = activity
                                self.tool_start_time = time.time()
                                self.tool_progress_dots = 0
                            else:
                                # Clear tool activity
                                self.current_tool_activity = ""
                                self.tool_start_time = None
                            
                            self.update_status()
                            # Force status refresh
                            if not self.copy_mode:
                                self.draw_screen()

                        # Handle tool execution blurbs
                        elif msg_type == 'tool_blurb':
                            content = msg.get('content', '')
                            tool_name = msg.get('tool_name', '')
                            if content.strip():
                                self.messages.append({
                                    'role': 'system',
                                    'content': f"🔧 {content}",
                                    'timestamp': datetime.now(),
                                    'tool': tool_name
                                })
                                # Force screen refresh
                                if not self.copy_mode:
                                    self.draw_screen()
                        
                        # Handle system state changes (like "Ani is ready")
                        elif msg_type == 'engine' and 'system_state_changed' in message:
                            status = metadata.get('status', '')
                            status_message = metadata.get('message', '')
                            
                            if status == 'ready' and status_message:
                                # Show the ready message as a system message
                                self.messages.append({
                                    'role': 'system',
                                    'content': status_message,
                                    'timestamp': datetime.now()
                                })
                                self.status = f"Status: Ready"
                                
                        # Handle file operations acknowledgments from personality
                        elif msg_type == 'engine' and 'file_operations_user_acknowledgment' in message:
                            acknowledgment = metadata.get('acknowledgment', '')
                            if acknowledgment.strip():
                                # This is Ani's warm response before starting work
                                self.messages.append({
                                    'role': 'assistant',
                                    'content': acknowledgment,
                                    'timestamp': datetime.now()
                                })
                                
                        # Handle other engine events for status updates
                        elif msg_type == 'engine':
                            if 'loading_personality' in message:
                                personality_name = metadata.get('message', 'personality')
                                self.status = f"Loading {personality_name}..."
                            elif 'file_operations_calling_gemma' in message:
                                self.status = "Planning file operations..."
                            elif 'file_operation_executing' in message:
                                operation = metadata.get('operation', 'operation')
                                self.status = f"Executing: {operation}"
                            elif 'personalizing' in message or 'personality_interpretation' in message:
                                self.status = "Personalizing response..."
                            elif 'intent_classification' in message:
                                self.status = "🧠 Analyzing intent..."
                                self.current_tool_activity = "analyzing user intent"
                                self.tool_start_time = time.time()
                            elif 'intelligence_router' in message:
                                self.status = "🤖 Selecting optimal model..."
                                self.current_tool_activity = "routing to best AI model"
                                self.tool_start_time = time.time()
                            elif 'tools_agent_start' in message:
                                self.status = "🔧 Planning tool execution..."
                                self.current_tool_activity = "planning tool steps"
                                self.tool_start_time = time.time()
                            elif 'tools_agent_executing_step' in message:
                                step_data = metadata.get('step', {})
                                tool_name = step_data.get('tool', 'unknown')
                                description = step_data.get('description', '')
                                self.current_tool_activity = f"executing {tool_name}"
                                if description:
                                    self.status = f"🔧 {description}..."
                                else:
                                    self.status = f"🔧 Executing {tool_name}..."
                                self.tool_start_time = time.time()
                            elif 'recursive_validation' in message:
                                self.status = "🔍 Validating results recursively..."
                                self.current_tool_activity = "recursive validation"
                                self.tool_start_time = time.time()
                            elif 'subconscious_reasoning' in message:
                                self.status = "🧠 Deep reasoning with DeepSeek..."
                                self.current_tool_activity = "deep subconscious analysis"
                                self.tool_start_time = time.time()
                            elif 'deepseek_attempt' in message:
                                attempt = metadata.get('attempt', 1)
                                self.status = f"🧠 DeepSeek thinking (attempt {attempt})..."
                                self.current_tool_activity = f"DeepSeek reasoning (try {attempt})"
                            elif 'personality_interpretation' in message:
                                self.status = "🎭 Ani interpreting response..."
                                self.current_tool_activity = "personality interpretation"
                                self.tool_start_time = time.time()
                            elif 'thinking' in message:
                                thinking_msg = metadata.get('message', 'Thinking...')
                                self.status = f"💭 {thinking_msg}"
                                self.current_tool_activity = "thinking"
                                self.tool_start_time = time.time()
                            elif '_complete' in message or '_success' in message:
                                # Clear tool activity when operations complete
                                self.current_tool_activity = ""
                                self.tool_start_time = None
                                self.status = "✅ Task completed"
                            elif '_failed' in message or 'error' in message.lower():
                                # Clear tool activity on error but show error status
                                self.current_tool_activity = ""
                                self.tool_start_time = None
                                error_msg = metadata.get('error', 'Unknown error')
                                self.status = f"❌ Error: {error_msg[:50]}..."
                                
                except json.JSONDecodeError:
                    # Skip lines that aren't valid JSON
                    continue
                    
        except Exception as e:
            # Log any processing errors but don't crash
            self.log_debug("system_message_error", f"Error processing system messages: {e}", {
                "stderr_preview": stderr_output[:200] if stderr_output else "",
                "error": str(e)
            })
        
    def clean_response_formatting(self, content):
        """Clean up response formatting - remove markdown styling for cleaner chat"""
        if not content:
            return content
            
        # Remove common markdown formatting
        content = content.replace('*', '')  # Remove asterisks (bold/italic)
        content = content.replace('_', '')  # Remove underscores (italic)
        content = content.replace('**', '') # Remove bold markers
        content = content.replace('__', '') # Remove bold underscores
        
        # Clean up excessive spacing and newlines
        import re
        content = re.sub(r'\n{3,}', '\n\n', content)  # Max 2 consecutive newlines
        content = re.sub(r' {2,}', ' ', content)      # Max 1 consecutive space
        
        # Remove escape characters that might mess up terminal
        content = content.replace('\\"', '"')
        content = content.replace('\\n', '\n')
        
        return content.strip()
        
    def handle_shortcuts(self, ch):
        """Handle keyboard shortcuts - stolen from working claude-condom"""
        if ch == 20:  # Ctrl+T - Toggle provider (claude → gemini → local)
            providers = ["claude", "gemini", "local"]
            current_idx = providers.index(self.provider) if self.provider in providers else 0
            new_provider = providers[(current_idx + 1) % len(providers)]
            
            self.log_debug("provider_toggle", "Provider toggled", {
                "old_provider": self.provider,
                "new_provider": new_provider
            })
            
            self.provider = new_provider
            self.update_status()
            return True
            
        elif ch == 12:  # Ctrl+L - Toggle conversation context
            old_context = self.conversation_context
            self.conversation_context = not self.conversation_context
            
            self.log_debug("context_toggle", "Conversation context toggled", {
                "old_context": old_context,
                "new_context": self.conversation_context
            })
            
            self.update_status()
            return True
            
        elif ch == 19:  # Ctrl+S - Toggle streaming
            self.streaming = not self.streaming
            self.update_status()
            return True
            
        elif ch == 16:  # Ctrl+P - Toggle personality
            personalities = ["ani", "professional", "casual"]
            current_idx = personalities.index(self.personality) if self.personality in personalities else 0
            self.personality = personalities[(current_idx + 1) % len(personalities)]
            self.update_status()
            return True
            
        elif ch == 22:  # Ctrl+V - Toggle view (personality/claude_raw)
            if self.view_mode == "personality":
                self.view_mode = "claude_raw"
            else:
                self.view_mode = "personality"
            
            self.log_debug("view_toggle", "View mode toggled", {
                "old_view": "claude_raw" if self.view_mode == "personality" else "personality",
                "new_view": self.view_mode
            })
            self.update_status()
            return True
            
        elif ch == 18:  # Ctrl+R - Toggle copy mode (pause/resume refresh)
            self.copy_mode = not self.copy_mode
            self.update_status()
            return True
            
        elif ch == 15:  # Ctrl+O - Toggle tools (when provider=local) 
            if self.provider == "local":
                old_tools = self.tools_enabled
                self.tools_enabled = not self.tools_enabled
                
                self.log_debug("tools_toggle", "Tools toggle attempted", {
                    "provider": self.provider,
                    "old_tools": old_tools,
                    "new_tools": self.tools_enabled,
                    "key_code": ch
                })
                
                self.update_status()
            else:
                self.log_debug("tools_toggle_ignored", "Tools toggle ignored (not local provider)", {
                    "provider": self.provider,
                    "key_code": ch
                })
            return True
            
        elif ch == 3:  # Ctrl+C - Exit
            return "EXIT"
            
        return False
        
    def run(self, stdscr):
        """Main TUI loop - stolen from working claude-condom pattern"""
        self.stdscr = stdscr
        self.init_colors()
        
        # Set non-blocking input with timeout
        self.stdscr.timeout(100)
        curses.curs_set(0)  # Hide cursor
        
        self.update_status()
        
        # Add enhanced welcome message with help
        self.messages.append({
            'role': 'assistant', 
            'content': '🎭 Welcome to Coquette Enhanced! \n\nNew Features:\n• Real-time tool activity visualization\n• Animated progress indicators\n• Performance metrics\n• Enhanced Ani personality responses\n• Tool execution blurbs\n\nShortcuts:\n• Ctrl+T: Provider (claude→gemini→local)\n• Ctrl+L: Context (🧠/🔄)\n• Ctrl+P: Personality (ani→prof→casual)\n• Ctrl+O: Tools (local: 💬/🔧)\n• Ctrl+V: View (personality/raw)\n• Ctrl+R: Copy mode\n• Ctrl+C: Exit\n\nType a message to see the enhanced visual feedback in action!',
            'timestamp': datetime.now()
        })
        
        while True:
            # Only redraw if not in copy mode
            if not self.copy_mode:
                self.draw_screen()
            
            ch = self.stdscr.getch()
            
            if ch == -1:  # No input (timeout)
                # Update tool progress animation
                if self.current_tool_activity:
                    self.tool_progress_dots = (self.tool_progress_dots + 1) % 4
                    self.update_status()
                continue
                
            # Handle shortcuts first
            shortcut_result = self.handle_shortcuts(ch)
            if shortcut_result == "EXIT":
                break
            elif shortcut_result:
                continue
                
            # Handle input
            if ch in [10, 13]:  # Enter
                if self.current_input.strip():
                    message = self.current_input.strip()
                    self.current_input = ""
                    self.send_message(message)
                    
            elif ch in [8, 127, curses.KEY_BACKSPACE]:  # Backspace
                if self.current_input:
                    self.current_input = self.current_input[:-1]
                    
            elif 32 <= ch <= 126:  # Printable characters
                self.current_input += chr(ch)

def main():
    tui = CoquetteTUI()
    
    try:
        curses.wrapper(tui.run)
    except KeyboardInterrupt:
        print("\nGoodbye!")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()