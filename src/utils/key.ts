/** S3 key / prefix 相关的小工具。 */

export function stripSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** 保证非空前缀以 / 结尾，空前缀保持为空。 */
export function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function joinKey(prefix: string, name: string): string {
  const base = prefix.endsWith("/") || prefix === "" ? prefix : `${prefix}/`;
  return `${base}${name}`;
}

/** "photos/2024/" -> "photos/"；"photos/" / "" -> "" */
export function parentPrefix(prefix: string): string {
  if (!prefix) return "";
  const trimmed = prefix.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  if (index === -1) return "";
  return trimmed.slice(0, index + 1);
}

export function basename(key: string): string {
  const trimmed = key.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

import { posix } from "node:path";

/** 把对象 key 转成安全的本地相对路径（归一化 . 与 ..，不允许逃出下载目录）。 */
export function keyToRelativePath(key: string): string {
  const normalized = posix.normalize(`/${key}`);
  return normalized
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .join("/");
}

/** 去掉对象 key 的前导 /（保留结尾 /，结尾 / 表示文件夹占位对象）。 */
export function normalizeObjectKey(value: string): string {
  return value.trim().replace(/^\/+/, "");
}

/** 把用户输入的文件夹名/路径拼到当前前缀下，返回以 / 结尾的目录 key；空输入返回空串。 */
export function folderKey(prefix: string, input: string): string {
  const cleaned = stripSlashes(input.trim());
  if (!cleaned) return "";
  return normalizePrefix(joinKey(prefix, cleaned));
}

export interface MovableEntry {
  kind: "dir" | "file";
  key: string;
}

/** 校验重命名/移动输入，返回新的完整 key 或中文错误。 */
export function resolveMoveTarget(
  entry: MovableEntry,
  input: string,
): { target: string } | { error: string } {
  const raw = normalizeObjectKey(input);
  if (entry.kind === "file") {
    if (!raw) return { error: "新 key 不能为空" };
    if (raw.endsWith("/")) return { error: "文件的新 key 不能以 / 结尾" };
    if (raw === entry.key) return { error: "新 key 与当前 key 相同" };
    return { target: raw };
  }

  const source = normalizePrefix(entry.key);
  const target = normalizePrefix(raw);
  if (!target) return { error: "新目录不能为空" };
  if (target === source) return { error: "新目录与当前目录相同" };
  if (target.startsWith(source)) return { error: "不能移动到自身或子目录" };
  return { target };
}

/** 目录移动时把源 key 映射到目标前缀下，保留占位对象的结尾 /。 */
export function moveTargetKey(
  sourcePrefix: string,
  targetPrefix: string,
  sourceKey: string,
): string {
  const suffix = sourceKey.startsWith(sourcePrefix) ? sourceKey.slice(sourcePrefix.length) : sourceKey;
  return `${targetPrefix}${suffix}`;
}

/** 把 key 相对某个目录前缀的路径转成安全的本地相对路径。 */
export function prefixRelativePath(prefix: string, key: string): string {
  const relative = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
  return keyToRelativePath(relative);
}

/** 展开 ~ 开头的用户路径。 */
export function expandHome(input: string, home: string): string {
  if (input === "~") return home;
  if (input.startsWith("~/")) return `${home}/${input.slice(2)}`;
  return input;
}