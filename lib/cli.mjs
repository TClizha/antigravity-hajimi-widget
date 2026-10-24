#!/usr/bin/env node
// 命令行工具：查看配额、启停挂件与执行页面内注入
import { fetchAntigravityStatus } from './quota-probe.mjs';
import { DEFAULT_PORT, PROJECT_ROOT } from './server.mjs';
import { ensureInjected } from './injector.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PID_FILE = path.join(PROJECT_ROOT, '.hajimi.pid');

async function isServerRunning(port = DEFAULT_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function handleStatus() {
  console.log('🐾 正在探测 Antigravity 额度状态...\n');
  const res = await fetchAntigravityStatus(true);
  if (!res.connected) {
    console.error('❌ 未能连接到 Antigravity: ' + res.error);
    process.exit(1);
  }

  console.log(`👤 用户: ${res.user.name} (${res.user.email})`);
  console.log(`📦 套餐: ${res.plan.planName} [${res.plan.tier}]`);
  console.log(`💳 Prompt 点数: ${res.plan.availablePromptCredits} / Flow 点数: ${res.plan.availableFlowCredits}`);
  console.log(`⚡ 挂件播报: ${res.primaryBubble}\n`);

  console.log('📊 各模型配额详情:');
  console.log('---------------------------------------------------------');
  res.models.forEach((m) => {
    const barLen = 20;
    const filled = Math.round((m.remainingFraction || 0) * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    console.log(`• ${m.label.padEnd(28)} [${bar}] ${m.remainingPctStr.padStart(6)} (${m.resetCountdown})`);
  });
  console.log('---------------------------------------------------------');
  console.log(`🕒 数据更新时间: ${res.lastUpdated}\n`);
}

async function handleStart() {
  let serverPid = null;
  const alreadyRunning = await isServerRunning(DEFAULT_PORT);
  if (!alreadyRunning) {
    console.log('🚀 正在后台拉起哈基米挂件 Web 服务...');
    const serverScript = path.join(PROJECT_ROOT, 'lib', 'server.mjs');
    const serverChild = spawn(process.execPath, [serverScript], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    serverChild.unref();
    serverPid = serverChild.pid;

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if (await isServerRunning(DEFAULT_PORT)) break;
    }
  } else {
    console.log('🐾 哈基米挂件 Web 服务运行中。');
  }

  // 记录 PID
  if (serverPid) {
    try {
      fs.writeFileSync(PID_FILE, JSON.stringify({
        serverPid,
        port: DEFAULT_PORT,
        startedAt: Date.now()
      }), 'utf8');
    } catch (_) {}
  }

  // 触发页面内 CDP 热注入
  console.log('✨ 正在将哈基米挂件注入到 Antigravity 窗口中...');
  const injectRes = await ensureInjected({ retries: 3, interval: 800 });
  if (injectRes.ok) {
    console.log(`✅ 注入成功！共扫描到 ${injectRes.pagesCount} 个页面，已成功注入/挂载挂件喵~`);
  } else {
    console.log(`⚠️ 注入提示: ${injectRes.reason || '未发现活动的 Antigravity 编辑器页面'}。当您打开 Antigravity 窗口时挂件将通过 MCP 自动装载。`);
  }

  console.log(`🌐 本地状态页面: http://127.0.0.1:${DEFAULT_PORT}/\n`);
}

async function handleStop() {
  if (fs.existsSync(PID_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
      if (data.serverPid) {
        try {
          process.kill(data.serverPid);
        } catch (e) {}
      }
      fs.unlinkSync(PID_FILE);
    } catch (e) {}
  }

  console.log('🛑 哈基米本地服务已停止。挂件为纯页面内 DOM 元素，关闭 Antigravity 窗口即可完全消失喵~');
}

async function handleInject() {
  console.log('✨ 正在对当前 Antigravity 窗口执行 CDP 热注入...');
  const res = await ensureInjected({ retries: 2, interval: 500 });
  console.log('注入结果:', JSON.stringify(res, null, 2));
}

async function main() {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'status') {
    await handleStatus();
  } else if (cmd === 'start') {
    await handleStart();
  } else if (cmd === 'stop') {
    await handleStop();
  } else if (cmd === 'inject') {
    await handleInject();
  } else {
    console.log(`用法: node lib/cli.mjs [status|start|stop|inject]`);
  }
}

main().catch((err) => {
  console.error('执行出错:', err);
});
