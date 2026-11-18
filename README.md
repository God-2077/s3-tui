# s3-tui

在终端里浏览和管理 S3 及 S3 兼容对象存储：列目录、上传/下载（文件与目录，大文件自动分片）、新建文件夹、重命名/移动、删除、生成预签名 URL，上传和下载都有实时进度条。

适合在 Termux、服务器或任何带终端的环境里快速操作 MinIO、Cloudflare R2、AWS S3 等存储。

## 功能

- 像文件管理器一样按目录浏览，支持前缀、分页、过滤和多选
- 上传文件或整个目录（递归）：按 `u` 打开本地文件浏览器多选，也可直接输入路径；`~/photos` 保留文件夹名，`~/photos/` 只上传内容；超过阈值自动走分片上传
- 下载对象或整个目录，支持多文件并发和单文件多线程分段下载，进度、速度、ETA 实时显示；保留 key 的子目录结构
- 重命名/移动文件或目录（先复制再删除源对象），新建多级文件夹
- 删除单个对象或递归删除目录，删除前确认
- 生成 GET / PUT 预签名 URL，支持 15 分钟到 7 天有效期；public 模式的公开 GET 直链不显示有效期
- 上传/下载可随时取消，失败或取消时会清理未完成的分片和半成品文件
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
| `S3_UPLOAD_CONCURRENCY` | `2` | 同时上传的文件数（1-16） |
| `S3_DOWNLOAD_CONCURRENCY` | `2` | 同时下载的文件数（1-16） |
| `S3_DOWNLOAD_THREADS` | `4` | 单个下载文件的分段线程数（1-16） |
| `S3_DOWNLOAD_PART_SIZE_MB` | `8` | 下载分段大小（MiB，1-5120） |
| `S3_CONCURRENCY` | `4` | 单个文件的分片上传与目录移动的并发数（1-16） |
| `S3_PART_SIZE_MB` | `8` | 上传分片大小，最小 5 MiB，最大 5120 MiB |
| `S3_MULTIPART_THRESHOLD_MB` | `8` | 超过多少 MiB 改用分片上传，最低按 5 MiB 处理 |

上传和下载分别按各自的文件级并发上限排队，两类任务可以同时进行。单个上传文件内部按 `S3_CONCURRENCY` 并发上传分片；单个下载文件大于分段大小时按 `S3_DOWNLOAD_THREADS` 并发下载分段。

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

设置 `S3_ACCELERATE_HOST` 后，列表、删除、复制、新建文件夹等管理操作仍走主端点，上传、下载和预签名走加速地址。只填域名（可带端口），不要带路径或查询参数；省略协议时按 `https` 处理。

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
- public 模式下上传、列表、删除、复制、新建文件夹等管理操作仍走主端点（签名操作），只有展示与下载走加速域；下载会直接请求公开直链，相当于让 CDN 加速。
- 直链没有签名、没有有效期；按 `p` 查看公开 GET 直链时，界面会隐藏有效期设置。按 `m` 切到 PUT 时仍使用主端点签名 URL，有效期重新显示。
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
| `u` | 上传：打开本地文件浏览器，可多选当前目录的文件/目录；浏览器内按 `p` 改输路径 |
| `d` | 下载选中项，没有选中时下载当前项；目录会递归下载，多个任务按下载并发数执行 |
| `m` | 重命名/移动当前项（输入完整 key） |
| `n` | 新建文件夹，支持多级路径 |
| `x` / `Delete` | 删除，目录会递归删除 |
| `p` | 生成预签名 URL |
| `/` | 过滤当前列表 |
| `r` | 刷新 |
| `c` | 清除已结束的传输记录 |
| `Ctrl-C` | 传输中取消所有任务；空闲时退出 |
| `q` | 退出 |

### 上传

按 `u` 打开本地文件浏览器，从当前工作目录开始：

- `↑`/`↓` 或 `j`/`k` 移动，`PgUp`/`PgDn`、`g`/`G` 翻页或跳到首尾。
- `Enter`、`→` 或 `l` 进入目录；`←`、`h` 或 `⌫` 返回上级；`~` 跳到用户主目录。
- `空格` 选择/取消选择当前项，`a` 全选或清空；`u` 上传选中项，没有选中时上传当前项。
- `p` 改为手动输入路径；`r` 刷新；`.` 显示或隐藏点文件；`Esc` 关闭。

浏览器只多选当前目录内的条目，进入其他目录、刷新或切换隐藏项后会清空选择。文件上传到当前前缀下的同名 key；目录会保留目录名并递归上传其中的文件。想只上传目录内容，可以进入该目录后选择里面的文件和子目录，或按 `p` 使用手动路径。

手动路径支持 `~/` 和相对路径；目录名是否保留取决于输入是否以分隔符结尾：

- `~/photos`：上传到当前前缀下的 `photos/`，保留文件夹名。
- `~/photos/`：只上传目录内容，不再多套一层 `photos/`。Windows 上也支持末尾反斜杠。

浏览器和手动路径都会跳过符号链接；空目录不会生成占位对象，需要保留空目录时按 `n` 手动创建。单次最多加入 2000 个文件，超出会截断并提示。

小于 `S3_MULTIPART_THRESHOLD_MB` 的文件走一次 PUT，更大的文件自动分片：分片并发上传、单独重试，取消或失败时清理未完成的分片。多个上传文件按 `S3_UPLOAD_CONCURRENCY` 并发。

### 下载

