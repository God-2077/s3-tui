import React from "react";
import { Box, Text, useInput } from "ink";

const SHORTCUTS: Array<[string, string]> = [
  ["↑/↓, j/k", "移动光标"],
  ["PgUp/PgDn, g/G", "翻页 / 顶部 / 底部"],
  ["Enter, →, l", "进入目录"],
  ["←, h, ⌫", "返回上级"],
  ["空格", "选择 / 取消选择"],
  ["a", "全选当前列表"],
  ["u", "上传（文件或目录；末尾带 / 只传内容）"],
  ["d", "下载选中项；目录会保留目录结构"],
  ["m", "重命名/移动当前项（输入完整 key）"],
  ["n", "新建文件夹（支持多级）"],
  ["x, Del", "删除（目录会递归删除）"],
  ["p", "生成预签名 URL"],
  ["/", "过滤当前列表"],
  ["r", "刷新"],
  ["c", "清除已结束的传输记录"],
  ["?", "帮助"],
  ["q", "退出"],
  ["Ctrl-C", "传输中取消所有任务；空闲时退出"],
];

export function HelpView({ onClose }: { onClose: () => void }) {
  useInput(() => onClose());

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor="gray">
      <Text bold color="cyan">
        快捷键
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {SHORTCUTS.map(([keys, description]) => (
          <Text key={keys}>
            <Text color="yellow">{keys.padEnd(18)}</Text>
            <Text>{description}</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>按任意键关闭</Text>
      </Box>
    </Box>
  );
}