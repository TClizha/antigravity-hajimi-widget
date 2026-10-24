// 🐾 Antigravity 哈基米 7 天使用记录与 Token 记账引擎
// 自动扫描 ~/.gemini/antigravity/brain/ 本地会话日志，秒级聚合近 7 天每日 Token、步数、会话数
// 并提供跨会话活跃提问与授权请求的毫秒级实时感知
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BRAIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
const STATS_CACHE_TTL_MS = 15000; // 15秒统计内存缓存

let cachedStats = null;
let lastCacheTime = 0;

let lastPendingResult = null;
let lastPendingTime = 0;
const PENDING_CACHE_TTL_MS = 1500; // 1.5秒 pending 内存缓存

// 清理旧版历史残留文件
try {
  const oldHistoryFile = path.join(os.homedir(), '.gemini', 'hajimi-usage-history.json');
  if (fs.existsSync(oldHistoryFile)) {
    fs.unlinkSync(oldHistoryFile);
  }
} catch (_) {}

// 本地日期格式化 YYYY-MM-DD
export function getLocalDateStr(date = new Date()) {
  const d = (date instanceof Date) ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 格式化 Token 数量（例如 5.36M, 120.5k, 850）
export function formatTokens(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) {
    return (n / 1000000).toFixed(2) + 'M';
  }
  if (n >= 1000) {
    return (n / 1000).toFixed(1) + 'k';
  }
  return String(n);
}

