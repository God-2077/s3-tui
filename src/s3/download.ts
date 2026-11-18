import { createWriteStream, existsSync } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { CancelToken, CancelledError, isCancelled } from "../utils/cancel.js";
import { keyToRelativePath } from "../utils/key.js";
import { ProgressMeter, createCountingTransform } from "../utils/progress.js";
import type { ProgressSnapshot } from "../utils/progress.js";

export interface DownloadOptions {
  /** 直接用 fetch 下载预签名 URL（rewrite 加速模式）。 */
  url?: string;
  client?: S3Client;
  bucket: string;
  key: string;
  destPath: string;
  token: CancelToken;
  onProgress: (snapshot: ProgressSnapshot) => void;
  /** 已知对象大小（列表里的 size），用于分段下载。 */
  totalSize?: number;
  /** 分段下载线程数；<=1 时退回单流下载。 */
  threads?: number;
  /** 分段大小；<=0 时退回单流下载。 */
  chunkSize?: number;
}

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Range {
  start: number;
  end: number;
}

class RangeUnsupportedError extends Error {
  constructor(message = "服务端不支持 Range 请求") {
    super(message);
    this.name = "RangeUnsupportedError";
  }
}

export function defaultDestination(downloadDir: string, key: string): string {
  const relative = keyToRelativePath(key) || basename(key) || "download";
  return join(downloadDir, relative);
}

/** 目标已存在时追加 " (1)"，避免静默覆盖。 */
export function uniqueDestination(target: string, reserved?: Set<string>): string {
  const exists = (candidate: string) => existsSync(candidate) || Boolean(reserved?.has(candidate));
  if (!exists(target)) return target;
  const extension = extname(target);
  const stem = target.slice(0, target.length - extension.length);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} (${index})${extension}`;
    if (!exists(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${extension}`;
}

/** 预留一个下载目标路径，供跨批次入队共享。 */
export function reserveDestination(target: string, reserved: Set<string>): string {
  const chosen = uniqueDestination(target, reserved);
  reserved.add(chosen);
  return chosen;
}

function planRanges(total: number, chunkSize: number): Range[] {
  const size = Math.max(1, Math.floor(chunkSize));
  const ranges: Range[] = [];
  for (let start = 0; start < total; start += size) {
    ranges.push({ start, end: Math.min(total, start + size) - 1 });
  }
  return ranges;
}

function parseContentRange(value: string | null | undefined): {
  start: number;
  end: number;
  total: number;
} | undefined {
  if (!value) return undefined;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)) {
    return undefined;
  }
  return { start, end, total };
}

async function writeFully(file: FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesWritten <= 0) throw new Error("下载失败：写入本地文件没有进展");
    offset += bytesWritten;
  }
}

interface RangeWriter {
  write: (buffer: Buffer, position: number) => Promise<void>;
}

/** FileHandle.write 不能并发调用；把多个分段线程的写入串行化。 */
function createRangeWriter(file: FileHandle): RangeWriter {
  let tail: Promise<void> = Promise.resolve();
  return {
    write(buffer, position) {
      const next = tail.then(() => writeFully(file, buffer, position));
      tail = next.catch(() => {});
      return next;
    },
  };
}

interface ErrorLike {
  name?: string;
  code?: string;
  Code?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
  statusCode?: number;
}

function isRangeUnsupported(error: unknown): boolean {
  if (error instanceof RangeUnsupportedError) return true;
  if (typeof error !== "object" || error === null) return false;
  const info = error as ErrorLike;
  const status = info.$metadata?.httpStatusCode ?? info.statusCode;
  const text = `${info.name ?? ""} ${info.code ?? ""} ${info.Code ?? ""} ${info.message ?? ""}`;
  return status === 416 || /InvalidRange|RangeNotSatisfiable/i.test(text);
}

interface RangeResponse {
  readable: Readable;
  contentRange: string | null | undefined;
}

async function requestRange(
  options: DownloadOptions,
  range: Range,
): Promise<RangeResponse> {
  const { token } = options;
  const rangeHeader = `bytes=${range.start}-${range.end}`;

  if (options.url) {
    const response = await fetch(options.url, {
      headers: { Range: rangeHeader, "Accept-Encoding": "identity" },
      signal: token.signal,
    });
    if (response.status === 206) {
      if (!response.body) throw new Error("下载失败：响应没有 body");
      return {
        readable: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        contentRange: response.headers.get("content-range"),
      };
    }
    await response.body?.cancel().catch(() => {});
    if (response.status === 200 || response.status === 416) throw new RangeUnsupportedError();
    throw new Error(`下载失败：HTTP ${response.status} ${response.statusText}`);
  }

  if (!options.client) throw new Error("下载失败：缺少 S3 client");
  const response = await options.client.send(
    new GetObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      Range: rangeHeader,
    }),
    { abortSignal: token.signal },
  );
  if (!response.Body) throw new Error("下载失败：响应没有 body");
  return {
    readable: response.Body as unknown as Readable,
    contentRange: response.ContentRange,
  };
}

