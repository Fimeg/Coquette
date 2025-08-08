import fs from 'fs';
import path from 'path';

interface DebugEntry {
  timestamp: Date;
  type: 'input' | 'submit' | 'engine' | 'error';
  message: string;
  metadata?: any;
}

export class DebugLogger {
  private static instance: DebugLogger | null = null;

  public static getInstance(): DebugLogger {
    if (!DebugLogger.instance) {
      DebugLogger.instance = new DebugLogger();
    }
    return DebugLogger.instance;
  }

  private debugDir: string = '';
  private sessionFile: string = '';
  
  private initialized = false;

  private constructor() {
    try {
      if (this.initialized) return;
      
      this.debugDir = path.join(process.cwd(), 'debug');
      this.sessionFile = path.join(
        this.debugDir,
        `debug_session_${process.pid}.json`
      );
      
      // Clear previous log file
      if (fs.existsSync(this.sessionFile)) {
        fs.writeFileSync(this.sessionFile, '');
      }
      
      this.ensureDebugDir();
      this.initialized = true;
      console.log(`Debug session started: ${this.sessionFile}`);
      
      this.ensureDebugDir();
    } catch (error) {
      console.error('DebugLogger initialization failed:', error);
      throw error;
    }
  }
  
  private ensureDebugDir() {
    if (!fs.existsSync(this.debugDir)) {
      fs.mkdirSync(this.debugDir, { recursive: true });
    }
  }
  
  log(entry: Omit<DebugEntry, 'timestamp'>) {
    const debugEntry: DebugEntry = {
      ...entry,
      timestamp: new Date()
    };
    
    try {
      const logLine = JSON.stringify(debugEntry) + '\n';
      fs.appendFileSync(this.sessionFile, logLine);
      
      // Only log errors and important events to console
      if (entry.type === 'error' || process.env.DEBUG) {
        console.log(`[Debug] ${entry.type}: ${entry.message}`);
      }
    } catch (error) {
      console.error('Debug logging failed:', error);
      console.error('Debug directory exists:', fs.existsSync(this.debugDir));
      console.error('Session file exists:', fs.existsSync(this.sessionFile));
      console.error('Debug directory permissions:', fs.statSync(this.debugDir).mode.toString(8));
    }
  }

  logInputEvent(type: string, input: string) {
    this.log({
      type: 'input',
      message: `${type} event`,
      metadata: { input }
    });
  }

  logSubmit(content: string) {
    this.log({
      type: 'submit', 
      message: 'Form submission',
      metadata: { content }
    });
  }

  logEngineEvent(event: string, data?: any) {
    this.log({
      type: 'engine',
      message: `Engine ${event}`,
      metadata: data
    });
    
    // Also emit to stderr for TUI consumption
    const systemMessage = {
      type: 'engine',
      message: `Engine ${event}`,
      metadata: data || {},
      timestamp: new Date().toISOString()
    };
    process.stderr.write(JSON.stringify(systemMessage) + '\n');
  }

  logError(context: string, error: any) {
    this.log({
      type: 'error',
      message: `Error in ${context}`,
      metadata: { 
        error: error?.message || String(error),
        stack: error?.stack 
      }
    });
    
    // Also emit to stderr for TUI consumption
    const systemMessage = {
      type: 'error',
      message: `Error in ${context}`,
      metadata: { 
        error: error?.message || String(error),
        stack: error?.stack 
      },
      timestamp: new Date().toISOString()
    };
    process.stderr.write(JSON.stringify(systemMessage) + '\n');
  }
}
