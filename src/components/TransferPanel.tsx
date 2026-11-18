import React from "react";
import { Box, Text } from "ink";
import type { TransferTaskView } from "../hooks/useTransfers.js";
import { fitText, formatBytes, formatEta, formatSpeed, padEndDisplay } from "../utils/format.js";
import { ProgressBar } from "./ProgressBar.js";

export interface TransferPanelProps {
  tasks: TransferTaskView[];
  columns: number;
}

function statusIcon(task: TransferTaskView): { icon: string; color: string } {
  switch (task.status) {
    case "running":
      return { icon: task.kind === "upload" ? "↑" : "↓", color: task.kind === "upload" ? "cyan" : "blue" };
    case "queued":
      return { icon: "·", color: "gray" };
    case "done":
      return { icon: "✓", color: "green" };
    case "error":
      return { icon: "✗", color: "red" };
    case "cancelled":
      return { icon: "⊘", color: "yellow" };
  }
}

function statusText(task: TransferTaskView): string {
  if (task.status === "queued") return "排队中";
  if (task.status === "error") return task.error ?? "失败";
  if (task.status === "cancelled") return "已取消";
  if (task.status === "done") return "完成";
  return "";
}

export function TransferPanel({ tasks, columns }: TransferPanelProps) {
  if (tasks.length === 0) return null;

  const running = tasks.filter((task) => task.status === "running" || task.status === "queued");
  const finished = tasks.filter(
    (task) => task.status === "done" || task.status === "error" || task.status === "cancelled",
  );
  const runningCount = tasks.filter((task) => task.status === "running").length;
  const queuedCount = tasks.filter((task) => task.status === "queued").length;

  const shown = [...running.slice(0, 4), ...finished.slice(-2)];
  const completed = tasks.filter((task) => task.status === "done").length;
  const failed = tasks.filter((task) => task.status === "error").length;
  const labelWidth = Math.max(12, Math.min(30, columns - 52));

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="single" borderColor="gray">
      <Text dimColor wrap="truncate-end">
        运行 {runningCount} · 排队 {queuedCount} · 完成 {completed}
        {failed > 0 ? ` · 失败 ${failed}` : ""}   <Text color="gray">c 清除已完成  Ctrl-C 取消</Text>
      </Text>
      {shown.map((task) => {
        const { icon, color } = statusIcon(task);
        const percent = Math.round(task.percent);
        const speed = task.status === "running" ? formatSpeed(task.speed) : "";
        const eta = task.status === "running" ? formatEta(task.etaMs) : "";
        const partLabel = task.kind === "upload" ? "分片" : "分段";
        const part = task.part
          ? ` ${partLabel} ${task.part.current}/${task.part.total}`
          : "";
        const label = padEndDisplay(task.label, labelWidth);

        return (
          <Text key={task.id} wrap="truncate-end">
            <Text color={color}>{icon} </Text>
            <Text>{label}</Text>
            <ProgressBar
              percent={task.status === "done" ? 100 : task.percent}
              tone={task.status === "done" ? "done" : task.status === "error" ? "error" : task.kind}
            />
            <Text> {String(percent).padStart(3)}%</Text>
            {task.total > 0 ? (
              <Text dimColor>
                {"  "}
                {formatBytes(task.status === "done" ? task.total : task.loaded)}/
                {formatBytes(task.total)}
              </Text>
            ) : (
              <Text dimColor> {formatBytes(task.loaded)}</Text>
            )}
            {speed ? <Text dimColor> {speed}</Text> : null}
            {eta && eta !== "—" ? <Text dimColor> ETA {eta}</Text> : null}
            {part ? <Text dimColor>{part}</Text> : null}
            {task.status === "error" ? <Text color="red"> {statusText(task)}</Text> : null}
          </Text>
        );
      })}
      {running.length > 4 ? (
        <Text dimColor>… 还有 {running.length - 4} 个未完成任务</Text>
      ) : null}
    </Box>
  );
}