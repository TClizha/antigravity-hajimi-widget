#!/usr/bin/env node
// Antigravity MCP Server: 随 Antigravity 会话启动，管理额度 HTTP 服务与页面内挂件注入
import readline from 'node:readline';
import { fetchAntigravityStatus } from './quota-probe.mjs';
import { createServer, DEFAULT_PORT } from './server.mjs';
import { ensureInjected, startCDPWatcher, stopCDPWatcher } from './injector.mjs';

let localServer = null;
let activePort = DEFAULT_PORT;

/**
 * 守护与接管服务：当原主进程退出释放端口时，当前 MCP 实例无缝绑定接管
 */
async function ensureServerAlive() {
  if (localServer) return; // 当前进程已经是服务宿主
  try {
    const resp = await fetch(`http://127.0.0.1:${activePort}/api/health`, {
      signal: AbortSignal.timeout(800)
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.name === 'antigravity-hajimi-widget') {
        return;
      }
    }
  } catch (_) {}

  // 原主服务不可用，尝试接管服务
  try {
    const res = await createServer(activePort);
    if (res && res.server) {
      localServer = res.server;
      activePort = res.port;
      console.error(`[Hajimi MCP] 前序服务已退出，当前进程已自动无缝接管端口 ${activePort} 喵！`);
    }
  } catch (err) {
    console.error('[Hajimi MCP] 尝试接管服务失败:', err.message);
  }
}

// 启动内嵌 HTTP 服务并执行两阶段自适应页面内挂件注入与守护
async function initService() {
  try {
    const res = await createServer(DEFAULT_PORT);
    localServer = res.server;
    activePort = res.port;
  } catch (err) {
    console.error('[Hajimi MCP] 启动本地 HTTP 服务失败:', err.message);
  }

  // 启动两阶段防重入自适应 CDP 守护器，并挂载多窗口无缝接管巡检
  try {
    startCDPWatcher(activePort, ensureServerAlive);
  } catch (err) {
    console.error('[Hajimi MCP] 启动 CDP 守护失败:', err.message);
  }
}

initService();

function cleanup() {
  stopCDPWatcher();
  if (localServer) {
    try {
      localServer.close();
    } catch (_) {}
  }
}

process.on('exit', cleanup);
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.stdin.on('close', () => { cleanup(); process.exit(0); });
process.stdin.on('end', () => { cleanup(); process.exit(0); });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(id, result) {
  const msg = { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendError(id, code, message) {
  const msg = { jsonrpc: '2.0', id, error: { code, message } };
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleToolCall(name, args) {
  if (name === 'get_antigravity_quota') {
    const status = await fetchAntigravityStatus(args?.refresh === true);
    if (!status.connected) {
      return {
        content: [{ type: 'text', text: `未能连接到 Antigravity: ${status.error}` }]
      };
    }
    let summary = `🐾 **哈基米为您播报 Antigravity 配额状态喵~**：\n`;
    summary += `- 👤 用户: ${status.user.name} (${status.user.email})\n`;
    summary += `- 📦 当前套餐: ${status.plan.planName} (${status.plan.tier})\n`;
    summary += `- 💳 Prompt 点数: ${status.plan.availablePromptCredits} / Flow 点数: ${status.plan.availableFlowCredits}\n\n`;
    summary += `📊 **主要模型剩余配额**：\n`;
    status.models.forEach((m) => {
      summary += `- **${m.label}**: ${m.remainingPctStr} (重置倒计时: ${m.resetCountdown})\n`;
    });
    return {
      content: [{ type: 'text', text: summary }]
    };
  }

  if (name === 'launch_hajimi_pet') {
    const action = args?.action || 'start';
    if (action === 'start') {
      const injectRes = await ensureInjected({ port: activePort, retries: 3, interval: 500 });
      if (injectRes.ok && injectRes.mountedCount > 0) {
        return {
          content: [{
            type: 'text',
            text: `✨ 哈基米已成功在 ${injectRes.mountedCount} 个 Antigravity 窗口中就绪并常驻右下角喵~（纯页面内 DOM 挂件，100% 采用 CDP 零侵入热挂载，支持自由拖拽与双击详情面板）！`
          }]
        };
      } else if (injectRes.waitingUiCount > 0) {
        return {
          content: [{
            type: 'text',
            text: `🐾 宿主界面正在加载中，哈基米守护器已就绪，将在宿主 UI 稳定后自动优雅淡入挂载喵~！`
          }]
        };
      }
      return {
        content: [{
          type: 'text',
          text: `✨ 哈基米挂件守护服务运行中（状态: ${JSON.stringify(injectRes)}）喵~`
        }]
      };
    } else if (action === 'stop') {
      return {
        content: [{
          type: 'text',
          text: `🛑 哈基米已伴随页面原生运行喵~ 如需临时收起气泡可直接单击气泡切换！`
        }]
      };
    }
  }

  throw new Error(`未知的工具: ${name}`);
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let parsedId = null;
  try {
    const req = JSON.parse(line);
    const { id, method, params } = req;
    parsedId = (typeof id !== 'undefined') ? id : null;

    if (method === 'ping') {
      sendResponse(parsedId, {});
      return;
    }

    if (method === 'initialize') {
      sendResponse(parsedId, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'antigravity-hajimi-mcp', version: '2.3.0' }
      });
      return;
    }

    if (method && method.startsWith('notifications/')) {
      return;
    }

    if (method === 'tools/list') {
      sendResponse(parsedId, {
        tools: [
          {
            name: 'get_antigravity_quota',
            description: '查询当前 Antigravity 账号的套餐级别、点数以及各大模型（Gemini 3.8 Flash、Gemini 4 Argon、Claude Sonnet 5.5等）的剩余配额比例与刷新时间。',
            inputSchema: {
              type: 'object',
              properties: {
                refresh: { type: 'boolean', description: '是否强制绕过缓存即时刷新' }
              }
            }
          },
          {
            name: 'launch_hajimi_pet',
            description: '唤醒或检查 Antigravity 页面内哈基米桌宠挂件的状态。',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['start', 'stop'], description: 'start (唤醒挂件) 或 stop (关闭提示)' }
              },
              required: ['action']
            }
          }
        ]
      });
      return;
    }

    if (method === 'tools/call') {
      const res = await handleToolCall(params.name, params.arguments);
      sendResponse(parsedId, res);
      return;
    }

    if (parsedId !== null) {
      sendError(parsedId, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (parsedId !== null) {
      sendError(parsedId, -32603, err.message);
    }
  }
});
