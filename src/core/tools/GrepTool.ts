/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Adapted for Coquette LocalMCP system
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { EOL } from 'os';
import { spawn } from 'child_process';
import { globStream } from 'glob';

// Simplified interfaces for our LocalMCP system
export interface GrepToolParams {
  pattern: string;
  path?: string;
  include?: string;
}

interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

// Utility functions (simplified from gemini-cli)
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isGitRepository(dirPath: string): boolean {
  try {
    const gitPath = path.join(dirPath, '.git');
    return fs.existsSync(gitPath);
  } catch {
    return false;
  }
}

/**
 * Production-grade Grep tool from gemini-cli, adapted for LocalMCP
 */
export class GrepTool {
  static readonly Name = 'search_content';
  
  constructor(private workingDirectory: string) {}

  /**
   * Validates the parameters for the tool
   */
  validateToolParams(params: GrepToolParams): string | null {
    if (!params.pattern || typeof params.pattern !== 'string') {
      return 'pattern parameter is required and must be a string';
    }

    try {
      new RegExp(params.pattern);
    } catch (error) {
      return `Invalid regular expression pattern: ${params.pattern}. Error: ${getErrorMessage(error)}`;
    }

    if (params.path) {
      try {
        this.resolveAndValidatePath(params.path);
      } catch (error) {
        return getErrorMessage(error);
      }
    }

    return null;
  }

