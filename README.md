# 🐾 Antigravity 哈基米挂件与额度监控系统 (V2.3)

> **Antigravity Hajimi Companion & Quota Monitor**  
> 专为 **Google Antigravity** 打造的原生页面内伴生挂件、实时模型配额监控与智能 Token 记账系统。

[![Version](https://img.shields.io/badge/version-2.3.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](README.md)

---

## ✨ 核心特性

- 🐾 **原生哈基米伴生形象**：
  - 内置 Google Gemini 专属角色「哈基米」（`assets/gemini.png`），支持 Q 弹物理按压、果冻回弹与抚摸音画互动。
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
- **运行时**：Node.js `>= 20.0.0`
- **宿主程序**：Google Antigravity 最新版

---

## 📦 安装与启用指南

### 1. 克隆仓库
```bash
git clone https://github.com/TClizha/antigravity-hajimi-widget.git
cd antigravity-hajimi-widget
```

### 2. 一键安装并注册插件
在项目根目录下执行安装脚本：
```bash
node install.mjs
# 或通过 npm
npm run install-plugin
```

安装脚本将自动完成：
1. 将插件核心文件复制到全局插件目录 `~/.gemini/config/plugins/antigravity-hajimi-widget/`；
2. 动态生成与当前用户环境匹配的 `plugin.json`、`mcp_config.json` 与 `hooks.json`；
3. 在 `~/.gemini/config/config.json` 中自动登记并启用插件。

### 3. 重启 Antigravity
重启 Antigravity，即可在编辑器右下角看到可爱的哈基米挂件伴生就绪！

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
├── assets/                 # 音效 (D1.mp3, Ya1.mp3 等) 与哈基米立绘 (gemini.png)
├── lib/
│   ├── quota-probe.mjs     # 语言服务器 RPC 配额探针引擎 (智能合并去重与固定排序)
│   ├── usage-stats.mjs     # 本地交互 Token 记账与活跃提问/授权请求检测器
│   ├── server.mjs          # 本地伴生 HTTP 服务与配置持久化接口 (39325)
│   ├── widget.js           # 页面内挂件核心逻辑 (Q弹物理、气泡、面板、Web Audio 音效)
│   ├── injector.mjs        # Chrome DevTools Protocol 动态 WebSocket 挂载守护器
│   ├── mcp-server.mjs      # Antigravity 标准 MCP 服务入口与生命周期管理
│   ├── hook-session-start.cjs # 会话伴生自动拉起 Hook
│   └── cli.mjs             # 命令行工具
├── skills/
│   └── hajimi-quota/       # Antigravity 内置技能定义
├── hooks.json              # 钩子配置模板
├── mcp_config.json         # MCP 服务配置模板
├── install.mjs             # 一键原子安装脚本
├── package.json
└── LICENSE                 # MIT 开源许可证
```

---

## 📜 鸣谢与致敬

- 交互与视觉灵感源自 DeepSeek Harness 大肥鱼挂件（`dsh-whale-widget`）与 [pigeon189/zcode-fox-widget](https://github.com/pigeon189/zcode-fox-widget)。
- 感谢 Google Antigravity 团队提供的卓越智能编程体验。
- 本项目遵循 [MIT 许可证](LICENSE) 开源。
