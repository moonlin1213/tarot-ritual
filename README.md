# ARCANUM · 星轨塔罗圣仪

**简体中文** | [English](README.en.md)

一个在本机运行的三维塔罗应用：星尘舞台、程序化粒子牌面、洗牌与翻牌动画，以及可选的 AI 流式解读。

支持 **Windows、macOS、Linux**。不需要构建前端，也不需要把密钥放进源码。

## 功能

- 78 张韦特体系牌卡，内置中文正逆位释义与牌面意象。
- 五种牌阵：每日一牌、时间之流、双子连桥、马蹄铁阵、凯尔特十字。
- 根据中文问题关键词推荐牌阵，也可自行选择。
- Three.js 三维洗牌、扇形选牌、飞牌、翻转、拖动画布与牌义详情。
- OpenAI 兼容 Chat Completions、Responses、Anthropic Messages 三种协议。
- 实拍牌面识别：本地缩放图片后发给所选视觉模型，支持手工校正牌名与正逆位。
- 可选 DSH 只读导入；默认关闭，不附带任何账户配置。

塔罗和 AI 输出仅供娱乐与自我反思，不构成事实预测，也不能替代医疗、法律或财务专业意见。传统释义与占星对应存在不同流派；本项目采用其中一套约定。

## 快速开始

安装 **Node.js 24 LTS（24.5 或更新）** 和 Git。浏览器需要支持 WebGL 2，建议使用近期版本的 Edge、Chrome、Firefox 或 Safari。

在 PowerShell、CMD、Terminal 或其他终端中运行：

```sh
git clone https://github.com/moonlin1213/tarot-ritual.git
cd tarot-ritual
npm ci --ignore-scripts
npm start
```

打开 **http://127.0.0.1:8642**。关闭终端或按 `Ctrl+C` 停止服务。也可从 GitHub 下载 ZIP，解压后在项目目录运行最后两条命令。

首次进入可以直接抽牌并查看内置牌义。要生成 AI 解读，打开右上角「神谕未连」，填写自己的服务名称、协议、Base URL 和 API Key。应用会尝试探测模型；若服务不提供模型列表，可在设置中手动填写模型 ID。

自定义密钥只保留在当前页面内存中，刷新或关闭页面后需重新填写。

### Windows 注意事项

- 启动与测试命令不依赖 Bash、WSL、`export` 或 Unix 环境变量前缀，支持 CMD 和 PowerShell。
- 如果 PowerShell 报 `npm.ps1` 不允许运行脚本，请使用 `npm.cmd ci --ignore-scripts`、`npm.cmd start`。不需要修改系统执行策略。
- 支持含中文和空格的项目目录。Node.js 服务按脚本位置定位静态资源。
- 使用 `127.0.0.1` 地址；本服务不会监听局域网，不需要开放公网防火墙端口。

## AI 服务配置

| 协议 | Base URL 示例 | 应用追加的路径 |
| --- | --- | --- |
| OpenAI 兼容 | `https://api.example.com/v1` | `/chat/completions`、`/models` |
| Responses | `https://api.example.com/v1` | `/responses`、`/models` |
| Anthropic | `https://api.anthropic.com` 或以 `/v1` 结尾的兼容地址 | `/v1/messages`、`/v1/models`，不会重复追加 `/v1` |

远程地址必须使用 HTTPS；本机网关允许 `http://127.0.0.1:端口`。不要在 URL 中嵌入密钥、用户名、密码或查询参数。服务不会自动跟随上游重定向；请填写最终地址。兼容网关与第三方 OAuth 的可用模型、费用、条款和接口行为由服务提供方决定。

模型必须支持所选协议。照片识别还需要视觉能力；自动探测到模型名称不代表该模型支持图片。

### 可选：DSH 导入

仅在你明确需要复用 DSH 配置时启动：

```sh
npm run start:dsh
```

默认目录由操作系统的用户主目录决定：Windows 通常为 `%USERPROFILE%\.dsh`，macOS/Linux 为 `~/.dsh`。服务读取 `settings.yaml`、`.credentials.yaml`、`.everything-oauth.json`，不写回文件；只向浏览器返回服务与模型元数据，不返回 API Key、访问令牌或刷新令牌。

