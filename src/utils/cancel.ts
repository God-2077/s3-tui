/** 取消令牌：同时中止在途 HTTP 请求与本地流。 */

export class CancelledError extends Error {
  constructor(message = "已取消") {
    super(message);
    this.name = "CancelledError";
  }
}

export function isCancelled(error: unknown): boolean {
  if (error instanceof CancelledError) return true;
  if (error instanceof Error) {
    return (
      error.name === "AbortError" ||
      error.name === "CanceledError" ||
      /aborted|cancell?ed/i.test(error.message)
    );
  }
  return false;
}

export class CancelToken {
  private readonly controller = new AbortController();
  private hooks: Array<() => void> = [];
  cancelled = false;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.controller.abort();
    const hooks = this.hooks;
    this.hooks = [];
    for (const hook of hooks) {
      try {
        hook();
      } catch {
        // 清理回调不应影响取消流程
      }
    }
  }

  onCancel(hook: () => void): () => void {
    if (this.cancelled) {
      hook();
      return () => {};
    }
    this.hooks.push(hook);
    return () => {
      this.hooks = this.hooks.filter((item) => item !== hook);
    };
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new CancelledError();
  }
}