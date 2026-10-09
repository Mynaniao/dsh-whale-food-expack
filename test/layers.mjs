/**
 * 图层断言：防止"饭碗被鲸鱼压住"这个 bug 复发，并守住皮肤/全屏兼容补丁的关键约定。
 *   node test/layers.mjs
 *
 * 纯静态检查（读源码文件），不联网、不需要 DOM —— 和仓库里其它测试一样，跑得飞快。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.join(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'assets/plus.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'assets/plus.js'), 'utf8');

let groups = 0, checks = 0;
const group = (name, fn) => {
  groups++;
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n      ' + e.message); process.exitCode = 1; }
};
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

/** 取某个选择器块里的某个属性值（先剥掉注释，否则注释会把属性分隔符挡住） */
const cssValue = (selector, prop) => {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = re.exec(css);
  if (!m) return null;
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '');      // ← 关键：先去掉注释
  const p = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)');
  const v = p.exec(body);
  return v ? v[1].trim() : null;
};
const num = (s) => parseInt(String(s).replace(/[^\d-]/g, ''), 10);

// ---------------------------------------------------------------- 上游层级基线
// 从上游 whale-widget.js 抄下来的两个关键值（也是我们这次修复的对照系）
const WHALE_IMG_Z = 1;      // .dshwv-img
const WHALE_ROOT_Z = 9999;  // .dshwv-root
const SKIN_LAYER_Z = 2147483000; // dsh-macos-skin 的 #dsh-desktop

console.log('图层与皮肤兼容断言');

group('饭碗必须压过鲸鱼本体（本次线上 bug 的根因）', () => {
  const z = cssValue('.dshwp-food', 'z-index');
  ok(z !== null, '.dshwp-food 必须有显式 z-index（之前没有 → 被上游图的 1 压住）');
  ok(num(z) > WHALE_IMG_Z, '饭碗 z-index(' + z + ') 必须 > 鲸鱼图 ' + WHALE_IMG_Z);
  ok(num(z) > WHALE_ROOT_Z, '饭碗拖拽时会被搬到 body，必须 > 鲸鱼根元素 ' + WHALE_ROOT_Z);
});

group('其他叠加层各有层级，不会互相压住', () => {
  const corner = cssValue('.dshwp-corner', 'z-index');
  ok(corner !== null && num(corner) > WHALE_IMG_Z, '.dshwp-corner 要有 z-index 且 > 1（当前 ' + corner + '）');
  for (const sel of ['.dshwp-hands', '.dshwp-mouthwrap', '.dshwp-toast', '.dshwp-sat']) {
    const z = cssValue(sel, 'z-index');
    ok(z !== null, sel + ' 应有显式 z-index');
  }
});

group('皮肤兼容补丁：常量取值正确', () => {
  const base = /var BASE_FOOD_Z = (\d+)/.exec(js);
  const sroot = /var SKIN_ROOT_Z = (\d+)/.exec(js);
  const sfood = /var SKIN_FOOD_Z = (\d+)/.exec(js);
  ok(base, '应有 BASE_FOOD_Z');
  ok(sroot, '应有 SKIN_ROOT_Z');
  ok(sfood, '应有 SKIN_FOOD_Z');
  ok(Number(base[1]) > WHALE_ROOT_Z, 'BASE_FOOD_Z 必须 > ' + WHALE_ROOT_Z);
  ok(Number(sroot[1]) > SKIN_LAYER_Z, 'SKIN_ROOT_Z 必须 > 皮肤层 ' + SKIN_LAYER_Z);
  ok(Number(sfood[1]) > Number(sroot[1]), 'SKIN_FOOD_Z 要比 SKIN_ROOT_Z 更高');
  ok(Number(base[1]) === num(cssValue('.dshwp-food', 'z-index')), 'CSS 与 JS 里的基础层级要一致（否则拖拽前后会跳）');
});

group('皮肤兼容补丁：只在检测到皮肤时才接管层级', () => {
  ok(/function isSkinLike/.test(js), '应有 isSkinLike()');
  ok(/cs\.position !== 'fixed'/.test(js), '皮肤判定应要求 position:fixed');
  ok(/z >= 1000000/.test(js), '皮肤判定应要求一个天文数字层级');
  ok(/function findSkinLayer/.test(js), '应有 findSkinLayer()');
  ok(/if \(on\) setZ\(root, SKIN_ROOT_Z\); else clearZ\(root\);/.test(js),
    '无皮肤时必须 clearZ(root) 还原 —— 不能永久改掉上游自己的动态 z-index');
});

group('全屏兼容：进 fullscreen 时把鲸鱼搬进 top layer', () => {
  ok(/function syncFullscreen/.test(js), '应有 syncFullscreen()');
  ok(/document\.addEventListener\('fullscreenchange', syncFullscreen\)/.test(js), '应监听 fullscreenchange');
  ok(/fsEl\.appendChild\(root\)/.test(js), '进入全屏应把根元素搬进 fullscreen 元素');
  ok(/homeParent\.appendChild\(root\)/.test(js), '退出全屏应搬回原来的父节点');
});

group('巡检与启动挂接', () => {
  ok(/setInterval\(function \(\) \{ syncLayers\(\); syncFullscreen\(\); \}, 3000\)/.test(js), '应有 3 秒巡检');
  const bootIdx = js.indexOf('function boot()');
  const after = js.slice(bootIdx, bootIdx + 1200);
  ok(/syncLayers\(true\)/.test(after), 'boot() 里应立刻判定一次皮肤');
  ok(/syncFullscreen\(\)/.test(after), 'boot() 里应立刻同步一次全屏状态');
});

group('饭碗不挂 dshwv-food（桥接会在全屏时把它单独搬走 → 会脱离锚点）', () => {
  const cls = /food\.className = '([^']+)'/.exec(js);
  ok(cls, "应能找到 food.className 赋值");
  ok(!/\bdshwv-food\b/.test(cls[1]), "饭碗的类名里不能有 dshwv-food（当前：'" + cls[1] + "'）");
});

console.log('\nok — ' + groups + ' 组断言 / ' + checks + ' 项检查全部通过');
