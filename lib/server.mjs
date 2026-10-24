// 本地轻量 Web 服务
// 为哈基米挂件提供前端页面、静态素材 (/assets)、脚本 (/widget.js) 与 Antigravity 额度接口 (/api/quota)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fetchAntigravityStatus } from './quota-probe.mjs';
import { getUsageStats, detectPendingPrompts } from './usage-stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const ASSETS_DIR = path.join(PROJECT_ROOT, 'assets');
export const DEFAULT_PORT = 39325;
const SETTINGS_FILE = path.join(os.homedir(), '.gemini', 'hajimi-settings.json');

/**
 * 严格白名单校验设置对象，防止非法类型注入与 XSS 风险
 */
export function sanitizeSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    raw = {};
  }
  const clean = {};

  // scaleLevel: 整数 1 ~ 20
  if ('scaleLevel' in raw) {
    const n = parseInt(raw.scaleLevel, 10);
    clean.scaleLevel = Number.isNaN(n) ? 10 : Math.max(1, Math.min(20, n));
  } else {
    clean.scaleLevel = 10;
  }

  // soundVol: 浮点数 0.0 ~ 1.0 (注意 0 是合法静音值)
  if ('soundVol' in raw) {
    const v = Number(raw.soundVol);
    clean.soundVol = (typeof raw.soundVol !== 'boolean' && raw.soundVol !== '' && raw.soundVol !== null && !Number.isNaN(v))
      ? Math.max(0, Math.min(1, v))
      : 0.9;
  } else {
    clean.soundVol = 0.9;
  }

  // soundGroup: 仅允许 'd' 或 'ya'
  if ('soundGroup' in raw && (raw.soundGroup === 'ya' || raw.soundGroup === 'd')) {
    clean.soundGroup = raw.soundGroup;
  } else {
    clean.soundGroup = 'd';
  }

  // 布尔开关字段
  const boolKeys = [
    'soundAll',
    'soundPress',
    'remindQuestion',
    'remindApproval',
    'snapEnabled',
    'flipEnabled',
    'hideMenuBtn'
  ];
  const defaultBools = {
    soundAll: true,
    soundPress: true,
    remindQuestion: true,
    remindApproval: true,
    snapEnabled: true,
    flipEnabled: true,
    hideMenuBtn: false
  };

  for (const k of boolKeys) {
    clean[k] = (k in raw) ? Boolean(raw[k]) : defaultBools[k];
  }

  return clean;
}

/**
 * 服务端持久化配置读取 (~/.gemini/hajimi-settings.json)
 */
export function loadPersistedSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return sanitizeSettings(parsed);
    }
  } catch (_) {}
  return sanitizeSettings({});
}

/**
 * 服务端持久化配置原子保存
 */
export function savePersistedSettings(newSettings) {
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const current = loadPersistedSettings() || {};
    const sanitized = sanitizeSettings(Object.assign({}, current, newSettings));

    // 原子写入：先写入临时文件，再原子 rename 替换
    const tmpFile = path.join(dir, `hajimi-settings.json.tmp.${Date.now()}`);
    fs.writeFileSync(tmpFile, JSON.stringify(sanitized, null, 2), 'utf8');
    fs.renameSync(tmpFile, SETTINGS_FILE);
    return sanitized;
  } catch (err) {
    console.error('[Hajimi Server] 保存设置失败:', err.message);
    return null;
  }
}

let runningServer = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon'
};

export function isTrustedLocalOrigin(origin) {
  if (!origin) return true; // CLI / Node / <script> / <img> 非 CORS 同源请求
  if (origin.startsWith('vscode-file://') || origin.startsWith('file://') || origin.startsWith('antigravity://')) {
    return true;
  }
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
}

export function isTrustedHostHeader(host) {
  if (!host) return true;
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host);
}

