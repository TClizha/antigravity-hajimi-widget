# 🐾 Antigravity 哈基米挂件与额度监控系统 (V2.3)

> **Antigravity Hajimi Companion & Quota Monitor**  
> 专为 **Google Antigravity** 打造的原生页面内伴生挂件、实时模型配额监控与智能 Token 记账系统。  
> 交互与视觉体验致敬 DeepSeek Harness 小鲸鱼余额挂件（[`MeteorNOX/DeepSeek-Balance-Whale-Widget`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)）。

[![Version](https://img.shields.io/badge/version-2.3.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](README.md)

---

## ✨ 核心特性

- 🐾 **原生哈基米伴生形象**：
  - 内置 Google Gemini 衍生同人形象「哈基米」（`assets/gemini.png`），支持 Q 弹物理按压、果冻回弹与抚摸音画互动。
  - 在 Antigravity 主界面内自由拖拽漫游，松手自动边缘磁性吸附，靠近左侧边缘自动平滑水平镜像翻转。
- 📊 **智能合并与多维度额度监控**：
  - **三合一紧凑卡片**：智能条件合并 Gemini (Flash)、Claude & GPT、Gemini 4 Argon 配额池，确定性固定排序，清晰直观。
  - **双击配额管理大面板**：双击挂件展开完整毛玻璃配额管理面板，展示当前账号套餐级别、点数（Prompt Credits、Flow Credits）及精准重置倒计时。
- 📈 **哈基米记账面板 (V2.3 纯 Token 明细)**：
  - 精确统计当天总交互次数与分模型 Token 消耗。
  - 近 7 天历史用量记录，支持点击日期自由展开/收起缓内（Cached）、缓外（Input）、输出（Output）的精准 Token 拆解明细。
- 🔔 **跨会话提问与授权智能提醒**：
  - 跨会话实时感知活跃提问（`ask_question`）与终端/文件执行授权请求，以萌系爪印气泡提示并伴随清脆可爱的双音和弦“叮咚~”和弦音。
- ⚙️ **丰富的自定义设置与双重持久化**：
  - **1~20 档大小微调**：采用角点锚定算法，任意缩放不跑位、不出界。
  - **音效/提示独立控制**：支持默认音效组与小黄鸭音效组实时试听预览，支持 0% 静音保护与音量微调。
  - 设置项双重磁盘持久化存储（`~/.gemini/hajimi-settings.json`），重启即时生效。
- 🚀 **现代 V2.0+ 纯页面内热注入架构**：
  - **100% 页面内原生 DOM**：直接挂载于 Antigravity 宿主内部，零独立窗口、零开机自启残留，随宿主开启而现、随宿主关闭而销。
  - **CDP WebSocket 零侵入热注入**：通过 Chrome DevTools Protocol 动态挂载，绝不碰 `app.asar`，绝不修改宿主任何二进制或安装包文件。
  - **宿主 UI 真实就绪守卫与 600ms 稳定期防抖**：精准辨别 React SPA 根容器就绪状态，彻底规避启动白屏与二次刷新带来的挂件闪退与丢失问题。

---

## 🛠️ 环境要求

- **操作系统**：Windows 10 / 11（已针对 Windows 原生优化）
- **运行时**：Node.js `>= 20.0.0`（含 `npm` / `npx`）与 `git`
- **宿主程序**：Google Antigravity 最新版

---

## 📦 极简安装指南（三选一）

> 💡 **为什么在 Antigravity 内置插件商店（Marketplace）搜不到？**  
> Antigravity 界面内置的 Marketplace 目前仅收录 Google 官方托管目录插件，暂未开放第三方 GitHub 仓库自动索引。因此推荐使用下方**一句话让 AI 帮你装**或**单行命令一键安装**，安装完成后即可在 Antigravity 的 **Plugins（已安装插件）** 界面看到带哈基米图标的插件卡片并自由开关！

### 🌟 方式一：直接让 Antigravity AI 帮你安装（最推荐 · 零手动敲命令）

直接打开 Antigravity 聊天框，复制发送下面这句话给 AI（过程中若弹出终端执行授权点确认即可）：

> **“帮我从 `https://github.com/TClizha/antigravity-hajimi-widget` 下载并运行 `node install.mjs` 安装哈基米挂件插件，装好后调用 `node lib/cli.mjs inject` 把挂件召唤出来”**

---

### ⚡ 方式二：终端一行命令极速安装（`npx` 免手动克隆）

在任意终端（PowerShell / CMD）中直接运行这一行命令，即可全自动从 GitHub 拉取并安装到 `~/.gemini/config/plugins/antigravity-hajimi-widget/`：

```powershell
npx -y github:TClizha/antigravity-hajimi-widget
```

---

### 🔧 方式三：传统克隆安装（适合二次开发与定制）

```powershell
git clone https://github.com/TClizha/antigravity-hajimi-widget.git
cd antigravity-hajimi-widget
node install.mjs
```

> 🎉 **生效说明**：安装脚本会自动将插件注册到 `~/.gemini/config/config.json`。**重启 Antigravity** 后挂件即会随会话自动伴生加载；若不想重启，直接运行 `node ~/.gemini/config/plugins/antigravity-hajimi-widget/lib/cli.mjs inject` 即可秒级热挂载到当前窗口！

---

## 🎮 挂件操作指南

| 操作 | 对应交互行为 |
| :--- | :--- |
| **单击猫猫** | 播放萌系音效，触发果冻回弹动效，三段式轮换展示：额度卡片 → 随机金句 → 隐藏气泡 |
| **双击猫猫** | 呼出完整 Antigravity 配额详情毛玻璃仪表盘 |
| **鼠标拖拽** | 在主界面内任意漫游拖拽，靠近左边缘自动镜像翻转，松手靠边吸附 |
| **右键 / ☰ 菜单** | 展开设置面板，调节大小（1~20 档）、切换音效方案、调整音量或打开记账明细 |
| **点击 7 天记账日期** | 展开/折叠对应日期的分模型缓内、缓外、输出详细 Token 数据 |

---

## 💻 命令行调试命令

可以在终端运行内置 CLI 脚本进行状态诊断与管理：
```bash
# 查看当前配额状态与本地服务健康状况
node lib/cli.mjs status

# 手动启动伴生 HTTP 服务
node lib/cli.mjs start

# 手动触发 CDP 页面热注入
node lib/cli.mjs inject

# 停止伴生服务
node lib/cli.mjs stop
```

---

## 📂 项目文件架构

```text
├── assets/                    # 音效 (D1.mp3, Ya1.mp3 等) 与哈基米立绘 (gemini.png)
├── docs/                      # 系统架构设计与代码审查白皮书
├── lib/
│   ├── quota-probe.mjs        # 语言服务器 RPC 配额探针引擎 (智能合并去重与固定排序)
│   ├── usage-stats.mjs        # 本地交互 Token 记账与活跃提问/授权请求检测器
│   ├── server.mjs             # 本地伴生 HTTP 服务与配置持久化接口 (39325)
│   ├── widget.js              # 页面内挂件核心逻辑 (Q弹物理、气泡、面板、Web Audio 音效)
│   ├── injector.mjs           # Chrome DevTools Protocol 动态 WebSocket 挂载守护器
│   ├── mcp-server.mjs         # Antigravity 标准 MCP 服务入口与生命周期管理
│   ├── hook-session-start.cjs # 会话伴生自动拉起 Hook
│   └── cli.mjs                # 命令行工具
├── skills/
│   └── hajimi-quota/          # Antigravity 内置技能定义
├── hooks.json                 # 钩子配置模板
├── mcp_config.json            # MCP 服务配置模板
├── plugin.json                # Antigravity 插件元数据清单 (含图标与推荐提示词)
├── install.mjs                # 一键原子安装脚本 (支持 npx 直接调用)
├── package.json
├── PROVENANCE.md              # 美术与音效素材来源及许可范围声明
└── LICENSE                    # MIT 开源许可证
```

---

## 📜 鸣谢与致敬 (Credits)

本项目的交互设计、气泡几何排版与音效反馈深深致敬以下优秀的开源前辈项目：

- 🐋 **[MeteorNOX/DeepSeek-Balance-Whale-Widget (`dsh-whale-widget`)](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)**：DeepSeek Harness (DSH) 经典小鲸鱼余额挂件（原作者 [@MeteorNOX](https://github.com/MeteorNOX) 及全体贡献者），提供了页面内伴生挂件的核心交互范式、思考气泡几何与经典按压音效设计。
- 🐋 **[Yang-huai406/Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public)**：小鲸鱼挂件 Codex 桌面应用独立仓库。
- 🦊 **[pigeon189/zcode-fox-widget](https://github.com/pigeon189/zcode-fox-widget)**：ZCode 狐狸娘挂件移植项目。
- 🚀 感谢 **Google Antigravity** 团队提供的卓越智能编程平台与插件生态支持。

---

## ⚖️ 开源许可证与素材声明 (License & Provenance)

- **源代码与文档**：遵循 **[MIT License](LICENSE)** 开源（同时保留上游参考项目的 MIT 版权声明）。
- **美术与音效素材（`assets/`）**：**不在 MIT 许可覆盖范围内**。`assets/` 目录下的音效文件（源自 [`DeepSeek-Balance-Whale-Widget`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)）与哈基米立绘图片（`gemini.png`）按「原样（as-is）」随插件分发，仅用于运行与展示本插件，不授予商业再许可。逐项来源说明与权利主张（Takedown）移除方式详见 **[`PROVENANCE.md`](PROVENANCE.md)**。
