// 安装脚本：将哈基米额度挂件安装到 Antigravity 插件目录 ~/.gemini/config/plugins/antigravity-hajimi-widget
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = __dirname;
const PLUGIN_NAME = 'antigravity-hajimi-widget';
const PLUGINS_BASE = path.join(os.homedir(), '.gemini', 'config', 'plugins');
const TARGET_DIR = path.join(PLUGINS_BASE, PLUGIN_NAME);

// 读取版本号
let version = '2.3.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'package.json'), 'utf8'));
  if (pkg.version) version = pkg.version;
} catch (_) {}

console.log(`📦 开始安装 Antigravity 哈基米挂件插件 (v${version})...`);
console.log(`  源路径: ${SOURCE_DIR}`);
console.log(`  安装目标: ${TARGET_DIR}`);

// 确保父目录存在
fs.mkdirSync(PLUGINS_BASE, { recursive: true });

// 同步文件夹辅助函数（递归复制并自动清理目标目录中已删除的旧文件，且不触发 Windows 根目录占用锁）
function syncRecursive(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    fs.mkdirSync(dest, { recursive: true });
    const srcChildren = fs.readdirSync(src).filter(
      (name) => name !== '.git' && name !== 'node_modules' && name !== 'scratch'
    );
    const srcSet = new Set(srcChildren);
    if (fs.existsSync(dest)) {
      for (const destChild of fs.readdirSync(dest)) {
        if (!srcSet.has(destChild)) {
          const stalePath = path.join(dest, destChild);
          try {
            fs.rmSync(stalePath, { recursive: true, force: true });
          } catch (rmErr) {
            console.warn(`⚠️ 清理旧文件失败 (${stalePath}):`, rmErr.message);
          }
        }
      }
    }
    for (const childItemName of srcChildren) {
      syncRecursive(path.join(src, childItemName), path.join(dest, childItemName));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// 1. 清理旧版残留并同步核心文件（纯 V2.0+ 现代页面内架构）
const itemsToCopy = ['assets', 'lib', 'package.json', 'README.md', 'LICENSE', 'skills'];
const allowedTopLevel = new Set([...itemsToCopy, 'plugin.json', 'mcp_config.json', 'hooks.json']);
fs.mkdirSync(TARGET_DIR, { recursive: true });

for (const existingItem of fs.readdirSync(TARGET_DIR)) {
  if (!allowedTopLevel.has(existingItem)) {
    const staleTopPath = path.join(TARGET_DIR, existingItem);
    try {
      fs.rmSync(staleTopPath, { recursive: true, force: true });
    } catch (rmErr) {
      console.warn(`⚠️ 清理顶层旧文件失败 (${staleTopPath}):`, rmErr.message);
    }
  }
}

for (const item of itemsToCopy) {
  const src = path.join(SOURCE_DIR, item);
  const dest = path.join(TARGET_DIR, item);
  if (fs.existsSync(src)) {
    syncRecursive(src, dest);
  }
}

// 2. 动态生成 plugin.json
const pluginManifest = {
  name: PLUGIN_NAME,
  description: 'Antigravity 哈基米页面内原生伴生挂件与额度实时监控',
  version: version
};
fs.writeFileSync(path.join(TARGET_DIR, 'plugin.json'), JSON.stringify(pluginManifest, null, 2), 'utf8');

// 3. 动态生成目标用户的 mcp_config.json
const mcpServerPath = path.join(TARGET_DIR, 'lib', 'mcp-server.mjs').replace(/\\/g, '/');
const mcpConfig = {
  mcpServers: {
    'hajimi-quota': {
      command: 'node',
      args: [mcpServerPath]
    }
  }
};
fs.writeFileSync(path.join(TARGET_DIR, 'mcp_config.json'), JSON.stringify(mcpConfig, null, 2), 'utf8');

// 4. 动态生成目标用户的 hooks.json
const hookScriptPath = path.join(TARGET_DIR, 'lib', 'hook-session-start.cjs').replace(/\\/g, '/');
const hooksConfig = {
  'hajimi-autostart': {
    SessionStart: [
      {
        type: 'command',
        command: `node "${hookScriptPath}"`
      }
    ]
  }
};
fs.writeFileSync(path.join(TARGET_DIR, 'hooks.json'), JSON.stringify(hooksConfig, null, 2), 'utf8');

// 5. 注册启用插件配置到 ~/.gemini/config/config.json (安全解析与原子写入，绝不清空损坏配置)
const configJsonPath = path.join(os.homedir(), '.gemini', 'config', 'config.json');
try {
  let userConfig = {};
  let canWriteConfig = true;
  if (fs.existsSync(configJsonPath)) {
    const rawContent = fs.readFileSync(configJsonPath, 'utf8').trim();
    if (rawContent.length > 0) {
      try {
        const parsed = JSON.parse(rawContent);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          userConfig = parsed;
        } else {
          canWriteConfig = false;
          console.warn(`⚠️ ~/.gemini/config/config.json 根节点不是有效对象，为保护原有配置已跳过自动改写。`);
        }
      } catch (parseErr) {
        canWriteConfig = false;
        const bakPath = `${configJsonPath}.bak.${Date.now()}`;
        fs.copyFileSync(configJsonPath, bakPath);
        console.warn(`⚠️ 解析 ~/.gemini/config/config.json 失败 (${parseErr.message})！已备份原文件至 ${bakPath}，为防止清空其他插件配置，已终止覆盖写入。`);
      }
    }
  }
  if (canWriteConfig) {
    if (!userConfig.plugins || typeof userConfig.plugins !== 'object' || Array.isArray(userConfig.plugins)) {
      userConfig.plugins = {};
    }
    userConfig.plugins[PLUGIN_NAME] = { enabled: true };

    const tmpConfigPath = path.join(os.homedir(), '.gemini', 'config', `config.json.tmp.${Date.now()}`);
    fs.writeFileSync(tmpConfigPath, JSON.stringify(userConfig, null, 2), 'utf8');
    fs.renameSync(tmpConfigPath, configJsonPath);
    console.log(`✅ 已在 ~/.gemini/config/config.json 中启用插件: ${PLUGIN_NAME}`);
  }
} catch (e) {
  console.warn(`⚠️ 写入 config.json 失败:`, e.message);
}

console.log(`\n🎉 安装成功！`);
console.log(`📍 插件目录: ${TARGET_DIR}`);
console.log(`💡 挂件已伴随 Antigravity 会话自动加载，也可通过命令行测试:`);
console.log(`   node "${path.join(TARGET_DIR, 'lib', 'cli.mjs')}" status`);
