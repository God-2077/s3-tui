import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Logger = (message: string, error?: unknown) => void;

const noop: Logger = () => {};

/** 只在 S3_TUI_DEBUG=true 时写文件，绝不污染 TUI 输出。 */
export function createLogger(enabled: boolean, file: string): Logger {
  if (!enabled) return noop;
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    // 无法创建目录时静默降级
  }
  return (message, error) => {
    const stamp = new Date().toISOString();
    let detail = "";
    if (error instanceof Error) detail = `\n${error.stack ?? error.message}`;
    else if (error !== undefined) detail = `\n${String(error)}`;
    try {
      appendFileSync(file, `[${stamp}] ${message}${detail}\n`);
    } catch {
      // 日志失败不影响主流程
    }
  };
}