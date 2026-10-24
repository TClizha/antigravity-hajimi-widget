// Antigravity 页面内哈基米挂件自动注入器
// 采用 100% 免改安装包、零侵入的 Chrome DevTools Protocol (CDP) WebSocket 热注入技术！
// 绝不碰 app.asar，绝不修改宿主任何二进制或安装文件！
// 随 MCP 服务伴生运行，自动检测并守护页面生命周期（开新窗口/刷新页面秒级自动重连）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * 动态跨平台定位 Antigravity 的 DevToolsActivePort 路径
 */
export function getDevToolsPortFile() {
  if (process.env.ANTIGRAVITY_DEVTOOLS_PORT_FILE && fs.existsSync(process.env.ANTIGRAVITY_DEVTOOLS_PORT_FILE)) {
    return process.env.ANTIGRAVITY_DEVTOOLS_PORT_FILE;
  }
  const home = os.homedir();
  const candidates = [
    // Windows
    path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort'),
    // macOS
    path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'),
    // Linux
    path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Antigravity', 'DevToolsActivePort')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export const DEVTOOLS_PORT_FILE = getDevToolsPortFile();
export const WIDGET_SCRIPT_URL = 'http://127.0.0.1:39325/widget.js';

/**
 * 获取当前 Antigravity 实例的 DevTools 调试端口
 */
export function getDevToolsPort() {
  const filePath = getDevToolsPortFile();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    const port = parseInt(content[0].trim(), 10);
    return isNaN(port) ? null : port;
  } catch (err) {
    return null;
  }
}

/**
 * 动态生成单页面的 JS 注入代码块
 * 包含严谨的宿主 UI 就绪守卫、连续 600ms 稳定期判定与状态机防死锁自愈
 */
export function generateInjectionEvalCode(port = 39325) {
  const widgetScriptUrl = `http://127.0.0.1:${port}/widget.js`;
  return `
(() => {
  try {
    // 0. 如果挂件容器已在 DOM 中，直接确认就绪
    if (document.getElementById('hajimi-container')) {
      window.__hajimi_inject_state = { status: 'mounted', ts: Date.now() };
      return 'mounted';
    }

    // 1. 宿主 UI 就绪守卫 (排除过渡页、about:blank 与白屏骨架)
    const checkHostUIReadyNow = () => {
      try {
        if (document.readyState !== 'complete' && document.readyState !== 'interactive') return false;
        if (!location.href || location.href === 'about:blank') return false;
        if (!document.body) return false;
        const root = document.getElementById('root');
        if (!root) return false;
        const rect = root.getBoundingClientRect();
        if (rect.width < 300 || rect.height < 200) return false;
        if (root.children.length === 0) return false;
        const descendants = root.querySelectorAll('*');
        if (descendants.length < 15) return false;
        return true;
      } catch (_) {
        return false;
      }
    };

    const isReadyNow = checkHostUIReadyNow();
    if (!isReadyNow) {
      window.__hajimi_ready_ts = 0;
      return 'waiting_ui';
    }

    // 连续稳定期判定 (必须连续稳定就绪至少 600ms，度过启动白屏和根节点重建)
    const now = Date.now();
    if (!window.__hajimi_ready_ts) {
      window.__hajimi_ready_ts = now;
      return 'waiting_ui';
    }
    if (now - window.__hajimi_ready_ts < 600) {
      return 'waiting_ui';
    }

    // 2. 注入状态机防死锁与自愈恢复
    const state = window.__hajimi_inject_state || null;
    const existingScript = document.getElementById('hajimi-widget-script');

    if (state && state.status === 'loading') {
      // 正在加载中，若未超过 3500ms 则等待
      if (now - state.ts < 3500) {
        return 'loading';
      }
      // 超时 3.5s 未挂载成功，说明脚本加载或执行卡死，清理并允许重试
      if (existingScript) existingScript.remove();
      window.__hajimi_inject_state = { status: 'failed', ts: now };
    }

    // 3. 执行注入
    window.__hajimi_inject_state = { status: 'loading', ts: now };

    if (existingScript) existingScript.remove();

    const s = document.createElement('script');
    s.id = 'hajimi-widget-script';
    s.src = '${widgetScriptUrl}?t=' + now;
    s.async = true;

    s.onerror = function() {
      // 失败自动降级内联重试
      fetch('${widgetScriptUrl}?t=' + Date.now())
        .then(function(r) { return r.text(); })
        .then(function(code) {
          const inlineScript = document.createElement('script');
          inlineScript.id = 'hajimi-widget-script-inline';
          inlineScript.textContent = code;
          (document.head || document.documentElement || document.body).appendChild(inlineScript);
        })
        .catch(function() {
          // 彻底失败时重置状态机，允许下次轮询重试
          if (document.getElementById('hajimi-widget-script')) {
            document.getElementById('hajimi-widget-script').remove();
          }
          window.__hajimi_inject_state = { status: 'failed', ts: Date.now() };
        });
    };

    (document.head || document.documentElement || document.body).appendChild(s);
    return 'injected';
  } catch (e) {
    return 'error: ' + (e && e.message ? e.message : String(e));
  }
})()
`;
}

/**
 * 对单个 CDP target 页面执行注入
 */
function injectPageTarget(target, port = 39325) {
  return new Promise((resolve) => {
    if (!target.webSocketDebuggerUrl) {
      return resolve({ url: target.url, status: 'no_ws' });
    }

    let ws = null;
    let settled = false;

    const cleanup = (status, extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ws) {
        try { ws.close(); } catch (_) {}
      }
      resolve({ url: target.url, status, ...extra });
    };

    const timer = setTimeout(() => {
      cleanup('timeout');
    }, 2000);

    try {
      ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: generateInjectionEvalCode(port),
            returnByValue: true
          }
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const evalResult = data?.result?.result?.value || 'done';
          cleanup('success', { evalResult });
        } catch (e) {
          cleanup('parse_error');
        }
      };

      ws.onerror = (err) => {
        cleanup('ws_error', { error: err?.message || 'unknown' });
      };
    } catch (err) {
      cleanup('exception', { error: err.message });
    }
  });
}