OAuth 访问令牌过期时，在 DSH 中刷新或重新登录，再重试。此项目不自行刷新、不旋转刷新令牌、不创建 OAuth 登录。某些 OAuth 服务不开放模型列表，需要手动填写可用模型 ID。DSH 文件格式属于外部兼容接口，后续变更可能需要调整适配。

如需更改端口或 DSH 目录：

PowerShell：

```powershell
$env:PORT = "8643"
$env:TAROT_DSH_DIR = Join-Path $env:USERPROFILE ".dsh"
npm run start:dsh
```

CMD：

```bat
set "PORT=8643"
set "TAROT_DSH_DIR=%USERPROFILE%\.dsh"
npm run start:dsh
```

macOS/Linux：

```sh
PORT=8643 TAROT_DSH_DIR="$HOME/.dsh" npm run start:dsh
```

`TAROT_DSH_IMPORT=1` 也可以直接开启导入。默认 `npm start` 不主动读取 DSH，除非你已在环境中设置该变量。项目不自动加载 `.env` 文件。

### 代理

启动脚本通过 Node.js 的 `--use-env-proxy` 使用已有的 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 配置。需要代理时请自行配置；源码没有个人代理地址。使用本机 AI 网关时，建议将 `127.0.0.1,localhost,::1` 加入 `NO_PROXY`，避免本机请求被外部代理转发。参见 [Node.js 代理配置](https://nodejs.org/api/cli.html#--use-env-proxy)。

## 隐私边界

- 静态页面、字体和 Three.js 均在本机加载，没有分析统计、遥测或远程 CDN。
- 抽牌和内置牌义不需要 AI。点击 AI 解读时，**问题、牌阵、抽牌结果与提示词会发送至所选 AI 服务**。
- 选择照片后会立即调用所选视觉模型进行识别。照片先在本页通过 Canvas 缩放、重新编码成 JPEG；请仍然检查照片可见内容，避免人脸、证件或其他不愿分享的信息。
- API Key / OAuth 访问令牌会作为所选服务的认证信息发送出去，因此「本地运行」不等于「数据永不出网」。上游保留政策以服务提供方为准。
- 自定义 provider 和密钥仅保存在页面内存；旧版 localStorage 中的自定义密钥会在启动时清除。浏览器只持久保存选中服务 ID 和模型偏好。
- 服务不保存问题、照片、解读或请求日志。复制解读会写入系统剪贴板；浏览器扩展、本机其他程序和操作系统仍属于你的信任边界。
- 服务仅绑定 `127.0.0.1`，检查 Host、Origin 和请求标记，拒绝跨站访问与路径越界。

**不要将这个本地凭据代理部署为公网服务，也不要用隧道或反向代理公开端口。** 开源的是代码；这不是带有多人账户权限体系的托管产品。

## 开发与验证

```sh
npm run check
npm test
npm audit --omit=dev
```

测试使用临时目录、虚构密钥和本机模拟上游，不读取真实 DSH，也不调用付费模型。GitHub Actions 在 Windows、macOS、Linux 上验证 Node.js 24 和 26。测试覆盖静态文件隔离、请求来源、密钥存储、模型探测、流式协议、重复解读与中文路径启动。

## 目录

```text
server.mjs          本地静态服务、只读 DSH 导入、多协议流式代理
public/index.html   页面骨架
public/css/         视觉样式
public/data/        唯一牌库与牌阵数据源
public/js/core.js   模块统一导出
public/js/ai.js     服务状态与流式客户端
public/js/reading.js 提示词与安全文本渲染
public/js/main.js   交互编排与实拍流程
public/js/art/      Canvas 粒子牌面
public/js/three/    三维舞台与卡牌动画
public/fonts/      本地字体及 OFL 许可证
public/vendor/     Three.js 及 MIT 许可证
scripts/           跨平台启动与语法检查
test/              隔离回归测试
```

## 许可

项目代码沿用原有的 [ISC 许可](LICENSE)。Three.js 使用 MIT 许可，Cinzel 与 Cormorant Garamond 字体使用 SIL OFL 1.1，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。程序化牌面是对传统意象的抽象表达，不包含商业塔罗牌扫描图。