// 核心：扫描并聚合近 7 天完整使用统计 (纯 Token 计数 + 三大模型分类 + 缓内/缓外/输出拆解)
export async function getUsageStats(forceRefresh = false) {
  const now = new Date();
  if (!forceRefresh && cachedStats && (now.getTime() - lastCacheTime < STATS_CACHE_TTL_MS)) {
    return cachedStats;
  }

  // 初始化 7 天自然日插槽（按日期倒序：今天, 昨天, ... 共 7 天，精准自然日划分）
  const daysList = [];
  const daysMap = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dateStr = getLocalDateStr(d);
    const label = i === 0 ? '今天' : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = {
      date: dateStr,
      label,
      isToday: i === 0,
      steps: 0,
      cacheTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      sessionsSet: new Set(),
      sessions: 0,
      models: {
        gemini: { id: 'gemini', label: 'Gemini (Flash)', steps: 0, cacheTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        claude: { id: 'claude', label: 'Claude & GPT', steps: 0, cacheTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        argon:  { id: 'argon', label: 'Gemini 4 Argon', steps: 0, cacheTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      }
    };
    daysList.push(entry);
    daysMap[dateStr] = entry;
  }

  // 极速扫描 ~/.gemini/antigravity/brain/
  const eightDaysAgoMs = now.getTime() - 8 * 86400000;
  if (fs.existsSync(BRAIN_DIR)) {
    try {
      const convDirs = fs.readdirSync(BRAIN_DIR);

      // 阶段 1：预扫描子代理映射 (识别每个 subagent 的归属模型池)
      const subagentPoolMap = {};
      for (const cid of convDirs) {
        const transcriptPath = path.join(BRAIN_DIR, cid, '.system_generated', 'logs', 'transcript.jsonl');
        if (!fs.existsSync(transcriptPath)) continue;
        try {
          const stat = fs.statSync(transcriptPath);
          if (stat.mtimeMs < eightDaysAgoMs) continue;
          const content = fs.readFileSync(transcriptPath, 'utf8');
          if (!content.includes('invoke_subagent')) continue;

          const lines = content.split('\n');
          let currentPool = 'gemini';
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            if (line.includes('Model Selection')) {
              const m = line.match(/Model Selection[\s\S]*?to ([^\n\\]+?)\.\s*No need/i);
              if (m) {
                const l = m[1].toLowerCase();
                if (l.includes('argon')) currentPool = 'argon';
                else if (l.includes('claude') || l.includes('gpt')) currentPool = 'claude';
                else if (l.includes('gemini') || l.includes('flash')) currentPool = 'gemini';
              }
            }
            if (line.includes('invoke_subagent')) {
              try {
                const item = JSON.parse(line);
                if (item.type === 'PLANNER_RESPONSE' && Array.isArray(item.tool_calls)) {
                  for (const call of item.tool_calls) {
                    if (call.name === 'invoke_subagent') {
                      const rawModel = String(call.args?.Model || '').replace(/^"|"$/g, '').toLowerCase();
                      let assignedPool = currentPool;
                      if (rawModel.includes('argon')) assignedPool = 'argon';
                      else if (rawModel.includes('claude') || rawModel.includes('gpt')) assignedPool = 'claude';
                      else if (rawModel === 'inherit' || !rawModel) assignedPool = currentPool;
                      else assignedPool = 'gemini';

                      // 放宽至后续 10 行查找子代理 conversationId
                      for (let k = i + 1; k < Math.min(lines.length, i + 11); k++) {
                        try {
                          const retItem = JSON.parse(lines[k]);
                          const contentStr = typeof retItem.content === 'string' ? retItem.content : JSON.stringify(retItem.content || '');
                          const subM = contentStr.match(/["']?conversationId["']?:\s*["']?([a-zA-Z0-9-]+)["']?/);
                          if (subM) {
                            subagentPoolMap[subM[1]] = assignedPool;
                            break;
                          }
                        } catch (_) {}
                      }
                    }
                  }
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }

      // 阶段 2：扫描聚合 8 天内所有会话的 Token、步数与模型分类
      for (const cid of convDirs) {
        const transcriptPath = path.join(BRAIN_DIR, cid, '.system_generated', 'logs', 'transcript.jsonl');
        if (!fs.existsSync(transcriptPath)) continue;

        try {
          const stat = fs.statSync(transcriptPath);
          if (stat.mtimeMs < eightDaysAgoMs) continue;

          const content = fs.readFileSync(transcriptPath, 'utf8');
          const lines = content.split('\n');

          let activePool = subagentPoolMap[cid] || 'gemini';

          for (let j = 0; j < lines.length; j++) {
            const line = lines[j];
            if (!line) continue;

            if (line.includes('Model Selection')) {
              const m = line.match(/Model Selection[\s\S]*?to ([^\n\\]+?)\.\s*No need/i);
              if (m) {
                const l = m[1].toLowerCase();
                if (l.includes('argon')) activePool = 'argon';
                else if (l.includes('claude') || l.includes('gpt')) activePool = 'claude';
                else if (l.includes('gemini') || l.includes('flash')) activePool = 'gemini';
              }
            }

            if (!line.includes('PLANNER_RESPONSE')) continue;

            try {
              const item = JSON.parse(line);
              if (item.type !== 'PLANNER_RESPONSE') continue;

              const d = new Date(item.created_at);
              const dateStr = getLocalDateStr(d);
              const target = daysMap[dateStr];
              if (target) {
                const inp = Number(item.input_tokens) || 0;
                const out = Number(item.output_tokens) || 0;
                const cch = Number(item.cache_read_tokens) || 0;
                const tot = cch + inp + out;

                target.steps += 1;
                target.cacheTokens += cch;
                target.inputTokens += inp;
                target.outputTokens += out;
                target.totalTokens += tot;
                target.sessionsSet.add(cid);

                const mTarget = target.models[activePool] || target.models.gemini;
                mTarget.steps += 1;
                mTarget.cacheTokens += cch;
                mTarget.inputTokens += inp;
                mTarget.outputTokens += out;
                mTarget.totalTokens += tot;
              }
            } catch (_) {}
          }
        } catch (_) {}
      }
    } catch (err) {
      console.error('[usage-stats] 遍历 brain 目录出错:', err.message);
    }
  }

  // 整理数据结构与格式化
  let sevenDaysTokens = 0;
  let sevenDaysSteps = 0;
  let sevenDaysCache = 0;
  let sevenDaysInput = 0;
  let sevenDaysOutput = 0;

  const formattedDays = daysList.map(d => {
    d.sessions = d.sessionsSet.size;
    delete d.sessionsSet;
    d.totalTokensStr = formatTokens(d.totalTokens);
    d.cacheTokensStr = formatTokens(d.cacheTokens);
    d.inputTokensStr = formatTokens(d.inputTokens);
    d.outputTokensStr = formatTokens(d.outputTokens);

    for (const m of Object.values(d.models)) {
      m.totalTokensStr = formatTokens(m.totalTokens);
      m.cacheTokensStr = formatTokens(m.cacheTokens);
      m.inputTokensStr = formatTokens(m.inputTokens);
      m.outputTokensStr = formatTokens(m.outputTokens);
    }

    sevenDaysTokens += d.totalTokens;
    sevenDaysSteps += d.steps;
    sevenDaysCache += d.cacheTokens;
    sevenDaysInput += d.inputTokens;
    sevenDaysOutput += d.outputTokens;
    return d;
  });

  const todayEntry = formattedDays[0];

  const result = {
    today: {
      date: todayEntry.date,
      label: '今天',
      totalTokens: todayEntry.totalTokens,
      totalTokensStr: todayEntry.totalTokensStr,
      cacheTokens: todayEntry.cacheTokens,
      cacheTokensStr: todayEntry.cacheTokensStr,
      inputTokens: todayEntry.inputTokens,
      inputTokensStr: todayEntry.inputTokensStr,
      outputTokens: todayEntry.outputTokens,
      outputTokensStr: todayEntry.outputTokensStr,
      steps: todayEntry.steps,
      sessions: todayEntry.sessions,
      models: todayEntry.models
    },
    sevenDays: {
      totalTokens: sevenDaysTokens,
      totalTokensStr: formatTokens(sevenDaysTokens),
      cacheTokens: sevenDaysCache,
      cacheTokensStr: formatTokens(sevenDaysCache),
      inputTokens: sevenDaysInput,
      inputTokensStr: formatTokens(sevenDaysInput),
      outputTokens: sevenDaysOutput,
      outputTokensStr: formatTokens(sevenDaysOutput),
      totalSteps: sevenDaysSteps,
      days: formattedDays
    }
  };

  cachedStats = result;
  lastCacheTime = now.getTime();
  return result;
}

// --------------------------------------------------------------------------
// 跨会话活跃提问与授权挂起状态检测引擎 (毫秒级零延迟感知)
// 扫描 ~/.gemini/antigravity/brain/ 中 60 分钟内活跃修改的会话 transcript.jsonl
// 读取尾部 64KB 判断是否存在未完成的 ask_question 或阻塞式授权请求
// --------------------------------------------------------------------------
function checkTranscriptPending(filePath, size) {
  try {
    const maxBytes = 65536; // 扩至 64KB 读取缓冲
    const readLen = Math.min(size, maxBytes);
    const buf = Buffer.alloc(readLen);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buf, 0, readLen, size - readLen);
    } finally {
      fs.closeSync(fd);
    }

    const text = buf.toString('utf8');
    const lines = text.trim().split('\n').filter(Boolean);
    let lastPlanner = null;
    let lastPlannerIndex = -1;

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === 'PLANNER_RESPONSE') {
          lastPlanner = obj;
          lastPlannerIndex = i;
          break;
        }
      } catch (_) {}
    }

    if (!lastPlanner) return null;

    let genericCountAfter = 0;
    let hasUserOrNewPlannerAfter = false;

    for (let j = lastPlannerIndex + 1; j < lines.length; j++) {
      try {
        const obj = JSON.parse(lines[j]);
        if (obj.type === 'USER_INPUT' || obj.type === 'PLANNER_RESPONSE') {
          hasUserOrNewPlannerAfter = true;
          break;
        }
        if (obj.type === 'GENERIC') {
          genericCountAfter++;
        }
      } catch (_) {}
    }

    if (hasUserOrNewPlannerAfter) return null;

    const toolCalls = Array.isArray(lastPlanner.tool_calls) ? lastPlanner.tool_calls : [];
    if (toolCalls.length === 0) return null;

    // 若返回的 GENERIC 数量已满足 tool_calls 长度，说明本轮工具都已正常结束
    if (genericCountAfter >= toolCalls.length) return null;

    // 检查是否存在阻塞式交互（排除 invoke_subagent、schedule 等异步工具）
    for (const call of toolCalls) {
      if (!call || !call.name) continue;
      if (call.name === 'ask_question') {
        return { type: 'question' };
      }
      const argsStr = JSON.stringify(call.args || {});
      if (call.name === 'run_command' && (argsStr.includes('"BypassSandbox":true') || argsStr.includes('"BypassSandbox": true'))) {
        return { type: 'approval' };
      }
      if ((call.name === 'write_file' || call.name === 'edit_file') && argsStr.includes('"RequestFeedback":true')) {
        return { type: 'approval' };
      }
    }
  } catch (_) {}
  return null;
}

export function detectPendingPrompts() {
  const now = Date.now();
  if (lastPendingResult && (now - lastPendingTime < PENDING_CACHE_TTL_MS)) {
    return lastPendingResult;
  }

  let result = { type: null, cid: null };
  try {
    if (!fs.existsSync(BRAIN_DIR)) {
      lastPendingResult = result;
      lastPendingTime = now;
      return result;
    }
    const cids = fs.readdirSync(BRAIN_DIR);
    const oneHourAgo = now - 3600000;
    const candidates = [];

    for (const cid of cids) {
      const transcriptPath = path.join(BRAIN_DIR, cid, '.system_generated', 'logs', 'transcript.jsonl');
      if (!fs.existsSync(transcriptPath)) continue;
      try {
        const stat = fs.statSync(transcriptPath);
        if (stat.mtimeMs >= oneHourAgo) {
          candidates.push({ cid, path: transcriptPath, mtimeMs: stat.mtimeMs, size: stat.size });
        }
      } catch (_) {}
    }

    // 按最后写入时间倒序扫描，优先检查最新产生动作的会话
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const cand of candidates) {
      const res = checkTranscriptPending(cand.path, cand.size);
      if (res && res.type) {
        result = { type: res.type, cid: cand.cid };
        break;
      }
    }
  } catch (err) {
    console.error('[usage-stats] detectPendingPrompts 出错:', err.message);
  }

  lastPendingResult = result;
  lastPendingTime = now;
  return result;
}
