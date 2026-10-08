/**
 * dsh-whale-food-expack — 大肥鱼附加插件的**宿主半端**。
 *
 * 给插件市场的 `dsh-whale-widget`（本体）叠加三样东西：
 *   ① 喂食：前端拖食物到鲸鱼身上
 *   ② 白米饭模式：喂食的第二种食物（饭碗 SVG，可空/可续）
 *   ③ BongoCat 式反应：干活时敲键盘 + 露手，每次工具调用报工具名，失败抖动，收工伸懒腰
 *
 * 本体一个字节都不改：本插件只做两件事 ——
 *   1. 把附加的 CSS / 客户端脚本注入 index 页面（与 dsh-whale-skin-bridge 同一机制）
 *   2. 把 agent 活动折叠成 `/dsh-whale-food-expack/activity.json`，供前端 1.2s 轮询
 *
 * 前端的几何、配色、台词、动画都取自用户原实现的复原版本（见 README）。
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 插件行 id（与 cordis.patch.yml 里的 id 一致）。 */
export const name = 'dsh-whale-food-expack';

/** 只依赖 web server；`agents` 用 ctx.get 取，避免变成硬依赖。 */
export const inject = ['webServer'];

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', 'assets');
const PREFIX = '/dsh-whale-food-expack';
const MARKER = 'data-plugin="dsh-whale-food-expack"';

/** 非活动会话的回收时间（用户原实现：10 分钟）。 */
const SESSION_TTL_MS = 10 * 60 * 1000;

/**
 * 把 `session/event` 与 `agent/*` 折叠成一份快照。
 *
 * 折叠规则来自用户原实现：
 *   - `turn/start` → running=true，清空工具与 token
 *   - `step/start` → 记 step
 *   - `tool/call`  → 当前工具名 + in-flight（callId → name 入表）
 *   - `tool/result`→ 用 `content[0].toolCallId` 反查名字（**结果不带工具名**）、
 *                    失败 = `content[0].isError === true || data.error !== undefined`
 *   - `assistant/message` → 累加 usage
 *   - `turn/end`   → running=false，reason 决定成败并复位失败标记
 *   - `agent/status` / `agent/error` → 权威校准与错误
 *
 * @param options - `now` 可注入时钟（测试用）。
 * @returns 折叠器：fold / setAgentStatus / setAgentError / reconcile / snapshot …
 */
