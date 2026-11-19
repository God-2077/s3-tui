import React from "react";
import { Box, Text } from "ink";
import type { S3Entry } from "../s3/list.js";
import {
  fitText,
  formatBytes,
  formatDateShort,
  padEndDisplay,
  padStartDisplay,
} from "../utils/format.js";
import { Spinner } from "./Spinner.js";

export interface FileListProps {
  entries: S3Entry[];
  cursor: number;
  selected: Set<string>;
  columns: number;
  height: number;
  loading: boolean;
  loadingMore: boolean;
  filter: string;
  folderSizes?: ReadonlyMap<string, number | null>;
}

export function FileList({
  entries,
  cursor,
  selected,
  columns,
  height,
  loading,
  loadingMore,
  filter,
  folderSizes,
}: FileListProps) {
  const nameWidth = Math.max(12, columns - 2 - 2 - 2 - 10 - 1 - 11 - 1);
  const visibleHeight = Math.max(1, height);
  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(visibleHeight / 2), entries.length - visibleHeight),
  );
  const window = entries.slice(start, start + visibleHeight);

  if (loading) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Spinner />
        <Text dimColor> 正在加载…</Text>
      </Box>
    );
  }

  if (entries.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>
          {filter ? `没有匹配「${filter}」的项目` : "（这里还没有对象，按 u 上传）"}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {window.map((entry, offset) => {
        const index = start + offset;
        const isCurrent = index === cursor;
        const isSelected = selected.has(entry.key);
        const folderSize = entry.kind === "dir" ? folderSizes?.get(entry.key) : undefined;
        const sizeText =
          entry.kind === "dir"
            ? folderSizes
              ? folderSize === undefined
                ? "…"
                : folderSize === null
                  ? "—"
                  : formatBytes(folderSize)
              : ""
            : formatBytes(entry.size);
        const dateText = entry.kind === "dir" ? "" : formatDateShort(entry.lastModified);
        const name = entry.kind === "dir" ? `${entry.name}/` : entry.name;

        return (
          <Text key={entry.key} wrap="truncate-end">
            <Text color={isCurrent ? "cyan" : undefined}>{isCurrent ? "❯ " : "  "}</Text>
            <Text color={isSelected ? "green" : undefined}>{isSelected ? "✓ " : "  "}</Text>
            <Text
              color={entry.kind === "dir" ? "cyan" : isCurrent ? "white" : undefined}
              bold={isCurrent}
            >
              {padEndDisplay(fitText(name, nameWidth), nameWidth)}
            </Text>
            <Text dimColor>{padStartDisplay(sizeText, 10)}</Text>
            <Text dimColor> {dateText}</Text>
          </Text>
        );
      })}
      {loadingMore ? (
        <Box paddingLeft={4}>
          <Spinner />
          <Text dimColor> 加载更多…</Text>
        </Box>
      ) : null}
    </Box>
  );
}