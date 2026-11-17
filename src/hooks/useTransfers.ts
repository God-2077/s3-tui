import { useCallback, useEffect, useRef, useState } from "react";
import { CancelToken, isCancelled } from "../utils/cancel.js";
import { errorMessage } from "../utils/error.js";
import type { ProgressSnapshot } from "../utils/progress.js";

export type TransferStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface TransferTaskView {
  id: string;
  kind: "upload" | "download";
  label: string;
  status: TransferStatus;
  loaded: number;
  total: number;
  percent: number;
  speed: number;
  etaMs?: number;
  part?: { current: number; total: number };
  error?: string;
  destPath?: string;
}

export interface TransferContext {
  token: CancelToken;
  onProgress: (snapshot: ProgressSnapshot) => void;
}

export interface TransferRequest {
  kind: "upload" | "download";
  label: string;
  total: number;
  destPath?: string;
  run: (context: TransferContext) => Promise<void>;
}

interface QueuedJob extends TransferRequest {
  id: string;
}

export interface UseTransfersResult {
  tasks: TransferTaskView[];
  enqueue: (requests: TransferRequest[]) => void;
  cancelAll: () => void;
  clearFinished: () => void;
  /** 队列或在途任务非空（读取 ref，避免拿到过期的 state）。 */
  isBusy: () => boolean;
}

export function useTransfers(options: { onDrained?: () => void } = {}): UseTransfersResult {
  const [tasks, setTasks] = useState<TransferTaskView[]>([]);
  const queueRef = useRef<QueuedJob[]>([]);
  const runningRef = useRef(false);
  const tokensRef = useRef(new Map<string, CancelToken>());
  const counterRef = useRef(0);
  const onDrainedRef = useRef(options.onDrained);
  onDrainedRef.current = options.onDrained;

  const update = useCallback(
    (
      id: string,
      patch:
        | Partial<TransferTaskView>
        | ((task: TransferTaskView) => Partial<TransferTaskView>),
    ) => {
      setTasks((previous) =>
        previous.map((task) => {
          if (task.id !== id) return task;
          const resolved = typeof patch === "function" ? patch(task) : patch;
          return { ...task, ...resolved };
        }),
      );
    },
    [],
  );

  const drain = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const job = queueRef.current.shift();
        if (!job) break;

        const token = new CancelToken();
        tokensRef.current.set(job.id, token);
        update(job.id, { status: "running", error: undefined });

        try {
          await job.run({
            token,
            onProgress: (snapshot: ProgressSnapshot) => {
              update(job.id, {
                status: "running",
                loaded: snapshot.loaded,
                total: snapshot.total || job.total,
                percent: snapshot.percent,
                speed: snapshot.speed,
                etaMs: snapshot.etaMs,
                part: snapshot.part,
              });
            },
          });

          update(job.id, (task) => ({
            status: token.cancelled ? "cancelled" : "done",
            percent: token.cancelled ? task.percent : 100,
            loaded: token.cancelled ? task.loaded : task.total || task.loaded,
            speed: 0,
            etaMs: undefined,
          }));
        } catch (error) {
          if (token.cancelled || isCancelled(error)) {
            update(job.id, { status: "cancelled", speed: 0, etaMs: undefined });
          } else {
            update(job.id, {
              status: "error",
              error: errorMessage(error),
              speed: 0,
              etaMs: undefined,
            });
          }
        } finally {
          tokensRef.current.delete(job.id);
        }
      }
    } finally {
      runningRef.current = false;
      onDrainedRef.current?.();
    }
  }, [update]);

  const enqueue = useCallback(
    (requests: TransferRequest[]) => {
      if (requests.length === 0) return;
      const jobs: QueuedJob[] = requests.map((request) => ({
        ...request,
        id: `${Date.now().toString(36)}-${(counterRef.current += 1).toString(36)}`,
      }));
      queueRef.current.push(...jobs);
      setTasks((previous) => [
        ...previous,
        ...jobs.map((job) => ({
          id: job.id,
          kind: job.kind,
          label: job.label,
          ...(job.destPath ? { destPath: job.destPath } : {}),
          status: "queued" as const,
          loaded: 0,
          total: job.total,
          percent: 0,
          speed: 0,
        })),
      ]);
      void drain();
    },
    [drain],
  );

  const cancelAll = useCallback(() => {
    const queued = queueRef.current.splice(0);
    if (queued.length > 0) {
      const ids = new Set(queued.map((job) => job.id));
      setTasks((previous) =>
        previous.map((task) =>
          ids.has(task.id) ? { ...task, status: "cancelled", speed: 0, etaMs: undefined } : task,
        ),
      );
    }
    for (const token of tokensRef.current.values()) token.cancel();
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((previous) =>
      previous.filter((task) => task.status === "running" || task.status === "queued"),
    );
  }, []);

  const isBusy = useCallback(
    () => runningRef.current || queueRef.current.length > 0 || tokensRef.current.size > 0,
    [],
  );

  useEffect(() => {
    return () => {
      queueRef.current = [];
      for (const token of tokensRef.current.values()) token.cancel();
    };
  }, []);

  return { tasks, enqueue, cancelAll, clearFinished, isBusy };
}