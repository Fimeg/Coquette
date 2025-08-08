/**
 * Hook for getting terminal size - adapted from Codex CLI
 */

import { useState, useEffect } from 'react';

interface TerminalSize {
  width: number;
  height: number;
}

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(() => ({
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24
  }));

  useEffect(() => {
    const handleResize = () => {
      setSize({
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24
      });
    };

    // Listen for terminal resize events
    process.stdout.on('resize', handleResize);

    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  return size;
}