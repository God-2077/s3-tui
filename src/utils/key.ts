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

/** 展开 ~ 开头的用户路径。 */
export function expandHome(input: string, home: string): string {
  if (input === "~") return home;
  if (input.startsWith("~/")) return `${home}/${input.slice(2)}`;
  return input;
}