  /**
   * Executes the grep search with the given parameters
   */
  async execute(params: GrepToolParams): Promise<{
    success: boolean;
    output: string;
    error?: string;
    metadata?: any;
  }> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        success: false,
        output: '',
        error: `Invalid parameters: ${validationError}`
      };
    }

    try {
      const searchDirAbs = this.resolveAndValidatePath(params.path);
      const searchDirDisplay = params.path || '.';

      const matches: GrepMatch[] = await this.performGrepSearch({
        pattern: params.pattern,
        path: searchDirAbs,
        include: params.include,
        signal: new AbortController().signal
      });

      if (matches.length === 0) {
        const noMatchMsg = `No matches found for pattern "${params.pattern}" in path "${searchDirDisplay}"${params.include ? ` (filter: "${params.include}")` : ''}.`;
        return { 
          success: true, 
          output: noMatchMsg,
          metadata: { matches_found: 0 }
        };
      }

      const matchesByFile = matches.reduce(
        (acc, match) => {
          const relativeFilePath = path.relative(
            searchDirAbs,
            path.resolve(searchDirAbs, match.filePath),
          ) || path.basename(match.filePath);
          if (!acc[relativeFilePath]) {
            acc[relativeFilePath] = [];
          }
          acc[relativeFilePath].push(match);
          acc[relativeFilePath].sort((a, b) => a.lineNumber - b.lineNumber);
          return acc;
        },
        {} as Record<string, GrepMatch[]>,
      );

      const matchCount = matches.length;
      const matchTerm = matchCount === 1 ? 'match' : 'matches';

      let output = `Found ${matchCount} ${matchTerm} for pattern "${params.pattern}" in path "${searchDirDisplay}"${params.include ? ` (filter: "${params.include}")` : ''}:\n---\n`;

      for (const filePath in matchesByFile) {
        output += `File: ${filePath}\n`;
        matchesByFile[filePath].forEach((match) => {
          const trimmedLine = match.line.trim();
          output += `L${match.lineNumber}: ${trimmedLine}\n`;
        });
        output += '---\n';
      }

      return {
        success: true,
        output: output.trim(),
        metadata: {
          matches_found: matchCount,
          files_searched: Object.keys(matchesByFile).length,
          pattern: params.pattern,
          search_path: searchDirDisplay
        }
      };
    } catch (error) {
      console.error(`Error during grep search: ${error}`);
      const errorMessage = getErrorMessage(error);
      return {
        success: false,
        output: '',
        error: `Grep search failed: ${errorMessage}`
      };
    }
  }

  /**
   * Checks if a path is within the working directory and resolves it
   */
  private resolveAndValidatePath(relativePath?: string): string {
    const targetPath = path.resolve(this.workingDirectory, relativePath || '.');

    // Security check: ensure path is within working directory
    if (!targetPath.startsWith(this.workingDirectory) && targetPath !== this.workingDirectory) {
      throw new Error(`Path validation failed: "${relativePath || '.'}" resolves outside working directory`);
    }

    // Check existence and type
    try {
      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${targetPath}`);
      }
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new Error(`Path does not exist: ${targetPath}`);
      }
      throw new Error(`Failed to access path: ${targetPath}`);
    }

    return targetPath;
  }

  /**
   * Checks if a command is available in the system's PATH
   */
  private isCommandAvailable(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const checkCommand = process.platform === 'win32' ? 'where' : 'command';
      const checkArgs = process.platform === 'win32' ? [command] : ['-v', command];
      try {
        const child = spawn(checkCommand, checkArgs, {
          stdio: 'ignore',
          shell: process.platform === 'win32',
        });
        child.on('close', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Parses grep output in format: filePath:lineNumber:lineContent
   */
  private parseGrepOutput(output: string, basePath: string): GrepMatch[] {
    const results: GrepMatch[] = [];
    if (!output) return results;

    const lines = output.split(EOL);

    for (const line of lines) {
      if (!line.trim()) continue;

      const firstColonIndex = line.indexOf(':');
      if (firstColonIndex === -1) continue;

      const secondColonIndex = line.indexOf(':', firstColonIndex + 1);
      if (secondColonIndex === -1) continue;

      const filePathRaw = line.substring(0, firstColonIndex);
      const lineNumberStr = line.substring(firstColonIndex + 1, secondColonIndex);
      const lineContent = line.substring(secondColonIndex + 1);

      const lineNumber = parseInt(lineNumberStr, 10);

      if (!isNaN(lineNumber)) {
        const absoluteFilePath = path.resolve(basePath, filePathRaw);
        const relativeFilePath = path.relative(basePath, absoluteFilePath);

        results.push({
          filePath: relativeFilePath || path.basename(absoluteFilePath),
          lineNumber,
          line: lineContent,
        });
      }
    }
    return results;
  }

  /**
   * Performs the actual search using prioritized strategies
   */
  private async performGrepSearch(options: {
    pattern: string;
    path: string;
    include?: string;
    signal: AbortSignal;
  }): Promise<GrepMatch[]> {
    const { pattern, path: absolutePath, include } = options;

    try {
      // Strategy 1: git grep (fastest if in git repo)
      const isGit = isGitRepository(absolutePath);
      const gitAvailable = isGit && (await this.isCommandAvailable('git'));

      if (gitAvailable) {
        const gitArgs = ['grep', '--untracked', '-n', '-E', '--ignore-case', pattern];
        if (include) {
          gitArgs.push('--', include);
        }

        try {
          const output = await new Promise<string>((resolve, reject) => {
            const child = spawn('git', gitArgs, {
              cwd: absolutePath,
              windowsHide: true,
            });
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
            child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
            child.on('error', (err) => reject(new Error(`Failed to start git grep: ${err.message}`)));
            child.on('close', (code) => {
              const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
              const stderrData = Buffer.concat(stderrChunks).toString('utf8');
              if (code === 0) resolve(stdoutData);
              else if (code === 1) resolve(''); // No matches
              else reject(new Error(`git grep exited with code ${code}: ${stderrData}`));
            });
          });
          return this.parseGrepOutput(output, absolutePath);
        } catch (gitError: unknown) {
          console.debug(`git grep failed: ${getErrorMessage(gitError)}. Falling back...`);
        }
      }

      // Strategy 2: System grep
      const grepAvailable = await this.isCommandAvailable('grep');
      if (grepAvailable) {
        const grepArgs = ['-r', '-n', '-H', '-E'];
        const commonExcludes = ['.git', 'node_modules', 'bower_components'];
        commonExcludes.forEach((dir) => grepArgs.push(`--exclude-dir=${dir}`));
        if (include) {
          grepArgs.push(`--include=${include}`);
        }
        grepArgs.push(pattern);
        grepArgs.push('.');

        try {
          const output = await new Promise<string>((resolve, reject) => {
            const child = spawn('grep', grepArgs, {
              cwd: absolutePath,
              windowsHide: true,
            });
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
            child.stderr.on('data', (chunk) => {
              const stderrStr = chunk.toString();
              if (!stderrStr.includes('Permission denied') && !/grep:.*: Is a directory/i.test(stderrStr)) {
                stderrChunks.push(chunk);
              }
            });
            child.on('error', (err) => reject(new Error(`Failed to start system grep: ${err.message}`)));
            child.on('close', (code) => {
              const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
              const stderrData = Buffer.concat(stderrChunks).toString('utf8').trim();
              if (code === 0) resolve(stdoutData);
              else if (code === 1) resolve(''); // No matches
              else {
                if (stderrData) reject(new Error(`System grep exited with code ${code}: ${stderrData}`));
                else resolve(''); // Exit code > 1 but no stderr
              }
            });
          });
          return this.parseGrepOutput(output, absolutePath);
        } catch (grepError: unknown) {
          console.debug(`System grep failed: ${getErrorMessage(grepError)}. Falling back...`);
        }
      }

      // Strategy 3: Pure JavaScript fallback
      console.debug('Falling back to JavaScript grep implementation.');
      const globPattern = include ? include : '**/*';
      const ignorePatterns = ['.git/**', 'node_modules/**', 'bower_components/**', '.svn/**', '.hg/**'];

      const filesStream = globStream(globPattern, {
        cwd: absolutePath,
        dot: true,
        ignore: ignorePatterns,
        absolute: true,
        nodir: true,
        signal: options.signal,
      });

      const regex = new RegExp(pattern, 'i');
      const allMatches: GrepMatch[] = [];

      for await (const filePath of filesStream) {
        const fileAbsolutePath = filePath as string;
        try {
          const content = await fsPromises.readFile(fileAbsolutePath, 'utf8');
          const lines = content.split(/\r?\n/);
          lines.forEach((line, index) => {
            if (regex.test(line)) {
              allMatches.push({
                filePath: path.relative(absolutePath, fileAbsolutePath) || path.basename(fileAbsolutePath),
                lineNumber: index + 1,
                line,
              });
            }
          });
        } catch (readError: unknown) {
          if (!isNodeError(readError) || readError.code !== 'ENOENT') {
            console.debug(`Could not read/process ${fileAbsolutePath}: ${getErrorMessage(readError)}`);
          }
        }
      }

      return allMatches;
    } catch (error: unknown) {
      console.error(`Error in performGrepSearch: ${getErrorMessage(error)}`);
      throw error;
    }
  }
}