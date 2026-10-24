// Antigravity 本地语言服务器额度探测引擎
// 自动探测运行中的 language_server.exe 进程、提取端口与 CSRF Token，并调用 GetUserStatus RPC
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';

const execFileAsync = promisify(execFile);

let cachedStatus = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 15000; // 15秒缓存

let cachedServerMeta = null;
let lastDetectTime = 0;
const DETECT_TTL_MS = 60000; // 60秒重新探测进程

let inFlightFetchPromise = null;

// 针对本地自签名 HTTPS 接口的局部 Agent，彻底避免污染全局 NODE_TLS_REJECT_UNAUTHORIZED
const localHttpsAgent = new https.Agent({
  rejectUnauthorized: false
});

/**
 * 局部安全的本地 HTTPS POST 请求
 */
function localPost(urlStr, headers, bodyStr, timeoutMs = 3000) {
  const parsed = new URL(urlStr);
  const isHttps = parsed.protocol === 'https:';

  if (!isHttps) {
    return fetch(urlStr, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(timeoutMs)
    }).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
  }

  // HTTPS 使用局部 rejectUnauthorized: false 的 https.request
  return new Promise((resolve, reject) => {
    const req = https.request(parsed, {
      method: 'POST',
      headers,
      agent: localHttpsAgent,
      timeout: timeoutMs
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTPS ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

export async function detectLanguageServer() {
  const now = Date.now();
  if (cachedServerMeta && (now - lastDetectTime < DETECT_TTL_MS)) {
    return cachedServerMeta;
  }

  // 匹配所有 language_server 候选进程，支持多实例并发与准确筛选
  const psScript = `
$procs = Get-CimInstance Win32_Process -Filter "name LIKE 'language_server%.exe'"
$results = @()
foreach ($p in $procs) {
    $ports = (Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort)
    if ($ports) {
        $results += [PSCustomObject]@{
            Pid = $p.ProcessId
            CommandLine = $p.CommandLine
            Ports = $ports
        }
    }
}
$results | ConvertTo-Json -Compress
`;
  try {
    const base64 = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-EncodedCommand', base64], {
      timeout: 4000,
      windowsHide: true
    });
    if (!stdout.trim()) {
      cachedServerMeta = null;
      return null;
    }

    let parsed = JSON.parse(stdout.trim());
    if (!Array.isArray(parsed)) parsed = [parsed];

    // 从候选列表中筛选出包含 csrf_token 且端口有效的活跃服务器
    let targetMeta = null;
    for (const raw of parsed) {
      const tokenMatch = raw.CommandLine?.match(/--csrf_token\s+([0-9a-fA-F-]+)/);
      const csrfToken = tokenMatch ? tokenMatch[1] : null;
      const ports = Array.isArray(raw.Ports) ? raw.Ports : [raw.Ports].filter(Boolean);
      if (csrfToken && ports.length > 0) {
        targetMeta = {
          pid: raw.Pid,
          csrfToken,
          ports
        };
        break;
      }
    }

    cachedServerMeta = targetMeta;
    lastDetectTime = now;
    return cachedServerMeta;
  } catch (err) {
    console.error('[quota-probe] 探测 language_server 失败:', err.message);
    cachedServerMeta = null;
    return null;
  }
}

function formatCountdown(resetTimeIso) {
  if (!resetTimeIso) return '';
  const diffMs = new Date(resetTimeIso).getTime() - Date.now();
  if (diffMs <= 0) return '即将刷新';
  const totalMin = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}天${remHours}时后`;
  }
  if (hours > 0) return `${hours}时${mins}分后`;
  return `${mins}分钟后`;
}

// 剥离档位后缀，提取基础模型名
export function cleanModelBaseLabel(label = '') {
  return (label || '').replace(/\s*\((Low|Medium|High)\)\s*$/i, '').trim();
}

// 确定性模型排序规则权重
export function getModelSortWeight(label = '') {
  const l = (label || '').toLowerCase();
  if (l.includes('gemini') && l.includes('flash')) return 10;
  if (l.includes('gemini') && l.includes('argon')) return 20;
  if (l.includes('gemini')) return 25;
  if (l.includes('claude') && l.includes('sonnet')) return 30;
  if (l.includes('claude') && l.includes('opus')) return 40;
  if (l.includes('claude')) return 45;
  if (l.includes('gpt')) return 50;
  return 90;
}

// 智能条件合并与确定性排序：
// 1. 按基础模型名分组，组内按 Low -> Medium -> High 固定排序
// 2. 检查组内条目的配额指标（remainingPctStr 与精确 resetTime）是否全部相同：
//    - 若完全一致（当前常态）：合并为 1 条，标题直接用清爽的 baseLabel
//    - 若存在不同（防御未来）：不合并，保留 Low/Medium/High 分档展开展示
// 3. 组间按大类权重（Gemini Flash -> Argon -> Sonnet -> Opus -> GPT）确定性排列
export function smartDeduplicateAndSortModels(rawModels) {
  if (!Array.isArray(rawModels)) return [];

  const groupMap = new Map();
  for (const m of rawModels) {
    const baseLabel = cleanModelBaseLabel(m.label || m.modelId || '');
    if (!baseLabel) continue;
    if (!groupMap.has(baseLabel)) groupMap.set(baseLabel, []);
    groupMap.get(baseLabel).push(m);
  }

  const getTierWeight = (lbl = '') => {
    if (lbl.includes('(Low)')) return 1;
    if (lbl.includes('(Medium)')) return 2;
    if (lbl.includes('(High)')) return 3;
    return 4;
  };

  const finalList = [];
  for (const [baseLabel, list] of groupMap.entries()) {
    list.sort((a, b) => getTierWeight(a.label) - getTierWeight(b.label));
    let allSame = true;
    if (list.length > 1) {
      const first = list[0];
      for (let i = 1; i < list.length; i++) {
        const item = list[i];
        if (item.remainingPctStr !== first.remainingPctStr || item.resetTime !== first.resetTime) {
          allSame = false;
          break;
        }
      }
    }

    if (allSame) {
      finalList.push({
        ...list[0],
        label: baseLabel
      });
    } else {
      finalList.push(...list);
    }
  }

  return finalList.sort((a, b) => {
    const wa = getModelSortWeight(a.label);
    const wb = getModelSortWeight(b.label);
    if (wa !== wb) return wa - wb;
    const baseA = cleanModelBaseLabel(a.label);
    const baseB = cleanModelBaseLabel(b.label);
    if (baseA !== baseB) return baseA.localeCompare(baseB);
    return getTierWeight(a.label) - getTierWeight(b.label);
  });
}

export function sortModels(models) {
  return smartDeduplicateAndSortModels(models);
}

export async function fetchAntigravityStatus(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedStatus && (now - lastFetchTime < CACHE_TTL_MS)) {
    return cachedStatus;
  }

  // 并发去重锁，避免同时发起多个探测
  if (inFlightFetchPromise) {
    return inFlightFetchPromise;
  }

  inFlightFetchPromise = (async () => {
    try {
      const meta = await detectLanguageServer();
      if (!meta || !meta.ports.length) {
        return {
          connected: false,
          error: '未检测到运行中的 Antigravity 语言服务器进程 (language_server.exe)'
        };
      }

      const body = JSON.stringify({
        metadata: { ide_name: 'antigravity', ide_version: '2.24.0' }
      });
      const headers = {
        'Content-Type': 'application/json',
        'X-Codeium-Csrf-Token': meta.csrfToken || ''
      };

      let rawData = null;
      let activePort = null;
      let activeProto = null;

      // 依次遍历端口与协议（优先 HTTP，HTTPS 使用局部零污染 Agent）
      for (const port of meta.ports) {
        for (const proto of ['http', 'https']) {
          try {
            const url = `${proto}://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`;
            rawData = await localPost(url, headers, body, 3000);
            if (rawData && rawData.userStatus) {
              activePort = port;
              activeProto = proto;
              break;
            }
          } catch (_) {
            // 继续尝试
          }
        }
        if (rawData && rawData.userStatus) break;
      }

      // 所有端口均连接失败时，立即重置 cachedServerMeta，防止缓存失效期持续报错
      if (!rawData || !rawData.userStatus) {
        cachedServerMeta = null;
        lastDetectTime = 0;
        return {
          connected: false,
          error: '无法连接到本地 GetUserStatus 接口'
        };
      }

      const u = rawData.userStatus;
      const planInfo = u.planStatus?.planInfo || {};
      const modelConfigs = u.cascadeModelConfigData?.clientModelConfigs || [];

      const rawModels = modelConfigs.map(m => {
        const qi = m.quotaInfo;
        let remainingFraction = 1;
        if (qi && typeof qi.remainingFraction === 'number') {
          remainingFraction = qi.remainingFraction;
        } else if (qi && qi.resetTime) {
          // Protobuf v3 JSON 省略了默认值为 0 的 remainingFraction，但存在 resetTime 说明该模型配额已耗尽归零 (0%)
          remainingFraction = 0;
        }
        const remainingPct = Math.round(remainingFraction * 100);
        const resetTime = qi?.resetTime || null;
        return {
          label: m.label,
          modelId: m.modelId || m.modelOrAlias?.model || '',
          remainingFraction,
          remainingPct,
          remainingPctStr: `${(remainingFraction * 100).toFixed(1)}%`,
          resetTime,
          resetCountdown: formatCountdown(resetTime)
        };
      });

      const models = sortModels(rawModels);

      // 聚合三大核心配额池（Gemini、Claude/GPT、Gemini 4 Argon）
      const geminiFlash = models.find(m => m.label.includes('Gemini 3.8 Flash') || m.label.includes('Flash')) || null;
      const geminiArgon = models.find(m => m.label.includes('Gemini 4 Argon') || m.label.includes('Argon')) || null;
      const claudeSonnet = models.find(m => m.label.includes('Claude Sonnet')) || null;
      const claudeOpus = models.find(m => m.label.includes('Claude Opus')) || null;
      const claudeGpt = models.find(m => m.label.includes('Claude') || m.label.includes('GPT')) || claudeSonnet || claudeOpus || null;

      const summaryGroups = [
        {
          id: 'gemini',
          name: 'Gemini',
          label: 'Gemini (Flash)',
          remainingPct: geminiFlash && typeof geminiFlash.remainingPct === 'number' ? geminiFlash.remainingPct : 100,
          remainingPctStr: geminiFlash ? geminiFlash.remainingPctStr : '100%',
          resetCountdown: geminiFlash ? geminiFlash.resetCountdown : ''
        },
        {
          id: 'claude-gpt',
          name: 'Claude / GPT',
          label: 'Claude & GPT',
          remainingPct: claudeGpt && typeof claudeGpt.remainingPct === 'number' ? claudeGpt.remainingPct : 100,
          remainingPctStr: claudeGpt ? claudeGpt.remainingPctStr : '100%',
          resetCountdown: claudeGpt ? claudeGpt.resetCountdown : ''
        },
        {
          id: 'argon',
          name: 'Argon (周)',
          label: 'Gemini 4 Argon',
          remainingPct: geminiArgon && typeof geminiArgon.remainingPct === 'number' ? geminiArgon.remainingPct : 100,
          remainingPctStr: geminiArgon ? geminiArgon.remainingPctStr : '100%',
          resetCountdown: geminiArgon ? geminiArgon.resetCountdown : ''
        }
      ];

      let primaryBubble = '';
      if (geminiFlash) {
        primaryBubble = `Flash: ${geminiFlash.remainingPctStr} (${geminiFlash.resetCountdown})`;
      } else if (geminiArgon) {
        primaryBubble = `Argon: ${geminiArgon.remainingPctStr} (${geminiArgon.resetCountdown})`;
      } else if (models.length) {
        primaryBubble = `${models[0].label}: ${models[0].remainingPctStr}`;
      }

      const result = {
        connected: true,
        lastUpdated: new Date().toISOString(),
        user: {
          name: u.name || 'Antigravity User',
          email: u.email || ''
        },
        plan: {
          planName: planInfo.planName || 'Free',
          tier: planInfo.teamsTier || '',
          monthlyPromptCredits: planInfo.monthlyPromptCredits || 0,
          monthlyFlowCredits: planInfo.monthlyFlowCredits || 0,
          availablePromptCredits: u.planStatus?.availablePromptCredits ?? 0,
          availableFlowCredits: u.planStatus?.availableFlowCredits ?? 0
        },
        primaryBubble,
        summaryGroups,
        highlightModels: {
          geminiFlash,
          geminiArgon,
          claudeSonnet,
          claudeOpus
        },
        models,
        server: {
          pid: meta.pid,
          port: activePort,
          protocol: activeProto
        }
      };

      cachedStatus = result;
      lastFetchTime = Date.now();
      return result;
    } finally {
      inFlightFetchPromise = null;
    }
  })();

  return inFlightFetchPromise;
}
