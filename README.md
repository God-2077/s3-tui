# s3-tui

在终端里浏览和管理 S3 及 S3 兼容对象存储：列目录、上传（大文件自动分片）、下载、删除、生成预签名 URL，上传和下载都有实时进度条。

适合在 Termux、服务器或任何带终端的环境里快速操作 MinIO、Cloudflare R2、AWS S3 等存储。

## 功能

- 像文件管理器一样按目录浏览，支持前缀、分页、过滤和多选
- 上传文件或整个目录（递归），超过阈值自动走分片上传
- 下载对象，进度、速度、ETA 实时显示；保留 key 的子目录结构
- 删除单个对象或递归删除目录，删除前确认
- 生成 GET / PUT 预签名 URL，支持 15 分钟到 7 天有效期
- 上传/下载可随时取消，分片上传失败会自动清理未完成的上传
- 支持自定义加速主机（重新签名、CDN 替换 host 或公开直链三种模式）

## 快速开始

需要 Node.js 20.12 或更高版本，以及 pnpm。

1. 安装依赖：

   ```bash
   pnpm install
   ```

2. 复制配置模板并填写凭证：

   ```bash
   cp .env.example .env
   ```

3. 启动：

   ```bash
   pnpm dev
   ```

   看到文件列表和底部快捷键提示就说明连接成功。

4. 构建后运行：

   ```bash
   pnpm build
   pnpm start
   ```

   也可以在当前项目执行 `pnpm link --global`，之后直接用 `s3-tui` 启动。

在 Termux 上建议把终端横屏或调整到至少 80 列宽。项目没有原生依赖，安装后即可使用。

## 配置

配置只从环境变量读取；如果当前目录有 `.env`，启动时会自动加载。已经存在的环境变量优先于 `.env` 里的值。

### 必填

| 变量 | 说明 |
| --- | --- |
| `S3_BUCKET` | 桶名 |
| `S3_ACCESS_KEY_ID` | Access Key，也接受 `AWS_ACCESS_KEY_ID` |
| `S3_SECRET_ACCESS_KEY` | Secret Key，也接受 `AWS_SECRET_ACCESS_KEY` |

### 常用可选

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `S3_REGION` | `us-east-1` | 区域，Cloudflare R2 填 `auto` |
| `S3_ENDPOINT` | AWS 官方 | S3 兼容端点，可省略协议（按 https） |
| `S3_FORCE_PATH_STYLE` | 有自定义端点时 `true` | MinIO / R2 通常需要 `true` |
| `S3_SESSION_TOKEN` | 空 | 临时凭证，也接受 `AWS_SESSION_TOKEN` |
| `S3_INITIAL_PREFIX` | 空 | 启动时进入的目录，如 `photos/` |
| `S3_DOWNLOAD_DIR` | `./downloads` | 下载文件保存目录 |
| `S3_PRESIGN_EXPIRES` | `3600` | 预签名默认有效期（秒，最大 7 天） |

### 传输参数

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `S3_CONCURRENCY` | `4` | 单个大文件的分片并发数（1-16） |
| `S3_PART_SIZE_MB` | `8` | 分片大小，最小 5 MiB，最大 5120 MiB |
| `S3_MULTIPART_THRESHOLD_MB` | `8` | 超过多少 MiB 改用分片上传，最低按 5 MiB 处理 |

文件之间按队列逐个传输，分片在单个文件内并发。

### 配置示例

Cloudflare R2：

```dotenv
S3_BUCKET=my-bucket
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
```

MinIO：

```dotenv
S3_BUCKET=my-bucket
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://192.168.1.10:9000
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```

AWS S3：

```dotenv
S3_BUCKET=my-bucket
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx
S3_REGION=ap-northeast-1
```

缺少必填项或数值不合法时，程序会在进入界面之前列出所有问题，并打印完整的变量说明。

## 加速主机

设置 `S3_ACCELERATE_HOST` 后，列表和删除仍走主端点，上传、下载和预签名走加速地址。只填域名（可带端口），不要带路径或查询参数；省略协议时按 `https` 处理。

### endpoint 模式（默认）

加速域名本身就是一个绑定到该桶的 S3 端点，桶的 key 直接位于域名根路径下（`https://加速域/key`）。程序用这个 host 重新签名，因此签名与实际访问一致。

```dotenv
S3_ACCELERATE_HOST=https://my-bucket.s3-accelerate.amazonaws.com
```

AWS S3 的 accelerate 端点必须把桶名写进 host，例如上面的写法。如果你有支持 S3 API 的自定义域（域根路径对应桶），也可以直接填该域名。

如果加速地址是 `https://gateway.example.com/bucket/key` 这种路径式结构，再设置：

```dotenv
S3_ACCELERATE_PATH_STYLE=true
```

Cloudflare R2 的自定义域通常只用于公开访问，不一定支持 S3 API 操作；需要签名访问时优先使用 R2 的 S3 端点，或改用下面的 rewrite 模式；只做公开直链时见 public 模式。

### rewrite 模式

