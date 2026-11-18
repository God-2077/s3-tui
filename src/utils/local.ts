import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { joinKey } from "./key.js";

/** 本地浏览器里的一行。 */
export interface LocalEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number;
}

/** 本地目录递归得到的文件。 */
export interface LocalFile {
  path: string;
  relative: string;
  size: number;
}

/** 上传规划结果：本地路径 -> S3 key。 */
export interface UploadFile {
  path: string;
  key: string;
  size: number;
}

export const MAX_UPLOAD_FILES = 2000;

/**
 * 列出一个本地目录。跳过符号链接，目录在前、文件在后。
 * 默认隐藏以 . 开头的条目；权限或读取错误向上抛出。
 */
export async function listLocalDirectory(
  directory: string,
  options: { showHidden?: boolean } = {},
): Promise<LocalEntry[]> {
  const showHidden = options.showHidden ?? false;
  const children = await readdir(directory, { withFileTypes: true });
  const entries: LocalEntry[] = [];

  for (const child of children) {
    if (child.isSymbolicLink()) continue;
    if (!showHidden && child.name.startsWith(".")) continue;
    const absolute = join(directory, child.name);
    if (child.isDirectory()) {
      entries.push({ name: child.name, path: absolute, kind: "dir", size: 0 });
    } else if (child.isFile()) {
      const info = await stat(absolute);
      entries.push({ name: child.name, path: absolute, kind: "file", size: info.size });
    }
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

/** 递归收集目录下的普通文件；跳过符号链接，relative 使用 / 分隔。 */
export async function collectFiles(root: string): Promise<LocalFile[]> {
  const files: LocalFile[] = [];
  const walk = async (directory: string, relativeBase: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      const absolute = join(directory, child.name);
      const relative = relativeBase ? `${relativeBase}/${child.name}` : child.name;
      if (child.isDirectory()) {
        await walk(absolute, relative);
      } else if (child.isFile()) {
        const info = await stat(absolute);
        files.push({ path: absolute, relative, size: info.size });
      }
    }
  };
  await walk(root, "");
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  return files;
}

/**
 * 把本地浏览器/手动路径选择规划成上传列表。
 * - 文件：key = joinKey(prefix, basename(path))
 * - 目录：key = joinKey(prefix, basename(path)) + 目录内相对路径
 * 空目录只计数，不产生任务；超过 maxFiles 时截断。
 */
export async function planPickerUploads(
  paths: string[],
  prefix: string,
  options: { maxFiles?: number } = {},
): Promise<{ files: UploadFile[]; emptyDirs: number; truncated: boolean }> {
  const maxFiles = Math.max(0, Math.floor(options.maxFiles ?? MAX_UPLOAD_FILES));
  const files: UploadFile[] = [];
  let emptyDirs = 0;

  for (const path of paths) {
    const info = await stat(path);
    if (info.isFile()) {
      files.push({ path, key: joinKey(prefix, basename(path)), size: info.size });
    } else if (info.isDirectory()) {
      const collected = await collectFiles(path);
      if (collected.length === 0) {
        emptyDirs += 1;
        continue;
      }
      const base = joinKey(prefix, basename(path));
      for (const file of collected) {
        files.push({ path: file.path, key: joinKey(base, file.relative), size: file.size });
      }
    } else {
      throw new Error("只支持普通文件或目录");
    }
  }

  return {
    files: files.slice(0, maxFiles),
    emptyDirs,
    truncated: files.length > maxFiles,
  };
}
