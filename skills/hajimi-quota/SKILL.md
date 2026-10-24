---
name: hajimi-quota
description: 召唤哈基米挂件或查询 Antigravity 模型配额与刷新倒计时。当用户询问“我还有多少额度”、“哈基米出来”、“启动桌宠”、“查看模型配额”时使用。
---

# Antigravity 哈基米额度挂件

提供了实时的 Antigravity 模型额度查询工具与 Antigravity 页面内原生伴生挂件。

## 可用工具与命令
- `get_antigravity_quota`: 查询当前账号套餐、点数及各模型（Gemini Flash、Gemini Argon、Claude / GPT 等）的剩余额度比例与重置倒计时。
- `launch_hajimi_pet`: 控制 Antigravity 页面内原生哈基米伴生挂件启停（action: 'start' | 'stop'）。
- 终端运行: `node ~/.gemini/config/plugins/antigravity-hajimi-widget/lib/cli.mjs status` 或 `start`。