先用主端点生成预签名 URL，再把 URL 的 host 换成加速域名。适合前面挂了纯 CDN 的场景。

```dotenv
S3_ACCELERATE_MODE=rewrite
S3_ACCELERATE_HOST=https://cdn.example.com
```

注意：CDN 必须放行带签名的请求（例如公开桶，或源站不校验查询签名）。这种模式下上传仍走主端点，只有下载和预签名 URL 使用加速域名。

### public 模式（公开桶直链）

加速域名绑定的是一个已开启公开访问的桶，文件在域根路径下直接可读。程序不签名，直接拼接公开直链 `https://加速域/key`；按 `p` 时显示、复制和保存的都是这种干净链接，适合对外分享。

```dotenv
S3_ACCELERATE_MODE=public
S3_ACCELERATE_HOST=https://k-pan.edgeone.ksable.top
```

注意：

- 桶必须开启公开访问，否则直链会 403/404。Cloudflare R2：桶 → Settings → Public access → Custom Domains → 连接域名并 Allow Public Access。
- public 模式下上传、列表、删除仍走主端点（签名操作），只有展示与下载走加速域；下载会直接请求公开直链，相当于让 CDN 加速。
- 直链没有签名、没有有效期；PUT 预签名仍回退到主端点签名 URL。
- 公开桶 = 任何人可读，请勿存放敏感数据。

## 使用

启动后底部会显示快捷键。完整列表按 `?` 查看。

| 按键 | 作用 |
| --- | --- |
| `↑` `↓` / `j` `k` | 移动光标 |
| `Enter` / `→` | 进入目录 |
| `←` / `⌫` | 返回上级 |
| `空格` | 选择或取消选择 |
| `a` | 全选当前列表 |
| `u` | 上传文件或目录 |
| `d` | 下载选中项，没有选中时下载当前项 |
| `x` / `Delete` | 删除，目录会递归删除 |
| `p` | 生成预签名 URL |
| `/` | 过滤当前列表 |
| `r` | 刷新 |
| `c` | 清除已结束的传输记录 |
| `Ctrl-C` | 传输中取消所有任务；空闲时退出 |
| `q` | 退出 |

### 上传

按 `u`，输入本地路径。支持 `~/` 和相对路径；输入目录会递归上传，并保留相对目录结构。符号链接会被跳过。单次最多加入 2000 个文件。

小于 `S3_MULTIPART_THRESHOLD_MB` 的文件走一次 PUT，更大的文件自动分片：分片并发上传、单独重试，取消或失败时清理未完成的分片。

### 下载

按 `d`，确认目标路径后开始下载。默认保存到 `S3_DOWNLOAD_DIR`，并保留对象 key 的子目录结构；目标文件已存在时自动追加 ` (1)`，不会静默覆盖。

目录不能直接下载，请进入目录后选择文件。

### 删除

按 `x` 删除选中项或当前项。删除目录时会列出前缀下所有对象并递归删除，确认框会显示对象数量。批量删除每 1000 个对象一组。

### 预签名 URL

在文件上按 `p`：

- `1` `2` `3` `4`：切换 15 分钟 / 1 小时 / 24 小时 / 7 天
- `m`：切换 GET / PUT
- `r`：重新生成
- `c`：复制到剪贴板
- `w`：保存到当前目录的 `presigned-url.txt`

复制优先使用 Termux 的 `termux-clipboard-set`（需要安装 termux-api），其他终端使用 OSC 52。终端不支持 OSC 52 时，用 `w` 保存后再取用。

## 排错

| 现象 | 处理 |
| --- | --- |
| `SignatureDoesNotMatch` | 检查 Secret Key 是否有多余空白；确认 path style 与区域，R2 的区域填 `auto` |
| `AccessDenied` | 凭证缺少 ListBucket / GetObject / PutObject / DeleteObject 权限 |
| `NoSuchBucket` 或 404 | 桶名、区域或端点不对，注意 MinIO 是否需要 `http://` |
| `NotImplemented` 或校验错误 | 服务端不支持某个 S3 特性，先确认端点和兼容性 |
| 请求超时或 `ECONNREFUSED` | 检查网络、DNS 和防火墙；内网地址需能直连 |
| 无法复制预签名 URL | 终端不支持 OSC 52；在 Termux 安装 termux-api，或按 `w` 保存 |
| 大量文件上传很慢 | 适当调大 `S3_CONCURRENCY`，并确认网络带宽 |

调试时可设置 `S3_TUI_DEBUG=true`，日志会写入 `S3_TUI_LOG`（默认 `./s3-tui.log`），不会打断界面。

## 开发

```bash
pnpm typecheck   # 类型检查
pnpm test        # 单元测试 + 本地 mock S3 端到端测试
pnpm build       # 输出到 dist/
```

测试里的 mock S3 覆盖了列表、单次上传、分片上传、下载、批量删除和预签名 URL 生成，不依赖外部服务。

已知限制：

- 不支持直接下载目录
- 不支持断点续传已中断的上传；中断时会清理分片
- 不创建/删除桶，只管理桶内对象

## License

[MIT](LICENSE)