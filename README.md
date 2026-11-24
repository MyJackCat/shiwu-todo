# 事务待办

[![CI](https://github.com/MyJackCat/shiwu-todo/actions/workflows/ci.yml/badge.svg)](https://github.com/MyJackCat/shiwu-todo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

自托管的待办 + 定时提醒系统：手机、电脑、安卓主屏小组件、Windows 桌面小组件实时同步，到点在自己的服务器和每个客户端上提醒。

- **事务待办**：没有时间的普通待办
- **定时提醒**：指定时间/时间段的提醒，支持每天、工作日、每周、每月重复，支持提前提醒
- **四种入口**：PWA 网页、Windows 桌面端（Electron）、安卓 App、桌面/手机桌面小组件
- **数据自持**：Node.js + SQLite，部署在自己的电脑或 NAS 上

## 架构

```
     手机浏览器 / PWA ─────┐
                           │
     Windows 桌面端 ────────┼── HTTP + SSE ──> 同步服务（Node + SQLite）
      （主窗口 + 小组件）    │                   ├─ 账号 / JWT
                           │                   ├─ 增量同步（seq）
     安卓 App（WebView +    │                   ├─ 提醒调度（15 秒扫描）
       原生小组件/闹钟）──────┘                   └─ Web Push + SSE
```

- 服务端是唯一数据源，任务有单调递增的 `seq`，客户端用 `GET /api/changes?since=` 增量拉取
- 桌面端/网页保持 SSE 长连接，任何一端改动会即时推给其他端
- 离线改动进入本地 outbox，联网后按顺序补发；冲突以服务器最后写入为准
- 提醒到点由服务端统一判定（每 15 秒），同时各客户端也有本地定时器/原生闹钟作为第二重保障

## 目录

```
server/   同步服务（Node 24 + 内置 SQLite + Express + Web Push）
web/      React + Vite 的 PWA（手机和电脑共用同一套界面）
desktop/  Electron 桌面端：主窗口、桌面小组件、托盘、开机自启、系统通知
android/  安卓原生外壳：WebView + 主屏小组件 + AlarmManager 闹钟通知
tools/    图标生成脚本
```

## 快速开始

前置：Node.js 24+（使用了内置 `node:sqlite`）。安卓构建另需 JDK 17+、Android SDK 36。

```bash
npm install
npm run build      # 构建网页（服务端会直接托管 web/dist）
npm start          # 启动同步服务，默认 http://localhost:8787
```

> 国内网络下载 Electron 很慢时，先设置镜像再安装（只影响当前终端）：
>
> ```powershell
> $env:ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"
> npm install
> ```
>
> npm 12 执行脚本时会打印 `npm notice run ...`，这是正常的执行提示，不是错误；不想要可以加 `--silent`，例如 `npm start --silent`。

1. 打开 `http://localhost:8787`，创建一个账号（邮箱 + 密码，数据只存在你的服务器）
2. 手机连接同一 Wi-Fi，访问服务启动时打印的局域网地址，例如 `http://192.168.1.10:8787`
3. 浏览器里「添加到主屏幕」即可当 App 使用
4. 电脑端运行 `npm run desktop`，托盘会出现图标，并显示常驻的桌面小组件

> 服务端需常驻运行，提醒才会在后台按时触发。可参考文末「常驻运行」。

### Windows 桌面端

```bash
npm run desktop
```

- 主窗口关闭后不会退出，会留在系统托盘继续提醒
- 到点会在屏幕右下角弹出置顶提醒卡片，带「完成」「稍后 10 分钟」「打开」按钮
- 小组件展开时是 348×486 的完整卡片，右上角有「收起」和「关闭」；收起后变成 176×176 的桌面宠物
- 点击桌宠（或聚焦后按 Enter）展开；收起状态会被记住，两种状态都不支持拉伸
- 关闭按钮只是隐藏小组件，不退出程序，到点提醒仍会继续；可在托盘菜单「显示桌面小组件」重新打开，托盘「退出」才是完全退出
- 小组件左上角有拖动点；按住标题栏、桌宠或空白处即可拖动，尺寸不会被拖大，按钮/输入框/列表仍可正常点击滚动
- 头部「提醒」按钮直接打开主窗口的定时提醒编辑器；底部输入框添加普通事务
- 主窗口登录后，已经在运行的小组件会自动恢复登录态并同步待办，不需要重启桌面端
- 桌面小组件默认置顶，可在设置里关闭置顶、隐藏小组件、开启开机自启
- 小组件直接勾选即可完成任务，标题可点开主窗口编辑

> 桌面端加载的是本地 `web/dist`。修改网页代码后需要重新 `npm run build`。

### 安卓

用 Android Studio 打开 `android/` 目录，或者命令行构建：

```bash
cd android
# Windows
gradlew.bat assembleDebug
# macOS / Linux
./gradlew assembleDebug
```

APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk`

APK 只有约 900KB，因为它不打包 Chromium：界面复用手机系统自带的 WebView，原生层负责主屏小组件、精确闹钟、通知动作和后台同步。它不是完整浏览器，只是用系统 WebView 承载网页界面。

小组件顶部有「添加」「提醒」两个按钮，点按会直接打开对应的新建窗口；底部「刷新」会立即从服务器拉一次数据。

首次安装：

1. 打开 App，填写服务器地址（真机填电脑局域网 IP，例如 `http://192.168.1.10:8787`）
2. 允许通知权限（Android 13+）
3. 允许「闹钟和提醒」精确闹钟权限，并把 App 加入电池优化白名单，避免提醒被系统延迟
4. 在网页里登录后，主屏小组件会自动拿到数据
5. 长按桌面 → 小组件 → 找到「事务待办」，拖到桌面即可

安卓端提醒完全由原生 `AlarmManager` 负责：即使 App 没打开，只要手机活着并且闹钟已排好，就会弹系统通知。App 打开时会通过 JS 桥把未来 7 天的提醒交给原生层；后台每 15 分钟还会同步一次服务器数据并重新排闹钟。

调试包可以个人直接安装使用；如果要上架应用商店，需要自己配置签名，并注意 `USE_EXACT_ALARM` 权限的政策限制。

### 手机后台推送（可选）

局域网 `http://` 页面不是安全上下文，浏览器不允许注册 Service Worker 和 Web Push，因此：

- 用安卓 App：靠原生闹钟，最可靠，不需要 HTTPS
- 用手机浏览器/PWA：页面打开时能收到站内提醒；需要锁屏也在浏览器里收到时，请给服务器配 HTTPS

HTTPS 推荐方式：Tailscale、Cloudflare Tunnel，或用 Nginx/Caddy 反代并配证书。服务地址变成 `https://你的域名` 后，在网页「设置 → 浏览器后台推送」里开启即可。VAPID 密钥会自动生成在 `server/data/vapid.json`。

## 外网访问（内网穿透）

本项目所有客户端都支持填公网地址，服务本身不需要改代码。选方案时重点看三件事：**HTTPS、固定域名、是否支持 SSE**。手机浏览器要用 PWA 后台推送，必须有一个**稳定的 HTTPS 地址**；临时 URL 每次变化会导致登录状态和推送订阅失效。

| 方案 | 免费额度 | 固定 URL | HTTPS | SSE 实时同步 | 适合场景 |
| --- | --- | --- | --- | --- | --- |
| **Tailscale Funnel** | Personal 免费（最多 6 用户） | 固定 `*.ts.net` | 有 | 支持 | **推荐长期自用，不需要买域名** |
| Tailscale Serve | 同上 | 固定 `*.ts.net` | 有 | 支持 | 只在自己的设备间访问，不暴露公网 |
| cpolar | 1Mbps、随机 URL、4 条隧道、1 个进程 | 免费版否 | 视套餐/分配 | 支持 | 国内速度优先、临时或轻量使用 |
| Cloudflare Tunnel（命名隧道） | 隧道免费，但要有自己的域名 | 固定自有域名 | 有 | 支持 | 已有域名、追求稳定 |
| Cloudflare Quick Tunnel | 免费、免账号 | 否，每次启动都变 | 有 | **不支持** | 只适合临时演示；本项目会退化为 60 秒轮询 |
| ngrok | 3 个端点、开发域名、$5 额度 | 开发域名 | 有 | 支持 | 临时调试；免费版有欢迎页，不适合 PWA |
| frp + VPS | 软件免费，服务器收费 | 自己定 | 自己配 | 支持 | 已有公网 VPS 的长期方案 |

> 国内的 natapp、花生壳等也是同类工具，免费版通常随机域名、限速、需要实名，适合临时使用；长期固定地址一般要付费。

### 推荐：Tailscale Funnel（免费 + 固定 HTTPS）

只需要在运行服务的电脑上装 Tailscale，手机和其他访问者不用装。

1. 安装 Windows 客户端：<https://tailscale.com/download/windows>
2. 登录（浏览器会弹出授权）：

   ```powershell
   tailscale up
   ```

3. 打开 <https://login.tailscale.com/admin/dns>，开启 **MagicDNS** 和 **HTTPS Certificates**。
4. 以管理员身份打开 PowerShell，把本地 8787 发布到公网：

   ```powershell
   tailscale funnel --bg 8787
   tailscale funnel status
   ```

会得到一个类似下面的地址，任何设备都能直接访问：

```text
https://你的机器名.你的tailnet.ts.net/
```

把这个地址填到电脑端设置、安卓 App 的服务器地址里即可。手机浏览器用它打开后，PWA 推送也能正常工作。

- 停止发布：`tailscale funnel reset`
- Funnel 目前是 beta，有非可配置的带宽限制，但对这个待办应用足够
- Funnel 只支持 443/8443/10000 端口，8787 会自动映射到 443
- Funnel 是**公网可访问**的，记得注册完账号后关闭注册（见下面的安全设置）
- Tailscale 的协调服务器在部分国内网络环境下可能不稳定；如果登录或连接困难，改用 cpolar

如果只想让自己的设备访问，不暴露给公网，用 **Tailscale Serve** 更安全：

```powershell
tailscale serve --bg 8787
```

手机、电脑都安装并登录同一个 Tailscale 账号，访问同一个 `https://机器名.tailnet.ts.net/` 即可。

### 国内速度优先：cpolar 免费版

1. 注册并下载 Windows 客户端：<https://www.cpolar.com/download>
2. 在后台复制 authtoken，执行：

   ```powershell
   cpolar authtoken 你的token
   cpolar http 8787
   ```

会得到一个随机公网地址。免费版是 1Mbps、随机 URL、每个进程 4 条隧道、1 个在线进程，流量不限，日常待办同步足够。

注意：免费版是随机地址，重启后可能变化。要固定子域名需要基础版（官网标价 ¥99/年，可保留 3 个子域名）；如果要在手机浏览器长期使用 PWA 推送，建议用固定地址。

### 临时测试：Cloudflare Quick Tunnel

无需账号，但**每次启动 URL 都会变，而且官方明确不支持 SSE**：

```powershell
cloudflared tunnel --url http://localhost:8787
```

本项目在 SSE 不可用时会用 60 秒轮询兜底，登录、增删改查和本地提醒仍然可用，但跨端实时性会变差，PWA 推送也会因为地址变化而失效。只建议用来快速验证外网能不能打开。

有域名的话，Cloudflare **命名隧道**是更稳定的选择（隧道本身免费，域名需要自己的）：先 `cloudflared tunnel login`，创建隧道并把域名 CNAME 到隧道，再 `cloudflared tunnel run`。具体可参考 [Cloudflare Tunnel 文档](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)。

### 公网访问时的安全设置

1. **先在局域网注册好账号**，然后关闭注册，重启服务：

   ```powershell
   $env:ALLOW_REGISTER="0"
   npm start
   ```

2. 如果只通过隧道访问，不希望局域网其他人直接连 8787，可以只监听本机：

   ```powershell
   $env:HOST="127.0.0.1"
   npm start
   ```

   隧道客户端连 `localhost:8787` 不受影响，但手机就不能再用局域网 IP 直连了。

3. 用强密码；不要直接把 8787 端口映射到路由器公网。
4. 更换公网地址后，需要在电脑端/安卓端更新服务器地址；PWA 也要重新登录并重新开启推送（浏览器按域名隔离数据）。
5. 服务端和隧道客户端都要保持运行；Tailscale 会作为系统服务常驻，cpolar/cloudflared 可配置成开机启动。

## 提醒机制细节

- 服务端每 15 秒扫描一次到期提醒，每次到点只通知一次；服务重启后最多补发 6 小时内错过的提醒
- 重复提醒（每天/工作日/每周/每月）在时间过去后自动滚动到下一次；「完成」重复提醒也会直接排到下一次
- 提前提醒会在设定时间前触发；提前通知后，到点不会再重复通知，但重复规则仍会正常滚动
- 客户端用 `taskId:提醒时刻` 去重，服务端 SSE 和本地定时器同时触发也只弹一次
- 安卓端通知带「完成」「稍后 10 分钟」两个动作；「完成」会直接调用服务器 API 并刷新小组件

## 配置

服务端环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 端口 |
| `HOST` | `0.0.0.0` | 监听地址（仅本机可设 `127.0.0.1`） |
| `DATA_DIR` | `server/data` | 数据目录（数据库、密钥、VAPID） |
| `DB_FILE` | `$DATA_DIR/todo.db` | SQLite 文件路径 |
| `JWT_SECRET` | 自动生成 | 不设置则持久化在 `$DATA_DIR/secret.key` |
| `ALLOW_REGISTER` | 开启 | 设为 `0` 可关闭新账号注册 |
| `WEB_DIST` | `web/dist` | 网页静态目录 |

常用命令：

```bash
npm test           # 服务端 13 个单元/接口测试
npm run typecheck  # 服务端 + 网页类型检查
npm run build      # 构建网页
npm run icons      # 重新生成各端图标
```

备份：停止服务后复制 `server/data/` 整个目录即可（SQLite 有 WAL 文件，运行中直接复制可能不一致）。`server/data/` 包含数据库、JWT 密钥和 VAPID 密钥，已经被 `.gitignore` 忽略，不要把里面的文件提交到仓库。

安全提醒：服务默认监听局域网。不要在路由器上直接把 8787 端口映射到公网；远程访问建议用 Tailscale 或带认证的反向代理。注册完成后可设 `ALLOW_REGISTER=0` 防止别人注册。

## 常驻运行

- **Windows 桌面端**：设置里打开「开机自启」
- **同步服务**：用 Windows 任务计划程序、NSSM 或 `pm2` 把 `npm start` 注册为开机启动服务
- **安卓**：允许通知、精确闹钟，关闭电池优化；部分国产系统还需要在「自启动管理」里放行

## API 摘要

所有接口以 `/api` 开头，除注册/登录/健康检查外都需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` | 注册，返回 token + user |
| POST | `/auth/login` | 登录 |
| GET | `/me` | 当前用户 |
| GET | `/changes?since=N` | 增量拉取任务（含软删除），返回 `serverSeq` |
| POST | `/tasks` | 新建（客户端可自带 UUID，重试幂等） |
| PATCH | `/tasks/:id` | 修改 |
| POST | `/tasks/:id/complete` | `{done:true/false}`，重复提醒会滚动 |
| DELETE | `/tasks/:id` | 软删除 |
| GET | `/events?token=` | SSE：`change` / `reminder` / `ready` |
| GET | `/push/key` | Web Push 公钥 |
| POST | `/push/subscribe` | 保存浏览器推送订阅 |

## 已验证

- 服务端：13 个测试全部通过（认证、任务生命周期、增量同步、重复规则、提前提醒、重复滚动、错过后补发/跳过）
- 网页：桌面与窄屏布局、登录、增删改查、SSE 实时提醒条
- Electron：主窗口、桌面小组件（浅色/深色）、收起为桌宠/展开/关闭、右下角提醒弹窗、跨窗口登录同步与拖拽实际验证
- 安卓（API 36 模拟器）：安装、WebView 登录、主屏小组件渲染、「添加/提醒」按钮拉起应用、后台精确闹钟、系统通知、「完成」动作回写服务器

安卓小组件可以用调试包里的预览页直接查看：

```bash
adb shell am start -n com.shiwu.todo/.WidgetPreviewActivity
```

## 已知限制

- 没有 iOS 原生客户端；iOS 上只能用 PWA，后台提醒受 Safari 限制
- 桌面端目前通过 `npm run desktop` 运行，没有打包成 exe 安装包
- 安卓与 Electron 的桌面小组件刷新依赖系统调度，空闲时可能滞后（安卓后台同步周期 15 分钟）
- 重复提醒按服务器本地时区滚动；跨时区使用时请让服务器与手机保持同一时区
- 多人共用同一账号时没有冲突合并，采用服务器最后写入为准

## License

本项目使用 [MIT License](LICENSE) 开源。© 2026 MyJackCat

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交前建议先运行：

```bash
npm test
npm run typecheck
```

CI 会在推送到 `main` 或提交 PR 时自动运行服务端测试、类型检查和网页构建。
