import React from "react";
import { Box, Text, useInput } from "ink";
import type { S3Entry } from "../s3/list.js";
import { formatBytes } from "../utils/format.js";
import { Spinner } from "./Spinner.js";

export interface PresignViewProps {
  entry: S3Entry;
  expires: number;
  method: "get" | "put";
  /** 当前 URL 是公开桶直链（无签名）。 */
  publicLink?: boolean;
  url?: string;
  loading: boolean;
  error?: string;
  onClose: () => void;
  onExpires: (expires: number) => void;
  onToggleMethod: () => void;
  onRegenerate: () => void;
  onCopy: (url: string) => void;
  onSave: (url: string) => void;
}

export const EXPIRY_PRESETS = [
  { seconds: 900, label: "15m" },
  { seconds: 3600, label: "1h" },
  { seconds: 86_400, label: "24h" },
  { seconds: 604_800, label: "7d" },
] as const;

function expiresLabel(seconds: number): string {
  const preset = EXPIRY_PRESETS.find((item) => item.seconds === seconds);
  if (preset) return preset.label;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function PresignView({
  entry,
  expires,
  method,
  publicLink,
  url,
  loading,
  error,
  onClose,
  onExpires,
  onToggleMethod,
  onRegenerate,
  onCopy,
  onSave,
}: PresignViewProps) {
  useInput((input, key) => {
    if (key.escape || input === "q") {
      onClose();
      return;
    }
    if (input === "c" && url) {
      onCopy(url);
      return;
    }
    if (input === "w" && url) {
      onSave(url);
      return;
    }
    if (input === "m") {
      onToggleMethod();
      return;
    }
    if (input === "r") {
      onRegenerate();
      return;
    }
    const preset = EXPIRY_PRESETS.find((item, index) => String(index + 1) === input);
    if (preset) onExpires(preset.seconds);
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor="cyan">
      <Text bold color="cyan">
        {publicLink ? "公开链接 URL" : "预签名 URL"} · {entry.name}
      </Text>
      <Text dimColor>
        {formatBytes(entry.size)} · {entry.key}
      </Text>

      <Box marginTop={1}>
        <Text dimColor>有效期：</Text>
        {EXPIRY_PRESETS.map((preset, index) => (
          <Text key={preset.seconds}>
            <Text color={expires === preset.seconds ? "green" : "gray"}>
              {expires === preset.seconds ? "●" : "○"} {preset.label}
            </Text>
            <Text dimColor>({index + 1}) </Text>
          </Text>
        ))}
        <Text dimColor>当前 {expiresLabel(expires)}</Text>
      </Box>

      <Box>
        <Text dimColor>方法：</Text>
        <Text color="yellow">{method === "get" ? "GET" : "PUT"}</Text>
        <Text dimColor>（m 切换，PUT 用于直传）</Text>
      </Box>

      {publicLink ? (
        <Box marginTop={1}>
          <Text dimColor>
            公开直链：桶需开启公开访问，无签名、无有效期（PUT 仍为主端点签名 URL）
          </Text>
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        {loading ? (
          <Box>
            <Spinner />
            <Text dimColor> 生成中…</Text>
          </Box>
        ) : error ? (
          <Text color="red">{error}</Text>
        ) : (
          <Text wrap="wrap" color="white">
            {url ?? "—"}
          </Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          <Text color="green">c</Text> 复制 · <Text color="green">w</Text> 保存到
          presigned-url.txt · <Text color="yellow">1-4</Text> 改有效期 ·{" "}
          <Text color="yellow">r</Text> 重新生成 · Esc 关闭
        </Text>
      </Box>
    </Box>
  );
}