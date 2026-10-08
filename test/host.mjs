/**
 * dsh-whale-food-expack 宿主半端自测：不启动 DSH、不联网、不碰真实 ~/.dsh。
 * 跑法：node test/host.mjs
 */
import assert from 'node:assert/strict';
import { createActivity, injectPlus, resolveAsset, name, inject } from '../lib/index.js';

let passed = 0;
const groups = [];
function check(title, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`\n✗ ${title}\n  ${err.message}`); process.exitCode = 1; }
}

// ---------- 元数据 ----------
groups.push('导出与 patch 行一致');
check('name 与 cordis.patch.yml 的行 id 一致', () => assert.equal(name, 'dsh-whale-food-expack'));
check('inject 只要 webServer', () => assert.deepEqual(inject, ['webServer']));

// ---------- index 注入 ----------
groups.push('index 注入');
check('样式进 head、脚本进 body 且是 module', () => {
  const html = injectPlus('<html><head><title>x</title></head><body><div id="root"></div></body></html>');
  const head = html.indexOf('</head>');
  const body = html.indexOf('</body>');
  assert.ok(html.indexOf('/dsh-whale-food-expack/plus.css') < head, 'style 应在 </head> 之前');
  assert.ok(html.indexOf('/dsh-whale-food-expack/plus.js') > head && html.indexOf('/dsh-whale-food-expack/plus.js') < body, 'script 应在 body 内');
  assert.ok(/<script [^>]*type="module"/.test(html), 'script 必须是 type="module"（plus.js 里 import ./satiety.mjs）');
});
check('幂等：二次注入不叠加', () => {
  const once = injectPlus('<html><head></head><body></body></html>');
  assert.equal(injectPlus(once), once);
});
check('没有 head/body 时降级为追加而不是丢内容', () => {
  const out = injectPlus('<html></html>');
  assert.ok(out.includes('plus.js') && out.includes('plus.css'));
});
check('非字符串输入原样返回', () => assert.equal(injectPlus(null), null));

