# 素材来源与许可范围（PROVENANCE）

本仓库的**源代码、脚本与文档**按 **MIT License** 许可（详见 [`LICENSE`](LICENSE)）。  
`assets/` 目录下的**美术与音效素材**（立绘图片与音频文件）**不在 MIT 许可覆盖范围内**，按下方说明提供。

---

## 一、许可范围划分

| 范围 | 许可说明 |
| :--- | :--- |
| `lib/`、`skills/`、`install.mjs`、`package.json`、`plugin.json`、`hooks.json`、`mcp_config.json` 及文档 | **MIT License**（见 [`LICENSE`](LICENSE)，包含本项目与上游参考项目的 MIT 版权声明） |
| `assets/**`（立绘图片与音效文件） | **不适用 MIT**：随插件按「原样（as-is）」提供，仅用于运行与展示本插件。本项目不就第三方或衍生素材授予额外的商业再许可，使用须遵循相关权利人的授权。 |

---

## 二、逐项素材来源说明

| 文件路径 | 类型 | 来源与说明 |
| :--- | :--- | :--- |
| `assets/gemini.png` | 挂件立绘与插件图标 | Google Gemini 衍生同人形象「哈基米」立绘素材，随本插件按原样提供，仅用于挂件界面展示与插件标识。 |
| `assets/D1.mp3`、`assets/D2.mp3` | 默认按压 / 松开音效 | 源自上游开源项目 [`MeteorNOX/DeepSeek-Balance-Whale-Widget`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（参见其 [`PROVENANCE.md`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/blob/main/PROVENANCE.md)），用于还原经典双段按压物理反馈体验。 |
| `assets/Ya1.mp3`、`assets/Ya2.mp3` | 小黄鸭按压 / 松开音效 | 源自上游开源项目 [`MeteorNOX/DeepSeek-Balance-Whale-Widget`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（参见其 [`PROVENANCE.md`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/blob/main/PROVENANCE.md)），用于可选的趣味按压音效反馈。 |

> 💡 **注**：提问提醒与授权提醒的「叮咚~」双音和弦由前端 `Web Audio API` 实时合成，不依赖外部音频文件。

---

## 三、上游开源致谢（Credits）

本项目的气泡几何排版、Q 弹物理形变、边缘吸附翻转、设置菜单及按压音效体验深受以下开源项目启发与支持：

1. **[MeteorNOX/DeepSeek-Balance-Whale-Widget (`dsh-whale-widget`)](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)**  
   DeepSeek Harness (DSH) 经典小鲸鱼余额挂件（MIT License），提供了页面内挂件的核心交互范式、SVG 思考气泡几何结构与双段音效设计。
2. **[Yang-huai406/Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public)**  
   小鲸鱼挂件 Codex 桌面端独立分支（MIT License）。
3. **[pigeon189/zcode-fox-widget](https://github.com/pigeon189/zcode-fox-widget)**  
   ZCode 狐狸娘挂件移植版（MIT License）。

---

## 四、权利主张与移除机制（Takedown）

如果你是 `assets/` 目录下某项素材的权利人，并认为本仓库的收录或使用方式侵犯了你的合法权益，请在本仓库提交一条 [GitHub Issue](https://github.com/TClizha/antigravity-hajimi-widget/issues)，说明**文件名**与**权利依据**。我们将在核实后**立即替换或移除相关文件**，不附加任何额外条件。同时我们也欢迎社区贡献可自由再分发的原创替代素材。
