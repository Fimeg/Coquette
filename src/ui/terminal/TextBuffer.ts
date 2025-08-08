/**
 * Text buffer implementation for advanced text editing
 * Based on Codex CLI's TextBuffer with cursor management
 */

export class TextBuffer {
  private content: string;
  private cursor: number;

  constructor(initialContent: string = '') {
    this.content = initialContent;
    this.cursor = initialContent.length;
  }

  // Basic operations
  toString(): string {
    return this.content;
  }

  length(): number {
    return this.content.length;
  }

  getCursor(): number {
    return this.cursor;
  }

  setCursor(position: number): void {
    this.cursor = Math.max(0, Math.min(position, this.content.length));
  }

  // Text manipulation
  insert(text: string): void {
    this.content = 
      this.content.slice(0, this.cursor) + 
      text + 
      this.content.slice(this.cursor);
    this.cursor += text.length;
  }

  backspace(): boolean {
    if (this.cursor > 0) {
      this.content = 
        this.content.slice(0, this.cursor - 1) + 
        this.content.slice(this.cursor);
      this.cursor--;
      return true;
    }
    return false;
  }

  delete(): boolean {
    if (this.cursor < this.content.length) {
      this.content = 
        this.content.slice(0, this.cursor) + 
        this.content.slice(this.cursor + 1);
      return true;
    }
    return false;
  }

  clear(): void {
    this.content = '';
    this.cursor = 0;
  }

  // Cursor movement
  moveLeft(): boolean {
    if (this.cursor > 0) {
      this.cursor--;
      return true;
    }
    return false;
  }

  moveRight(): boolean {
    if (this.cursor < this.content.length) {
      this.cursor++;
      return true;
    }
    return false;
  }

  moveToBol(): void {
    // Move to beginning of current line
    const currentLine = this.getCurrentLineStart();
    this.cursor = currentLine;
  }

  moveToEol(): void {
    // Move to end of current line
    const currentLineEnd = this.getCurrentLineEnd();
    this.cursor = currentLineEnd;
  }

  moveWordBackward(): void {
    if (this.cursor <= 0) return;

    let pos = this.cursor - 1;
    
    // Skip whitespace
    while (pos > 0 && this.isWhitespace(this.content[pos])) {
      pos--;
    }
    
    // Skip to beginning of word
    while (pos > 0 && !this.isWhitespace(this.content[pos - 1])) {
      pos--;
    }
    
    this.cursor = pos;
  }

  moveWordForward(): void {
    if (this.cursor >= this.content.length) return;

    let pos = this.cursor;
    
    // Skip current word
    while (pos < this.content.length && !this.isWhitespace(this.content[pos])) {
      pos++;
    }
    
    // Skip whitespace
    while (pos < this.content.length && this.isWhitespace(this.content[pos])) {
      pos++;
    }
    
    this.cursor = pos;
  }

  // Advanced deletion
  deleteWordBackward(): void {
    if (this.cursor <= 0) return;

    const originalCursor = this.cursor;
    this.moveWordBackward();
    const newCursor = this.cursor;
    
    this.content = 
      this.content.slice(0, newCursor) + 
      this.content.slice(originalCursor);
  }

  deleteToEndOfLine(): void {
    const lineEnd = this.getCurrentLineEnd();
    this.content = 
      this.content.slice(0, this.cursor) + 
      this.content.slice(lineEnd);
  }

  deleteCurrentLine(): void {
    const lineStart = this.getCurrentLineStart();
    const lineEnd = this.getCurrentLineEnd();
    
    // Include newline character if not at end of content
    const deleteEnd = lineEnd < this.content.length ? lineEnd + 1 : lineEnd;
    
    this.content = 
      this.content.slice(0, lineStart) + 
      this.content.slice(deleteEnd);
    
    this.cursor = lineStart;
  }

  // Line operations
  getCurrentLine(): string {
    const start = this.getCurrentLineStart();
    const end = this.getCurrentLineEnd();
    return this.content.slice(start, end);
  }

  getCurrentLineNumber(): number {
    return this.content.slice(0, this.cursor).split('\n').length;
  }

  getTotalLines(): number {
    return this.content.split('\n').length;
  }

  getLines(): string[] {
    return this.content.split('\n');
  }

  getLineAt(lineNumber: number): string {
    const lines = this.getLines();
    return lines[lineNumber - 1] || '';
  }

  // Selection operations (for future use)
  getSelection(start: number, end: number): string {
    const selStart = Math.max(0, Math.min(start, end));
    const selEnd = Math.min(this.content.length, Math.max(start, end));
    return this.content.slice(selStart, selEnd);
  }

  replaceSelection(start: number, end: number, replacement: string): void {
    const selStart = Math.max(0, Math.min(start, end));
    const selEnd = Math.min(this.content.length, Math.max(start, end));
    
    this.content = 
      this.content.slice(0, selStart) + 
      replacement + 
      this.content.slice(selEnd);
      
    this.cursor = selStart + replacement.length;
  }

  // Private helper methods
  private getCurrentLineStart(): number {
    const beforeCursor = this.content.slice(0, this.cursor);
    const lastNewline = beforeCursor.lastIndexOf('\n');
    return lastNewline === -1 ? 0 : lastNewline + 1;
  }

  private getCurrentLineEnd(): number {
    const afterCursor = this.content.slice(this.cursor);
    const nextNewline = afterCursor.indexOf('\n');
    return nextNewline === -1 ? this.content.length : this.cursor + nextNewline;
  }

  private isWhitespace(char: string): boolean {
    return /\s/.test(char);
  }

  private isWordCharacter(char: string): boolean {
    return /\w/.test(char);
  }

  // Utility methods for debugging/testing
  getDebugInfo(): {
    content: string;
    cursor: number;
    length: number;
    currentLine: string;
    lineNumber: number;
    totalLines: number;
  } {
    return {
      content: this.content,
      cursor: this.cursor,
      length: this.content.length,
      currentLine: this.getCurrentLine(),
      lineNumber: this.getCurrentLineNumber(),
      totalLines: this.getTotalLines()
    };
  }

  // Serialization
  toJSON(): { content: string; cursor: number } {
    return {
      content: this.content,
      cursor: this.cursor
    };
  }

  static fromJSON(data: { content: string; cursor: number }): TextBuffer {
    const buffer = new TextBuffer(data.content);
    buffer.setCursor(data.cursor);
    return buffer;
  }
}