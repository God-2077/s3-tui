import { DeleteObjectsCommand, type S3Client } from "@aws-sdk/client-s3";
import { listAllKeys } from "./list.js";

export interface DeleteFailure {
  key: string;
  message: string;
}

export interface DeleteResult {
  deleted: number;
  failures: DeleteFailure[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** DeleteObjects 单次上限 1000。 */
export async function deleteKeys(
  client: S3Client,
  bucket: string,
  keys: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<DeleteResult> {
  let deleted = 0;
  const failures: DeleteFailure[] = [];
  const chunks = chunk(keys, 1000);

  for (const [index, group] of chunks.entries()) {
    if (group.length === 0) continue;
    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: group.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }),
    );
    for (const error of response.Errors ?? []) {
      failures.push({
        key: error.Key ?? "(unknown)",
        message: error.Message ?? error.Code ?? "未知错误",
      });
    }
    deleted += group.length - (response.Errors?.length ?? 0);
    onProgress?.(Math.min((index + 1) * 1000, keys.length), keys.length);
  }

  return { deleted, failures };
}

export async function deletePrefix(
  client: S3Client,
  bucket: string,
  prefix: string,
  onProgress?: (done: number, total: number) => void,
): Promise<DeleteResult> {
  const keys = await listAllKeys(client, bucket, prefix, (found) =>
    onProgress?.(0, found),
  );
  if (keys.length === 0) return { deleted: 0, failures: [] };
  return deleteKeys(client, bucket, keys, onProgress);
}