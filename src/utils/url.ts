/** 加速域名 / 预签名 URL 的 host 处理。 */

/** 允许用户省略协议；只接受 origin（不允许路径/查询串）。 */
export function normalizeAccelerateHost(input: string): string {
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)
    ? input
    : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`不是合法的 URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`只支持 http/https: ${input}`);
  }
  if (!url.hostname) {
    throw new Error(`缺少主机名: ${input}`);
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error(
      `加速主机只要域名（可带端口），不要路径或参数: ${input}`,
    );
  }
  return url.origin;
}

/** 预签名 URL 已按主端点签好，只替换 host（含端口）。 */
export function replaceUrlHost(url: string, host: string): string {
  const parsed = new URL(url);
  parsed.host = host;
  return parsed.toString();
}

export function hostOf(url: string): string {
  return new URL(url).host;
}