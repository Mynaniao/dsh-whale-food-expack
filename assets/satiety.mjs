/**
 * 饱食度：纯逻辑，不碰 DOM / localStorage，所以能在 Node 里单测（test/satiety.mjs）。
 *
 * 规则（用户 2026-10-07 定）：
 *   - 空闲：每分钟 -1%
 *   - agent 干活时：速度 ×5（即 -5%/分钟）
 *   - 喂一碗白米饭：+5%
 *   - ≤50% 就开始主动喊饿，**每 30 秒一句**、吐司停留 **3 秒**；每再降 10% 换一档，共 5 档
 *   - 喂饭的台词也分语境（starving / hungry / normal / full），见 feedTier()
 *   - 所有随机台词（饿话、喂饭台词）**相邻两句不重复**，统一走 pickFresh()
 */

/** 空闲时的下降速度（百分点/分钟）。 */
export const IDLE_PER_MIN = 1;
/** agent 干活时的倍率。 */
export const WORK_MULTIPLIER = 5;
/** 一碗米饭的饱食度增量（百分点）。 */
export const FEED_GAIN = 5;
/** 低于等于这个值就开始喊饿。 */
export const HUNGRY_AT = 50;
/** 每降这么多百分点换一档台词。 */
export const TIER_SPAN = 10;
/** 台词档数。 */
export const TIER_COUNT = 5;
/** 高于这个值就"太饱了"，喂不进（避免满值还消耗饭碗）。 */
export const FULL_AT = 99.5;

/** 饿话频率：≤50% 时每 30 秒说一句。 */
export const HUNGER_INTERVAL_MS = 30000;
/** 饿话在吐司里停留 3 秒。 */
export const HUNGER_TOAST_MS = 3000;

/** 喂饭台词的语境分界：吃饱到什么程度算"很饱"（这套台词里才有"要变成大肥鱼"）。 */
export const FED_FULL_AT = 80;
/** 喂饭台词的语境分界：低于等于这个值算"饿着吃上饭"。 */
export const FED_HUNGRY_AT = 50;
/** 喂饭台词的语境分界：低于等于这个值算"快饿死了才吃上"。 */
export const FED_STARVING_AT = 20;

/** 夹在 0~100。 */
export const clamp = (v) => Math.max(0, Math.min(100, v));

/** 当前每分钟下降多少（干活 ×5）。 */
export const decayRate = (working) => IDLE_PER_MIN * (working ? WORK_MULTIPLIER : 1);

/**
 * 经过一段时间后的饱食度。
 *
 * @param satiety - 当前饱食度（0~100）。
 * @param minutes - 经过的分钟数（负数按 0 处理）。
 * @param working - 这段时间里 agent 是否在干活。
 * @returns 新的饱食度（已夹到 0~100）。
 */
export const decay = (satiety, minutes, working) => clamp(satiety - decayRate(working) * Math.max(0, minutes));

/** 喂一碗饭之后。 */
export const feed = (satiety) => clamp(satiety + FEED_GAIN);

/** 是不是该喊饿了。 */
export const isHungry = (satiety) => satiety <= HUNGRY_AT;

/** 还吃得下吗。 */
export const canEat = (satiety) => satiety < FULL_AT;

/**
 * 饥饿档位：0 最轻（刚低于 50%），4 最重（≤10%）。
 *
 * @param satiety - 当前饱食度。
 * @returns 0~4。
 */
export const tierOf = (satiety) =>
  Math.max(0, Math.min(TIER_COUNT - 1, Math.floor((HUNGRY_AT - satiety) / TIER_SPAN)));

/**
 * 喂饭台词的语境（**用吃之前**的饱食度算，因为"终于吃上饭"说的是挨饿那一刻）。
 *
 *   'starving' ≤20% → 救命饭、终于吃上了
 *   'hungry'   ≤50% → 饭真香、来得正好
 *   'normal'   其余  → 平常的好吃
 *   'full'     ≥80% → 已经很饱，"再吃要变成大肥鱼了"只在这档
 *
 * @param satiety - 吃饭之前的饱食度。
 * @returns 语境名。
 */
export const feedTier = (satiety) => {
  if (satiety >= FED_FULL_AT) return 'full';
  if (satiety <= FED_STARVING_AT) return 'starving';
  if (satiety <= FED_HUNGRY_AT) return 'hungry';
  return 'normal';
};

/**
 * 从池子里挑一句，**避开上一句**（相邻不重复）；池子只剩一句时只能重复。
 *
 * @param pool - 候选台词。
 * @param last - 上一句（可为空）。
 * @param random - 随机源（测试可注入）。
 * @returns 选中的句子；空池返回空串。
 */
export const pickFresh = (pool, last, random = Math.random) => {
  const list = Array.isArray(pool) ? pool : [];
  if (!list.length) return '';
  const fresh = list.filter((l) => l !== last);
  const from = fresh.length ? fresh : list;
  return from[Math.floor(random() * from.length)];
};