// ---------- 活动折叠 ----------
groups.push('活动折叠');
const mk = () => createActivity({ now: () => 1000 });
check('turn/start 开跑、tool/call 记名、tool/result 反查名字', () => {
  const a = mk();
  a.fold('s1', { kind: 'turn/start', turn: 1 });
  assert.equal(a.snapshot().running, true);
  a.fold('s1', { kind: 'tool/call', name: 'read', callId: 'c1' });
  assert.equal(a.snapshot().tool, 'read');
  assert.equal(a.snapshot().toolRunning, true);
  // 结果里**没有工具名**，只有 callId —— 必须能反查
  a.fold('s1', { kind: 'tool/result', message: { content: [{ toolCallId: 'c1' }] } });
  const s = a.snapshot();
  assert.equal(s.tool, 'read');
  assert.equal(s.toolRunning, false);
  assert.equal(s.toolCount, 1);
  assert.equal(s.toolOk, true);
});
check('失败判定：content[0].isError === true', () => {
  const a = mk();
  a.fold('s1', { kind: 'turn/start' });
  a.fold('s1', { kind: 'tool/call', name: 'pwsh', callId: 'c9' });
  a.fold('s1', { kind: 'tool/result', message: { content: [{ toolCallId: 'c9', isError: true }] } });
  assert.equal(a.snapshot().toolOk, false);
});
check('失败判定：data.error 也算失败', () => {
  const a = mk();
  a.fold('s1', { kind: 'turn/start' });
  a.fold('s1', { kind: 'tool/call', name: 'grep', callId: 'c2' });
  a.fold('s1', { kind: 'tool/result', message: { content: [{ toolCallId: 'c2' }] }, data: { error: { message: 'boom' } } });
  assert.equal(a.snapshot().toolOk, false);
});
check('并行工具：两个 call 只回一个时 toolRunning 仍为真', () => {
  const a = mk();
  a.fold('s1', { kind: 'turn/start' });
  a.fold('s1', { kind: 'tool/call', name: 'read', callId: 'a' });
  a.fold('s1', { kind: 'tool/call', name: 'grep', callId: 'b' });
  a.fold('s1', { kind: 'tool/result', message: { content: [{ toolCallId: 'a' }] } });
  assert.equal(a.snapshot().toolRunning, true);
  assert.equal(a.snapshot().tool, 'read');
});
check('turn/end 收工并复位失败标记', () => {
  const a = mk();
  a.fold('s1', { kind: 'turn/start' });
  a.fold('s1', { kind: 'tool/call', name: 'read', callId: 'c' });
  a.fold('s1', { kind: 'tool/result', message: { content: [{ toolCallId: 'c', isError: true }] } });
  a.fold('s1', { kind: 'turn/end', reason: { kind: 'completed' } });
  const s = a.snapshot();
  assert.equal(s.running, false);
  assert.equal(s.toolOk, true);
  assert.deepEqual(s.reason, { kind: 'completed' });
});
check('tool/result 缺 callId 时按 FIFO 收掉一个在飞的调用', () => {
  const a = mk();
  a.fold('s1', { kind: 'turn/start' });
  a.fold('s1', { kind: 'tool/call', name: 'read', callId: 'x' });
  a.fold('s1', { kind: 'tool/result', message: { content: [{}] } });
  assert.equal(a.snapshot().toolRunning, false);
});
check('assistant/message 累加 token', () => {
  const a = mk();
  a.fold('s1', { kind: 'turn/start' });
  a.fold('s1', { kind: 'assistant/message', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 } });
  assert.equal(a.snapshot().tokens, 17);
});
check('seq 每次事件都增长（前端靠它判新事实）', () => {
  const a = mk();
  const s0 = a.snapshot().seq;
  a.fold('s1', { kind: 'step/start', step: 2 });
  assert.ok(a.snapshot().seq > s0);
});
check('agent/status 载荷是单个对象', () => {
  const a = mk();
  a.setAgentStatus({ sessionId: 's9', status: 'running' });
  assert.equal(a.snapshot().running, true);
  a.setAgentStatus({ sessionId: 's9', status: 'idle' });
  assert.equal(a.snapshot().running, false);
});
check('agent/error 记为失败并停跑', () => {
  const a = mk();
  a.setAgentStatus({ sessionId: 's1', status: 'running' });
  a.setAgentError({ sessionId: 's1', error: { message: 'crash' } });
  const s = a.snapshot();
  assert.equal(s.running, false);
  assert.equal(s.toolOk, false);
  assert.equal(s.reason.kind, 'error');
});
check('多会话：任一会话在跑则 running 为真，其余字段取焦点会话', () => {
  const a = createActivity({ now: (() => { let t = 0; return () => (t += 100); })() });
  a.fold('old', { kind: 'turn/start' });
  a.fold('old', { kind: 'turn/end' });
  a.fold('new', { kind: 'turn/start' });
  a.fold('new', { kind: 'tool/call', name: 'edit', callId: 'k' });
  const s = a.snapshot();
  assert.equal(s.running, true);
  assert.equal(s.tool, 'edit');
  assert.equal(s.sessionId, 'new');
  assert.equal(s.sessions, 2);
});
check('reconcile 用 agents 服务校准 running', () => {
  const a = mk();
  a.fold('s1', { kind: 'turn/start' });
  a.reconcile({ get: (id) => (id === 's1' ? { status: 'idle' } : undefined) });
  assert.equal(a.snapshot().running, false);
});
check('坏事件不抛错', () => {
  const a = mk();
  a.fold('s1', undefined);
  a.fold('s1', null);
  a.fold('s1', 'nonsense');
  a.setAgentStatus({});
  a.setAgentError({});
  assert.equal(typeof a.snapshot().seq, 'number');
});
check('长期无动静的会话被回收', () => {
  let t = 1000;
  const a = createActivity({ now: () => t });
  a.fold('s1', { kind: 'turn/start' });
  a.fold('s1', { kind: 'turn/end' });
  assert.equal(a.snapshot().sessions, 1);
  t += 61 * 60 * 1000;
  assert.equal(a.snapshot().sessions, 0);
});

