/**
 * Daemon status — PID file management and status reporting.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { PID_PATH } from './config.js';

export function writePid(): void {
  writeFileSync(PID_PATH, String(process.pid), 'utf-8');
}

export function clearPid(): void {
  try {
    unlinkSync(PID_PATH);
  } catch { /* ignore */ }
}

export function readPid(): number | null {
  if (!existsSync(PID_PATH)) return null;
  try {
    const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
    if (isNaN(pid)) return null;
    // Check if process is actually running
    try {
      process.kill(pid, 0); // signal 0 = check existence
      return pid;
    } catch {
      // Process not running, stale PID file
      clearPid();
      return null;
    }
  } catch {
    return null;
  }
}

export function printStatus(): void {
  const pid = readPid();
  if (pid) {
    console.log(`familiard is running (PID: ${pid})`);
  } else {
    console.log('familiard is not running');
  }
}
