import test from "node:test";
import assert from "node:assert/strict";
import { ConfigError, parseConfig } from "../src/config.js";

const baseEnv: NodeJS.ProcessEnv = {
  S3_BUCKET: "demo-bucket",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};

test("最小配置可以解析，并应用默认值", () => {
  const config = parseConfig(baseEnv);
  assert.equal(config.bucket, "demo-bucket");
  assert.equal(config.region, "us-east-1");
  assert.equal(config.endpoint, undefined);
  assert.equal(config.forcePathStyle, false);
  assert.equal(config.concurrency, 4);
  assert.equal(config.uploadConcurrency, 2);
  assert.equal(config.downloadConcurrency, 2);
  assert.equal(config.downloadThreads, 4);
  assert.equal(config.downloadPartSize, 8 * 1024 * 1024);
  assert.equal(config.partSize, 8 * 1024 * 1024);
  assert.equal(config.multipartThreshold, 8 * 1024 * 1024);
  assert.equal(config.presignExpires, 3600);
  assert.equal(config.accelerateMode, "endpoint");
  assert.ok(config.downloadDir.endsWith("downloads"));
});

test("兼容 AWS_ 前缀凭证", () => {
  const config = parseConfig({
    S3_BUCKET: "b",
    AWS_ACCESS_KEY_ID: "aws-key",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    AWS_SESSION_TOKEN: "token",
    AWS_REGION: "ap-northeast-1",
  });
  assert.equal(config.accessKeyId, "aws-key");
  assert.equal(config.secretAccessKey, "aws-secret");
  assert.equal(config.sessionToken, "token");
  assert.equal(config.region, "ap-northeast-1");
});

test("自定义 endpoint 默认启用 path style，并补全协议", () => {
  const config = parseConfig({ ...baseEnv, S3_ENDPOINT: "minio.local:9000" });
  assert.equal(config.endpoint, "https://minio.local:9000");
  assert.equal(config.forcePathStyle, true);
});

test("显式关闭 path style", () => {
  const config = parseConfig({
    ...baseEnv,
    S3_ENDPOINT: "https://example.com",
    S3_FORCE_PATH_STYLE: "false",
  });
  assert.equal(config.forcePathStyle, false);
});

test("加速主机：endpoint 模式", () => {
  const config = parseConfig({
    ...baseEnv,
    S3_ACCELERATE_HOST: "cdn.example.com",
    S3_ACCELERATE_MODE: "endpoint",
  });
  assert.equal(config.accelerateHost, "https://cdn.example.com");
  assert.equal(config.accelerateMode, "endpoint");
});

test("加速主机：rewrite 模式", () => {
  const config = parseConfig({
    ...baseEnv,
    S3_ACCELERATE_HOST: "https://cdn.example.com:8443",
    S3_ACCELERATE_MODE: "rewrite",
    S3_ACCELERATE_PATH_STYLE: "true",
  });
  assert.equal(config.accelerateHost, "https://cdn.example.com:8443");
  assert.equal(config.accelerateMode, "rewrite");
  assert.equal(config.acceleratePathStyle, true);
});

test("分片阈值不会低于 5 MiB", () => {
  const config = parseConfig({
    ...baseEnv,
    S3_MULTIPART_THRESHOLD_MB: "1",
    S3_PART_SIZE_MB: "5",
  });
  assert.equal(config.multipartThreshold, 5 * 1024 * 1024);
  assert.equal(config.partSize, 5 * 1024 * 1024);
});

test("上传与下载并发参数支持显式配置", () => {
  const config = parseConfig({
    ...baseEnv,
    S3_UPLOAD_CONCURRENCY: "1",
    S3_DOWNLOAD_CONCURRENCY: "3",
    S3_DOWNLOAD_THREADS: "6",
    S3_DOWNLOAD_PART_SIZE_MB: "2",
  });
  assert.equal(config.uploadConcurrency, 1);
  assert.equal(config.downloadConcurrency, 3);
  assert.equal(config.downloadThreads, 6);
  assert.equal(config.downloadPartSize, 2 * 1024 * 1024);
});

test("缺少必填项会一次报告所有问题", () => {
  assert.throws(
    () => parseConfig({}),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.problems.length, 3);
      assert.ok(error.problems.some((problem) => problem.includes("S3_BUCKET")));
      assert.ok(error.problems.some((problem) => problem.includes("S3_ACCESS_KEY_ID")));
      assert.ok(error.problems.some((problem) => problem.includes("S3_SECRET_ACCESS_KEY")));
      return true;
    },
  );
});

test("非法数值与加速模式会报错", () => {
  assert.throws(
    () =>
      parseConfig({
        ...baseEnv,
        S3_CONCURRENCY: "99",
        S3_UPLOAD_CONCURRENCY: "0",
        S3_DOWNLOAD_CONCURRENCY: "17",
        S3_DOWNLOAD_THREADS: "x",
        S3_DOWNLOAD_PART_SIZE_MB: "0",
        S3_PRESIGN_EXPIRES: "9999999",
        S3_ACCELERATE_MODE: "fast",
        S3_ACCELERATE_HOST: "https://cdn.example.com/path",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.problems.length, 8);
      return true;
    },
  );
});