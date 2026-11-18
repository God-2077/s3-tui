/** 上传/下载各自的文件级队列调度（纯函数，便于单测）。 */

export type TransferKind = "upload" | "download";

export type TransferQueues<T> = Record<TransferKind, T[]>;
export type TransferKindCounts = Record<TransferKind, number>;
export type TransferKindLimits = Record<TransferKind, number>;

export interface StartableJob<T> {
  kind: TransferKind;
  job: T;
}

/**
 * 从各队列取出当前可启动的任务，并原地更新计数。
 * 每类任务遵守自己的并发上限；上限非法时按 1 处理。
 */
export function takeStartableJobs<T>(
  queues: TransferQueues<T>,
  counts: TransferKindCounts,
  limits: TransferKindLimits,
): Array<StartableJob<T>> {
  const started: Array<StartableJob<T>> = [];
  for (const kind of ["upload", "download"] as const) {
    const rawLimit = limits[kind];
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.floor(rawLimit)) : 1;
    while (queues[kind].length > 0 && counts[kind] < limit) {
      const job = queues[kind].shift();
      if (job === undefined) break;
      counts[kind] += 1;
      started.push({ kind, job });
    }
  }
  return started;
}
