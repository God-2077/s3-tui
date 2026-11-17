/** 把 S3 / 网络错误翻译成可操作的中文提示。 */

interface ErrorLike {
  name?: string;
  message?: string;
  code?: string;
  Code?: string;
  $metadata?: { httpStatusCode?: number };
  statusCode?: number;
}

function fields(error: unknown): ErrorLike {
  if (typeof error === "object" && error !== null) return error as ErrorLike;
  return { message: String(error) };
}

function textOf(error: ErrorLike): string {
  return `${error.name ?? ""} ${error.code ?? ""} ${error.Code ?? ""} ${error.message ?? ""}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export function describeError(error: unknown): { message: string; hints: string[] } {
  const info = fields(error);
  const text = textOf(info);
  const status = info.$metadata?.httpStatusCode ?? info.statusCode;
  const hints: string[] = [];

  if (/SignatureDoesNotMatch/i.test(text)) {
    hints.push("签名不匹配：检查 S3_SECRET_ACCESS_KEY 是否含多余空格/换行。");
    hints.push("S3 兼容服务通常需要 S3_FORCE_PATH_STYLE=true，R2 的 S3_REGION 填 auto。");
    if (/host/i.test(text)) {
      hints.push("若使用了 S3_ACCELERATE_HOST，确认该域名与签名使用的 host 一致。");
    }
  } else if (/InvalidAccessKeyId/i.test(text)) {
    hints.push("Access Key 不存在或已被删除，检查 S3_ACCESS_KEY_ID。");
  } else if (/AccessDenied|Forbidden/i.test(text) || status === 403) {
    hints.push("权限不足：确认该凭证拥有 ListBucket / GetObject / PutObject / DeleteObject 权限。");
  } else if (/NoSuchBucket/i.test(text) || status === 404) {
    hints.push("桶不存在或不在当前 region：检查 S3_BUCKET / S3_REGION / S3_ENDPOINT。");
  } else if (/NoSuchKey/i.test(text)) {
    hints.push("对象不存在：可能已被其他人删除，按 r 刷新列表。");
  } else if (/ExpiredToken|InvalidToken|TokenRefresh/i.test(text)) {
    hints.push("临时凭证已过期，重新导出 S3_SESSION_TOKEN / AWS_SESSION_TOKEN。");
  } else if (/RequestTimeTooSkewed/i.test(text)) {
    hints.push("本机时间偏差过大，请校准系统时间。");
  } else if (/SlowDown|Throttl/i.test(text) || status === 503) {
    hints.push("请求被限流：稍后重试，或在 .env 里调低 S3_CONCURRENCY。");
  } else if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|network/i.test(text)) {
    hints.push("网络不可达：检查 S3_ENDPOINT、代理与 DNS。");
    hints.push("如果 endpoint 只支持 http，请显式写 http://。");
  } else if (/NotImplemented|XAmzContentSHA256Mismatch|checksum/i.test(text)) {
    hints.push("可能是 S3 兼容服务的校验/特性差异，确认服务端支持当前操作。");
  } else if (/EntityTooSmall|part/i.test(text) && /small/i.test(text)) {
    hints.push("分片太小：把 S3_PART_SIZE_MB 调到 5 以上。");
  } else if (/EntityTooLarge/i.test(text)) {
    hints.push("对象过大：减小 S3_PART_SIZE_MB 让分片数保持在 10000 以内。");
  }

  if (hints.length === 0) {
    hints.push("检查 .env 中的 S3_* 配置；按 r 重试，或按 ? 查看帮助。");
  }

  const message = info.message || info.name || String(error);
  return { message, hints };
}