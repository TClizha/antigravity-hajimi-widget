// Antigravity Hook: SessionStart 处理器
// 确保输出符合 Antigravity 规范的 JSON，同时按需触发页面内挂件注入
const cp = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

try {
  // 异步触发注入与后台服务唤醒，即发即弃，绝不阻塞会话启动（<30ms）
  const injectorScript = path.join(PROJECT_ROOT, 'lib', 'injector.mjs');
  const child = cp.spawn(process.execPath, [injectorScript], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
} catch (e) {}

// 输出必须为合法 JSON
process.stdout.write(JSON.stringify({}) + '\n');