export function createActivity({ now = () => Date.now() } = {}) {
  const sessions = new Map();
  let seq = 0;
  let events = 0;
  let subscribed = false;

  const session = (id) => {
    const key = String(id ?? '');
    let s = sessions.get(key);
    if (!s) {
      s = {
        id: key, running: false, tool: '', toolRunning: false, toolOk: true,
        toolCount: 0, turn: 0, step: 0, tokens: 0, reason: null, cwd: '',
        at: 0, calls: new Map(),
      };
      sessions.set(key, s);
    }
    return s;
  };

  /**
   * 取事件载荷：真实形状是 `{ type, seq, time, data: {...} }`，
   * 所以工具名/调用 id/turn/step/reason 都在 `event.data` 里。
   * 这里优先读 `data`，同时兼容直接写在顶层的形状（旧测试与未知来源）。
   */
  const payload = (event) => (event && typeof event.data === 'object' && event.data !== null ? event.data : event) ?? {};

  /** 折叠一条会话事件。 */
  const fold = (id, event) => {
    if (!event || typeof event !== 'object') return;
    const s = session(id);
    const d = payload(event);
    const kind = event.kind ?? event.type ?? '';
    events++;
    seq++;
    s.at = now();
    if (!s.cwd && typeof (d.cwd ?? event.cwd) === 'string') s.cwd = d.cwd ?? event.cwd;
    switch (kind) {
      case 'turn/start':
        s.running = true; s.tool = ''; s.toolRunning = false; s.toolOk = true;
        s.toolCount = 0; s.tokens = 0; s.reason = null; s.calls.clear();
        s.turn = Number(d.turn ?? event.turn ?? s.turn + 1);
        break;
      case 'step/start':
        s.step = Number(d.step ?? event.step ?? s.step + 1);
        break;
      case 'tool/call': {
        // 真实形状：{ type:'tool/call', data:{ name, callId, turn, step, arguments } }
        const tool = String(d.name ?? event.name ?? event.tool ?? 'tool');
        const callId = String(d.callId ?? event.callId ?? event.id ?? '');
        s.tool = tool;
        s.toolRunning = true;
        if (d.turn !== undefined) s.turn = Number(d.turn);
        if (d.step !== undefined) s.step = Number(d.step);
        if (callId) s.calls.set(callId, tool);
        break;
      }
      case 'tool/result': {
        // 真实形状：{ type:'tool/result', data:{ message:{ content:[{ toolCallId, isError }] } } }
        const msg = d.message ?? event.message ?? {};
        const c0 = msg.content?.[0] ?? d.content?.[0] ?? event.content?.[0] ?? {};
        const callId = String(c0.toolCallId ?? d.callId ?? event.callId ?? '');
        if (callId && s.calls.has(callId)) {
          s.tool = s.calls.get(callId);
          s.calls.delete(callId);
        } else if (!callId && s.calls.size > 0) {
          // 畸形结果（缺 callId）：按 FIFO 收掉最早一个在飞调用，
          // 否则"工具进行中"会永远挂着。
          const oldest = s.calls.keys().next();
          if (!oldest.done) {
            s.tool = s.calls.get(oldest.value);
            s.calls.delete(oldest.value);
          }
        }
        s.toolCount += 1;
        s.toolOk = !(c0.isError === true || d.error !== undefined || event.error !== undefined);
        s.toolRunning = s.calls.size > 0;
        break;
      }
      case 'assistant/message': {
        const u = d.usage ?? event.usage ?? d.message?.usage ?? event.message?.usage ?? {};
        s.tokens += Number(u.inputTokens ?? 0) + Number(u.outputTokens ?? 0) + Number(u.cacheReadTokens ?? 0);
        break;
      }
      case 'turn/end':
        s.running = false;
        s.reason = d.reason ?? event.reason ?? null;
        s.toolRunning = false;
        s.toolOk = true;
        s.calls.clear();
        break;
      default:
        break;
    }
  };

  /** `agent/status` 的载荷是**单个对象**（不是位置参数）。 */
  const setAgentStatus = (payload) => {
    const id = payload?.sessionId ?? payload?.session?.id ?? payload?.agent?.sessionId ?? payload?.id;
    const status = payload?.status ?? payload?.agent?.status;
    if (id === undefined || status === undefined) return;
    const s = session(id);
    s.running = status === 'running';
    s.at = now();
    seq++;
  };

  /** `agent/error` 同样是单个对象。 */
  const setAgentError = (payload) => {
    const id = payload?.sessionId ?? payload?.session?.id ?? payload?.agent?.sessionId ?? payload?.id;
    if (id === undefined) return;
    const s = session(id);
    s.running = false;
    s.toolRunning = false;
    s.toolOk = false;
    s.reason = { kind: 'error', message: String(payload?.error?.message ?? payload?.error ?? 'error') };
    s.at = now();
    seq++;
  };

  /** 权威校准：`agents.get(id)?.status === 'running'`。 */
  const reconcile = (agents) => {
    if (!agents || typeof agents.get !== 'function') return;
    for (const s of sessions.values()) {
      try {
        const a = agents.get(s.id);
        if (a?.status) s.running = a.status === 'running';
      } catch {
        /* 拿不到就退回 turn 区间推断 */
      }
    }
  };

  /** 回收长时间无动静且没在跑的会话。 */
  const gc = () => {
    const t = now();
    for (const [k, s] of sessions) if (!s.running && t - s.at > SESSION_TTL_MS) sessions.delete(k);
  };

  /** 焦点会话 = 在跑的里面最近活跃的；没有在跑就取最近活跃的。 */
  const pickFocus = () => {
    let best = null;
    for (const s of sessions.values()) {
      if (!best) { best = s; continue; }
      const a = s.running ? 1 : 0;
      const b = best.running ? 1 : 0;
      if (a > b || (a === b && s.at > best.at)) best = s;
    }
    return best;
  };

  return {
    fold,
    setAgentStatus,
    setAgentError,
    reconcile,
    markSubscribed: () => { subscribed = true; },
    /** 对外契约：前端每 1.2s 轮询这个快照，用 `seq` 判定"有没有新事实"。 */
    snapshot: () => {
      gc();
      const f = pickFocus();
      let running = false;
      for (const s of sessions.values()) if (s.running) { running = true; break; }
      return {
        seq, running,
        tool: f?.tool ?? '', toolRunning: f?.toolRunning ?? false, toolOk: f?.toolOk ?? true,
        toolCount: f?.toolCount ?? 0, turn: f?.turn ?? 0, step: f?.step ?? 0, tokens: f?.tokens ?? 0,
        reason: f?.reason ?? null, sessionId: f?.id ?? '', cwd: f?.cwd ?? '', at: f?.at ?? 0,
        sessions: sessions.size, events, subscribed,
      };
    },
  };
}

/** 在锚点前插入片段（没有锚点就追加）。 */
function insertBefore(html, anchor, fragment) {
  const at = html.search(anchor);
  if (at === -1) return html + fragment;
  return html.slice(0, at) + fragment + html.slice(at);
}

