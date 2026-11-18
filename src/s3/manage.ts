import {
  CopyObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { errorMessage } from "../utils/error.js";
import { deleteKeys } from "./delete.js";

export interface MovePair {
  source: string;
  target: string;
}

export interface MoveFailure {
  key: string;
  target: string;
  message: string;
}

export interface MoveResult {
  moved: number;
  failures: MoveFailure[];
}

export interface MoveOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/** 构造 CopySource，逐段编码，保留 key 里的 /。 */
export function buildCopySource(bucket: string, key: string): string {
  return `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** 创建一个以 / 结尾的零字节占位对象。 */
export async function createFolder(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  if (!key.endsWith("/")) throw new Error("文件夹 key 必须以 / 结尾");
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.alloc(0),
    }),
  );
}

function isNotFound(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  if (status === 404) return true;
  const name = (error as { name?: string }).name;
  return name === "NotFound" || name === "NoSuchKey";
}

/** HEAD 对象判断是否存在；只有 404 视为不存在，其它错误继续抛出。 */
export async function objectExists(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/**
 * 先并发复制，复制成功的对象再批量删除源。
 * 复制失败的对象不会删除源；删除失败时目标已存在，会计入 failures。
 */
export async function moveObjects(
  client: S3Client,
  bucket: string,
  pairs: MovePair[],
  options: MoveOptions = {},
): Promise<MoveResult> {
  const total = pairs.length;
  if (total === 0) return { moved: 0, failures: [] };

  const limit = Math.max(1, Math.min(options.concurrency ?? 4, 16, total));
  const failures: MoveFailure[] = [];
  const copied: MovePair[] = [];
  let nextIndex = 0;
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;
      const pair = pairs[index]!;
      if (pair.source === pair.target) {
        failures.push({
          key: pair.source,
          target: pair.target,
          message: "源 key 与目标 key 相同",
        });
      } else {
        try {
          await client.send(
            new CopyObjectCommand({
              Bucket: bucket,
              CopySource: buildCopySource(bucket, pair.source),
              Key: pair.target,
            }),
          );
          copied.push(pair);
        } catch (error) {
          failures.push({
            key: pair.source,
            target: pair.target,
            message: `复制失败：${errorMessage(error)}`,
          });
        }
      }
      completed += 1;
      options.onProgress?.(completed, total);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));

  let moved = 0;
  if (copied.length > 0) {
    const targetBySource = new Map(copied.map((pair) => [pair.source, pair.target]));
    try {
      const result = await deleteKeys(client, bucket, copied.map((pair) => pair.source));
      moved = result.deleted;
      for (const failure of result.failures) {
        failures.push({
          key: failure.key,
          target: targetBySource.get(failure.key) ?? "",
          message: `复制成功但删除源失败：${failure.message}`,
        });
      }
    } catch (error) {
      for (const pair of copied) {
        failures.push({
          key: pair.source,
          target: pair.target,
          message: `复制成功但删除源失败：${errorMessage(error)}`,
        });
      }
    }
  }

  return { moved, failures };
}
