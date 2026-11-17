import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { existsSync, statSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { AppConfig } from "../config.js";
import type { S3Context } from "../s3/client.js";
import { deleteKeys, deletePrefix, type DeleteFailure } from "../s3/delete.js";
import {
  defaultDestination,
  downloadObject,
  uniqueDestination,
} from "../s3/download.js";
import { listPage, type S3Entry } from "../s3/list.js";
import { presignGet, presignPut } from "../s3/presign.js";
import { uploadFile } from "../s3/upload.js";
import { useTransfers, type TransferRequest } from "../hooks/useTransfers.js";
import { copyToClipboard } from "../utils/clipboard.js";
import { describeError, errorMessage } from "../utils/error.js";
import { expandHome, joinKey, parentPrefix } from "../utils/key.js";
import type { Logger } from "../utils/log.js";
import { guessContentType } from "../utils/mime.js";
import { publicObjectUrl, replaceUrlHost } from "../utils/url.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ErrorPanel } from "./ErrorPanel.js";
import { FileList } from "./FileList.js";
import { HelpView } from "./HelpView.js";
import { PresignView } from "./PresignView.js";
import { Prompt } from "./Prompt.js";
import { Spinner } from "./Spinner.js";
import { TransferPanel } from "./TransferPanel.js";

interface PromptState {
  kind: "upload" | "download" | "filter";
  label: string;
  hint?: string;
  initial: string;
  entry?: S3Entry;
}

interface ConfirmState {
  title: string;
  lines: string[];
  danger?: boolean;
  action: () => void;
}

interface PresignState {
  entry: S3Entry;
  expires: number;
  method: "get" | "put";
  publicLink?: boolean;
  url?: string;
  loading: boolean;
  error?: string;
}

interface Notice {
  text: string;
  tone: "info" | "success" | "error";
}

interface LocalFile {
  path: string;
  relative: string;
  size: number;
}

async function collectFiles(root: string): Promise<LocalFile[]> {
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

export function App({
  config,
  s3,
  logger,
}: {
  config: AppConfig;
  s3: S3Context;
  logger?: Logger;
}) {
  const { exit } = useApp();
  const windowSize = useWindowSize();
  const columns = Math.max(40, windowSize.columns || 80);
  const rows = Math.max(8, windowSize.rows || 24);

  const [prefix, setPrefix] = useState(config.initialPrefix);
  const [entries, setEntries] = useState<S3Entry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<ReturnType<typeof describeError> | null>(null);
  const [filter, setFilter] = useState("");
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [presign, setPresign] = useState<PresignState | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const seqRef = useRef(0);
  const presignSeqRef = useRef(0);
  const busyRef = useRef(false);
  const pendingQuitRef = useRef(false);

  const transfers = useTransfers({
    onDrained: () => {
      setRefreshKey((current) => current + 1);
      if (pendingQuitRef.current) {
        pendingQuitRef.current = false;
        exit();
      }
    },
  });

  useEffect(() => {
    let cancelled = false;
    const seq = (seqRef.current += 1);
    setLoading(true);
    setListError(null);
    setLoadingMore(false);
    setEntries([]);
    setNextToken(undefined);

    listPage(s3.main, config.bucket, prefix)
      .then((page) => {
        if (cancelled || seq !== seqRef.current) return;
        setEntries(page.entries);
        setNextToken(page.nextToken);
        setCursor(0);
        setSelected(new Set());
      })
      .catch((error: unknown) => {
        if (cancelled || seq !== seqRef.current) return;
        logger?.("加载列表失败", error);
        setListError(describeError(error));
      })
      .finally(() => {
        if (!cancelled && seq === seqRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [prefix, refreshKey, s3, config.bucket]);

  useEffect(() => {
    setFilter("");
  }, [prefix]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [entries, filter]);

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const loadMore = useCallback(async () => {
    if (!nextToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listPage(s3.main, config.bucket, prefix, nextToken);
      setEntries((previous) => [...previous, ...page.entries]);
      setNextToken(page.nextToken);
    } catch (error) {
      logger?.("加载更多失败", error);
      setNotice({ text: errorMessage(error), tone: "error" });
    } finally {
      setLoadingMore(false);
    }
  }, [nextToken, loadingMore, s3, config.bucket, prefix]);

  useEffect(() => {
    if (filter.trim() || !nextToken || loading || loadingMore) return;
    if (cursor >= entries.length - 5) void loadMore();
  }, [cursor, entries.length, nextToken, loading, loadingMore, filter, loadMore]);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  const getTargets = useCallback((): S3Entry[] => {
    const selectedEntries = entries.filter((entry) => selected.has(entry.key));
    if (selectedEntries.length > 0) return selectedEntries;
    const current = filtered[cursor];
    return current ? [current] : [];
  }, [entries, selected, filtered, cursor]);

  const makeUploadRequest = (filePath: string, key: string, size: number): TransferRequest => ({
    kind: "upload",
    label: key,
    total: size,
    run: ({ token, onProgress }) =>
      uploadFile({
        client: s3.transfer,
        bucket: config.bucket,
        key,
        filePath,
        contentType: guessContentType(filePath),
        partSize: config.partSize,
        multipartThreshold: config.multipartThreshold,
        concurrency: config.concurrency,
        token,
        onProgress,
      }).then(() => undefined),
  });

  const makeDownloadRequest = (entry: S3Entry, destPath: string): TransferRequest => ({
    kind: "download",
    label: entry.name,
    total: entry.size,
    destPath,
    run: async ({ token, onProgress }) => {
      let url: string | undefined;
      if (s3.rewriteHost) {
        const signed = await presignGet(
          s3.main,
          config.bucket,
          entry.key,
          Math.min(config.presignExpires, 3600),
        );
        url = replaceUrlHost(signed, s3.rewriteHost);
      } else if (s3.publicHost) {
        url = publicObjectUrl(s3.publicHost, entry.key);
      }
      await downloadObject({
        ...(url ? { url } : { client: s3.transfer }),
        bucket: config.bucket,
        key: entry.key,
        destPath,
        token,
        onProgress,
      });
    },
  });

  const enqueueDownloads = (files: S3Entry[], skippedDirs = 0): void => {
    const reserved = new Set<string>();
    const requests = files.map((file) => {
      const target = uniqueDestination(defaultDestination(config.downloadDir, file.key), reserved);
      reserved.add(target);
      return makeDownloadRequest(file, target);
    });
    transfers.enqueue(requests);
    setNotice({
      text: `已加入 ${requests.length} 个下载任务${skippedDirs > 0 ? `，跳过 ${skippedDirs} 个目录` : ""}`,
      tone: "info",
    });
  };

  const handleUploadSubmit = async (value: string): Promise<void> => {
    setPrompt(null);
    const target = resolve(expandHome(value, homedir()));
    try {
      const info = await stat(target);
      if (info.isFile()) {
        transfers.enqueue([makeUploadRequest(target, joinKey(prefix, basename(target)), info.size)]);
        setNotice({ text: `已加入上传：${basename(target)}`, tone: "info" });
        return;
      }
      if (info.isDirectory()) {
        const files = await collectFiles(target);
        if (files.length === 0) {
          setNotice({ text: "目录里没有可上传的文件", tone: "error" });
          return;
        }
        const limited = files.slice(0, 2000);
        transfers.enqueue(
          limited.map((file) =>
            makeUploadRequest(file.path, joinKey(prefix, file.relative), file.size),
          ),
        );
        setNotice({
          text:
            limited.length < files.length
              ? `已加入 ${limited.length} 个文件（超过 2000 个已截断）`
              : `已加入 ${limited.length} 个文件到上传队列`,
          tone: "info",
        });
        return;
      }
      setNotice({ text: "只支持普通文件或目录", tone: "error" });
    } catch (error) {
      logger?.("读取本地路径失败", error);
      setNotice({ text: `读取路径失败：${errorMessage(error)}`, tone: "error" });
    }
  };

  const handleDownloadSubmit = (value: string, entry: S3Entry): void => {
    setPrompt(null);
    const target = resolve(expandHome(value, homedir()));
    if (existsSync(target) && statSync(target).isDirectory()) {
      setNotice({ text: "目标是目录，请输入完整的文件路径", tone: "error" });
      return;
    }
    transfers.enqueue([makeDownloadRequest(entry, uniqueDestination(target))]);
    setNotice({ text: `开始下载：${entry.name}`, tone: "info" });
  };

  const startDownload = (targets: S3Entry[]): void => {
    if (targets.length === 0) return;
    const files = targets.filter((entry) => entry.kind === "file");
    const skippedDirs = targets.length - files.length;
    if (files.length === 0) {
      setNotice({ text: "目录不能直接下载，请进入目录后选择文件", tone: "error" });
      return;
    }
    if (files.length === 1) {
      const file = files[0]!;
      setPrompt({
        kind: "download",
        label: `下载 ${file.name} 到`,
        hint: "Enter 开始下载 · Esc 取消",
        initial: uniqueDestination(defaultDestination(config.downloadDir, file.key)),
        entry: file,
      });
      if (skippedDirs > 0) {
        setNotice({ text: `已跳过 ${skippedDirs} 个目录`, tone: "info" });
      }
      return;
    }
    enqueueDownloads(files, skippedDirs);
  };

  const performDelete = async (targets: S3Entry[]): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setNotice({ text: `正在删除 ${targets.length} 项…`, tone: "info" });
    let deleted = 0;
    const failures: DeleteFailure[] = [];

    try {
      for (const target of targets) {
        try {
          const result =
            target.kind === "dir"
              ? await deletePrefix(s3.main, config.bucket, target.key)
              : await deleteKeys(s3.main, config.bucket, [target.key]);
          deleted += result.deleted;
          failures.push(...result.failures);
        } catch (error) {
          logger?.(`删除失败 ${target.key}`, error);
          failures.push({ key: target.key, message: errorMessage(error) });
        }
      }
    } finally {
      busyRef.current = false;
    }

    setSelected(new Set());
    setRefreshKey((current) => current + 1);

    if (failures.length > 0) {
      setNotice({
        text: `删除完成 ${deleted} 个，失败 ${failures.length} 个：${failures[0]!.message}`,
        tone: "error",
      });
    } else {
      setNotice({ text: `已删除 ${deleted} 个对象`, tone: "success" });
    }
  };

  const requestDelete = (targets: S3Entry[]): void => {
    if (targets.length === 0) return;
    const dirCount = targets.filter((entry) => entry.kind === "dir").length;
    const fileCount = targets.length - dirCount;
    const lines = targets.slice(0, 6).map((entry) => `${entry.kind === "dir" ? "目录" : "对象"}  ${entry.key}`);
    if (targets.length > 6) lines.push(`… 以及另外 ${targets.length - 6} 项`);
    if (dirCount > 0) lines.push(`注意：${dirCount} 个目录会被递归删除`);
    if (fileCount > 0) lines.push(`对象数量：${fileCount}`);

    setConfirm({
      title: "确认删除",
      danger: true,
      lines,
      action: () => {
        setConfirm(null);
        void performDelete(targets);
      },
    });
  };

  const generatePresign = useCallback(
    async (entry: S3Entry, expires: number, method: "get" | "put"): Promise<void> => {
      const seq = (presignSeqRef.current += 1);
      setPresign((current) =>
        current && current.entry.key === entry.key
          ? { ...current, loading: true, error: undefined, expires, method }
          : current,
      );
      try {
        const isPublicLink = Boolean(s3.publicHost) && method === "get";
        const raw = isPublicLink
          ? publicObjectUrl(s3.publicHost!, entry.key)
          : method === "get"
            ? await presignGet(s3.transfer, config.bucket, entry.key, expires)
            : await presignPut(s3.transfer, config.bucket, entry.key, expires);
        if (seq !== presignSeqRef.current) return;
        const url = s3.rewriteHost ? replaceUrlHost(raw, s3.rewriteHost) : raw;
        setPresign((current) =>
          current && current.entry.key === entry.key
            ? { ...current, url, loading: false, error: undefined, expires, method, publicLink: isPublicLink }
            : current,
        );
      } catch (error) {
        if (seq !== presignSeqRef.current) return;
        logger?.("生成预签名失败", error);
        setPresign((current) =>
          current ? { ...current, loading: false, error: describeError(error).message } : current,
        );
      }
    },
    [s3, config.bucket],
  );

  const openPresign = (entry: S3Entry): void => {
    setPresign({
      entry,
      expires: config.presignExpires,
      method: "get",
      publicLink: Boolean(s3.publicHost),
      loading: true,
    });
    void generatePresign(entry, config.presignExpires, "get");
  };

  const handleCopy = async (url: string): Promise<void> => {
    const channel = await copyToClipboard(url);
    setNotice({
      text: channel ? `已复制到剪贴板（${channel}）` : "复制失败",
      tone: channel ? "success" : "error",
    });
  };

  const handleSave = async (url: string): Promise<void> => {
    try {
      await writeFile("presigned-url.txt", `${url}\n`, "utf8");
      setNotice({ text: "已保存到 presigned-url.txt", tone: "success" });
    } catch (error) {
      setNotice({ text: `保存失败：${errorMessage(error)}`, tone: "error" });
    }
  };

  const runningTasks = transfers.tasks.filter(
    (task) => task.status === "running" || task.status === "queued",
  );
  const finishedTasks = transfers.tasks.filter(
    (task) => task.status === "done" || task.status === "error" || task.status === "cancelled",
  );
  const hasActive = runningTasks.length > 0;

  const requestQuit = useCallback(() => {
    if (hasActive) {
      setConfirm({
        title: "退出 s3-tui",
        lines: [`还有 ${runningTasks.length} 个传输任务，退出会中断它们。`],
        danger: true,
        action: () => {
          setConfirm(null);
          if (transfers.isBusy()) {
            pendingQuitRef.current = true;
            setNotice({ text: "正在取消传输并退出…", tone: "info" });
            transfers.cancelAll();
          } else {
            exit();
          }
        },
      });
      return;
    }
    exit();
  }, [hasActive, runningTasks.length, transfers, exit]);

  const transferRows =
    transfers.tasks.length === 0
      ? 0
      : Math.min(4, runningTasks.length) + Math.min(2, finishedTasks.length) + 3;
  const listHeight = Math.max(3, rows - 5 - transferRows);
  const pageStep = Math.max(3, listHeight - 2);

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === "c") {
      if (hasActive) {
        transfers.cancelAll();
        setNotice({ text: "已取消所有传输任务", tone: "error" });
      } else {
        exit();
      }
      return;
    }

    if (prompt || confirm || presign || helpOpen) return;

    if (listError) {
      if (input === "r") refresh();
      else if (key.escape) setListError(null);
      else if (input === "q") requestQuit();
      return;
    }

    const current = filtered[cursor];

    if (key.upArrow || input === "k") {
      setCursor((value) => Math.max(0, value - 1));
    } else if (key.downArrow || input === "j") {
      setCursor((value) => Math.min(Math.max(0, filtered.length - 1), value + 1));
    } else if (key.pageUp) {
      setCursor((value) => Math.max(0, value - pageStep));
    } else if (key.pageDown) {
      setCursor((value) => Math.min(Math.max(0, filtered.length - 1), value + pageStep));
    } else if (input === "g") {
      setCursor(0);
    } else if (input === "G") {
      setCursor(Math.max(0, filtered.length - 1));
    } else if (key.return || key.rightArrow || input === "l") {
      if (current?.kind === "dir") setPrefix(current.key);
    } else if (key.leftArrow || input === "h" || key.backspace) {
      setPrefix((value) => parentPrefix(value));
    } else if (input === " ") {
      if (current) {
        setSelected((previous) => {
          const next = new Set(previous);
          if (next.has(current.key)) next.delete(current.key);
          else next.add(current.key);
          return next;
        });
      }
    } else if (input === "a") {
      setSelected(new Set(filtered.map((entry) => entry.key)));
    } else if (input === "u") {
      setPrompt({
        kind: "upload",
        label: "上传本地路径（文件或目录）",
        hint: "支持 ~/ 与相对路径，目录会递归上传 · Enter 确认 · Esc 取消",
        initial: "",
      });
    } else if (input === "d") {
      startDownload(getTargets());
    } else if (input === "x" || key.delete) {
      requestDelete(getTargets());
    } else if (input === "p") {
      const file = getTargets().find((entry) => entry.kind === "file");
      if (file) openPresign(file);
      else setNotice({ text: "只能对文件生成预签名 URL", tone: "error" });
    } else if (input === "r") {
      refresh();
    } else if (input === "/") {
      setPrompt({
        kind: "filter",
        label: "过滤当前列表",
        hint: "输入即生效 · Enter 保留过滤 · Esc 清除",
        initial: filter,
      });
    } else if (input === "?") {
      setHelpOpen(true);
    } else if (input === "c") {
      transfers.clearFinished();
    } else if (input === "q") {
      requestQuit();
    } else if (key.escape) {
      setFilter("");
      setSelected(new Set());
    }
  });

  const noticeColor =
    notice?.tone === "error" ? "red" : notice?.tone === "success" ? "green" : "cyan";

  let body: React.ReactNode;
  if (helpOpen) {
    body = <HelpView onClose={() => setHelpOpen(false)} />;
  } else if (prompt) {
    body = (
      <Prompt
        label={prompt.label}
        {...(prompt.hint ? { hint: prompt.hint } : {})}
        initialValue={prompt.initial}
        columns={columns}
        onChange={prompt.kind === "filter" ? (value) => setFilter(value) : undefined}
        validator={
          prompt.kind === "upload"
            ? (value) => {
                const target = resolve(expandHome(value, homedir()));
                return existsSync(target) ? undefined : `路径不存在：${target}`;
              }
            : prompt.kind === "download"
              ? (value) => {
                  const target = resolve(expandHome(value, homedir()));
                  return existsSync(target) && statSync(target).isDirectory()
                    ? "目标是目录，请输入完整的文件路径"
                    : undefined;
                }
              : undefined
        }
        onSubmit={(value) => {
          if (prompt.kind === "upload") void handleUploadSubmit(value);
          else if (prompt.kind === "download" && prompt.entry)
            handleDownloadSubmit(value, prompt.entry);
          else if (prompt.kind === "filter") {
            setFilter(value);
            setPrompt(null);
          }
        }}
        onCancel={() => {
          if (prompt.kind === "filter") setFilter("");
          setPrompt(null);
        }}
      />
    );
  } else if (confirm) {
    body = (
      <ConfirmDialog
        title={confirm.title}
        lines={confirm.lines}
        {...(confirm.danger ? { danger: true } : {})}
        onConfirm={confirm.action}
        onCancel={() => setConfirm(null)}
      />
    );
  } else if (presign) {
    body = (
      <PresignView
        entry={presign.entry}
        expires={presign.expires}
        method={presign.method}
        {...(presign.publicLink ? { publicLink: true } : {})}
        {...(presign.url ? { url: presign.url } : {})}
        loading={presign.loading}
        {...(presign.error ? { error: presign.error } : {})}
        onClose={() => setPresign(null)}
        onExpires={(seconds) => {
          setPresign((current) => (current ? { ...current, expires: seconds } : current));
          void generatePresign(presign.entry, seconds, presign.method);
        }}
        onToggleMethod={() => {
          const method = presign.method === "get" ? "put" : "get";
          setPresign((current) => (current ? { ...current, method } : current));
          void generatePresign(presign.entry, presign.expires, method);
        }}
        onRegenerate={() => void generatePresign(presign.entry, presign.expires, presign.method)}
        onCopy={(url) => void handleCopy(url)}
        onSave={(url) => void handleSave(url)}
      />
    );
  } else if (listError) {
    body = (
      <ErrorPanel
        title="加载列表失败"
        message={listError.message}
        hints={listError.hints}
      />
    );
  } else {
    body = (
      <>
        <FileList
          entries={filtered}
          cursor={cursor}
          selected={selected}
          columns={columns}
          height={listHeight}
          loading={loading}
          loadingMore={loadingMore}
          filter={filter}
        />
        <TransferPanel tasks={transfers.tasks} columns={columns} />
      </>
    );
  }

  const accelerateLabel = config.accelerateHost
    ? ` · ⚡${config.accelerateHost.replace(/^https?:\/\//, "")}${s3.publicHost ? "（公开）" : ""}`
    : "";

  return (
    <Box flexDirection="column" width={columns}>
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">
          s3-tui
        </Text>
        <Text dimColor wrap="truncate-end">
          {config.bucket} · {config.region}
          {accelerateLabel}
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text color="blue" wrap="truncate-end">
          {prefix ? `/${prefix}` : "/"}
        </Text>
        <Text dimColor wrap="truncate-end">
          {"  "}
          {filtered.length}/{entries.length} 项
          {nextToken ? " · 有更多" : ""}
          {selected.size > 0 ? ` · 已选 ${selected.size}` : ""}
          {filter.trim() ? ` · 过滤「${filter.trim()}」` : ""}
        </Text>
        {loading ? (
          <Text>
            {" "}
            <Spinner />
          </Text>
        ) : null}
        {hasActive ? <Text dimColor> · 传输 {runningTasks.length}</Text> : null}
      </Box>

      {body}

      <Box paddingX={1}>
        {notice ? (
          <Text color={noticeColor} wrap="truncate-end">
            {notice.text}
          </Text>
        ) : (
          <Text dimColor wrap="truncate-end">
            {selected.size > 0
              ? `已选 ${selected.size} 项 · 空格取消选择 · a 全选 · x 删除`
              : hasActive
                ? "Ctrl-C 取消传输 · ? 帮助"
                : "↑↓ 移动 · Enter 进入 · ⌫ 上级 · ? 帮助"}
          </Text>
        )}
      </Box>
      <Box paddingX={1}>
        <Text dimColor wrap="truncate-end">
          u 上传 · d 下载 · x 删除 · p 预签名 · / 过滤 · r 刷新 · q 退出
        </Text>
      </Box>
    </Box>
  );
}