/**
 * 扫描当前所有运行中的 Antigravity 窗口并通过 CDP 执行挂载
 */
export async function injectRunningWindows(port = 39325) {
  const devToolsPort = getDevToolsPort();
  if (!devToolsPort) {
    return { ok: false, reason: 'DevToolsActivePort not found or invalid' };
  }

  let targets = [];
  try {
    const res = await fetch(`http://127.0.0.1:${devToolsPort}/json`, {
      signal: AbortSignal.timeout(1500)
    });
    targets = await res.json();
  } catch (err) {
    return { ok: false, reason: `Failed to fetch CDP targets: ${err.message}` };
  }

  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
  if (pages.length === 0) {
    return { ok: true, pagesCount: 0, mountedCount: 0, injectedCount: 0, waitingUiCount: 0, loadingCount: 0, errorCount: 0 };
  }

  const results = await Promise.all(pages.map(p => injectPageTarget(p, port)));
  let mountedCount = 0;
  let injectedCount = 0;
  let waitingUiCount = 0;
  let loadingCount = 0;
  let errorCount = 0;

  for (const r of results) {
    if (r.evalResult === 'mounted') mountedCount++;
    else if (r.evalResult === 'injected') injectedCount++;
    else if (r.evalResult === 'waiting_ui') waitingUiCount++;
    else if (r.evalResult === 'loading') loadingCount++;
    else errorCount++;
  }

  return {
    ok: true,
    pagesCount: pages.length,
    mountedCount,
    injectedCount,
    waitingUiCount,
    loadingCount,
    errorCount,
    details: results
  };
}

/**
 * 启动期快速重试注入 (供手动唤醒工具使用，快速返回)
 */
export async function ensureInjected(options = {}) {
  const maxRetries = options.retries ?? 4;
  const intervalMs = options.interval ?? 600;
  const port = options.port ?? 39325;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await injectRunningWindows(port);
      if (res.ok && res.pagesCount > 0) {
        if (res.mountedCount > 0 || res.injectedCount > 0) {
          return { ok: true, attempt, ...res };
        }
      }
    } catch (_) {}

    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  return { ok: false, reason: 'Waiting for active Antigravity page targets' };
}

/**
 * 启动两阶段防重入串行 CDP 守护器
 * 1. 采用 inFlight 锁 + setTimeout 调度，严禁慢请求重入；
 * 2. 启动前 25 秒或存在未挂载页面时，保持 800ms 高频巡检；
 * 3. 稳定就绪后，平滑降频为 3000ms 常规保活；
 * 4. 支持每轮巡检执行 onTick 回调（如服务健康监测或多窗口无缝接管）。
 */
let watcherTimer = null;
let inFlight = false;
let watcherStartTime = 0;

export function startCDPWatcher(port = 39325, onTick = null) {
  if (watcherTimer) return;
  watcherStartTime = Date.now();

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;

    let allMounted = false;
    try {
      if (typeof onTick === 'function') {
        try { await onTick(); } catch (_) {}
      }
      const res = await injectRunningWindows(port);
      if (res.ok && res.pagesCount > 0 && res.mountedCount === res.pagesCount) {
        allMounted = true;
      }
    } catch (_) {} finally {
      inFlight = false;
    }

    if (!watcherTimer) return; // 守护器已停止

    const elapsed = Date.now() - watcherStartTime;
    const isEarlyPhase = (elapsed < 25000) || !allMounted;
    const nextDelay = isEarlyPhase ? 800 : 3000;

    watcherTimer = setTimeout(tick, nextDelay);
  };

  watcherTimer = setTimeout(tick, 100);
}

export function stopCDPWatcher() {
  if (watcherTimer) {
    clearTimeout(watcherTimer);
    watcherTimer = null;
  }
}

// 支持 CLI 直接执行测试
const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(import.meta.url ? fileURLToPath(import.meta.url) : '').toLowerCase();
if (isMain) {
  injectRunningWindows().then((res) => {
    console.log('[Hajimi Injector Result]:', JSON.stringify(res, null, 2));
  }).catch((err) => {
    console.error('[Hajimi Injector Error]:', err);
  });
}
