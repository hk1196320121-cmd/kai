import { DispatchError } from "../core/orchestrator/types";
import type { AgentBridge, DispatchResult } from "./agent-bridge";

/** Default timeout for claude subprocess execution (ms) */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Maximum prompt length (chars) to prevent abuse */
const MAX_PROMPT_LENGTH = 10_000;

/** Maximum output size in bytes (1MB). Prevents OOM from unbounded subprocess output. */
const MAX_OUTPUT_BYTES = 1_024 * 1_024;

export interface ClaudeCodeBridgeConfig {
  /** Timeout in ms for subprocess execution. Default: 120000 */
  timeoutMs?: number;
  /** Grace period after SIGTERM before SIGKILL (ms). Default: 5000 */
  graceMs?: number;
  /** Working directory for claude subprocess. Default: process.cwd() */
  cwd?: string;
  /** Path to the claude binary. Default: "claude" (resolved via PATH) */
  bin?: string;
}

export class ClaudeCodeBridge implements AgentBridge {
  private timeoutMs: number;
  private graceMs: number;
  private cwd: string;
  private bin: string;

  constructor(config?: ClaudeCodeBridgeConfig) {
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.graceMs = config?.graceMs ?? 5_000;
    this.cwd = config?.cwd ?? process.cwd();
    this.bin = config?.bin ?? "claude";
  }

  async dispatchOneOff(
    taskId: string,
    agent: string,
    prompt: string,
  ): Promise<DispatchResult> {
    // Security: reject empty prompt
    if (!prompt || prompt.trim().length === 0) {
      return {
        success: false,
        agent,
        error: "Prompt is empty",
        retryable: false,
      };
    }

    // Security: validate prompt length
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return {
        success: false,
        agent,
        error: `Prompt exceeds maximum length (${prompt.length} > ${MAX_PROMPT_LENGTH})`,
        retryable: false,
      };
    }

    try {
      const proc = Bun.spawn([this.bin, "--print"], {
        cwd: this.cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Write prompt via stdin pipe (not argv — avoids length limits + process listing leak)
      // Bun's stdin: "pipe" returns a FileSink, not a WritableStream
      proc.stdin.write(prompt);
      proc.stdin.flush();
      await proc.stdin.end();

      // CRITICAL: Start reading streams IMMEDIATELY to prevent pipe deadlock.
      // If Claude writes >64KB to stdout/stderr and we don't drain concurrently,
      // the child process blocks on write and never exits.
      const stdoutPromise = this.readStream(proc.stdout);
      const stderrPromise = this.readStream(proc.stderr);

      // Race between process exit and timeout
      // C1 fix: store timer ID so we can clearTimeout if process exits first
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          try {
            proc.kill("SIGTERM");
            // Grace period before SIGKILL — also tracked for cleanup
            const graceId = setTimeout(() => {
              try {
                proc.kill("SIGKILL");
              } catch {}
            }, this.graceMs);
            // Grace timer is fire-and-forget by design (process should exit on SIGTERM)
            // but we store it for potential future cleanup needs
            void graceId;
          } catch {}
          reject(new Error("TIMEOUT: claude subprocess exceeded timeout"));
        }, this.timeoutMs);
      });

      let exitCode: number;
      try {
        exitCode = await Promise.race([proc.exited, timeoutPromise]);
      } finally {
        // C1 fix: clear the timeout if process exited normally (won the race)
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }

      // Await stream results (they're already draining in background)
      const stdout = await stdoutPromise;
      const stderr = await stderrPromise;

      if (exitCode === 0) {
        return {
          success: true,
          agent,
          jobId: taskId,
          retryable: false,
          output: stdout,
        };
      }

      return {
        success: false,
        agent,
        error: stderr || `claude exited with code ${exitCode}`,
        retryable: false,
        output: stdout || undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes("ENOENT")) {
        return {
          success: false,
          agent,
          error: `${DispatchError.AGENT_NOT_FOUND}: claude binary not found in PATH`,
          retryable: false,
        };
      }

      // TIMEOUT errors get their own clean category (not wrapped in EXECUTION_FAILED)
      if (message.startsWith("TIMEOUT")) {
        return {
          success: false,
          agent,
          error: `${DispatchError.TIMEOUT}: ${message.replace("TIMEOUT: ", "")}`,
          retryable: false,
        };
      }

      return {
        success: false,
        agent,
        error: `${DispatchError.EXECUTION_FAILED}: ${message}`,
        retryable: false,
      };
    }
  }

  async scheduleCron(): Promise<DispatchResult> {
    throw new Error("ClaudeCodeBridge.scheduleCron not supported");
  }

  async cancelCron(): Promise<boolean> {
    throw new Error("ClaudeCodeBridge.cancelCron not supported");
  }

  async listPending(): Promise<
    Array<{ id: string; type: string; schedule?: string; prompt: string }>
  > {
    return [];
  }

  private decoder = new TextDecoder();

  private async readStream(
    stream: ReadableStream<Uint8Array>,
  ): Promise<string> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      // C2 fix: cap output to prevent OOM from unbounded subprocess output
      if (totalBytes > MAX_OUTPUT_BYTES) {
        chunks.push(
          value.slice(0, MAX_OUTPUT_BYTES - (totalBytes - value.length)),
        );
        break;
      }
      chunks.push(value);
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      buf.set(chunk, offset);
      offset += chunk.length;
    }
    return this.decoder.decode(buf);
  }
}