export function createServer(port = DEFAULT_PORT) {
  if (runningServer) {
    return Promise.resolve({ server: runningServer, port, reused: true });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const reqHost = req.headers.host || '';
      const reqOrigin = req.headers.origin || '';

      // 防御 DNS Rebinding 与外部网页/沙箱 iframe (Origin: null) 跨域探测
      if (!isTrustedHostHeader(reqHost) || !isTrustedLocalOrigin(reqOrigin)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: Untrusted Origin or Host' }));
        return;
      }

      // 仅当存在受信任的 Origin 时回显 CORS 响应头（绝不回显 null 或通配符 *）
      if (reqOrigin) {
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
      }
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'HEAD') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 安全解析 URL，避免非法 Host 头导致抛错
      let url;
      try {
        const rawHost = reqHost || '127.0.0.1';
        url = new URL(req.url, `http://${rawHost}`);
      } catch (_) {
        url = new URL(req.url, 'http://127.0.0.1');
      }

      const pathname = url.pathname;

      // 接口：/api/quota
      if (pathname === '/api/quota') {
        try {
          const force = url.searchParams.get('refresh') === '1';
          const data = await fetchAntigravityStatus(force);
          const pendingPrompt = detectPendingPrompts();
          // 脱敏：前端 UI 仅需 tier/planName 与 name，不通过 HTTP 暴露用户个人邮箱
          const safeUser = data && data.user ? {
            name: data.user.name || 'Antigravity 用户',
            tier: data.user.tier || '',
            planName: data.user.planName || ''
          } : null;
          const payload = Object.assign({}, data, { user: safeUser, pendingPrompt });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(payload));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ connected: false, error: err.message }));
        }
        return;
      }

      // 接口：/api/pending (极速跨会话活跃提问与授权挂起轮询)
      if (pathname === '/api/pending') {
        try {
          const pendingPrompt = detectPendingPrompts();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, pendingPrompt }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
        return;
      }

      // 接口：/api/settings (配置读取与磁盘持久化)
      if (pathname === '/api/settings') {
        if (req.method === 'POST') {
          let body = '';
          let bodySize = 0;
          const MAX_BODY_SIZE = 16384; // 16KB 上限保护
          let isTooLarge = false;

          req.on('data', chunk => {
            bodySize += chunk.length;
            if (bodySize > MAX_BODY_SIZE) {
              isTooLarge = true;
              res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: false, error: 'Payload Too Large' }));
              req.destroy();
              return;
            }
            body += chunk;
          });

          req.on('end', () => {
            if (isTooLarge) return;
            try {
              const parsed = JSON.parse(body || '{}');
              const saved = savePersistedSettings(parsed);
              if (!saved) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: false, error: 'Failed to persist settings to disk' }));
                return;
              }
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: true, settings: saved }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: false, error: err.message }));
            }
          });
          return;
        }

        // GET 请求返回磁盘已持久化配置
        const persisted = loadPersistedSettings() || {};
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(persisted));
        return;
      }

      // 接口：/api/stats (近7天使用记录与记账统计)
      if (pathname === '/api/stats') {
        try {
          const force = url.searchParams.get('refresh') === '1';
          const stats = await getUsageStats(force);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(stats));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
        return;
      }

      // 接口：/api/health
      if (pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, name: 'antigravity-hajimi-widget', pid: process.pid, time: Date.now() }));
        return;
      }

      // 静态文件映射与零延迟配置预注入
      if (pathname === '/widget.js' || pathname === '/lib/widget.js') {
        const filePath = path.join(PROJECT_ROOT, 'lib', 'widget.js');
        if (fs.existsSync(filePath)) {
          const code = fs.readFileSync(filePath, 'utf8');
          const persisted = loadPersistedSettings() || {};
          // 转义 '<' 规避 XSS 风险
          const safeInjectedJson = JSON.stringify(persisted).replace(/</g, '\\u003c');
          const injection = `window.__HAJIMI_SERVER_SETTINGS__ = ${safeInjectedJson};\n`;
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-cache'
          });
          res.end(injection + code);
          return;
        }
      }

      // 首页
      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>🐾 Antigravity 哈基米挂件服务</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; background: #0f172a; color: #f8fafc; text-align: center; }
    .card { max-width: 480px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; }
    img { width: 120px; height: 120px; object-fit: contain; margin-bottom: 12px; }
    h1 { font-size: 20px; margin: 8px 0; color: #38bdf8; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.6; }
    a { color: #38bdf8; text-decoration: none; }
    .tag { display: inline-block; background: #0284c7; color: white; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <img src="/assets/gemini.png" alt="哈基米" />
    <br/>
    <span class="tag">V2.3 纯页面内挂件服务</span>
    <h1>🐾 哈基米服务正在运行中喵~</h1>
    <p>挂件已通过纯 DevTools Protocol 注入到 Antigravity 编辑器内。<br/>
    如需查看配额 JSON 数据，请访问 <a href="/api/quota">/api/quota</a>。</p>
  </div>
</body>
</html>`);
        return;
      }

      // 静态静态资源防目录穿越 (assets)
      if (pathname.startsWith('/assets/')) {
        const rel = pathname.slice('/assets/'.length);
        const safeAssetsBase = path.resolve(ASSETS_DIR);
        const resolved = path.resolve(safeAssetsBase, rel);

        if (resolved.startsWith(safeAssetsBase + path.sep) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          const ext = path.extname(resolved).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache'
          });
          const stream = fs.createReadStream(resolved);
          stream.on('error', () => {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            }
            res.end();
          });
          stream.pipe(res);
          return;
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      runningServer = server;
      console.error(`[Hajimi Server] 哈基米页面内挂件服务已启动: http://127.0.0.1:${port}/`);
      resolve({ server, port, reused: false });
    });

    server.on('error', async (err) => {
      if (err.code === 'EADDRINUSE') {
        // 如果端口已被占用，先检查现有实例是否由本项目运行且健康
        try {
          const resp = await fetch(`http://127.0.0.1:${port}/api/health`, {
            signal: AbortSignal.timeout(1000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.name === 'antigravity-hajimi-widget') {
              console.error(`[Hajimi Server] 端口 ${port} 已有健康服务在运行，直接复用。`);
              resolve({ server: null, port, reused: true });
              return;
            }
          }
        } catch (_) {}

        // 若非健康服务且尝试次数在 10 个端口以内 (39325 ~ 39334)，向后顺延端口
        if (port < DEFAULT_PORT + 9) {
          resolve(createServer(port + 1));
        } else {
          reject(new Error(`无法在端口 ${DEFAULT_PORT} ~ ${DEFAULT_PORT + 9} 找到可用端口！`));
        }
      } else {
        reject(err);
      }
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (isMain) {
  createServer();
}
