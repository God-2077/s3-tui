import { spawn } from "node:child_process";

async function trySpawn(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: ["ignore", "ignore", "ignore"] });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Termux 优先用 termux-clipboard-set，其余终端走 OSC 52。
 * 返回实际使用的通道，便于在 TUI 里提示。
 */
export async function copyToClipboard(text: string): Promise<string | undefined> {
  const termux = Boolean(
    process.env.TERMUX_VERSION ?? process.env.PREFIX?.includes("com.termux"),
  );
  if (termux && (await trySpawn("termux-clipboard-set", [text]))) {
    return "termux-clipboard-set";
  }
  const encoded = Buffer.from(text, "utf8").toString("base64");
  process.stdout.write(`\u001B]52;c;${encoded}\u0007`);
  return "OSC 52";
}