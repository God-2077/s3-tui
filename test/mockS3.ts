import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { S3Client } from "@aws-sdk/client-s3";

export const BUCKET = "test-bucket";
export const MIB = 1024 * 1024;

interface PartState {
  key: string;
  parts: Map<number, Buffer>;
}

export interface MockS3 {
  server: Server;
  endpoint: string;
  objects: Map<string, Buffer>;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function etagOf(buffer: Buffer): string {
  return `"${createHash("md5").update(buffer).digest("hex")}"`;
}

function send(
  response: ServerResponse,
  status: number,
  body = "",
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": "application/xml",
    "content-length": String(Buffer.byteLength(body)),
    ...headers,
  });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** 一个只用于测试的最小 S3 兼容服务：list / put / get / multipart / batch delete。 */
export async function startMockS3(options: { bucketless?: boolean } = {}): Promise<MockS3> {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, PartState>();
  let uploadCounter = 0;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      const bucket = options.bucketless ? BUCKET : segments[0];
      const key = (options.bucketless ? segments : segments.slice(1)).join("/");
      const query = url.searchParams;
      const method = request.method ?? "GET";

      if (bucket !== BUCKET) {
        send(response, 404, "<Error><Code>NoSuchBucket</Code><Message>bucket</Message></Error>");
        return;
      }

      if (method === "GET" && query.get("list-type") === "2") {
        const prefix = query.get("prefix") ?? "";
        const delimiter = query.get("delimiter") ?? undefined;
        const contents: Array<{ key: string; size: number }> = [];
        const commonPrefixes = new Set<string>();

        for (const [objectKey, buffer] of [...objects.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          if (!objectKey.startsWith(prefix)) continue;
          const rest = objectKey.slice(prefix.length);
          if (delimiter && rest.includes(delimiter)) {
            commonPrefixes.add(prefix + rest.slice(0, rest.indexOf(delimiter) + 1));
          } else {
            contents.push({ key: objectKey, size: buffer.length });
          }
        }

        const body = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
          `<Name>${BUCKET}</Name>`,
          `<Prefix>${xmlEscape(prefix)}</Prefix>`,
          `<KeyCount>${contents.length + commonPrefixes.size}</KeyCount>`,
          "<MaxKeys>1000</MaxKeys>",
          "<IsTruncated>false</IsTruncated>",
          ...contents.map(
            (item) =>
              `<Contents><Key>${xmlEscape(item.key)}</Key><LastModified>2026-01-02T03:04:05.000Z</LastModified><ETag>${etagOf(
                objects.get(item.key) ?? Buffer.alloc(0),
              )}</ETag><Size>${item.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
          ),
          ...[...commonPrefixes].map(
            (item) => `<CommonPrefixes><Prefix>${xmlEscape(item)}</Prefix></CommonPrefixes>`,
          ),
          "</ListBucketResult>",
        ].join("");
        send(response, 200, body);
        return;
      }

      if (method === "POST" && query.has("delete")) {
        const body = (await readBody(request)).toString("utf8");
        const keys = [...body.matchAll(/<Key>(.*?)<\/Key>/gs)].map((match) => match[1] ?? "");
        for (const item of keys) objects.delete(item);
        send(
          response,
          200,
          '<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></DeleteResult>',
        );
        return;
      }

      if (method === "POST" && key && query.has("uploads")) {
        const uploadId = `upload-${(uploadCounter += 1)}`;
        uploads.set(uploadId, { key, parts: new Map() });
        send(
          response,
          200,
          `<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>${BUCKET}</Bucket><Key>${xmlEscape(
            key,
          )}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
        );
        return;
      }

      if (method === "PUT" && key && query.has("partNumber")) {
        const uploadId = query.get("uploadId") ?? "";
        const upload = uploads.get(uploadId);
        if (!upload) {
          send(response, 404, "<Error><Code>NoSuchUpload</Code></Error>");
          return;
        }
        const partNumber = Number(query.get("partNumber"));
        upload.parts.set(partNumber, await readBody(request));
        send(response, 200, "", { etag: `"part-${partNumber}"` });
        return;
      }

      if (method === "POST" && key && query.has("uploadId")) {
        const uploadId = query.get("uploadId") ?? "";
        const upload = uploads.get(uploadId);
        if (!upload) {
          send(response, 404, "<Error><Code>NoSuchUpload</Code></Error>");
          return;
        }
        await readBody(request);
        const ordered = [...upload.parts.entries()].sort(([a], [b]) => a - b);
        const combined = Buffer.concat(ordered.map(([, part]) => part));
        objects.set(upload.key, combined);
        uploads.delete(uploadId);
        send(
          response,
          200,
          `<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Location>http://localhost/${BUCKET}/${xmlEscape(
            upload.key,
          )}</Location><Bucket>${BUCKET}</Bucket><Key>${xmlEscape(upload.key)}</Key><ETag>${etagOf(
            combined,
          )}</ETag></CompleteMultipartUploadResult>`,
        );
        return;
      }

      if (method === "DELETE" && query.has("uploadId")) {
        uploads.delete(query.get("uploadId") ?? "");
        send(response, 204, "");
        return;
      }

      if (method === "PUT" && key) {
        const body = await readBody(request);
        objects.set(key, body);
        send(response, 200, "", { etag: etagOf(body) });
        return;
      }

      if (method === "GET" && key) {
        const body = objects.get(key);
        if (!body) {
          send(response, 404, "<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>");
          return;
        }
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(body.length),
          etag: etagOf(body),
          "last-modified": "Fri, 02 Jan 2026 03:04:05 GMT",
        });
        response.end(body);
        return;
      }

      send(response, 400, "<Error><Code>Unsupported</Code></Error>");
    } catch (error) {
      send(
        response,
        500,
        `<Error><Code>Internal</Code><Message>${xmlEscape(String(error))}</Message></Error>`,
      );
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, endpoint: `http://127.0.0.1:${port}`, objects };
}

export function clientFor(endpoint: string): S3Client {
  return new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 1,
  });
}