/**
 * 把附加样式与脚本挂到 index HTML 上。
 *
 * 幂等：已经带 marker 的文档原样返回，重复渲染不会叠加。
 * 用 `defer` 而不是内联脚本，这样附加脚本在 DOM 就绪后运行、且不阻塞首屏。
 *
 * @param html - web server 提供的 index HTML。
 * @returns 注入后的 HTML。
 */
export function injectPlus(html) {
  if (typeof html !== 'string' || html.includes(MARKER)) return html;
  const style = `<link rel="stylesheet" ${MARKER} href="${PREFIX}/plus.css">`;
  // type="module"：plus.js 里要 import './satiety.mjs'（纯逻辑模块，便于 Node 单测）
  const script = `<script type="module" ${MARKER} src="${PREFIX}/plus.js"></script>`;
  return insertBefore(insertBefore(html, /<\/head>/i, style), /<\/body>/i, script);
}

/** 统一的应答头：默认不缓存；静态图片/音频走长缓存（它们的改动伴随重启或改名）。 */
function respond(res, status, type, body, cache = 'no-store') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': cache,
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

/** 允许通过路由暴露的扩展名 → MIME。白名单之外一律 404，避免漏出 lib/ 等文件。 */
const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** 值得长缓存的类型（用户那张 1521×1521 的饭碗有 1.1 MB，不能每次刷新都重下）。 */
const IMMUTABLE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.mp3', '.wav']);

/**
 * 把 `/dsh-whale-food-expack/<name>` 解析成 assets 目录下的文件。
 *
 * 用前缀路由而不是逐个登记文件：以后往 `assets/` 里丢新贴图**不需要改宿主、也不需要重启**。
 * 拒绝目录穿越（`..`、空段、反斜杠、NUL）与白名单外的扩展名。
 *
 * @param pathname - 请求路径（不含 query）。
 * @returns `{ file, type, cache }`，不可用时返回 null。
 */
export function resolveAsset(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(`${PREFIX}/`)) return null;
  let rel;
  try { rel = decodeURIComponent(pathname.slice(PREFIX.length + 1)); } catch { return null; }
  if (!rel || rel.includes('\0') || rel.includes('\\')) return null;
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  const dot = rel.lastIndexOf('.');
  const ext = dot === -1 ? '' : rel.slice(dot).toLowerCase();
  const type = MIME[ext];
  if (!type) return null;
  return { file: join(ASSETS, ...parts), type, cache: IMMUTABLE.has(ext) ? 'public, max-age=31536000, immutable' : 'no-store' };
}

/**
 * 挂载插件：订阅活动、注册路由、注入资源。
 *
 * @param ctx - 带 `webServer` 服务的宿主上下文。
 */
export function apply(ctx) {
  const activity = createActivity();

  /** 三种事件都用同一种写法：先试 `{ global: true }`，失败再退回无选项。 */
  const on = (event, handler) => {
    for (const options of [{ global: true }, undefined]) {
      try {
        if (options === undefined) ctx.on(event, handler);
        else ctx.on(event, handler, options);
        activity.markSubscribed();
        return;
      } catch {
        /* 换下一种写法 */
      }
    }
  };
  on('session/event', (session, event) => {
    try { activity.fold(session?.id ?? session, event); } catch { /* 一条坏事件不能打断后续 */ }
  });
  on('agent/status', (payload) => {
    try { activity.setAgentStatus(payload); } catch { /* ignore */ }
  });
  on('agent/error', (payload) => {
    try { activity.setAgentError(payload); } catch { /* ignore */ }
  });

  ctx.effect(() => ctx.webServer.tapIndex(injectPlus), `${MARKER}: 附加样式与脚本`);

  // 静态资源：一条前缀路由覆盖整个 assets/（JS/CSS/JSON 每次读盘 → 前端改动 F5 即生效）
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req, res) => {
        if (req.method === 'OPTIONS') { respond(res, 204, 'text/plain', ''); return; }
        const asset = resolveAsset(new URL(req.url ?? '/', 'http://localhost').pathname);
        if (!asset) { respond(res, 404, 'text/plain; charset=utf-8', 'dsh-whale-food-expack: not found'); return; }
        try {
          respond(res, 200, asset.type, await readFile(asset.file), asset.cache);
        } catch (err) {
          respond(res, 404, 'text/plain; charset=utf-8', `dsh-whale-food-expack: ${err?.message ?? err}`);
        }
      },
    }),
    `route ${PREFIX}/*`,
  );

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/activity.json`,
      handler: (req, res) => {
        try { activity.reconcile(ctx.get('agents')); } catch { /* agents 不可用就退回推断 */ }
        respond(res, 200, 'application/json; charset=utf-8', JSON.stringify(activity.snapshot()));
      },
    }),
    `route ${PREFIX}/activity.json`,
  );
}
