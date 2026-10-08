/**
 * 饱食度纯逻辑自测：node test/satiety.mjs
 * 不联网、不需要 DSH、不碰 localStorage。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  IDLE_PER_MIN, WORK_MULTIPLIER, FEED_GAIN, HUNGRY_AT, TIER_SPAN, TIER_COUNT, FULL_AT,
  HUNGER_INTERVAL_MS, HUNGER_TOAST_MS,
  FED_FULL_AT, FED_HUNGRY_AT, FED_STARVING_AT,
  clamp, decayRate, decay, feed, isHungry, tierOf, canEat, feedTier, pickFresh,
} from '../assets/satiety.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = (f) => JSON.parse(readFileSync(join(HERE, '..', 'assets', f), 'utf8'));
let passed = 0;
const groups = [];
function check(title, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`\n✗ ${title}\n  ${err.message}`); process.exitCode = 1; }
}

groups.push('规格常量');
check('数值与需求一致：-1%/分钟、干活 ×3、一碗 +5%、50% 起饿、每 10% 一档、共 5 档', () => {
  assert.equal(IDLE_PER_MIN, 1);
  assert.equal(WORK_MULTIPLIER, 3);
  assert.equal(FEED_GAIN, 5);
  assert.equal(HUNGRY_AT, 50);
  assert.equal(TIER_SPAN, 10);
  assert.equal(TIER_COUNT, 5);
  assert.ok(FULL_AT > 99 && FULL_AT <= 100);
});
check('饿话频率 30 秒、停留 3 秒', () => {
  assert.equal(HUNGER_INTERVAL_MS, 30000);
  assert.equal(HUNGER_TOAST_MS, 3000);
});

groups.push('下降速度');
check('空闲 1%/分钟，干活 3%/分钟', () => {
  assert.equal(decayRate(false), 1);
  assert.equal(decayRate(true), 3);
});
check('满值放 1 分钟：空闲 → 99，干活 → 97', () => {
  assert.equal(decay(100, 1, false), 99);
  assert.equal(decay(100, 1, true), 97);
});
check('干活 5 倍速确实等于空闲的 5 倍消耗', () => {
  const idle = 100 - decay(100, 3, false);
  const work = 100 - decay(100, 3, true);
  assert.equal(work, idle * WORK_MULTIPLIER);
});
check('不会掉到负数，也不会超过 100', () => {
  assert.equal(decay(5, 10, false), 0);
  assert.equal(decay(100, 0, true), 100);
  assert.equal(decay(50, -5, true), 50, '负时间按 0 处理');
  assert.equal(clamp(-3), 0);
  assert.equal(clamp(120), 100);
});

groups.push('喂食');
check('一碗 +5%，封顶 100', () => {
  assert.equal(feed(50), 55);
  assert.equal(feed(96), 100);
  assert.equal(feed(100), 100);
});
check('太饱（≥99.5）时喂不进', () => {
  assert.equal(canEat(99), true);
  assert.equal(canEat(99.6), false);
  assert.equal(canEat(100), false);
});

groups.push('饥饿档位（喊话台词用）');
check('档位边界：50/40/30/20/10 各换一档，共 5 档', () => {
  assert.equal(tierOf(50), 0, '刚降到 50% 是第 1 档');
  assert.equal(tierOf(40.1), 0);
  assert.equal(tierOf(40), 1);
  assert.equal(tierOf(30), 2);
  assert.equal(tierOf(20), 3);
  assert.equal(tierOf(10), 4);
  assert.equal(tierOf(0), 4, '最低也封在第 5 档');
});
check('isHungry 在 ≤50% 时为真', () => {
  assert.equal(isHungry(50), true);
  assert.equal(isHungry(50.01), false);
});

groups.push('喂饭语境（吃之前的状态决定台词）');
check('四个语境：starving / hungry / normal / full', () => {
  assert.equal(feedTier(0), 'starving');
  assert.equal(feedTier(FED_STARVING_AT), 'starving');
  assert.equal(feedTier(21), 'hungry');
  assert.equal(feedTier(FED_HUNGRY_AT), 'hungry', '刚好 50% 算"饿着吃上饭"');
  assert.equal(feedTier(50.1), 'normal');
  assert.equal(feedTier(79.9), 'normal');
  assert.equal(feedTier(FED_FULL_AT), 'full');
  assert.equal(feedTier(100), 'full');
});
check('三个分界常量符合需求（80 / 50 / 20）', () => {
  assert.equal(FED_FULL_AT, 80);
  assert.equal(FED_HUNGRY_AT, 50);
  assert.equal(FED_STARVING_AT, 20);
});

groups.push('相邻两句不重复（pickFresh）');
check('不会挑到上一句', () => {
  const pool = ['A', 'B', 'C'];
  assert.equal(pickFresh(pool, 'A', () => 0), 'B', '排除 A 之后第一个是 B');
  assert.equal(pickFresh(pool, 'B', () => 0), 'A');
  assert.equal(pickFresh(pool, 'C', () => 0.99), 'B');
});
check('池子只剩一句时只能重复它', () => {
  assert.equal(pickFresh(['只有我'], '只有我', () => 0), '只有我');
});
check('空池返回空串、非数组也安全', () => {
  assert.equal(pickFresh([], 'A'), '');
  assert.equal(pickFresh(null, 'A'), '');
});

groups.push('台词文件与语境一致');
const feedLines = readJson('feed-lines.json');
const hungerLines = readJson('hunger-lines.json');
check('喂饭四组台词齐全且都非空', () => {
  for (const k of ['starving', 'hungry', 'normal', 'full']) {
    assert.ok(Array.isArray(feedLines[k]) && feedLines[k].length > 0, `${k} 组缺失或为空`);
  }
});
check('饿话是 5 档且都非空', () => {
  assert.equal(hungerLines.length, 5);
  hungerLines.forEach((t, i) => assert.ok(Array.isArray(t) && t.length > 0, `第 ${i + 1} 档缺失或为空`));
});
check('"再吃真的要变成大肥鱼了"只出现在 full 档（饱食度很高时）', () => {
  const hit = ['starving', 'hungry', 'normal', 'full'].filter((k) => feedLines[k].some((l) => l.includes('大肥鱼')));
  assert.deepEqual(hit, ['full'], '这句应只在 full 档：' + hit.join(','));
});
check('饿着吃上的两档说的是"终于吃上/救命饭"这类语境', () => {
  const hungryish = [...feedLines.starving, ...feedLines.hungry].join('');
  assert.match(hungryish, /终于|救命|等好久|饿/, 'starving/hungry 档要有挨饿语境');
});
check('计数台词（含 N）只在 normal 档', () => {
  const withN = ['starving', 'hungry', 'normal', 'full'].filter((k) => feedLines[k].some((l) => l.includes('N')));
  assert.deepEqual(withN, ['normal']);
});
check('每个池子内部没有重复句（否则"相邻不重复"会被同一句破坏）', () => {
  for (const [k, list] of Object.entries(feedLines)) {
    assert.equal(new Set(list).size, list.length, `${k} 档有重复句`);
  }
  hungerLines.forEach((list, i) => assert.equal(new Set(list).size, list.length, `饿话第 ${i + 1} 档有重复句`));
});
check('饿话与喂饭台词没有交叉重复（避免刚喊完饿就重复同一句）', () => {
  const hungerAll = new Set(hungerLines.flat());
  const clash = Object.values(feedLines).flat().filter((l) => hungerAll.has(l));
  assert.deepEqual(clash, [], '交叉重复：' + clash.join(' / '));
});

groups.push('经济性（让用户看清这套数值的节奏）');
check('一碗饭能撑：空闲 5 分钟 / 干活 100 秒', () => {
  assert.equal(FEED_GAIN / decayRate(false), 5);
  assert.equal(FEED_GAIN / decayRate(true), 5 / 3);
});
check('从满值饿到 0：空闲 100 分钟 / 一直干活约 33 分钟', () => {
  assert.equal(100 / decayRate(false), 100);
  assert.equal(100 / decayRate(true), 100 / 3);
});

console.log(`\nok — ${groups.length} 组断言 / ${passed} 项检查全部通过`);
