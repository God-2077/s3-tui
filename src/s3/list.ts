import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { basename } from "../utils/key.js";

export interface S3Entry {
  kind: "dir" | "file";
  key: string;
  name: string;
  size: number;
  lastModified?: Date;
  etag?: string;
}

export interface ListPage {
  entries: S3Entry[];
  nextToken?: string;
}

function compareEntries(a: S3Entry, b: S3Entry): number {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

export async function listPage(
  client: S3Client,
  bucket: string,
  prefix: string,
  continuationToken?: string,
  maxKeys = 200,
): Promise<ListPage> {
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: "/",
      MaxKeys: maxKeys,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }),
  );

  const entries: S3Entry[] = [];
  for (const commonPrefix of response.CommonPrefixes ?? []) {
    if (!commonPrefix.Prefix) continue;
    entries.push({
      kind: "dir",
      key: commonPrefix.Prefix,
      name: basename(commonPrefix.Prefix),
      size: 0,
    });
  }

  for (const object of response.Contents ?? []) {
    if (!object.Key || object.Key === prefix) continue;
    entries.push({
      kind: "file",
      key: object.Key,
      name: basename(object.Key),
      size: object.Size ?? 0,
      ...(object.LastModified ? { lastModified: object.LastModified } : {}),
      ...(object.ETag ? { etag: object.ETag } : {}),
    });
  }

  entries.sort(compareEntries);

  return {
    entries,
    ...(response.IsTruncated && response.NextContinuationToken
      ? { nextToken: response.NextContinuationToken }
      : {}),
  };
}

/** 递归列出某个前缀下的所有对象（不折叠目录）。 */
export async function listAllObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
  onPage?: (count: number) => void,
): Promise<S3Entry[]> {
  const entries: S3Entry[] = [];
  let token: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ...(token ? { ContinuationToken: token } : {}),
      }),
    );
    for (const object of response.Contents ?? []) {
      if (!object.Key) continue;
      entries.push({
        kind: "file",
        key: object.Key,
        name: basename(object.Key),
        size: object.Size ?? 0,
        ...(object.LastModified ? { lastModified: object.LastModified } : {}),
        ...(object.ETag ? { etag: object.ETag } : {}),
      });
    }
    onPage?.(entries.length);
    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);
  return entries;
}

/** 递归列出某个前缀下的所有对象 key（用于删除目录 / 批量操作）。 */
export async function listAllKeys(
  client: S3Client,
  bucket: string,
  prefix: string,
  onPage?: (count: number) => void,
): Promise<string[]> {
  const entries = await listAllObjects(client, bucket, prefix, onPage);
  return entries.map((entry) => entry.key);
}