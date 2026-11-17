#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { createRequire } from "node:module";
import { App } from "./components/App.js";
import {
  ConfigError,
  formatConfigHelp,
  loadDotEnv,
  parseConfig,
} from "./config.js";
import { createS3, closeS3 } from "./s3/client.js";
import { describeError } from "./utils/error.js";
import { createLogger } from "./utils/log.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };
const VERSION = pkg.version ?? "0.0.0";

const USAGE = `s3-tui ${VERSION} — S3 文件管理终端界面

用法：
  s3-tui              启动 TUI
  s3-tui --help       查看帮助与环境变量
  s3-tui --version    输出版本

功能：浏览、上传（含分片）、下载、删除、生成预签名 URL，均带进度显示。

${formatConfigHelp()}`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log(USAGE);
  process.exit(0);
}
if (args.has("--version") || args.has("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  fail("s3-tui 需要在交互式终端中运行（stdin/stdout 需要是 TTY）。");
}

loadDotEnv();

let config;
try {
  config = parseConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error("配置有误：\n");
    for (const problem of error.problems) console.error(`  ✗ ${problem}`);
    console.error(`\n${formatConfigHelp()}`);
    process.exit(1);
  }
  throw error;
}

const logger = createLogger(config.debug, config.debugLog);
logger(`启动：bucket=${config.bucket} region=${config.region} endpoint=${config.endpoint ?? "aws"}`);

const s3 = createS3(config);
let instance: ReturnType<typeof render> | undefined;

const shutdown = (error: unknown): never => {
  try {
    instance?.unmount();
  } catch {
    // 终端已退出时忽略
  }
  const { message, hints } = describeError(error);
  logger("未捕获异常", error);
  console.error(`\n[s3-tui] ${message}`);
  for (const hint of hints) console.error(`  • ${hint}`);
  try {
    closeS3(s3);
  } catch {
    // ignore
  }
  process.exit(1);
};

process.on("uncaughtException", shutdown);
process.on("unhandledRejection", shutdown);

instance = render(<App config={config} s3={s3} logger={logger} />, {
  exitOnCtrlC: false,
  patchConsole: true,
});

await instance.waitUntilExit();
logger("退出");
try {
  closeS3(s3);
} catch {
  // ignore
}