// ---------- 静态资源解析 ----------
groups.push('静态资源解析');
check('已知资产：路径、MIME 与缓存策略', () => {
  const js = resolveAsset('/dsh-whale-food-expack/plus.js');
  assert.equal(js.type, 'text/javascript; charset=utf-8');
  assert.equal(js.cache, 'no-store', 'JS 必须不缓存，前端才能热更');
  assert.ok(js.file.endsWith('plus.js'));
  const rice = resolveAsset('/dsh-whale-food-expack/rice-full.png');
  assert.equal(rice.type, 'image/png');
  assert.equal(rice.cache, 'public, max-age=31536000, immutable', '贴图应长缓存（饭碗有 1.1 MB）');
  assert.equal(resolveAsset('/dsh-whale-food-expack/rice-empty.png').type, 'image/png');
  assert.equal(resolveAsset('/dsh-whale-food-expack/feed-lines.json').type, 'application/json; charset=utf-8');
});
check('拒绝目录穿越、未知扩展名与越界前缀', () => {
  assert.equal(resolveAsset('/dsh-whale-food-expack/../lib/index.js'), null);
  assert.equal(resolveAsset('/dsh-whale-food-expack/..%2F..%2Fpackage.json'), null);
  assert.equal(resolveAsset('/dsh-whale-food-expack/secret.txt'), null);
  assert.equal(resolveAsset('/other/plus.js'), null);
  assert.equal(resolveAsset('/dsh-whale-food-expack/'), null);
  assert.equal(resolveAsset(null), null);
});
check('子目录允许，但结果必须仍在 assets 之内', () => {
  const nested = resolveAsset('/dsh-whale-food-expack/rice/full.png');
  assert.ok(nested && nested.file.includes('assets'), '解析结果应位于 assets 目录下');
  assert.equal(nested.type, 'image/png');
});

// ---------- 真实事件形状 ----------
groups.push('真实事件形状');
check('字段都装在 event.data 里（tool/call、step/start、turn/end…）', () => {
  const a = mk();
  a.fold('s1', { type: 'turn/start', data: { turn: 3 } });
  assert.equal(a.snapshot().running, true);
  assert.equal(a.snapshot().turn, 3, 'turn 应在 data.turn');
  a.fold('s1', { type: 'step/start', data: { step: 7 } });
  assert.equal(a.snapshot().step, 7, 'step 应在 data.step');
  a.fold('s1', { type: 'tool/call', data: { name: 'pwsh', callId: 'c1', turn: 3, step: 7 } });
  assert.equal(a.snapshot().tool, 'pwsh', '工具名应在 data.name');
  assert.equal(a.snapshot().toolRunning, true);
  a.fold('s1', { type: 'tool/result', data: { message: { content: [{ toolCallId: 'c1', isError: true }] } } });
  const s = a.snapshot();
  assert.equal(s.tool, 'pwsh', 'tool/result 要用 callId 反查名字');
  assert.equal(s.toolRunning, false);
  assert.equal(s.toolOk, false, '失败判定读 data.message.content[0].isError');
  a.fold('s1', { type: 'turn/end', data: { reason: { kind: 'error' } } });
  assert.deepEqual(a.snapshot().reason, { kind: 'error' }, 'reason 应在 data.reason');
});
check('顶层形状仍然兼容（旧数据/未知来源）', () => {
  const a = mk();
  a.fold('s1', { kind: 'turn/start', turn: 2 });
  a.fold('s1', { kind: 'tool/call', name: 'read', callId: 'x' });
  const s = a.snapshot();
  assert.equal(s.tool, 'read');
  assert.equal(s.turn, 2);
});

console.log(`\nok — ${groups.length} 组断言 / ${passed} 项检查全部通过`);
