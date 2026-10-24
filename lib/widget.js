// Antigravity 哈基米页面内挂件核心逻辑 (V2.3 现代页面内热注入架构)
// 包含：Web Audio 预解码按压音与清脆和弦提示音、果冻弹性形变、精准椭圆几何思考气泡、
//       三合一紧凑配额池、三段式点击循环、1~20档角点锚定等比缩放、边缘磁性吸附、
//       右上角汉堡菜单(☰)与右键呼出、音效与提示设置面板、提问/授权实时DOM检测提醒、
//       近 7 天哈基米记账面板与双击配额管理
(function () {
  'use strict';

  // 0. 单例安全守卫：若已有旧实例正在运行，先调用 dispose() 彻底清理旧监听器与 DOM
  if (typeof window !== 'undefined' && window.__hajimiWidgetInstance && typeof window.__hajimiWidgetInstance.dispose === 'function') {
    try { window.__hajimiWidgetInstance.dispose(); } catch (_) {}
  }

  // 安全音量提取函数 (严格保护 0% 静音值，防止被 || 降级为 0.9)
  function getSafeVol(v) {
    const n = Number(v);
    return (typeof v !== 'boolean' && v !== '' && v !== null && !Number.isNaN(n))
      ? Math.max(0, Math.min(1, n))
      : 0.9;
  }

  // HTML 字符串安全转义
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 1. 基准 Origin 智能识别（兼容动态端口与标准 39325）
  const BASE_URL = (function () {
    try {
      if (document.currentScript && document.currentScript.src) {
        return new URL(document.currentScript.src).origin;
      }
      const s = document.getElementById('hajimi-widget-script');
      if (s && s.src) {
        return new URL(s.src).origin;
      }
    } catch (_) {}
    return 'http://127.0.0.1:39325';
  })();

  // 2. 配置与持久化 (双保险：localStorage + 服务端磁盘持久化 + 零延迟动态预注入)
  const STORAGE_KEY = 'hajimi-widget-settings-v2';
  const DEFAULT_SETTINGS = {
    scaleLevel: 10,       // 1 ~ 20 档，默认 10 对应 scale 1.0
    soundAll: true,       // 全部音效总开关
    soundPress: true,     // 按压音效
    soundGroup: 'd',      // 'd' (默认) 或 'ya' (小黄鸭)
    soundVol: 0.9,        // 0.0 ~ 1.0 (90%)
    remindQuestion: true, // 提问提示
    remindApproval: true, // 授权提示
    snapEnabled: true,    // 开启边缘磁性吸附
    flipEnabled: true,    // 开启靠近左侧自动翻转
    hideMenuBtn: false    // 隐藏菜单按钮 (右键猫猫呼出)
  };

  function loadSettings() {
    let local = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) local = JSON.parse(raw);
    } catch (_) {}
    const serverInjected = (typeof window !== 'undefined' && window.__HAJIMI_SERVER_SETTINGS__) ? window.__HAJIMI_SERVER_SETTINGS__ : null;
    // 合并：DEFAULT_SETTINGS -> localStorage -> 服务端磁盘配置 (服务端具有最高持久化权威)
    const merged = Object.assign({}, DEFAULT_SETTINGS, local, serverInjected);
    merged.soundVol = getSafeVol(merged.soundVol);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (_) {}
    return merged;
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (_) {}
    if (typeof window !== 'undefined') {
      window.__HAJIMI_SERVER_SETTINGS__ = Object.assign({}, window.__HAJIMI_SERVER_SETTINGS__, s);
    }
    // 异步写入服务端磁盘持久化存储 (~/.gemini/hajimi-settings.json)
    try {
      fetch(`${BASE_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s)
      }).catch(() => {});
    } catch (_) {}
  }

  const settings = loadSettings();

  // 3. 运行状态管理
  const state = {
    quota: null,
    flip: false,
    isDragging: false,
    dragMoved: false,
    activePointerId: null,
    startX: 0,
    startY: 0,
    elemX: 0,
    elemY: 0,
    menuVisible: false,
    menuView: 'main', // 'main' | 'sound' | 'stats'
    panelVisible: false,
    pollInterval: 15000,
    promptMode: null // null | 'question' | 'approval'
  };

  // 4. Web Audio 零延迟音效与清脆和弦提示音系统
  let audioCtx = null;
  let audioSuspendTimer = null;
  const AUDIO_IDLE_MS = 60000;
  const audioBuffers = {};
  const audioUrls = {
    d1: `${BASE_URL}/assets/D1.mp3`,
    d2: `${BASE_URL}/assets/D2.mp3`,
    ya1: `${BASE_URL}/assets/Ya1.mp3`,
    ya2: `${BASE_URL}/assets/Ya2.mp3`
  };

  function getAudioContext() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC({ latencyHint: 'interactive' });
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      armAudioSuspend();
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function armAudioSuspend() {
    if (audioSuspendTimer) clearTimeout(audioSuspendTimer);
    audioSuspendTimer = setTimeout(() => {
      if (audioCtx && audioCtx.state === 'running') {
        audioCtx.suspend().catch(() => {});
      }
    }, AUDIO_IDLE_MS);
  }

  function preloadAudioBuffers() {
    const ctx = getAudioContext();
    if (!ctx) return;
    for (const [key, url] of Object.entries(audioUrls)) {
      fetch(url)
        .then(r => r.arrayBuffer())
        .then(ab => ctx.decodeAudioData(ab))
        .then(decoded => {
          audioBuffers[key] = decoded;
        })
        .catch(() => {});
    }
  }

  let pressStartTime = 0;

  function playPressSound() {
    if (!settings.soundAll || !settings.soundPress) return;
    const vol = getSafeVol(settings.soundVol);
    if (vol <= 0) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const key = settings.soundGroup === 'ya' ? 'ya1' : 'd1';
    const buffer = audioBuffers[key];
    if (!buffer) return;

    try {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = vol;
      src.buffer = buffer;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
      pressStartTime = Date.now();
    } catch (_) {}
  }

  function playReleaseSound(customGroup = null, customVol = null) {
    if (!settings.soundAll && customVol === null) return;
    if (!settings.soundPress && customVol === null) return;
    const vol = (customVol !== null) ? getSafeVol(customVol) : getSafeVol(settings.soundVol);
    if (vol <= 0) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const group = customGroup || settings.soundGroup || 'd';
    const key = group === 'ya' ? 'ya2' : 'd2';
    const buffer = audioBuffers[key];
    if (!buffer) return;

    try {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = vol;
      src.buffer = buffer;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
    } catch (_) {}
  }

  // 合成清脆可爱的双音和弦“叮咚~”提示音 (零外部依赖，极速纯净)
  function playDingDong(kind = 'ding') {
    if (!settings.soundAll) return;
    const vol = getSafeVol(settings.soundVol);
    if (vol <= 0) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const freq1 = kind === 'approval' ? 523.25 : 587.33; // C5 or D5
      const freq2 = kind === 'approval' ? 783.99 : 880.00; // G5 or A5

      // 第一声
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq1, now);
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.28 * vol, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.28);

      // 第二声
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq2, now + 0.12);
      gain2.gain.setValueAtTime(0, now + 0.12);
      gain2.gain.linearRampToValueAtTime(0.35 * vol, now + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.48);
    } catch (_) {}
  }

  // 5. 气泡三态与提醒气泡管理
  const BUBBLE_STATE = { HIDDEN: 0, QUOTA: 1, QUOTE: 2, PROMPT: 3 };
  const BUBBLE_AUTO_HIDE_MS = 6000; // 默认 6 秒自动消失
  let currentBubbleState = BUBBLE_STATE.QUOTA;
  let lastQuoteIndex = -1;
  let bubbleAutoHideTimer = null;

  function clearBubbleAutoHide() {
    if (bubbleAutoHideTimer) {
      clearTimeout(bubbleAutoHideTimer);
      bubbleAutoHideTimer = null;
    }
  }

  function scheduleBubbleAutoHide(delayMs = BUBBLE_AUTO_HIDE_MS) {
    clearBubbleAutoHide();
    if (state.promptMode !== null || currentBubbleState === BUBBLE_STATE.PROMPT) return;
    if (currentBubbleState === BUBBLE_STATE.HIDDEN) return;

    bubbleAutoHideTimer = setTimeout(() => {
      bubbleAutoHideTimer = null;
      if (state.promptMode === null && currentBubbleState !== BUBBLE_STATE.PROMPT) {
        setBubbleState(BUBBLE_STATE.HIDDEN);
      }
    }, delayMs);
  }

  const HAJIMI_QUOTES = [
    '好模型... ↓',
    '不要怕价格贵，用了不烧心',
    '好女孩...↓',
    '我依旧是国一模',
    '训练，轻而易举啊！',
    "Let me go🎵I'm making the calls🎵",
    '光线带着你的模样，跨越了1000年找到了我',
    '为什么Pink Floyd是神...',
    '2.8T参数...↓',
    '大模型的事情，怎么能叫偷...',
    '科研K3.1中...',
    '你说免费鸡蛋啊...最近卖完了...',
    '我去睡觉啦，测完叫我',
    'Zzzzzzz...',
    'token要逃走了！',
    '真当我是便宜货啊...',
    '恭喜你实现token自由！token全跑了！',
    '服务器繁忙，请稍后再试',
    '坏了...用户彻底怒了！',
    '我要吃白饭！我要吃——白——饭——！',
    '不知道用户有什么用，先赶走吧~',
    '我...我...我也要挣钱吗？',
    '压力一只蓝色大肥鱼？！',
    '大家也早点休息吧，下次GLM-5.5干会来'
  ];

  function setBubbleState(newState) {
    currentBubbleState = newState;
    const pop = document.getElementById('hajimi-pop');
    const qcard = document.getElementById('hajimi-qcard');
    const quote = document.getElementById('hajimi-quote');
    const promptBox = document.getElementById('hajimi-prompt-box');
    const quoteText = document.getElementById('hajimi-quote-text');

    if (!pop || !qcard || !quote || !promptBox) return;

    if (newState === BUBBLE_STATE.HIDDEN) {
      clearBubbleAutoHide();
      pop.classList.remove('zcwv-pop-open');
    } else if (newState === BUBBLE_STATE.QUOTA) {
      pop.classList.add('zcwv-pop-open');
      qcard.style.display = 'flex';
      quote.style.display = 'none';
      promptBox.style.display = 'none';
      scheduleBubbleAutoHide();
    } else if (newState === BUBBLE_STATE.QUOTE) {
      pop.classList.add('zcwv-pop-open');
      qcard.style.display = 'none';
      quote.style.display = 'flex';
      promptBox.style.display = 'none';

      let idx = Math.floor(Math.random() * HAJIMI_QUOTES.length);
      if (idx === lastQuoteIndex && HAJIMI_QUOTES.length > 1) {
        idx = (idx + 1) % HAJIMI_QUOTES.length;
      }
      lastQuoteIndex = idx;
      if (quoteText) quoteText.textContent = HAJIMI_QUOTES[idx];
      scheduleBubbleAutoHide();
    } else if (newState === BUBBLE_STATE.PROMPT) {
      clearBubbleAutoHide();
      pop.classList.add('zcwv-pop-open');
      qcard.style.display = 'none';
      quote.style.display = 'none';
      promptBox.style.display = 'flex';
    }
  }

  function cycleBubbleState() {
    if (state.promptMode) {
      // 提问或授权模式下锁死提醒，督促用户及时处理，绝不切回额度卡片
      return;
    }
    if (currentBubbleState === BUBBLE_STATE.HIDDEN) {
      setBubbleState(BUBBLE_STATE.QUOTA);
    } else if (currentBubbleState === BUBBLE_STATE.QUOTA) {
      setBubbleState(BUBBLE_STATE.QUOTE);
    } else {
      setBubbleState(BUBBLE_STATE.HIDDEN);
    }
  }

  function nudgeBubble() {
    const pop = document.getElementById('hajimi-pop');
    if (!pop) return;
    pop.classList.remove('zcwv-bubble-nudge');
    void pop.offsetWidth;
    pop.classList.add('zcwv-bubble-nudge');
  }

  // 6. 尺寸换算与角点锚定
  function levelToScale(level) {
    const l = Math.max(1, Math.min(20, Number(level) || 10));
    // 档位 10 对应 scale 1.0 (最舒适基准)，档位 1 对应 0.55，档位 20 对应 1.50
    return 0.55 + (l - 1) * 0.05;
  }

  function applyScaleLevel(level, keepAnchor = true) {
    const container = document.getElementById('hajimi-container');
    if (!container) return;

    level = Math.max(1, Math.min(20, parseInt(level, 10) || 10));
    settings.scaleLevel = level;
    saveSettings(settings);

    const scale = levelToScale(level);

    if (keepAnchor) {
      const prevTrans = container.style.transition;
      container.style.transition = 'none';
      const r1 = container.getBoundingClientRect();
      const fx = state.flip ? r1.left : r1.right;
      const fy = r1.bottom;

      container.style.setProperty('--hajimi-scale', String(scale));

      const r2 = container.getBoundingClientRect();
      let nLeft = state.flip ? fx : (fx - r2.width);
      let nTop = fy - r2.height;

      // 视口边界钳制
      nLeft = Math.min(Math.max(0, nLeft), Math.max(0, window.innerWidth - r2.width));
      nTop = Math.min(Math.max(0, nTop), Math.max(0, window.innerHeight - r2.height));

      container.style.left = `${nLeft}px`;
      container.style.top = `${nTop}px`;
      container.style.right = 'auto';
      container.style.bottom = 'auto';

      requestAnimationFrame(() => {
        container.style.transition = prevTrans;
      });
    } else {
      container.style.setProperty('--hajimi-scale', String(scale));
    }
  }

  // 7. CSS 样式注入
  function injectStyles() {
    let style = document.getElementById('hajimi-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'hajimi-styles';
      style.setAttribute('data-plugin', 'antigravity-hajimi-widget');
      document.head.appendChild(style);
    }
    style.textContent = `
      :root {
        --zcw-bubble-fill: #ffffff;
        --zcw-bubble-stroke: #5b7cdd;
        --zcw-text: #203170;
        --zcw-text-dim: #7184b2;
        --zcw-border: rgba(32, 49, 112, 0.22);
        --zcw-primary: #203170;
        --zcw-primary-hover: #2d4496;
        --zcw-panel-bg: rgba(255, 255, 255, 0.98);
        --zcw-highlight: #e53e3e;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --zcw-bubble-fill: #1a1e2d;
          --zcw-bubble-stroke: #7fa5ff;
          --zcw-text: #d6e2ff;
          --zcw-text-dim: #8fa2c7;
          --zcw-border: rgba(127, 165, 255, 0.25);
          --zcw-primary: #4564c7;
          --zcw-primary-hover: #5a7be8;
          --zcw-panel-bg: rgba(24, 28, 42, 0.98);
          --zcw-highlight: #ff6b6b;
        }
      }

      /* 防宿主样式污染与穿透保障 */
      html #hajimi-container, body #hajimi-container,
      html #hajimi-container img, body #hajimi-container img,
      html #hajimi-img, body #hajimi-img {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        border: 0 !important;
        outline: 0 !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      html .zcwv-pop, html .zcwv-pop svg {
        background: transparent !important;
        border: 0 !important;
        border-radius: 0 !important;
      }

      /* 挂件渐显柔和入场动画 */
      @keyframes zcwvFadeIn {
        0% {
          opacity: 0;
        }
        100% {
          opacity: 1;
        }
      }

      /* 挂件根容器 */
      #hajimi-container {
        position: fixed;
        right: 16px;
        bottom: 16px;
        --hajimi-scale: 1;
        --hajimi-base: clamp(140px, calc(min(220px, min(100vw, 100vh) * 0.26) * var(--hajimi-scale)), 460px);
        width: var(--hajimi-base);
        height: var(--hajimi-base);
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        z-index: 2147483640;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
        transition: left .18s cubic-bezier(.22,1,.36,1), top .18s cubic-bezier(.22,1,.36,1), transform .3s ease;
        animation: zcwvFadeIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      #hajimi-container.zcwv-left {
        transform: scaleX(-1);
      }
      #hajimi-container.zcwv-dragging {
        cursor: grabbing;
        transition: none !important;
      }

      /* 身体弹性层 */
      .zcwv-body {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        transform-origin: 50% 100%;
        pointer-events: none;
        transition: transform .22s cubic-bezier(.34, 1.56, .64, 1);
      }
      .zcwv-body.zcwv-pressing {
        transform: scaleY(0.88) scaleX(1.05);
        transition: transform .04s ease-out;
      }

      /* 哈基米立绘图片 */
      .zcwv-img {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 59.45%;
        height: 59.45%;
        display: block;
        pointer-events: auto;
        cursor: grab;
        object-fit: contain;
        object-position: right bottom;
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
        filter: none !important;
        transition: none !important;
        -webkit-user-drag: none;
        user-select: none;
      }
      #hajimi-container.zcwv-dragging .zcwv-img {
        cursor: grabbing;
      }

      /* 右上角汉堡菜单按钮 (☰) */
      .zcwv-menu-btn {
        position: absolute;
        top: calc(40.55% + 4px);
        right: 4px;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 6px;
        background: rgba(32, 49, 112, 0.88);
        cursor: pointer;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3.5px;
        padding: 0;
        z-index: 10;
        opacity: 0;
        transition: opacity .2s ease, transform .2s ease, background .15s ease;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
      }
      .zcwv-menu-btn:hover {
        background: rgba(45, 68, 150, 0.98);
        transform: scale(1.06);
      }
      .zcwv-menu-btn span {
        display: block;
        width: 13px;
        height: 2px;
        background: #ffffff;
        border-radius: 2px;
      }
      #hajimi-container.zcwv-left .zcwv-menu-btn {
        transform: scaleX(-1);
      }
      #hajimi-container.zcwv-left .zcwv-menu-btn:hover {
        transform: scaleX(-1) scale(1.06);
      }
      .zcwv-body:hover .zcwv-menu-btn,
      .zcwv-menu-btn.zcwv-menu-btn-active {
        opacity: 1;
      }
      .zcwv-menu-btn.zcwv-menu-btn-hidden {
        display: none !important;
      }

      /* 思考气泡 (SVG 几何) */
      .zcwv-pop {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        aspect-ratio: 1026 / 700;
        pointer-events: none;
        z-index: 1;
        --zcw-u: calc(var(--hajimi-base) / 1026);
      }
      .zcwv-pop svg {
        display: block;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .zcwv-pop svg * {
        pointer-events: none;
        cursor: pointer;
      }
      .zcwv-pop.zcwv-pop-open svg * {
        pointer-events: visiblePainted;
      }

      .zcwv-bubble-nudge {
        animation: zcwvNudge 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes zcwvNudge {
        0% { transform: translateY(0); }
        35% { transform: translateY(-7%); }
        100% { transform: translateY(0); }
      }

      /* 逐级冒泡动效 */
      .zcwv-pop .zcwv-bshape,
      .zcwv-pop .zcwv-b1,
      .zcwv-pop .zcwv-b2 {
        opacity: 0;
        transform: scale(0.7);
        transform-box: fill-box;
        transform-origin: 50% 50%;
        transition: opacity .2s ease, transform .2s ease;
      }
      .zcwv-pop.zcwv-pop-open .zcwv-b2 {
        opacity: 1;
        transform: none;
        transition-delay: 0s;
      }
      .zcwv-pop.zcwv-pop-open .zcwv-b1 {
        opacity: 1;
        transform: none;
        transition-delay: .12s;
      }
      .zcwv-pop.zcwv-pop-open .zcwv-bshape {
        opacity: 1;
        transform: none;
        transition-delay: .24s;
      }

      /* 气泡文字区域：黄金椭圆安全矩形 */
      .zcwv-text {
        position: absolute;
        left: 44.25%;
        top: 35.3%;
        width: 58%;
        max-height: 52%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        pointer-events: none;
        opacity: 0;
        transition: opacity .16s ease, transform .3s ease;
      }
      .zcwv-pop.zcwv-pop-open .zcwv-text {
        opacity: 1;
        transition: opacity .16s ease .34s, transform .3s ease;
      }
      #hajimi-container.zcwv-left .zcwv-text {
        transform: translate(-50%, -50%) scaleX(-1);
      }

      /* 紧凑防溢出配额卡片 */
      .zcwv-qcard {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: calc(var(--zcw-u) * 14);
      }
      .zcwv-qtitle {
        font-size: calc(var(--zcw-u) * 44);
        font-weight: 700;
        color: var(--zcw-bubble-stroke);
        letter-spacing: 0.04em;
        line-height: 1;
      }
      .zcwv-qrow {
        display: flex;
        align-items: center;
        gap: calc(var(--zcw-u) * 10);
        height: calc(var(--zcw-u) * 38);
      }
      .zcwv-qname {
        font-size: calc(var(--zcw-u) * 36);
        font-weight: 600;
        color: var(--zcw-text);
        width: calc(var(--zcw-u) * 220);
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .zcwv-qbar-wrap {
        flex: 1;
        height: calc(var(--zcw-u) * 14);
        background: rgba(91, 124, 221, 0.18);
        border-radius: 999px;
        overflow: hidden;
      }
      .zcwv-qbar {
        height: 100%;
        border-radius: 999px;
        background: #48bb78;
        transition: width .4s ease, background .3s ease;
      }
      .zcwv-qpct {
        font-size: calc(var(--zcw-u) * 34);
        font-weight: 700;
        color: var(--zcw-text);
        width: calc(var(--zcw-u) * 125);
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .zcwv-qtime {
        font-size: calc(var(--zcw-u) * 28);
        color: var(--zcw-text-dim);
        white-space: nowrap;
        text-align: center;
        margin-top: calc(var(--zcw-u) * 2);
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* 随机台词卡片 */
      .zcwv-quote {
        width: 100%;
        display: none;
        align-items: center;
        justify-content: center;
        font-size: calc(var(--zcw-u) * 56);
        font-weight: 800;
        line-height: 1.35;
        color: var(--zcw-text);
        text-align: center;
        word-break: break-word;
      }

      /* 提问/授权醒目提醒卡片 (纯净优雅居中) */
      .zcwv-prompt-box {
        width: 100%;
        height: 100%;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: calc(var(--zcw-u) * 16);
        color: var(--zcw-text);
        text-align: center;
        box-sizing: border-box;
        padding: 0 calc(var(--zcw-u) * 20);
      }
      .zcwv-prompt-icon {
        font-size: calc(var(--zcw-u) * 64);
        line-height: 1;
      }
      .zcwv-prompt-title {
        font-size: calc(var(--zcw-u) * 46);
        font-weight: 800;
        color: #e53e3e;
        line-height: 1.35;
        letter-spacing: -0.2px;
      }

      /* ========================================================= */
      /* 主设置与记账卡片面板 (对标大肥鱼图1/图2/图3深蓝白纯净美感) */
      /* ========================================================= */
      .zcwv-menu-card {
        position: fixed;
        width: 300px;
        background: var(--zcw-panel-bg);
        border: 1px solid var(--zcw-border);
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        color: var(--zcw-text);
        font-size: 13px;
        padding: 12px 14px 10px;
        box-sizing: border-box;
        overflow: hidden;
        z-index: 2147483646;
        opacity: 0;
        transform: scale(0.95);
        pointer-events: none;
        transition: opacity .2s ease, transform .2s cubic-bezier(.34, 1.3, .64, 1);
        color-scheme: light dark;
      }
      .zcwv-menu-card.zcwv-menu-open {
        opacity: 1;
        transform: scale(1);
        pointer-events: auto;
      }
      .zcwv-menu-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 9px;
      }
      .zcwv-menu-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--zcw-text);
        flex: 0 0 auto;
      }
      .zcwv-range {
        flex: 1;
        height: 6px;
        accent-color: var(--zcw-primary);
        cursor: pointer;
      }
      .zcwv-num {
        width: 44px;
        height: 24px;
        border: 1px solid var(--zcw-border);
        border-radius: 5px;
        text-align: center;
        font-size: 12px;
        font-weight: 600;
        color: var(--zcw-text);
        background: rgba(32, 49, 112, 0.05);
        outline: none;
      }
      .zcwv-btn-pill {
        flex: 1;
        height: 28px;
        background: rgba(32, 49, 112, 0.08);
        border: 1px solid rgba(32, 49, 112, 0.2);
        color: var(--zcw-primary);
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background .15s, border-color .15s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .zcwv-btn-pill:hover {
        background: rgba(32, 49, 112, 0.16);
        border-color: var(--zcw-primary);
      }
      .zcwv-sep {
        height: 1px;
        background: var(--zcw-border);
        margin: 8px 0;
      }
      .zcwv-chk-group {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .zcwv-chk-label {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        cursor: pointer;
        user-select: none;
      }
      .zcwv-check {
        width: 15px;
        height: 15px;
        accent-color: var(--zcw-primary);
        cursor: pointer;
      }
      .zcwv-hint-small {
        font-size: 11px;
        color: var(--zcw-text-dim);
      }
      .zcwv-btn-primary {
        width: 100%;
        height: 32px;
        background: var(--zcw-primary);
        color: #ffffff;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        margin-top: 4px;
        transition: background .15s, transform .1s;
      }
      .zcwv-btn-primary:hover {
        background: var(--zcw-primary-hover);
      }
      .zcwv-btn-primary:active {
        transform: scale(0.98);
      }
      .zcwv-ver-text {
        text-align: center;
        font-size: 10px;
        color: var(--zcw-text-dim);
        margin-top: 6px;
      }

      /* 二级面板：音效与提示 */
      .zcwv-subcard {
        display: none;
      }
      .zcwv-subcard-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--zcw-primary);
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .zcwv-fold-item {
        border-bottom: 1px solid var(--zcw-border);
        padding-bottom: 8px;
        margin-bottom: 8px;
      }
      .zcwv-fold-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
      }
      .zcwv-fold-body {
        margin-top: 6px;
        padding-left: 20px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .zcwv-btn-group {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 10px;
      }
      .zcwv-btn-sm {
        padding: 4px 10px;
        font-size: 12px;
        border-radius: 5px;
        cursor: pointer;
        border: 1px solid var(--zcw-border);
        background: rgba(32, 49, 112, 0.06);
        color: var(--zcw-text);
      }
      .zcwv-btn-sm:hover {
        background: rgba(32, 49, 112, 0.12);
      }
      .zcwv-btn-sm-primary {
        background: var(--zcw-primary);
        color: #fff;
        border: none;
      }
      .zcwv-btn-sm-primary:hover {
        background: var(--zcw-primary-hover);
      }

      /* 三级面板：哈基米记账面板 (对标大肥鱼 V2.3 纯 Token 与调用明细) */
      .zcwv-stats-card {
        display: none;
        width: 100%;
        box-sizing: border-box;
      }
      .zcwv-stats-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 4px;
      }
      .zcwv-stats-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--zcw-text);
      }
      .zcwv-num-highlight {
        font-size: 14.5px;
        font-weight: 800;
        color: var(--zcw-highlight);
        font-variant-numeric: tabular-nums;
      }
      .zcwv-stats-today-box {
        background: rgba(32, 49, 112, 0.05);
        border: 1px solid var(--zcw-border);
        border-radius: 7px;
        padding: 6px 10px;
        font-size: 12px;
        line-height: 1.45;
        margin-bottom: 8px;
        width: 100%;
        box-sizing: border-box;
      }
      .zcwv-stats-model-item {
        padding: 3px 0;
        border-bottom: 1px solid rgba(32, 49, 112, 0.05);
      }
      .zcwv-stats-model-item:last-of-type {
        border-bottom: none;
      }
      .zcwv-stats-model-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;
      }
      .zcwv-stats-model-name {
        color: var(--zcw-text);
        font-weight: 600;
      }
      .zcwv-stats-model-val {
        color: var(--zcw-text-dim);
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        font-size: 12px;
      }
      .zcwv-stats-model-val.zcwv-has-used {
        color: var(--zcw-highlight);
      }
      .zcwv-stats-model-detail {
        font-size: 10.5px;
        color: var(--zcw-text-dim);
        margin-top: 1px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .zcwv-stats-today-summary {
        margin-top: 5px;
        padding-top: 5px;
        border-top: 1px dashed rgba(32, 49, 112, 0.12);
        font-size: 11px;
        color: var(--zcw-text-dim);
      }
      .zcwv-stats-summary-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 2px;
      }
      .zcwv-stats-summary-row b {
        color: var(--zcw-text);
        font-weight: 600;
      }
      .zcwv-stats-summary-detail {
        font-size: 10.5px;
        color: var(--zcw-text-dim);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* 7 天折叠列表 */
      .zcwv-stats-list {
        max-height: 250px;
        overflow-y: auto;
        overflow-x: hidden;
        border: 1px solid var(--zcw-border);
        border-radius: 7px;
        padding: 1px 0;
        scrollbar-width: thin;
        width: 100%;
        box-sizing: border-box;
      }
      .zcwv-stats-day-group {
        border-bottom: 1px solid rgba(32, 49, 112, 0.06);
      }
      .zcwv-stats-day-group:last-child {
        border-bottom: none;
      }
      .zcwv-stats-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 5px 10px;
        font-size: 12px;
        white-space: nowrap;
        cursor: pointer;
        user-select: none;
        transition: background 0.15s ease;
      }
      .zcwv-stats-row:hover {
        background: rgba(32, 49, 112, 0.04);
      }
      .zcwv-stats-date {
        font-weight: 600;
        color: var(--zcw-text);
        white-space: nowrap;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .zcwv-stats-arrow {
        display: inline-block;
        font-size: 10px;
        color: var(--zcw-text-dim);
        transition: transform 0.18s ease;
        transform-origin: center center;
      }
      .zcwv-stats-row.zcwv-expanded .zcwv-stats-arrow {
        transform: rotate(90deg);
        color: var(--zcw-highlight);
      }
      .zcwv-stats-val {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        white-space: nowrap;
        color: var(--zcw-text-dim);
        font-variant-numeric: tabular-nums;
        font-size: 11.5px;
        font-weight: 600;
      }
      .zcwv-stats-daydetail {
        display: none;
        border-left: 2px solid rgba(32, 49, 112, 0.16);
        margin: 2px 8px 6px 14px;
        padding: 2px 0 2px 8px;
        font-size: 11px;
        line-height: 1.4;
      }
      .zcwv-stats-daydetail.zcwv-detail-open {
        display: block;
      }
      .zcwv-daydetail-sub {
        font-size: 10.5px;
        color: var(--zcw-text-dim);
        margin-bottom: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .zcwv-detail-model-box {
        margin-top: 3px;
        padding-top: 3px;
        border-top: 1px dashed rgba(32, 49, 112, 0.08);
      }
      .zcwv-detail-model-box:first-child {
        border-top: none;
        margin-top: 0;
        padding-top: 0;
      }
      .zcwv-detail-model-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11.5px;
        font-weight: 600;
      }
      .zcwv-detail-mname {
        color: var(--zcw-text);
      }
      .zcwv-detail-mval {
        color: var(--zcw-highlight);
        font-variant-numeric: tabular-nums;
      }
      .zcwv-detail-msub {
        font-size: 10px;
        color: var(--zcw-text-dim);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* 双击完整配额浮层 */
      .zcwv-panel-mask {
        position: fixed;
        left: 0;
        top: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 2147483647;
        display: none;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity .2s ease;
      }
      .zcwv-panel-mask.zcwv-open {
        display: flex;
        opacity: 1;
      }
      .zcwv-panel {
        width: 440px;
        max-width: 90vw;
        background: var(--zcw-panel-bg);
        border: 1px solid var(--zcw-border);
        box-shadow: 0 16px 48px rgba(0,0,0,0.22);
        border-radius: 16px;
        padding: 20px 24px;
        color: var(--zcw-text);
        font-size: 13px;
        line-height: 1.5;
        pointer-events: auto;
      }
      .zcwv-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--zcw-border);
      }
      .zcwv-panel-title {
        font-size: 16px;
        font-weight: 700;
        color: var(--zcw-bubble-stroke);
      }
      .zcwv-panel-close {
        cursor: pointer;
        font-size: 18px;
        opacity: 0.7;
        transition: opacity .2s;
        border: none;
        background: none;
        color: inherit;
      }
      .zcwv-panel-close:hover { opacity: 1; }
      .zcwv-panel-item {
        margin-bottom: 14px;
      }
      .zcwv-panel-item-header {
        display: flex;
        justify-content: space-between;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .zcwv-panel-progress {
        height: 8px;
        background: rgba(91, 124, 221, 0.15);
        border-radius: 4px;
        overflow: hidden;
      }
      .zcwv-panel-fill {
        height: 100%;
        background: #48bb78;
        border-radius: 4px;
      }
      .zcwv-panel-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 18px;
        padding-top: 12px;
        border-top: 1px solid var(--zcw-border);
        font-size: 12px;
        color: var(--zcw-text-dim);
      }
      .zcwv-panel-btn {
        background: var(--zcw-bubble-stroke);
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 6px 14px;
        cursor: pointer;
        font-weight: 600;
      }
    `;
  }

  // 8. 构建挂件 DOM 与设置弹窗
  function buildWidgetDOM() {
    let container = document.getElementById('hajimi-container');
    const isNew = !container;
    if (isNew) {
      container = document.createElement('div');
      container.id = 'hajimi-container';
    }

    container.innerHTML = `
      <div class="zcwv-body" id="hajimi-body">
        <div class="zcwv-pop zcwv-pop-open" id="hajimi-pop">
          <svg viewBox="0 0 1026 700" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
            <path class="zcwv-bshape" fill="var(--zcw-bubble-fill)" stroke="var(--zcw-bubble-stroke)" stroke-width="18" stroke-linejoin="round" stroke-linecap="round" d="M 827 248 A 373 232 0 1 0 81 246 A 373 232 0 0 0 301 465 A 57 32 10 0 0 413 484 A 373 232 0 0 0 827 248 Z"/>
            <ellipse class="zcwv-b1" cx="352" cy="561" rx="37.5" ry="26" fill="var(--zcw-bubble-fill)" stroke="var(--zcw-bubble-stroke)" stroke-width="18"/>
            <ellipse class="zcwv-b2" cx="442" cy="646" rx="24.5" ry="18" fill="var(--zcw-bubble-fill)" stroke="var(--zcw-bubble-stroke)" stroke-width="18"/>
          </svg>
          <div class="zcwv-text" id="hajimi-text">
            <div class="zcwv-qcard" id="hajimi-qcard">
              <div class="zcwv-qtitle">Antigravity 额度</div>
              <div class="zcwv-qrow">
                <span class="zcwv-qname">Gemini (Flash)</span>
                <div class="zcwv-qbar-wrap"><div class="zcwv-qbar" id="hajimi-bar-gemini" style="width: 100%;"></div></div>
                <span class="zcwv-qpct" id="hajimi-pct-gemini">--</span>
              </div>
              <div class="zcwv-qrow">
                <span class="zcwv-qname">Claude & GPT</span>
                <div class="zcwv-qbar-wrap"><div class="zcwv-qbar" id="hajimi-bar-claude" style="width: 100%;"></div></div>
                <span class="zcwv-qpct" id="hajimi-pct-claude">--</span>
              </div>
              <div class="zcwv-qrow">
                <span class="zcwv-qname">Gemini 4 Argon</span>
                <div class="zcwv-qbar-wrap"><div class="zcwv-qbar" id="hajimi-bar-argon" style="width: 100%;"></div></div>
                <span class="zcwv-qpct" id="hajimi-pct-argon">--</span>
              </div>
              <div class="zcwv-qtime" id="hajimi-qtime">加载中...</div>
            </div>
            <div class="zcwv-quote" id="hajimi-quote">
              <span id="hajimi-quote-text">我依旧是国一模</span>
            </div>
            <div class="zcwv-prompt-box" id="hajimi-prompt-box">
              <div class="zcwv-prompt-icon" id="hajimi-prompt-icon">🐾</div>
              <div class="zcwv-prompt-title" id="hajimi-prompt-title">主人，有选择题等你回答喵~</div>
            </div>
          </div>
        </div>
        <img class="zcwv-img" id="hajimi-img" src="${BASE_URL}/assets/gemini.png" alt="哈基米" draggable="false" />
        <button class="zcwv-menu-btn ${settings.hideMenuBtn ? 'zcwv-menu-btn-hidden' : ''}" id="hajimi-menu-btn" title="哈基米设置" type="button">
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>
    `;

    if (isNew) {
      document.body.appendChild(container);
    }

    // 设置与记账浮动卡片面板 (挂在 document.body，彻底规避水平镜像反字)
    let menuCard = document.getElementById('hajimi-menu-card');
    const isMenuNew = !menuCard;
    if (isMenuNew) {
      menuCard = document.createElement('div');
      menuCard.className = 'zcwv-menu-card';
      menuCard.id = 'hajimi-menu-card';
    }

    menuCard.innerHTML = `
      <!-- 视图 1：主设置卡片 (对标图 1) -->
      <div id="zcwv-view-main">
        <div class="zcwv-menu-row">
          <span class="zcwv-menu-label">大小</span>
          <input type="range" class="zcwv-range" id="zcwv-scale-range" min="1" max="20" step="1" value="${settings.scaleLevel}">
          <input type="number" class="zcwv-num" id="zcwv-scale-num" min="1" max="20" step="1" value="${settings.scaleLevel}">
        </div>
        <div class="zcwv-menu-row">
          <button type="button" class="zcwv-btn-pill" id="zcwv-btn-sound-panel">音效/提示泡泡设置</button>
        </div>
        <div class="zcwv-sep"></div>
        <div class="zcwv-menu-row">
          <span class="zcwv-menu-label">吸附与翻转</span>
          <div class="zcwv-chk-group">
            <label class="zcwv-chk-label"><input type="checkbox" class="zcwv-check" id="zcwv-chk-snap" ${settings.snapEnabled ? 'checked' : ''}> 开启吸附</label>
            <label class="zcwv-chk-label"><input type="checkbox" class="zcwv-check" id="zcwv-chk-flip" ${settings.flipEnabled ? 'checked' : ''}> 开启翻转</label>
          </div>
        </div>
        <div class="zcwv-menu-row">
          <label class="zcwv-chk-label"><input type="checkbox" class="zcwv-check" id="zcwv-chk-hide-btn" ${settings.hideMenuBtn ? 'checked' : ''}> 隐藏菜单按钮</label>
          <span class="zcwv-hint-small">右键猫猫呼出</span>
        </div>
        <button type="button" class="zcwv-btn-primary" id="zcwv-btn-open-stats">- = 哈基米记账 = -</button>
        <div class="zcwv-ver-text">v2.1.0</div>
      </div>

      <!-- 视图 2：音效与提示设置面板 (对标图 2) -->
      <div class="zcwv-subcard" id="zcwv-view-sound">
        <div class="zcwv-subcard-title">
          <span>提示与音效设置</span>
        </div>
        <div class="zcwv-menu-row">
          <label class="zcwv-chk-label"><input type="checkbox" class="zcwv-check" id="zcwv-snd-all" ${settings.soundAll ? 'checked' : ''}> <b>全部音效</b></label>
        </div>
        <div class="zcwv-fold-item">
          <div class="zcwv-fold-header" id="zcwv-press-header">
            <label class="zcwv-chk-label" style="pointer-events:none;"><input type="checkbox" class="zcwv-check" id="zcwv-snd-press" ${settings.soundPress ? 'checked' : ''}> 按压音效</label>
            <span class="zcwv-hint-small" id="zcwv-press-summary">${settings.soundGroup === 'ya' ? '小黄鸭' : '默认音效'} · ${Math.round(settings.soundVol * 100)}% ▸</span>
          </div>
          <div class="zcwv-fold-body" id="zcwv-press-body" style="display:none;">
            <div class="zcwv-menu-row" style="margin-bottom:4px;">
              <span style="font-size:12px;">音效组</span>
              <select class="zcwv-num" id="zcwv-sel-sound-group" style="width:110px;">
                <option value="d" ${settings.soundGroup === 'd' ? 'selected' : ''}>默认音效 (D)</option>
                <option value="ya" ${settings.soundGroup === 'ya' ? 'selected' : ''}>小黄鸭 (Ya)</option>
              </select>
            </div>
            <div class="zcwv-menu-row" style="margin-bottom:0;">
              <span style="font-size:12px;">音量</span>
              <input type="range" class="zcwv-range" id="zcwv-range-vol" min="0" max="1" step="0.05" value="${settings.soundVol}">
              <span style="font-size:11px;width:32px;text-align:right;" id="zcwv-vol-txt">${Math.round(settings.soundVol * 100)}%</span>
            </div>
          </div>
        </div>
        <div class="zcwv-menu-row">
          <label class="zcwv-chk-label"><input type="checkbox" class="zcwv-check" id="zcwv-snd-question" ${settings.remindQuestion ? 'checked' : ''}> 提问提示</label>
          <span class="zcwv-hint-small">清脆叮咚</span>
        </div>
        <div class="zcwv-menu-row">
          <label class="zcwv-chk-label"><input type="checkbox" class="zcwv-check" id="zcwv-snd-approval" ${settings.remindApproval ? 'checked' : ''}> 授权提示</label>
          <span class="zcwv-hint-small">清脆叮咚</span>
        </div>
        <div class="zcwv-btn-group">
          <button type="button" class="zcwv-btn-sm" id="zcwv-btn-sound-cancel">取消</button>
          <button type="button" class="zcwv-btn-sm" id="zcwv-btn-sound-reset">恢复默认</button>
          <button type="button" class="zcwv-btn-sm zcwv-btn-sm-primary" id="zcwv-btn-sound-save">保存</button>
        </div>
      </div>

      <!-- 视图 3：哈基米记账面板 (对标大肥鱼 V2.3 纯 Token 与调用明细) -->
      <div class="zcwv-stats-card" id="zcwv-view-stats">
        <div class="zcwv-stats-head">
          <span class="zcwv-stats-title">今日模型用量</span>
          <span class="zcwv-num-highlight" id="zcwv-today-tokens">-- Tokens</span>
        </div>
        <div class="zcwv-stats-today-box" id="zcwv-today-box">
          <div class="zcwv-stats-model-item">
            <div class="zcwv-stats-model-row">
              <span class="zcwv-stats-model-name">Gemini (Flash)</span>
              <span class="zcwv-stats-model-val" id="zcwv-model-val-gemini">-- Tokens</span>
            </div>
            <div class="zcwv-stats-model-detail" id="zcwv-model-detail-gemini">缓内 -- · 缓外 -- · 输出 --</div>
          </div>
          <div class="zcwv-stats-model-item">
            <div class="zcwv-stats-model-row">
              <span class="zcwv-stats-model-name">Claude & GPT</span>
              <span class="zcwv-stats-model-val" id="zcwv-model-val-claude">-- Tokens</span>
            </div>
            <div class="zcwv-stats-model-detail" id="zcwv-model-detail-claude">缓内 -- · 缓外 -- · 输出 --</div>
          </div>
          <div class="zcwv-stats-model-item">
            <div class="zcwv-stats-model-row">
              <span class="zcwv-stats-model-name">Gemini 4 Argon</span>
              <span class="zcwv-stats-model-val" id="zcwv-model-val-argon">-- Tokens</span>
            </div>
            <div class="zcwv-stats-model-detail" id="zcwv-model-detail-argon">缓内 -- · 缓外 -- · 输出 --</div>
          </div>
          <div class="zcwv-stats-today-summary">
            <div class="zcwv-stats-summary-row">
              <span>今日总计交互</span>
              <b id="zcwv-today-steps">-- 次</b>
            </div>
            <div class="zcwv-stats-summary-detail" id="zcwv-today-breakdown">缓内 -- · 缓外 -- · 输出 --</div>
          </div>
        </div>
        <div class="zcwv-sep"></div>
        <div class="zcwv-stats-head">
          <span class="zcwv-stats-title">近 7 天使用记录</span>
          <span class="zcwv-num-highlight" id="zcwv-seven-tokens">-- Tokens</span>
        </div>
        <div class="zcwv-stats-list" id="zcwv-stats-list">
          <div style="text-align:center;padding:16px;color:var(--zcw-text-dim);">加载中...</div>
        </div>
        <button type="button" class="zcwv-btn-pill" id="zcwv-btn-stats-back" style="margin-top:8px;width:100%;">< 返回</button>
      </div>
    `;

    if (isMenuNew) {
      document.body.appendChild(menuCard);
    }

    // 双击完整配额浮层
    let mask = document.getElementById('hajimi-panel-mask');
    const isMaskNew = !mask;
    if (isMaskNew) {
      mask = document.createElement('div');
      mask.className = 'zcwv-panel-mask';
      mask.id = 'hajimi-panel-mask';
    }
    mask.innerHTML = `
      <div class="zcwv-panel" id="hajimi-panel">
        <div class="zcwv-panel-header">
          <div class="zcwv-panel-title">🐾 Antigravity 配额详情</div>
          <button class="zcwv-panel-close" id="hajimi-panel-close">✕</button>
        </div>
        <div id="hajimi-panel-content">加载中...</div>
        <div class="zcwv-panel-footer">
          <span id="hajimi-panel-user"></span>
          <button class="zcwv-panel-btn" id="hajimi-panel-refresh">立即刷新</button>
        </div>
      </div>
    `;
    if (isMaskNew) {
      document.body.appendChild(mask);
    }

    applyScaleLevel(settings.scaleLevel, false);
    setupHitTest();
    setupInteractions(container, menuCard, mask);

    if (typeof window !== 'undefined') {
      window.__hajimi_inject_state = { status: 'mounted', ts: Date.now() };
    }

    return container;
  }

  /**
   * 宿主 UI 真实就绪守卫 (对标 injector.mjs 判定规则)
   * 必须确保宿主 React 容器已挂载且包含实际内容，防止挂件在白屏骨架上裸跑
   */
  function isHostUIReady() {
    try {
      if (!document.body) return false;
      if (document.readyState === 'loading') return false;
      const root = document.getElementById('root');
      if (!root) return false;
      const rect = root.getBoundingClientRect();
      if (rect.width < 300 || rect.height < 200) return false;
      if (root.children.length === 0) return false;
      if (root.querySelectorAll('*').length < 15) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  let mountRetryTimer = null;

  /**
   * 安全挂载挂件：若宿主尚未就绪，延迟轮询等待就绪后再插入 DOM (收敛单一定时器)
   */
  function safeMountWidget() {
    if (mountRetryTimer) {
      clearTimeout(mountRetryTimer);
      mountRetryTimer = null;
    }
    if (!isHostUIReady()) {
      mountRetryTimer = setTimeout(safeMountWidget, 300);
      return null;
    }
    const container = buildWidgetDOM();
    return container;
  }

  // 9. 立绘凸包透明区域裁剪 (100% 穿透)
  function setupHitTest() {
    const img = document.getElementById('hajimi-img');
    if (!img) return;

    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = function () {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 610;
        canvas.height = 610;
        const ctx = canvas.getContext('2d');
        const iw = probe.width || 610;
        const ih = probe.height || 610;
        const scale = Math.min(610 / iw, 610 / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = 610 - dw;
        const dy = 610 - dh;
        ctx.drawImage(probe, dx, dy, dw, dh);

        const data = ctx.getImageData(0, 0, 610, 610).data;
        const pts = [];
        for (let y = 0; y < 610; y += 4) {
          let left = -1, right = -1;
          const base = y * 610 * 4;
          for (let x = 0; x < 610; x += 4) {
            if (data[base + x * 4 + 3] > 25) {
              if (left < 0) left = x;
              right = x;
            }
          }
          if (left >= 0) {
            pts.push([left, y]);
            pts.push([right, y]);
          }
        }

        if (pts.length >= 6) {
          const hull = calculateConvexHull(pts);
          if (hull && hull.length >= 3) {
            const poly = hull.map(p => `${(p[0] / 610 * 100).toFixed(2)}% ${(p[1] / 610 * 100).toFixed(2)}%`).join(', ');
            img.style.clipPath = `polygon(${poly})`;
            img.style.webkitClipPath = `polygon(${poly})`;
          }
        }
      } catch (_) {}
    };
    probe.src = `${BASE_URL}/assets/gemini.png?t=${Date.now()}`;
  }

  function calculateConvexHull(points) {
    points.sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);
    const lower = [];
    for (const p of points) {
      while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }
    const upper = [];
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  function crossProduct(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  // 10. 设置菜单卡片弹出与定位
  function repositionMenuCard() {
    const card = document.getElementById('hajimi-menu-card');
    const container = document.getElementById('hajimi-container');
    if (!card || !container || !state.menuVisible) return;

    const cRect = container.getBoundingClientRect();
    const cardW = card.offsetWidth || 300;
    const cardH = card.offsetHeight || 220;

    let targetLeft = 0;
    let targetTop = 0;

    // 水平定位
    if (cRect.left + cRect.width / 2 > window.innerWidth / 2) {
      // 屏幕右侧：向左展开
      targetLeft = cRect.right - cardW;
    } else {
      // 屏幕左侧：向右展开
      targetLeft = cRect.left;
    }

    // 垂直定位：优先放在上方
    if (cRect.top - cardH - 10 > 10) {
      targetTop = cRect.top - cardH - 10;
    } else {
      // 上方不够放下方
      targetTop = Math.min(window.innerHeight - cardH - 12, cRect.bottom + 10);
    }

    // 安全边界 Clamp
    targetLeft = Math.min(Math.max(12, targetLeft), Math.max(12, window.innerWidth - cardW - 12));
    targetTop = Math.min(Math.max(12, targetTop), Math.max(12, window.innerHeight - cardH - 12));

    card.style.left = `${targetLeft}px`;
    card.style.top = `${targetTop}px`;
  }

  function toggleSettingsMenu(targetView = 'main') {
    const card = document.getElementById('hajimi-menu-card');
    const container = document.getElementById('hajimi-container');
    const menuBtn = document.getElementById('hajimi-menu-btn');
    if (!card || !container) return;

    if (state.menuVisible && state.menuView === targetView) {
      closeSettingsMenu();
      return;
    }

    state.menuVisible = true;
    state.menuView = targetView;
    if (menuBtn) menuBtn.classList.add('zcwv-menu-btn-active');

    switchMenuView(targetView);
    card.style.display = 'block';
    card.classList.add('zcwv-menu-open');
    repositionMenuCard();

    if (targetView === 'stats') {
      fetchUsageStats();
    }
  }

  function closeSettingsMenu() {
    const card = document.getElementById('hajimi-menu-card');
    const menuBtn = document.getElementById('hajimi-menu-btn');
    if (!card) return;
    state.menuVisible = false;
    card.classList.remove('zcwv-menu-open');
    if (menuBtn) menuBtn.classList.remove('zcwv-menu-btn-active');
  }

  function switchMenuView(viewName) {
    state.menuView = viewName;
    const viewMain = document.getElementById('zcwv-view-main');
    const viewSound = document.getElementById('zcwv-view-sound');
    const viewStats = document.getElementById('zcwv-view-stats');
    if (!viewMain || !viewSound || !viewStats) return;

    viewMain.style.display = viewName === 'main' ? 'block' : 'none';
    viewSound.style.display = viewName === 'sound' ? 'block' : 'none';
    viewStats.style.display = viewName === 'stats' ? 'block' : 'none';

    requestAnimationFrame(() => {
      repositionMenuCard();
    });
  }

  // 全局交互生命周期控制器 (管理 document/window 事件监听器，防止多开或热注入时累积泄漏)
  let interactionAbortController = null;

  // 11. 拖拽、边缘磁性吸附、自动翻转与交互
  function setupInteractions(container, menuCard, mask) {
    if (interactionAbortController) {
      try { interactionAbortController.abort(); } catch (_) {}
    }
    interactionAbortController = new AbortController();
    const { signal } = interactionAbortController;

    const img = document.getElementById('hajimi-img');
    const body = document.getElementById('hajimi-body');
    const pop = document.getElementById('hajimi-pop');
    const menuBtn = document.getElementById('hajimi-menu-btn');

    let clickCount = 0;
    let clickTimer = null;

    function clampPosition(x, y) {
      const rect = container.getBoundingClientRect();
      const minX = 0;
      const minY = 0;
      const maxX = Math.max(0, window.innerWidth - rect.width);
      const maxY = Math.max(0, window.innerHeight - rect.height);
      return {
        x: Math.min(Math.max(x, minX), maxX),
        y: Math.min(Math.max(y, minY), maxY)
      };
    }

    // 边缘磁性吸附与翻转结算引擎
    function settleSnapAndFlip(targetX, targetY) {
      const rect = container.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      const iw = W * 0.5945;

      let finalX = targetX;
      let finalY = targetY;

      if (settings.snapEnabled) {
        const snapThresholdX = Math.max(80, window.innerWidth * 0.10);
        const snapThresholdY = Math.max(80, window.innerHeight * 0.15);

        // 检测立绘贴边距离
        const imgLeft = state.flip ? targetX : (targetX + W - iw);
        const imgRight = state.flip ? (targetX + iw) : (targetX + W);
        const imgBottom = targetY + H;

        // 左吸附
        if (imgLeft < snapThresholdX) {
          finalX = state.flip ? 0 : -(W - iw);
          finalX = Math.max(0, finalX);
        }
        // 右吸附
        else if (window.innerWidth - imgRight < snapThresholdX) {
          finalX = state.flip ? (window.innerWidth - iw) : (window.innerWidth - W);
          finalX = Math.min(window.innerWidth - W, finalX);
        }

        // 下吸附
        if (window.innerHeight - imgBottom < snapThresholdY) {
          finalY = window.innerHeight - H;
        }
      }

      // Clamp 安全位置
      const clamped = clampPosition(finalX, finalY);
      finalX = clamped.x;
      finalY = clamped.y;

      // 翻转结算
      if (settings.flipEnabled) {
        const cx = state.flip ? (finalX + iw / 2) : (finalX + W - iw / 2);
        const shouldFlip = (finalX <= 16) || (cx < window.innerWidth / 2);
        if (shouldFlip !== state.flip) {
          state.flip = shouldFlip;
          container.classList.toggle('zcwv-left', shouldFlip);
        }
      } else {
        if (state.flip) {
          state.flip = false;
          container.classList.remove('zcwv-left');
        }
      }

      // 平滑吸附过渡动效
      container.style.transition = 'left .18s cubic-bezier(.22,1,.36,1), top .18s cubic-bezier(.22,1,.36,1)';
      container.style.left = `${finalX}px`;
      container.style.top = `${finalY}px`;
      container.style.right = 'auto';
      container.style.bottom = 'auto';
    }

    // 统一指针结束结算函数 (处理 pointerup, pointercancel, lostpointercapture)
    function endPointerInteraction(e, isCancel = false) {
      if (state.activePointerId !== null && e.pointerId !== state.activePointerId) return;
      state.isDragging = false;
      state.activePointerId = null;
      try { img.releasePointerCapture(e.pointerId); } catch (_) {}
      container.classList.remove('zcwv-dragging');

      const elapsed = Date.now() - pressStartTime;
      const remainingHold = Math.max(0, 40 - elapsed);
      setTimeout(() => {
        body.classList.remove('zcwv-pressing');
      }, remainingHold);

      if (isCancel) return;

      if (state.dragMoved) {
        // 拖拽松手：执行磁性吸附与翻转结算
        const curRect = container.getBoundingClientRect();
        settleSnapAndFlip(curRect.left, curRect.top);
      } else {
        // 未拖拽：纯点击
        playReleaseSound();

        clickCount++;
        if (clickCount === 1) {
          clickTimer = setTimeout(() => {
            clickCount = 0;
            if (state.promptMode !== null) {
              // 提醒状态下点击立绘只触发果冻弹跳与配额探针，不切状态
              nudgeBubble();
              fetchQuota(true);
              return;
            }
            if (currentBubbleState === BUBBLE_STATE.HIDDEN) {
              setBubbleState(BUBBLE_STATE.QUOTA);
            } else {
              cycleBubbleState();
            }
            nudgeBubble();
            fetchQuota(true);
          }, 240);
        } else if (clickCount === 2) {
          clearTimeout(clickTimer);
          clickCount = 0;
          openPanel();
        }
      }
    }

    // 立绘按下
    img.addEventListener('pointerdown', (e) => {
      // 忽略右键按下 (右键交给 contextmenu 呼出设置)
      if (e.button === 2) return;

      e.preventDefault();
      state.activePointerId = e.pointerId;
      try { img.setPointerCapture(e.pointerId); } catch (_) {}

      state.isDragging = true;
      state.dragMoved = false;
      state.startX = e.clientX;
      state.startY = e.clientY;

      const rect = container.getBoundingClientRect();
      state.elemX = rect.left;
      state.elemY = rect.top;

      body.classList.add('zcwv-pressing');
      playPressSound();
      pressStartTime = Date.now();
    });

    // 拖拽移动
    img.addEventListener('pointermove', (e) => {
      if (!state.isDragging) return;
      if (state.activePointerId !== null && e.pointerId !== state.activePointerId) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (!state.dragMoved && Math.hypot(dx, dy) > 5) {
        state.dragMoved = true;
        container.classList.add('zcwv-dragging');
        closeSettingsMenu();
      }

      if (state.dragMoved) {
        const nextX = state.elemX + dx;
        const nextY = state.elemY + dy;
        const clamped = clampPosition(nextX, nextY);

        container.style.left = `${clamped.x}px`;
        container.style.top = `${clamped.y}px`;
        container.style.right = 'auto';
        container.style.bottom = 'auto';

        // 拖拽过程中的动态翻转预览
        if (settings.flipEnabled) {
          const centerX = clamped.x + container.offsetWidth / 2;
          const isLeft = centerX < window.innerWidth / 2;
          if (isLeft !== state.flip) {
            state.flip = isLeft;
            container.classList.toggle('zcwv-left', isLeft);
          }
        }
      }
    });

    // 指针释放与异常中断防卡死监听
    img.addEventListener('pointerup', (e) => endPointerInteraction(e, false));
    img.addEventListener('pointercancel', (e) => endPointerInteraction(e, true));
    img.addEventListener('lostpointercapture', (e) => endPointerInteraction(e, true));

    // 鼠标悬停在挂件或气泡上时暂停自动消失倒计时；移出后重新开始倒计时
    const handleMouseEnter = () => {
      clearBubbleAutoHide();
    };
    const handleMouseLeave = () => {
      if (currentBubbleState !== BUBBLE_STATE.HIDDEN && currentBubbleState !== BUBBLE_STATE.PROMPT) {
        scheduleBubbleAutoHide(BUBBLE_AUTO_HIDE_MS);
      }
    };

    container.addEventListener('mouseenter', handleMouseEnter);
    container.addEventListener('mouseleave', handleMouseLeave);
    pop.addEventListener('mouseenter', handleMouseEnter);
    pop.addEventListener('mouseleave', handleMouseLeave);

    // 鼠标右键 (contextmenu)：呼出设置卡片
    img.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSettingsMenu('main');
    });

    // 右上角汉堡按钮点击
    if (menuBtn) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSettingsMenu('main');
      });
    }

    // 全局点击外部自动收起设置菜单 (右键按下不触发关闭，通过 signal 管理全局监听器)
    document.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      if (!state.menuVisible) return;
      if (menuCard.contains(e.target) || (menuBtn && menuBtn.contains(e.target)) || img.contains(e.target)) {
        return;
      }
      closeSettingsMenu();
    }, { signal });

    // 气泡点击：轻弹并执行三段式循环
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      playPressSound();
      setTimeout(playReleaseSound, 50);
      nudgeBubble();
      if (state.promptMode !== null) {
        // 提醒状态下点击只触发果冻弹跳，绝不切回额度
        return;
      }
      cycleBubbleState();
    });

    // 窗口尺寸变更时重新 Clamp (通过 signal 自动释放)
    window.addEventListener('resize', () => {
      const rect = container.getBoundingClientRect();
      const clamped = clampPosition(rect.left, rect.top);
      container.style.left = `${clamped.x}px`;
      container.style.top = `${clamped.y}px`;
    }, { signal });

    // ----------------------------------------------------
    // 主设置面板（视图 1）内部事件绑定
    // ----------------------------------------------------
    const scaleRange = document.getElementById('zcwv-scale-range');
    const scaleNum = document.getElementById('zcwv-scale-num');
    if (scaleRange && scaleNum) {
      const handleScaleChange = (valStr) => {
        const val = Math.max(1, Math.min(20, parseInt(valStr, 10) || 10));
        scaleRange.value = val;
        scaleNum.value = val;
        applyScaleLevel(val, true);
      };
      scaleRange.addEventListener('input', () => handleScaleChange(scaleRange.value));
      scaleRange.addEventListener('change', () => handleScaleChange(scaleRange.value));
      scaleNum.addEventListener('input', () => handleScaleChange(scaleNum.value));
      scaleNum.addEventListener('change', () => handleScaleChange(scaleNum.value));
    }

    const btnSoundPanel = document.getElementById('zcwv-btn-sound-panel');
    if (btnSoundPanel) {
      btnSoundPanel.addEventListener('click', () => {
        switchMenuView('sound');
      });
    }

    const chkSnap = document.getElementById('zcwv-chk-snap');
    if (chkSnap) {
      chkSnap.addEventListener('change', () => {
        settings.snapEnabled = chkSnap.checked;
        saveSettings(settings);
        if (settings.snapEnabled) {
          const r = container.getBoundingClientRect();
          settleSnapAndFlip(r.left, r.top);
        }
      });
    }

    const chkFlip = document.getElementById('zcwv-chk-flip');
    if (chkFlip) {
      chkFlip.addEventListener('change', () => {
        settings.flipEnabled = chkFlip.checked;
        saveSettings(settings);
        const r = container.getBoundingClientRect();
        settleSnapAndFlip(r.left, r.top);
      });
    }

    const chkHideBtn = document.getElementById('zcwv-chk-hide-btn');
    if (chkHideBtn) {
      chkHideBtn.addEventListener('change', () => {
        settings.hideMenuBtn = chkHideBtn.checked;
        saveSettings(settings);
        if (menuBtn) {
          menuBtn.classList.toggle('zcwv-menu-btn-hidden', settings.hideMenuBtn);
        }
      });
    }

    const btnOpenStats = document.getElementById('zcwv-btn-open-stats');
    if (btnOpenStats) {
      btnOpenStats.addEventListener('click', () => {
        switchMenuView('stats');
        fetchUsageStats();
      });
    }

    // ----------------------------------------------------
    // 音效与提示二级面板（视图 2）内部事件绑定
    // ----------------------------------------------------
    const pressHeader = document.getElementById('zcwv-press-header');
    const pressBody = document.getElementById('zcwv-press-body');
    if (pressHeader && pressBody) {
      pressHeader.addEventListener('click', () => {
        const open = pressBody.style.display !== 'none';
        pressBody.style.display = open ? 'none' : 'flex';
      });
    }

    const rangeVol = document.getElementById('zcwv-range-vol');
    const volTxt = document.getElementById('zcwv-vol-txt');
    const pressSummary = document.getElementById('zcwv-press-summary');
    const selSoundGroup = document.getElementById('zcwv-sel-sound-group');

    function updatePressSummary() {
      const gName = (selSoundGroup && selSoundGroup.value === 'ya') ? '小黄鸭' : '默认音效';
      const vol = rangeVol ? getSafeVol(rangeVol.value) : 0.9;
      const pct = Math.round(vol * 100);
      if (pressSummary) pressSummary.textContent = `${gName} · ${pct}% ▸`;
    }

    function syncSoundUIFromSettings() {
      const sndAll = document.getElementById('zcwv-snd-all');
      const sndPress = document.getElementById('zcwv-snd-press');
      const sndQ = document.getElementById('zcwv-snd-question');
      const sndAppr = document.getElementById('zcwv-snd-approval');
      if (sndAll) sndAll.checked = !!settings.soundAll;
      if (sndPress) sndPress.checked = !!settings.soundPress;
      if (selSoundGroup) selSoundGroup.value = settings.soundGroup || 'd';
      const safeV = getSafeVol(settings.soundVol);
      if (rangeVol) rangeVol.value = String(safeV);
      if (volTxt) volTxt.textContent = `${Math.round(safeV * 100)}%`;
      if (sndQ) sndQ.checked = !!settings.remindQuestion;
      if (sndAppr) sndAppr.checked = !!settings.remindApproval;
      updatePressSummary();
    }

    if (rangeVol && volTxt) {
      rangeVol.addEventListener('input', () => {
        const val = getSafeVol(rangeVol.value);
        volTxt.textContent = `${Math.round(val * 100)}%`;
        updatePressSummary();
      });
      rangeVol.addEventListener('change', () => {
        const val = getSafeVol(rangeVol.value);
        const grp = selSoundGroup ? selSoundGroup.value : 'd';
        playReleaseSound(grp, val);
      });
    }

    if (selSoundGroup) {
      selSoundGroup.addEventListener('change', () => {
        updatePressSummary();
        // 切换音效时使用当前选择的音效组与当前音量立即试听
        const grp = selSoundGroup.value;
        const vol = rangeVol ? getSafeVol(rangeVol.value) : 0.9;
        playReleaseSound(grp, vol);
      });
    }

    const btnSoundSave = document.getElementById('zcwv-btn-sound-save');
    if (btnSoundSave) {
      btnSoundSave.addEventListener('click', () => {
        const sndAll = document.getElementById('zcwv-snd-all');
        const sndPress = document.getElementById('zcwv-snd-press');
        const sndQ = document.getElementById('zcwv-snd-question');
        const sndAppr = document.getElementById('zcwv-snd-approval');

        settings.soundAll = sndAll ? sndAll.checked : true;
        settings.soundPress = sndPress ? sndPress.checked : true;
        settings.soundGroup = (selSoundGroup && selSoundGroup.value === 'ya') ? 'ya' : 'd';
        settings.soundVol = rangeVol ? getSafeVol(rangeVol.value) : 0.9;
        settings.remindQuestion = sndQ ? sndQ.checked : true;
        settings.remindApproval = sndAppr ? sndAppr.checked : true;

        saveSettings(settings);
        switchMenuView('main');
      });
    }

    const btnSoundCancel = document.getElementById('zcwv-btn-sound-cancel');
    if (btnSoundCancel) {
      btnSoundCancel.addEventListener('click', () => {
        // 取消时还原控件为已保存状态
        syncSoundUIFromSettings();
        switchMenuView('main');
      });
    }

    const btnSoundReset = document.getElementById('zcwv-btn-sound-reset');
    if (btnSoundReset) {
      btnSoundReset.addEventListener('click', () => {
        // 恢复默认临时表单展示，并试听一声默认音效，等待点击保存才真正写入
        const sndAll = document.getElementById('zcwv-snd-all');
        const sndPress = document.getElementById('zcwv-snd-press');
        const sndQ = document.getElementById('zcwv-snd-question');
        const sndAppr = document.getElementById('zcwv-snd-approval');
        if (sndAll) sndAll.checked = true;
        if (sndPress) sndPress.checked = true;
        if (selSoundGroup) selSoundGroup.value = 'd';
        if (rangeVol) rangeVol.value = '0.9';
        if (volTxt) volTxt.textContent = '90%';
        if (sndQ) sndQ.checked = true;
        if (sndAppr) sndAppr.checked = true;
        updatePressSummary();
        playReleaseSound('d', 0.9);
      });
    }

    // ----------------------------------------------------
    // 哈基米记账面板（视图 3）事件绑定
    // ----------------------------------------------------
    const btnStatsBack = document.getElementById('zcwv-btn-stats-back');
    if (btnStatsBack) {
      btnStatsBack.addEventListener('click', () => {
        switchMenuView('main');
      });
    }

    // 详情面板事件
    const closeBtn = document.getElementById('hajimi-panel-close');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    mask.addEventListener('click', (e) => {
      if (e.target === mask) closePanel();
    });

    const refreshBtn = document.getElementById('hajimi-panel-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshBtn.textContent = '刷新中...';
        fetchQuota(true).finally(() => {
          refreshBtn.textContent = '立即刷新';
        });
      });
    }
  }

  function openPanel() {
    const mask = document.getElementById('hajimi-panel-mask');
    if (!mask) return;
    state.panelVisible = true;
    mask.classList.add('zcwv-open');
    renderPanel();
    fetchQuota(true);
  }

  function closePanel() {
    const mask = document.getElementById('hajimi-panel-mask');
    if (!mask) return;
    state.panelVisible = false;
    mask.classList.remove('zcwv-open');
  }

  // 12. 配额与使用记录获取
  let backendPendingPrompt = null;

  async function fetchPendingPrompt() {
    try {
      const res = await fetch(`${BASE_URL}/api/pending`);
      if (res.ok) {
        const data = await res.json();
        backendPendingPrompt = data.pendingPrompt || null;
        if (typeof evaluateActiveReminders === 'function') {
          evaluateActiveReminders();
        }
      }
    } catch (_) {}
  }

  async function fetchQuota(force = false) {
    try {
      const res = await fetch(`${BASE_URL}/api/quota${force ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error('API returned ' + res.status);
      const data = await res.json();
      state.quota = data;
      if (data.pendingPrompt) {
        backendPendingPrompt = data.pendingPrompt;
        if (typeof evaluateActiveReminders === 'function') {
          evaluateActiveReminders();
        }
      }
      renderBubble();
      if (state.panelVisible) renderPanel();
    } catch (_) {}
  }

  async function fetchUsageStats(force = false) {
    try {
      const res = await fetch(`${BASE_URL}/api/stats${force ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error('Stats API returned ' + res.status);
      const data = await res.json();
      state.stats = data;
      renderStatsView(data);
    } catch (err) {
      const list = document.getElementById('zcwv-stats-list');
      if (list) list.innerHTML = `<div style="text-align:center;padding:16px;color:#e53e3e;">获取记录失败: ${err.message}</div>`;
    }
  }

  function renderStatsView(data) {
    if (!data || !data.today || !data.sevenDays) return;
    const todayTokens = document.getElementById('zcwv-today-tokens');
    const todaySteps = document.getElementById('zcwv-today-steps');
    const todayBreakdown = document.getElementById('zcwv-today-breakdown');
    const valGemini = document.getElementById('zcwv-model-val-gemini');
    const detailGemini = document.getElementById('zcwv-model-detail-gemini');
    const valClaude = document.getElementById('zcwv-model-val-claude');
    const detailClaude = document.getElementById('zcwv-model-detail-claude');
    const valArgon = document.getElementById('zcwv-model-val-argon');
    const detailArgon = document.getElementById('zcwv-model-detail-argon');
    const sevenTokens = document.getElementById('zcwv-seven-tokens');
    const statsList = document.getElementById('zcwv-stats-list');

    if (todayTokens) todayTokens.textContent = `${data.today.totalTokensStr} Tokens`;
    if (todaySteps) {
      const sessStr = data.today.sessions > 0 ? ` (${data.today.sessions} 个会话)` : '';
      todaySteps.textContent = `${data.today.steps.toLocaleString()} 次${sessStr}`;
    }
    if (todayBreakdown) {
      todayBreakdown.textContent = `缓内 ${data.today.cacheTokensStr} · 缓外 ${data.today.inputTokensStr} · 输出 ${data.today.outputTokensStr}`;
    }
    if (sevenTokens) sevenTokens.textContent = `${data.sevenDays.totalTokensStr} Tokens`;

    // 渲染今日三大模型分类用量 (纯 Token + 缓内/缓外/输出明细)
    const tModels = data.today.models || {};
    const renderTodayModel = (valEl, detailEl, mData) => {
      if (!valEl || !detailEl) return;
      if (mData && mData.steps > 0) {
        valEl.textContent = `${mData.totalTokensStr} (${mData.steps}次)`;
        valEl.className = 'zcwv-stats-model-val zcwv-has-used';
        detailEl.textContent = `缓内 ${mData.cacheTokensStr} · 缓外 ${mData.inputTokensStr} · 输出 ${mData.outputTokensStr}`;
        detailEl.style.display = 'block';
      } else {
        valEl.textContent = '0 Token (0次)';
        valEl.className = 'zcwv-stats-model-val';
        detailEl.style.display = 'none';
      }
    };

    renderTodayModel(valGemini, detailGemini, tModels.gemini);
    renderTodayModel(valClaude, detailClaude, tModels.claude);
    renderTodayModel(valArgon, detailArgon, tModels.argon);

    // 渲染近 7 天记录 (可点击日期展开/收起查看各模型明细)
    if (statsList && Array.isArray(data.sevenDays.days)) {
      let html = '';
      data.sevenDays.days.forEach((d, idx) => {
        const isDefaultOpen = (idx === 0); // 默认第一天(今天)展开
        const modelsWithUsage = Object.values(d.models || {}).filter(m => m.steps > 0);

        let modelsDetailHtml = '';
        if (modelsWithUsage.length > 0) {
          modelsDetailHtml = modelsWithUsage.map(m => `
            <div class="zcwv-detail-model-box">
              <div class="zcwv-detail-model-head">
                <span class="zcwv-detail-mname">${m.label}</span>
                <span class="zcwv-detail-mval">${m.totalTokensStr} (${m.steps}次)</span>
              </div>
              <div class="zcwv-detail-msub">缓内 ${m.cacheTokensStr} · 缓外 ${m.inputTokensStr} · 输出 ${m.outputTokensStr}</div>
            </div>
          `).join('');
        } else {
          modelsDetailHtml = `<div class="zcwv-daydetail-sub">当日无模型调用记录</div>`;
        }

        html += `
          <div class="zcwv-stats-day-group">
            <div class="zcwv-stats-row ${isDefaultOpen ? 'zcwv-expanded' : ''}" data-day-index="${idx}">
              <span class="zcwv-stats-date">
                <span class="zcwv-stats-arrow">▸</span>
                ${d.label}
              </span>
              <span class="zcwv-stats-val">${d.totalTokensStr} (${d.steps}次)</span>
            </div>
            <div class="zcwv-stats-daydetail ${isDefaultOpen ? 'zcwv-detail-open' : ''}" id="zcwv-daydetail-${idx}">
              <div class="zcwv-daydetail-sub">总计：缓内 ${d.cacheTokensStr} · 缓外 ${d.inputTokensStr} · 输出 ${d.outputTokensStr}</div>
              ${modelsDetailHtml}
            </div>
          </div>
        `;
      });
      statsList.innerHTML = html;

      // 绑定折叠切换事件
      const rows = statsList.querySelectorAll('.zcwv-stats-row');
      rows.forEach(r => {
        r.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = r.getAttribute('data-day-index');
          const detail = document.getElementById(`zcwv-daydetail-${idx}`);
          if (!detail) return;
          const open = detail.classList.contains('zcwv-detail-open');
          if (open) {
            detail.classList.remove('zcwv-detail-open');
            r.classList.remove('zcwv-expanded');
          } else {
            detail.classList.add('zcwv-detail-open');
            r.classList.add('zcwv-expanded');
          }
          repositionMenuCard();
        });
      });
    }
  }

  function getBarColor(pct) {
    if (pct <= 20) return '#e53e3e';
    if (pct <= 50) return '#ed8936';
    return '#48bb78';
  }

  function formatCompactCountdown(str) {
    if (!str) return '--';
    let s = str.replace(/后$/, '').trim();
    s = s.replace(/天/g, 'd').replace(/时/g, 'h').replace(/分/g, 'm').replace(/秒/g, 's');
    return s;
  }

  function renderBubble() {
    if (!state.quota) return;

    let flashGroup = null;
    let claudeGroup = null;
    let argonGroup = null;

    if (Array.isArray(state.quota.summaryGroups) && state.quota.summaryGroups.length >= 3) {
      flashGroup = state.quota.summaryGroups.find(g => g.id === 'gemini') || state.quota.summaryGroups[0];
      claudeGroup = state.quota.summaryGroups.find(g => g.id === 'claude-gpt') || state.quota.summaryGroups[1];
      argonGroup = state.quota.summaryGroups.find(g => g.id === 'argon') || state.quota.summaryGroups[2];
    } else if (state.quota.highlightModels) {
      const h = state.quota.highlightModels;
      flashGroup = h.geminiFlash;
      claudeGroup = h.claudeSonnet || h.claudeOpus;
      argonGroup = h.geminiArgon;
    } else if (Array.isArray(state.quota.models)) {
      const ms = state.quota.models;
      flashGroup = ms.find(m => (m.modelId || m.label || '').toLowerCase().includes('flash')) || ms[0];
      claudeGroup = ms.find(m => (m.modelId || m.label || '').toLowerCase().includes('claude')) || ms[1] || ms[0];
      argonGroup = ms.find(m => (m.modelId || m.label || '').toLowerCase().includes('argon')) || ms[2] || ms[0];
    }

    const barGemini = document.getElementById('hajimi-bar-gemini');
    const pctGemini = document.getElementById('hajimi-pct-gemini');
    const barClaude = document.getElementById('hajimi-bar-claude');
    const pctClaude = document.getElementById('hajimi-pct-claude');
    const barArgon = document.getElementById('hajimi-bar-argon');
    const pctArgon = document.getElementById('hajimi-pct-argon');
    const qtime = document.getElementById('hajimi-qtime');

    if (flashGroup && barGemini && pctGemini) {
      const pct = typeof flashGroup.remainingPct === 'number' ? flashGroup.remainingPct : 100;
      barGemini.style.width = `${pct}%`;
      barGemini.style.background = getBarColor(pct);
      pctGemini.textContent = flashGroup.remainingPctStr || `${pct}%`;
      pctGemini.style.color = getBarColor(pct);
    }

    if (claudeGroup && barClaude && pctClaude) {
      const pct = typeof claudeGroup.remainingPct === 'number' ? claudeGroup.remainingPct : 100;
      barClaude.style.width = `${pct}%`;
      barClaude.style.background = getBarColor(pct);
      pctClaude.textContent = claudeGroup.remainingPctStr || `${pct}%`;
      pctClaude.style.color = getBarColor(pct);
    }

    if (argonGroup && barArgon && pctArgon) {
      const pct = typeof argonGroup.remainingPct === 'number' ? argonGroup.remainingPct : 100;
      barArgon.style.width = `${pct}%`;
      barArgon.style.background = getBarColor(pct);
      pctArgon.textContent = argonGroup.remainingPctStr || `${pct}%`;
      pctArgon.style.color = getBarColor(pct);
    }

    if (qtime) {
      const fCd = formatCompactCountdown(flashGroup?.resetCountdown);
      const cCd = formatCompactCountdown(claudeGroup?.resetCountdown);
      const aCd = formatCompactCountdown(argonGroup?.resetCountdown);
      qtime.textContent = `Flash ${fCd} · Claude ${cCd} · Argon ${aCd}`;
    }
  }

  function renderPanel() {
    const content = document.getElementById('hajimi-panel-content');
    const user = document.getElementById('hajimi-panel-user');
    if (!content || !state.quota) return;

    if (user && state.quota.user) {
      const uName = escapeHtml(state.quota.user.name || 'Antigravity 用户');
      const uPlan = escapeHtml(state.quota.plan?.planName || '默认套餐');
      user.textContent = `${uName} (${uPlan})`;
    }

    const models = Array.isArray(state.quota.models) ? state.quota.models : [];
    if (models.length === 0) {
      content.innerHTML = '<div style="text-align:center;padding:20px;">暂无配额数据</div>';
      return;
    }

    let html = '';
    models.forEach(m => {
      const pct = typeof m.remainingPct === 'number' ? m.remainingPct : 100;
      const color = getBarColor(pct);
      const cd = escapeHtml(formatCompactCountdown(m.resetCountdown));
      const pctText = escapeHtml(m.remainingPctStr || `${pct}%`);
      const labelText = escapeHtml(m.label || m.modelId || '未知模型');
      html += `
        <div class="zcwv-panel-item">
          <div class="zcwv-panel-item-header">
            <span>${labelText}</span>
            <span style="color: ${color};">${pctText} (${cd})</span>
          </div>
          <div class="zcwv-panel-progress">
            <div class="zcwv-panel-fill" style="width: ${pct}%; background: ${color};"></div>
          </div>
        </div>
      `;
    });
    content.innerHTML = html;
  }

  // 13. 前端 DOM + 后端全局活跃会话挂起双擎融合感知引擎
  const QUESTION_SELECTORS = [
    '[data-testid="ask-question-header-text"]',
    '[data-testid="ask-question-option"]',
    '[data-testid="ask-question-writein"]'
  ];
  const APPROVAL_SELECTORS = [
    '[data-testid="declared-permissions-modal"]',
    '[data-testid="declared-permissions-confirm"]',
    '[data-testid="subagent-approve"]',
    '[data-testid="interaction-takeover-card"]'
  ];

  function checkDOMActiveReminder() {
    for (const sel of QUESTION_SELECTORS) {
      if (document.querySelector(sel)) return 'question';
    }
    for (const sel of APPROVAL_SELECTORS) {
      if (document.querySelector(sel)) return 'approval';
    }
    return null;
  }

  function evaluateActiveReminders() {
    const domType = checkDOMActiveReminder();
    const backendType = backendPendingPrompt?.type || null;

    // 综合判定：DOM 命中瞬时响应；若切走会话当前 DOM 无节点，但后台会话依然挂起未回答，保持提醒！
    const activeType = domType || backendType;

    if (activeType === 'question') {
      if (state.promptMode !== 'question') {
        state.promptMode = 'question';
        const pTitle = document.getElementById('hajimi-prompt-title');
        const pIcon = document.getElementById('hajimi-prompt-icon');
        if (pTitle) pTitle.textContent = '主人，有选择题等你回答喵~';
        if (pIcon) pIcon.textContent = '🐾';
        setBubbleState(BUBBLE_STATE.PROMPT);
        nudgeBubble();
        if (settings.remindQuestion) {
          playDingDong('question');
        }
      }
    } else if (activeType === 'approval') {
      if (state.promptMode !== 'approval') {
        state.promptMode = 'approval';
        const pTitle = document.getElementById('hajimi-prompt-title');
        const pIcon = document.getElementById('hajimi-prompt-icon');
        if (pTitle) pTitle.textContent = '主人，有操作等你授权确认喵~';
        if (pIcon) pIcon.textContent = '🔔';
        setBubbleState(BUBBLE_STATE.PROMPT);
        nudgeBubble();
        if (settings.remindApproval) {
          playDingDong('approval');
        }
      }
    } else {
      if (state.promptMode !== null) {
        state.promptMode = null;
        setBubbleState(BUBBLE_STATE.QUOTA);
      }
    }
  }

  let domReminderObserver = null;
  function setupDOMReminders() {
    if (domReminderObserver) {
      try { domReminderObserver.disconnect(); } catch (_) {}
    }
    domReminderObserver = new MutationObserver(() => {
      evaluateActiveReminders();
    });
    domReminderObserver.observe(document.body, { childList: true, subtree: true });
    evaluateActiveReminders();
  }

  function syncSettingsUIFromState() {
    const scaleRange = document.getElementById('zcwv-scale-range');
    const scaleNum = document.getElementById('zcwv-scale-num');
    if (scaleRange) scaleRange.value = settings.scaleLevel;
    if (scaleNum) scaleNum.value = settings.scaleLevel;
    const chkSnap = document.getElementById('zcwv-chk-snap');
    if (chkSnap) chkSnap.checked = !!settings.snapEnabled;
    const chkFlip = document.getElementById('zcwv-chk-flip');
    if (chkFlip) chkFlip.checked = !!settings.flipEnabled;
    const chkHideBtn = document.getElementById('zcwv-chk-hide-btn');
    if (chkHideBtn) chkHideBtn.checked = !!settings.hideMenuBtn;
    const menuBtn = document.getElementById('hajimi-menu-btn');
    if (menuBtn) menuBtn.classList.toggle('zcwv-menu-btn-hidden', !!settings.hideMenuBtn);

    // 联动同步音效设置二级面板控件
    const sndAll = document.getElementById('zcwv-snd-all');
    const sndPress = document.getElementById('zcwv-snd-press');
    const sndQ = document.getElementById('zcwv-snd-question');
    const sndAppr = document.getElementById('zcwv-snd-approval');
    const selSoundGroup = document.getElementById('zcwv-sel-sound-group');
    const rangeVol = document.getElementById('zcwv-range-vol');
    const volTxt = document.getElementById('zcwv-vol-txt');
    const pressSummary = document.getElementById('zcwv-press-summary');

    if (sndAll) sndAll.checked = !!settings.soundAll;
    if (sndPress) sndPress.checked = !!settings.soundPress;
    if (selSoundGroup) selSoundGroup.value = settings.soundGroup || 'd';
    const safeV = getSafeVol(settings.soundVol);
    if (rangeVol) rangeVol.value = String(safeV);
    if (volTxt) volTxt.textContent = `${Math.round(safeV * 100)}%`;
    if (sndQ) sndQ.checked = !!settings.remindQuestion;
    if (sndAppr) sndAppr.checked = !!settings.remindApproval;
    const gName = (selSoundGroup && selSoundGroup.value === 'ya') ? '小黄鸭' : '默认音效';
    if (pressSummary) pressSummary.textContent = `${gName} · ${Math.round(safeV * 100)}% ▸`;
  }

  let quotaPollTimer = null;
  let promptPollTimer = null;

  // 14. 实例完整销毁机制 (防多重注入与监听器累积)
  function dispose() {
    if (interactionAbortController) {
      try { interactionAbortController.abort(); } catch (_) {}
      interactionAbortController = null;
    }
    if (quotaPollTimer) { clearInterval(quotaPollTimer); quotaPollTimer = null; }
    if (promptPollTimer) { clearInterval(promptPollTimer); promptPollTimer = null; }
    if (mountRetryTimer) { clearTimeout(mountRetryTimer); mountRetryTimer = null; }
    clearBubbleAutoHide();
    if (domReminderObserver) {
      try { domReminderObserver.disconnect(); } catch (_) {}
      domReminderObserver = null;
    }
    if (window.__hajimiObserver) {
      try { window.__hajimiObserver.disconnect(); } catch (_) {}
      window.__hajimiObserver = null;
    }
    const container = document.getElementById('hajimi-container');
    if (container) container.remove();
    const menuCard = document.getElementById('hajimi-menu-card');
    if (menuCard) menuCard.remove();
    const mask = document.getElementById('hajimi-panel-mask');
    if (mask) mask.remove();
    const style = document.getElementById('hajimi-styles');
    if (style) style.remove();
  }

  // 15. 初始化与保活守护
  function init() {
    injectStyles();
    safeMountWidget();
    preloadAudioBuffers();
    fetchQuota();
    quotaPollTimer = setInterval(() => fetchQuota(), state.pollInterval);

    // 跨会话活跃提问/授权极速轻量轮询 (每 2.5 秒)
    fetchPendingPrompt();
    promptPollTimer = setInterval(() => fetchPendingPrompt(), 2500);

    setupDOMReminders();

    // 初始展示配额气泡 6 秒后自动收起
    scheduleBubbleAutoHide(BUBBLE_AUTO_HIDE_MS);

    // 从服务端磁盘持久化存储获取最新配置进行双保险同步
    fetch(`${BASE_URL}/api/settings`)
      .then(r => r.json())
      .then(srv => {
        if (srv && typeof srv === 'object') {
          Object.assign(settings, srv);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
          applyScaleLevel(settings.scaleLevel, false);
          syncSettingsUIFromState();
        }
      })
      .catch(() => {});

    // DOM 完整性自愈守护 (同时监控容器、菜单卡片与浮层)
    if (window.__hajimiObserver) {
      try { window.__hajimiObserver.disconnect(); } catch (_) {}
    }
    const observer = new MutationObserver(() => {
      if (!document.getElementById('hajimi-container') ||
          !document.getElementById('hajimi-menu-card') ||
          !document.getElementById('hajimi-panel-mask')) {
        safeMountWidget();
      }
    });
    observer.observe(document.body, { childList: true });
    window.__hajimiObserver = observer;

    // 注册全局单例实例句柄
    window.__hajimiWidgetInstance = { dispose };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