按 `d`，确认目标路径后开始下载。默认保存到 `S3_DOWNLOAD_DIR`，并保留对象 key 的子目录结构；目标文件已存在时自动追加 ` (1)`，同一批或连续入队的下载目标也会预留路径，不会静默覆盖或互相覆盖。

下载支持两级并发：同时下载 `S3_DOWNLOAD_CONCURRENCY` 个文件（默认 2）；单个文件大于 `S3_DOWNLOAD_PART_SIZE_MB`（默认 8 MiB）时，再按 `S3_DOWNLOAD_THREADS`（默认 4）发起 Range 分段并发。小文件或线程数为 1 时使用单流下载。服务端不支持 Range，或返回的总大小与列表不一致时，会自动清理分段文件并回退单流。进度条中的“分段 x/y”表示已完成的 Range 段数。

下载单个目录时会先询问保存目录；多选或目录与文件混合时，直接下载到 `S3_DOWNLOAD_DIR`。目录会递归枚举后加入队列，key 以 `/` 结尾的占位对象只会在本地创建空目录。取消下载会关闭文件并删除半成品。

### 重命名 / 移动

在文件或目录上按 `m`，输入完整的对象 key 后确认，可只改最后一段，也可跨目录移动。目录只能移动到自身之外的位置。

- 文件：复制到新 key，成功后删除源对象；目标已存在时会要求确认覆盖。
- 目录：先列出前缀下所有对象，确认框中显示对象数量，再并发复制；复制成功的对象随后批量删除源，复制失败的对象保留源对象。
- 对象管理操作（列表、复制、删除、新建）始终使用主端点，不走加速域。

已知限制：单次 CopyObject 最大 5 GB；目录移动不是原子操作，过程中可能同时存在新旧两份对象。如果目录里连占位对象都没有，则没有对象可移动，需要用 `n` 在新位置创建。

### 新建文件夹

按 `n`，输入相对于当前前缀的文件夹名，支持多级路径（例如 `2024/照片`）。程序会创建一个以 `/` 结尾的零字节占位对象，列表随即显示该目录。S3 没有真正的目录，删除这个占位对象后目录就会消失。

### 删除

按 `x` 删除选中项或当前项。删除目录时会列出前缀下所有对象并递归删除，确认框会显示对象数量。批量删除每 1000 个对象一组。

### 预签名 URL

在文件上按 `p`：

- `1` `2` `3` `4`：切换 15 分钟 / 1 小时 / 24 小时 / 7 天；public 模式的公开 GET 直链下隐藏
- `m`：切换 GET / PUT；public 模式下切到 PUT 会恢复有效期
- `r`：重新生成
- `c`：复制到剪贴板
- `w`：保存到当前目录的 `presigned-url.txt`

复制优先使用 Termux 的 `termux-clipboard-set`（需要安装 termux-api），其他终端使用 OSC 52。终端不支持 OSC 52 时，用 `w` 保存后再取用。

## 排错

| 现象 | 处理 |
| --- | --- |
| `SignatureDoesNotMatch` | 检查 Secret Key 是否有多余空白；确认 path style 与区域，R2 的区域填 `auto` |
| `AccessDenied` | 凭证缺少 ListBucket / GetObject / PutObject / CopyObject / DeleteObject 权限 |
| `NoSuchBucket` 或 404 | 桶名、区域或端点不对，注意 MinIO 是否需要 `http://` |
| `NotImplemented` 或校验错误 | 服务端不支持某个 S3 特性，先确认端点和兼容性 |
| 请求超时或 `ECONNREFUSED` | 检查网络、DNS 和防火墙；内网地址需能直连 |
| 无法复制预签名 URL | 终端不支持 OSC 52；在 Termux 安装 termux-api，或按 `w` 保存 |
| 大量文件上传很慢 | 适当调大 `S3_UPLOAD_CONCURRENCY`（文件级）和 `S3_CONCURRENCY`（分片级），并确认网络带宽 |
| 大量文件下载很慢 | 适当调大 `S3_DOWNLOAD_CONCURRENCY`（文件级）或 `S3_DOWNLOAD_THREADS`（分段级）；被服务端限流时调小 |
| 下载没有出现“分段”或速度上不去 | 文件可能小于 `S3_DOWNLOAD_PART_SIZE_MB`，或服务端不支持 Range；程序会自动回退单流 |

调试时可设置 `S3_TUI_DEBUG=true`，日志会写入 `S3_TUI_LOG`（默认 `./s3-tui.log`），不会打断界面。

## 开发

```bash
pnpm typecheck   # 类型检查
pnpm test        # 单元测试 + 本地 mock S3 端到端测试
pnpm build       # 输出到 dist/
```

测试里的 mock S3 覆盖了列表、单次上传、分片上传、单流与 Range 分段下载、复制、HEAD、批量删除和预签名 URL 生成，不依赖外部服务。

已知限制：

- 单个对象复制（重命名/移动）上限为 5 GB；目录移动不是原子操作
- S3 没有真正的目录，空目录依靠以 `/` 结尾的零字节占位对象表示
- 不支持批量重命名/移动，`m` 只作用于当前项
- 不支持断点续传已中断的上传或下载；中断时会清理分片/半成品
- 下载分段依赖服务端 Range 支持；不支持时自动回退单流，此时无法按分段加速
- 本地浏览器只多选当前目录，不支持跨目录累积选择
- 不创建/删除桶，只管理桶内对象

## License

[MIT](LICENSE)