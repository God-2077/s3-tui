import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { errorMessage } from "../utils/error.js";
import { fitText, formatBytes, padEndDisplay, padStartDisplay } from "../utils/format.js";
import { listLocalDirectory, type LocalEntry } from "../utils/local.js";
import { Spinner } from "./Spinner.js";

export interface LocalPickerProps {
  initialDir: string;
  columns: number;
  height: number;
  onCancel: () => void;
  onUpload: (paths: string[]) => void;
  onManualPath: () => void;
}

/** 本地文件浏览器：选择当前目录下的文件/目录，或切换到手动输入路径。 */
export function LocalPicker({
  initialDir,
  columns,
  height,
  onCancel,
  onUpload,
  onManualPath,
}: LocalPickerProps) {
  const [directory, setDirectory] = useState(initialDir);
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setEntries([]);
    setCursor(0);
    listLocalDirectory(directory, { showHidden })
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        setCursor(0);
        setSelected(new Set());
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setEntries([]);
        setCursor(0);
        setSelected(new Set());
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [directory, showHidden, reloadKey]);

  const navigate = (target: string): void => {
    setSelected(new Set());
    setDirectory(target);
  };

  const current = entries[cursor];

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((value) => Math.min(Math.max(0, entries.length - 1), value + 1));
      return;
    }
    if (key.pageUp) {
      setCursor((value) => Math.max(0, value - Math.max(3, height - 2)));
      return;
    }
    if (key.pageDown) {
      setCursor((value) =>
        Math.min(Math.max(0, entries.length - 1), value + Math.max(3, height - 2)),
      );
      return;
    }
    if (input === "g") {
      setCursor(0);
      return;
    }
    if (input === "G") {
      setCursor(Math.max(0, entries.length - 1));
      return;
    }
    if (key.return || key.rightArrow || input === "l") {
      if (current?.kind === "dir") navigate(current.path);
      return;
    }
    if (key.leftArrow || input === "h" || key.backspace) {
      const parent = dirname(directory);
      if (parent !== directory) navigate(parent);
      return;
    }
    if (input === " ") {
      if (!current) return;
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(current.path)) next.delete(current.path);
        else next.add(current.path);
        return next;
      });
      return;
    }
    if (input === "a") {
      if (entries.length === 0) return;
      setSelected((previous) =>
        previous.size === entries.length ? new Set() : new Set(entries.map((entry) => entry.path)),
      );
      return;
    }
    if (input === "u") {
      const paths =
        selected.size > 0
          ? entries.filter((entry) => selected.has(entry.path)).map((entry) => entry.path)
          : current
            ? [current.path]
            : [];
      if (paths.length > 0) onUpload(paths);
      return;
    }
    if (input === "p") {
      onManualPath();
      return;
    }
    if (input === "r") {
      setReloadKey((value) => value + 1);
      return;
    }
    if (input === "~") {
      navigate(homedir());
      return;
    }
    if (input === ".") {
      setShowHidden((value) => !value);
    }
  });

  const visibleHeight = Math.max(1, height);
  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(visibleHeight / 2), entries.length - visibleHeight),
  );
  const windowEntries = entries.slice(start, start + visibleHeight);
  const nameWidth = Math.max(10, columns - 2 - 2 - 2 - 10);
  const selectedText = selected.size > 0 ? ` · 已选 ${selected.size} 项` : "";

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="cyan">
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          选择要上传的文件或目录
        </Text>
        <Text dimColor wrap="truncate-end">
          {showHidden ? "显示隐藏项" : "隐藏点文件"}
          {selectedText}
        </Text>
      </Box>
      <Text color="blue" wrap="truncate-end">
        {fitText(directory, Math.max(10, columns - 4))}
      </Text>

      {loading ? (
        <Box paddingY={1}>
          <Spinner />
          <Text dimColor> 正在读取目录…</Text>
        </Box>
      ) : error ? (
        <Box flexDirection="column" paddingY={1}>
          <Text color="red">读取目录失败：{fitText(error, Math.max(10, columns - 18))}</Text>
          <Text dimColor>按 r 重试 · Esc 关闭</Text>
        </Box>
      ) : entries.length === 0 ? (
        <Box paddingY={1}>
          <Text dimColor>（空目录；按 h 返回上级）</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {windowEntries.map((entry, offset) => {
            const index = start + offset;
            const isCurrent = index === cursor;
            const isSelected = selected.has(entry.path);
            const name = entry.kind === "dir" ? `${entry.name}/` : entry.name;
            return (
              <Text key={entry.path} wrap="truncate-end">
                <Text color={isCurrent ? "cyan" : undefined}>{isCurrent ? "❯ " : "  "}</Text>
                <Text color={isSelected ? "green" : undefined}>{isSelected ? "✓ " : "  "}</Text>
                <Text
                  color={entry.kind === "dir" ? "cyan" : isCurrent ? "white" : undefined}
                  bold={isCurrent}
                >
                  {padEndDisplay(fitText(name, nameWidth), nameWidth)}
                </Text>
                <Text dimColor>{padStartDisplay(entry.kind === "file" ? formatBytes(entry.size) : "", 10)}</Text>
              </Text>
            );
          })}
        </Box>
      )}

      <Text dimColor wrap="truncate-end">
        ↑↓ 移动 · Enter 进入 · 空格选择 · a 全选/清空 · u 上传 · p 路径 · r 刷新 · . 隐藏 · Esc 关闭
      </Text>
    </Box>
  );
}