/** 真正下载一个区间；校验 Content-Range 与响应长度。 */
async function downloadRange(
  options: DownloadOptions,
  writer: RangeWriter,
  range: Range,
  totalSize: number,
  meter: ProgressMeter,
): Promise<void> {
  const { token } = options;
  const expected = range.end - range.start + 1;
  let attempt = 0;

  while (true) {
    token.throwIfCancelled();
    let written = 0;
    let readable: Readable | undefined;
    try {
      const response = await requestRange(options, range);
      readable = response.readable;
      const parsed = parseContentRange(response.contentRange);
      if (
        !parsed ||
        parsed.start !== range.start ||
        parsed.end !== range.end ||
        parsed.total !== totalSize
      ) {
        throw new RangeUnsupportedError("服务端返回的 Content-Range 与请求不一致");
      }

      for await (const chunk of readable) {
        token.throwIfCancelled();
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        if (written + buffer.length > expected) {
          throw new Error(`下载失败：分段 ${range.start}-${range.end} 响应过长`);
        }
        await writer.write(buffer, range.start + written);
        written += buffer.length;
        meter.add(buffer.length);
      }

      if (written !== expected) {
        throw new Error(
          `下载失败：分段 ${range.start}-${range.end} 只收到 ${written}/${expected} 字节`,
        );
      }
      return;
    } catch (error) {
      if (written > 0) meter.add(-written);
      if (isCancelled(error) || token.cancelled) throw new CancelledError();
      if (isRangeUnsupported(error)) throw new RangeUnsupportedError();
      attempt += 1;
      if (attempt >= MAX_ATTEMPTS) throw error;
      await sleep(300 * attempt);
    } finally {
      readable?.destroy();
    }
  }
}

async function downloadRanged(
  options: DownloadOptions,
  totalSize: number,
  threads: number,
  chunkSize: number,
): Promise<number> {
  const { token, destPath } = options;
  const ranges = planRanges(totalSize, chunkSize);
  const meter = new ProgressMeter(totalSize, options.onProgress);
  meter.setPart(0, ranges.length);

  const file = await open(destPath, "w");
  let failed = true;
  try {
    await file.truncate(totalSize);
    const writer = createRangeWriter(file);

    let nextIndex = 0;
    let completed = 0;
    let failedRange = false;
    let failure: unknown = new Error("下载失败：未知错误");

    const worker = async (): Promise<void> => {
      while (!failedRange) {
        try {
          token.throwIfCancelled();
          const index = nextIndex++;
          if (index >= ranges.length) return;
          await downloadRange(options, writer, ranges[index]!, totalSize, meter);
          completed += 1;
          meter.setPart(completed, ranges.length);
        } catch (error) {
          failedRange = true;
          failure = isCancelled(error) || token.cancelled ? new CancelledError() : error;
          return;
        }
      }
    };

    const workerCount = Math.max(1, Math.min(Math.floor(threads), ranges.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    token.throwIfCancelled();
    if (failedRange) throw failure;
    if (completed !== ranges.length) {
      throw new Error(`下载失败：分段不完整 ${completed}/${ranges.length}`);
    }

    failed = false;
    meter.flush();
    return meter.loaded;
  } catch (error) {
    if (isCancelled(error) || token.cancelled) throw new CancelledError();
    throw error;
  } finally {
    await file.close().catch(() => {});
    if (failed) await unlink(destPath).catch(() => {});
  }
}

export async function downloadObject(options: DownloadOptions): Promise<number> {
  const { token, destPath } = options;
  await mkdir(dirname(destPath), { recursive: true });

  const totalSize = options.totalSize ?? 0;
  const threads = options.threads ?? 1;
  const chunkSize = options.chunkSize ?? 0;
  const useRanges = totalSize > 0 && threads > 1 && chunkSize > 0 && totalSize > chunkSize;

  if (useRanges) {
    try {
      return await downloadRanged(options, totalSize, threads, chunkSize);
    } catch (error) {
      if (!(error instanceof RangeUnsupportedError)) throw error;
      token.throwIfCancelled();
      return downloadObject({ ...options, totalSize: 0, threads: 1 });
    }
  }

  let readable: Readable;
  let total = 0;

  if (options.url) {
    const response = await fetch(options.url, { signal: token.signal });
    if (!response.ok) {
      throw new Error(`下载失败：HTTP ${response.status} ${response.statusText}`);
    }
    const length = Number(response.headers.get("content-length"));
    total = Number.isFinite(length) && length > 0 ? length : 0;
    if (!response.body) throw new Error("下载失败：响应没有 body");
    readable = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  } else {
    if (!options.client) throw new Error("下载失败：缺少 S3 client");
    const response = await options.client.send(
      new GetObjectCommand({ Bucket: options.bucket, Key: options.key }),
      { abortSignal: token.signal },
    );
    total = response.ContentLength ?? 0;
    if (!response.Body) throw new Error("下载失败：响应没有 body");
    readable = response.Body as unknown as Readable;
  }

  const meter = new ProgressMeter(total, options.onProgress);
  const file = createWriteStream(destPath);
  const offCancel = token.onCancel(() => {
    readable.destroy(new CancelledError());
    file.destroy(new CancelledError());
  });

  try {
    await pipeline(readable, createCountingTransform((bytes) => meter.add(bytes)), file);
  } catch (error) {
    offCancel();
    await unlink(destPath).catch(() => {});
    if (isCancelled(error) || token.cancelled) throw new CancelledError();
    throw error;
  }
  offCancel();
  meter.flush();
  return meter.loaded;
}
