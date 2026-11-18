import { useCallback, useEffect, useRef, useState } from "react";
import { CancelToken, isCancelled } from "../utils/cancel.js";
import { errorMessage } from "../utils/error.js";
import type { ProgressSnapshot } from "../utils/progress.js";
import {
  takeStartableJobs,
  type TransferKind,
  type TransferKindCounts,
  type TransferKindLimits,
  type TransferQueues,
} from "./transferQueue.js";

export type TransferStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface TransferTaskView {
  id: string;
  kind: TransferKind;
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
  kind: TransferKind;
  label: string;
  total: number;
  destPath?: string;
  run: (context: TransferContext) => Promise<void>;
}

interface QueuedJob extends TransferRequest {
  id: string;
}

export interface UseTransfersOptions {
  /** 同时运行的上传文件数，默认 1。 */
  uploadConcurrency?: number;
  /** 同时运行的下载文件数，默认 1。 */
  downloadConcurrency?: number;
  onDrained?: () => void;
}

export interface UseTransfersResult {
  tasks: TransferTaskView[];
  enqueue: (requests: TransferRequest[]) => void;
  cancelAll: () => void;
  clearFinished: () => void;
  /** 队列或在途任务非空（读取 ref，避免拿到过期的 state）。 */
  isBusy: () => boolean;
}

function normalizeLimit(value: number | undefined, fallback = 1): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function useTransfers(options: UseTransfersOptions = {}): UseTransfersResult {
  const [tasks, setTasks] = useState<TransferTaskView[]>([]);
  const queuesRef = useRef<TransferQueues<QueuedJob>>({ upload: [], download: [] });
  const countsRef = useRef<TransferKindCounts>({ upload: 0, download: 0 });
  const limitsRef = useRef<TransferKindLimits>({
    upload: normalizeLimit(options.uploadConcurrency),
    download: normalizeLimit(options.downloadConcurrency),
  });
  const tokensRef = useRef(new Map<string, CancelToken>());
  const counterRef = useRef(0);
  const notifiedRef = useRef(true);
  const onDrainedRef = useRef(options.onDrained);
  onDrainedRef.current = options.onDrained;

  limitsRef.current = {
    upload: normalizeLimit(options.uploadConcurrency),
    download: normalizeLimit(options.downloadConcurrency),
  };

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

  const isIdle = useCallback(
    () =>
      countsRef.current.upload === 0 &&
      countsRef.current.download === 0 &&
      queuesRef.current.upload.length === 0 &&
      queuesRef.current.download.length === 0,
    [],
  );

  const pumpRef = useRef<() => void>(() => {});

  const execute = useCallback(
    async (kind: TransferKind, job: QueuedJob): Promise<void> => {
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
        countsRef.current[kind] = Math.max(0, countsRef.current[kind] - 1);
        pumpRef.current();
      }
    },
    [update],
  );

  const pump = useCallback(() => {
    const startable = takeStartableJobs(queuesRef.current, countsRef.current, limitsRef.current);
    if (startable.length === 0) {
      if (isIdle() && !notifiedRef.current) {
        notifiedRef.current = true;
        onDrainedRef.current?.();
      }
      return;
    }
    for (const { kind, job } of startable) void execute(kind, job);
  }, [execute, isIdle]);

  pumpRef.current = pump;

  const enqueue = useCallback(
    (requests: TransferRequest[]) => {
      if (requests.length === 0) return;
      const jobs: QueuedJob[] = requests.map((request) => ({
        ...request,
        id: `${Date.now().toString(36)}-${(counterRef.current += 1).toString(36)}`,
      }));
      for (const job of jobs) queuesRef.current[job.kind].push(job);
      notifiedRef.current = false;
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
      pumpRef.current();
    },
    [],
  );

  const cancelAll = useCallback(() => {
    const queued = [...queuesRef.current.upload.splice(0), ...queuesRef.current.download.splice(0)];
    if (queued.length > 0) {
      notifiedRef.current = false;
      const ids = new Set(queued.map((job) => job.id));
      setTasks((previous) =>
        previous.map((task) =>
          ids.has(task.id) ? { ...task, status: "cancelled", speed: 0, etaMs: undefined } : task,
        ),
      );
    }
    for (const token of tokensRef.current.values()) token.cancel();
    pumpRef.current();
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((previous) =>
      previous.filter((task) => task.status === "running" || task.status === "queued"),
    );
  }, []);

  const isBusy = useCallback(
    () =>
      countsRef.current.upload > 0 ||
      countsRef.current.download > 0 ||
      queuesRef.current.upload.length > 0 ||
      queuesRef.current.download.length > 0 ||
      tokensRef.current.size > 0,
    [],
  );

  useEffect(() => {
    return () => {
      queuesRef.current = { upload: [], download: [] };
      for (const token of tokensRef.current.values()) token.cancel();
    };
  }, []);

  return { tasks, enqueue, cancelAll, clearFinished, isBusy };
}
