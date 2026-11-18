import { homedir } from "node:os";
import { resolve } from "node:path";
import { expandHome, normalizePrefix } from "./utils/key.js";
import { MIN_PART_SIZE } from "./utils/parts.js";
import { normalizeAccelerateHost } from "./utils/url.js";

const MIB = 1024 * 1024;

export type AccelerateMode = "endpoint" | "rewrite" | "public";

export interface AppConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle: boolean;
  initialPrefix: string;
  accelerateHost?: string;
  accelerateMode: AccelerateMode;
  acceleratePathStyle: boolean;
  concurrency: number;
  partSize: number;
  multipartThreshold: number;
  downloadDir: string;
  presignExpires: number;
  debug: boolean;
  debugLog: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "ConfigError";
  }
}

export interface ConfigFieldHelp {
  name: string;
  required: boolean;
  defaultValue: string;
  description: string;
}

export const CONFIG_FIELDS: ConfigFieldHelp[] = [
  { name: "S3_BUCKET", required: true, defaultValue: "", description: "桶名" },
  {
    name: "S3_ACCESS_KEY_ID",
    required: true,
    defaultValue: "",
    description: "Access Key（也兼容 AWS_ACCESS_KEY_ID）",
  },
  {
    name: "S3_SECRET_ACCESS_KEY",
    required: true,
    defaultValue: "",
    description: "Secret Key（也兼容 AWS_SECRET_ACCESS_KEY）",
  },
  { name: "S3_SESSION_TOKEN", required: false, defaultValue: "", description: "临时凭证 token（兼容 AWS_SESSION_TOKEN）" },
  { name: "S3_REGION", required: false, defaultValue: "us-east-1", description: "区域；Cloudflare R2 填 auto" },
  { name: "S3_ENDPOINT", required: false, defaultValue: "AWS 官方", description: "S3 兼容端点，如 https://xxx.r2.cloudflarestorage.com" },
  {
    name: "S3_FORCE_PATH_STYLE",
    required: false,
    defaultValue: "有自定义 endpoint 时为 true",
    description: "MinIO/R2 一般需要 true",
  },
  { name: "S3_INITIAL_PREFIX", required: false, defaultValue: "", description: "启动时进入的目录前缀" },
  {
    name: "S3_ACCELERATE_HOST",
    required: false,
    defaultValue: "",
    description: "加速域（域根路径直接对应桶）",
  },
  {
    name: "S3_ACCELERATE_MODE",
    required: false,
    defaultValue: "endpoint",
    description: "endpoint=用加速域重新签名；rewrite=主端点签名后替换 host；public=只生成无签名公开直链，传输仍走主端点",
  },
  {
    name: "S3_ACCELERATE_PATH_STYLE",
    required: false,
    defaultValue: "false",
    description: "加速域是 host/bucket/key 形态时设为 true",
  },
  { name: "S3_CONCURRENCY", required: false, defaultValue: "4", description: "分片上传/目录移动的并发数（1-16）" },
  {
    name: "S3_PART_SIZE_MB",
    required: false,
    defaultValue: "8",
    description: "分片大小，最小 5",
  },
  {
    name: "S3_MULTIPART_THRESHOLD_MB",
    required: false,
    defaultValue: "8",
    description: "超过多少 MiB 走分片上传（最低 5）",
  },
  { name: "S3_DOWNLOAD_DIR", required: false, defaultValue: "./downloads", description: "下载落盘目录" },
  { name: "S3_PRESIGN_EXPIRES", required: false, defaultValue: "3600", description: "预签名默认有效期（秒，最大 7 天）" },
  { name: "S3_TUI_DEBUG", required: false, defaultValue: "false", description: "把调试日志写入日志文件" },
  { name: "S3_TUI_LOG", required: false, defaultValue: "./s3-tui.log", description: "调试日志路径" },
];

