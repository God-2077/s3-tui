import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MAX_EXPIRES = 7 * 24 * 3600;

export async function presignGet(
  client: S3Client,
  bucket: string,
  key: string,
  expiresIn: number,
): Promise<string> {
  const expires = Math.min(Math.max(1, Math.floor(expiresIn)), MAX_EXPIRES);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expires,
  });
}

export async function presignPut(
  client: S3Client,
  bucket: string,
  key: string,
  expiresIn: number,
  contentType?: string,
): Promise<string> {
  const expires = Math.min(Math.max(1, Math.floor(expiresIn)), MAX_EXPIRES);
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
    { expiresIn: expires },
  );
}