import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type { AppConfig } from "../config.js";

export interface S3Context {
  /** 列表、删除、元数据永远走主端点。 */
  main: S3Client;
  /** 上传/下载/预签名使用；没有加速主机时与 main 相同。 */
  transfer: S3Client;
  /** rewrite 模式下需要替换预签名 URL 的 host。 */
  rewriteHost?: string;
  bucket: string;
}

export function createS3(config: AppConfig): S3Context {
  const base: S3ClientConfig = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    },
    maxAttempts: 4,
    // 兼容 MinIO / R2：不要默认追加 flexible checksum
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };

  const main = new S3Client({
    ...base,
    ...(config.endpoint
      ? { endpoint: config.endpoint, forcePathStyle: config.forcePathStyle }
      : {}),
  });

  if (!config.accelerateHost) {
    return { main, transfer: main, bucket: config.bucket };
  }

  if (config.accelerateMode === "endpoint") {
    const accelerateHost = config.accelerateHost;
    const transfer = config.acceleratePathStyle
      ? new S3Client({
          ...base,
          endpoint: accelerateHost,
          forcePathStyle: true,
        })
      : new S3Client({
          ...base,
          endpoint: accelerateHost,
          // 加速域已经绑定到桶：用自定义 endpoint provider 固定 host，
          // 避免 SDK 把 bucket 前缀拼到 host 上（bucketEndpoint 在新版语义不同）。
          endpointProvider: () => ({
            url: new URL(accelerateHost),
            headers: {},
            properties: {},
          }),
        });
    return { main, transfer, bucket: config.bucket };
  }

  return {
    main,
    transfer: main,
    rewriteHost: new URL(config.accelerateHost).host,
    bucket: config.bucket,
  };
}

export function closeS3(context: S3Context): void {
  context.main.destroy();
  if (context.transfer !== context.main) context.transfer.destroy();
}