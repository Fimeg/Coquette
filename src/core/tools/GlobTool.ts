/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Adapted for Coquette LocalMCP system
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

// Simplified interfaces for our LocalMCP system
export interface GlobToolParams {
  pattern: string;
  path?: string;
  case_sensitive?: boolean;
  respect_git_ignore?: boolean;
}

// Subset of 'Path' interface provided by 'glob' that we can implement
export interface GlobPath {
  fullpath(): string;
  mtimeMs?: number;
}

// Utility functions (simplified from gemini-cli)
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);
  return resolvedTarget.startsWith(resolvedRoot + path.sep) || resolvedTarget === resolvedRoot;
}

/**
 * Sorts file entries based on recency and then alphabetically.
 * Recent files (modified within recencyThresholdMs) are listed first, newest to oldest.
 * Older files are listed after recent ones, sorted alphabetically by path.
 */
export function sortFileEntries(
  entries: GlobPath[],
  nowTimestamp: number,
  recencyThresholdMs: number,
): GlobPath[] {
  const sortedEntries = [...entries];
  sortedEntries.sort((a, b) => {
    const mtimeA = a.mtimeMs ?? 0;
    const mtimeB = b.mtimeMs ?? 0;
    const aIsRecent = nowTimestamp - mtimeA < recencyThresholdMs;
    const bIsRecent = nowTimestamp - mtimeB < recencyThresholdMs;

    if (aIsRecent && bIsRecent) {
      return mtimeB - mtimeA;
    } else if (aIsRecent) {
      return -1;
    } else if (bIsRecent) {
      return 1;
    } else {
      return a.fullpath().localeCompare(b.fullpath());
    }
  });
  return sortedEntries;
}

/**
 * Production-grade Glob tool from gemini-cli, adapted for LocalMCP
 */
export class GlobTool {
  static readonly Name = 'find_files';
  
  constructor(private workingDirectory: string) {}

  /**
   * Validates the parameters for the tool
   */
  validateToolParams(params: GlobToolParams): string | null {
    if (!params.pattern || typeof params.pattern !== 'string' || params.pattern.trim() === '') {
      return "The 'pattern' parameter cannot be empty.";
    }

    const searchDirAbsolute = path.resolve(this.workingDirectory, params.path || '.');

    if (!isWithinRoot(searchDirAbsolute, this.workingDirectory)) {
      return `Search path ("${searchDirAbsolute}") resolves outside the working directory ("${this.workingDirectory}").`;
    }

    try {
      if (!fs.existsSync(searchDirAbsolute)) {
        return `Search path does not exist: ${searchDirAbsolute}`;
      }
      if (!fs.statSync(searchDirAbsolute).isDirectory()) {
        return `Search path is not a directory: ${searchDirAbsolute}`;
      }
    } catch (e: unknown) {
      return `Error accessing search path: ${getErrorMessage(e)}`;
    }

    return null;
  }

  /**
   * Executes the glob search with the given parameters
   */
  async execute(params: GlobToolParams): Promise<{
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
      const searchDirAbsolute = path.resolve(this.workingDirectory, params.path || '.');
      const searchDirDisplay = params.path || '.';

      const entries = (await glob(params.pattern, {
        cwd: searchDirAbsolute,
        withFileTypes: true,
        nodir: true,
        stat: true,
        nocase: !params.case_sensitive,
        dot: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
        follow: false,
      })) as GlobPath[];

      // Apply git-aware filtering if enabled
      let filteredEntries = entries;
      let gitIgnoredCount = 0;

      if (params.respect_git_ignore !== false) {
        // Simple git ignore check - could be enhanced
        const gitIgnorePath = path.join(searchDirAbsolute, '.gitignore');
        if (fs.existsSync(gitIgnorePath)) {
          try {
            const gitIgnoreContent = fs.readFileSync(gitIgnorePath, 'utf8');
            const ignorePatterns = gitIgnoreContent
              .split('\n')
              .map(line => line.trim())
              .filter(line => line && !line.startsWith('#'));
            
            const originalCount = filteredEntries.length;
            filteredEntries = filteredEntries.filter(entry => {
              const relativePath = path.relative(searchDirAbsolute, entry.fullpath());
              return !ignorePatterns.some(pattern => {
                // Simple pattern matching - could be more sophisticated
                if (pattern.includes('*')) {
                  const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                  return regex.test(relativePath);
                }
                return relativePath.includes(pattern);
              });
            });
            gitIgnoredCount = originalCount - filteredEntries.length;
          } catch (error) {
            console.debug(`Could not read .gitignore: ${getErrorMessage(error)}`);
          }
        }
      }

      if (!filteredEntries || filteredEntries.length === 0) {
        let message = `No files found matching pattern "${params.pattern}" within ${searchDirDisplay}.`;
        if (gitIgnoredCount > 0) {
          message += ` (${gitIgnoredCount} files were git-ignored)`;
        }
        return {
          success: true,
          output: message,
          metadata: { matches_found: 0, git_ignored_count: gitIgnoredCount }
        };
      }

      // Sort by modification time (recent first, then alphabetical)
      const oneDayInMs = 24 * 60 * 60 * 1000;
      const nowTimestamp = new Date().getTime();

      const sortedEntries = sortFileEntries(filteredEntries, nowTimestamp, oneDayInMs);

      const sortedAbsolutePaths = sortedEntries.map(entry => entry.fullpath());
      const fileListDescription = sortedAbsolutePaths.join('\n');
      const fileCount = sortedAbsolutePaths.length;

      let resultMessage = `Found ${fileCount} file(s) matching "${params.pattern}" within ${searchDirDisplay}`;
      if (gitIgnoredCount > 0) {
        resultMessage += ` (${gitIgnoredCount} additional files were git-ignored)`;
      }
      resultMessage += `, sorted by modification time (newest first):\n${fileListDescription}`;

      return {
        success: true,
        output: resultMessage,
        metadata: {
          matches_found: fileCount,
          git_ignored_count: gitIgnoredCount,
          pattern: params.pattern,
          search_path: searchDirDisplay,
          files: sortedAbsolutePaths
        }
      };
    } catch (error) {
      console.error(`Error during glob search: ${error}`);
      const errorMessage = getErrorMessage(error);
      return {
        success: false,
        output: '',
        error: `Glob search failed: ${errorMessage}`
      };
    }
  }
}