export function loadDotEnv(path = ".env"): boolean {
  const loader = (process as unknown as { loadEnvFile?: (file?: string) => void }).loadEnvFile;
  if (!loader) return false;
  try {
    loader.call(process, path);
    return true;
  } catch {
    return false;
  }
}

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const problems: string[] = [];

  const read = (name: string): string | undefined => {
    const raw = env[name];
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    return trimmed === "" ? undefined : trimmed;
  };

  const first = (...names: string[]): string | undefined => {
    for (const name of names) {
      const found = read(name);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const parseBool = (name: string, fallback: boolean): boolean => {
    const raw = read(name)?.toLowerCase();
    if (raw === undefined) return fallback;
    if (["1", "true", "yes", "on"].includes(raw)) return true;
    if (["0", "false", "no", "off"].includes(raw)) return false;
    problems.push(`${name} 需要是 true/false，当前值：${raw}`);
    return fallback;
  };

  const parseIntInRange = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} 需要是 ${min}-${max} 之间的整数，当前值：${raw}`);
      return fallback;
    }
    return value;
  };

  const bucket = read("S3_BUCKET");
  if (!bucket) problems.push("缺少 S3_BUCKET（桶名）");

  const accessKeyId = first("S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID");
  if (!accessKeyId) problems.push("缺少 S3_ACCESS_KEY_ID（或 AWS_ACCESS_KEY_ID）");

  const secretAccessKey = first("S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY");
  if (!secretAccessKey) problems.push("缺少 S3_SECRET_ACCESS_KEY（或 AWS_SECRET_ACCESS_KEY）");

  const sessionToken = first("S3_SESSION_TOKEN", "AWS_SESSION_TOKEN");
  const region = read("S3_REGION") ?? first("AWS_REGION", "AWS_DEFAULT_REGION") ?? "us-east-1";

  let endpoint = read("S3_ENDPOINT");
  if (endpoint) {
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(endpoint)) endpoint = `https://${endpoint}`;
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        problems.push(`S3_ENDPOINT 只支持 http/https：${endpoint}`);
      } else {
        endpoint = parsed.toString().replace(/\/+$/, "");
      }
    } catch {
      problems.push(`S3_ENDPOINT 不是合法 URL：${endpoint}`);
      endpoint = undefined;
    }
  }

  const explicitPathStyle = read("S3_FORCE_PATH_STYLE");
  const forcePathStyle =
    explicitPathStyle === undefined ? Boolean(endpoint) : parseBool("S3_FORCE_PATH_STYLE", false);

  let accelerateHost: string | undefined;
  const accelerateRaw = read("S3_ACCELERATE_HOST");
  if (accelerateRaw) {
    try {
      accelerateHost = normalizeAccelerateHost(accelerateRaw);
    } catch (error) {
      problems.push(`S3_ACCELERATE_HOST 无效：${(error as Error).message}`);
    }
  }

  const accelerateModeRaw = (read("S3_ACCELERATE_MODE") ?? "endpoint").toLowerCase();
  let accelerateMode: AccelerateMode = "endpoint";
  if (
    accelerateModeRaw === "endpoint" ||
    accelerateModeRaw === "rewrite" ||
    accelerateModeRaw === "public"
  ) {
    accelerateMode = accelerateModeRaw;
  } else {
    problems.push(
      `S3_ACCELERATE_MODE 只能是 endpoint、rewrite 或 public，当前值：${accelerateModeRaw}`,
    );
  }

  const acceleratePathStyle = parseBool("S3_ACCELERATE_PATH_STYLE", false);
  const concurrency = parseIntInRange("S3_CONCURRENCY", 4, 1, 16);
  const partSizeMb = parseIntInRange("S3_PART_SIZE_MB", 8, 5, 5120);
  const thresholdMb = parseIntInRange("S3_MULTIPART_THRESHOLD_MB", 8, 0, 5 * 1024 * 1024);
  const presignExpires = parseIntInRange("S3_PRESIGN_EXPIRES", 3600, 1, 7 * 24 * 3600);

  const partSize = partSizeMb * MIB;
  const multipartThreshold = Math.max(thresholdMb * MIB, MIN_PART_SIZE);

  const downloadDirRaw = read("S3_DOWNLOAD_DIR") ?? "./downloads";
  const downloadDir = resolve(expandHome(downloadDirRaw, homedir()));

  const debug = parseBool("S3_TUI_DEBUG", false);
  const debugLog = resolve(expandHome(read("S3_TUI_LOG") ?? "./s3-tui.log", homedir()));

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    bucket: bucket!,
    region,
    ...(endpoint ? { endpoint } : {}),
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    ...(sessionToken ? { sessionToken } : {}),
    forcePathStyle,
    initialPrefix: normalizePrefix(read("S3_INITIAL_PREFIX") ?? ""),
    ...(accelerateHost ? { accelerateHost } : {}),
    accelerateMode,
    acceleratePathStyle,
    concurrency,
    partSize,
    multipartThreshold,
    downloadDir,
    presignExpires,
    debug,
    debugLog,
  };
}

export function formatConfigHelp(): string {
  const lines = ["环境变量："];
  for (const field of CONFIG_FIELDS) {
    const required = field.required ? "必填" : "可选";
    const fallback = field.defaultValue ? `，默认 ${field.defaultValue}` : "";
    lines.push(`  ${field.name.padEnd(28)} ${required}${fallback}`);
    lines.push(`  ${" ".repeat(28)} ${field.description}`);
  }
  lines.push("");
  lines.push("可把变量写进当前目录的 .env，启动时会自动加载（已存在的环境变量优先）。");
  return lines.join("\n");
}