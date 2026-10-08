/**
 * dsh-whale-food-expack — 客户端（浏览器）半端。
 *
 * 叠加在插件市场的大肥鱼（dsh-whale-widget）之上，实现用户原来的三次改动：
 *   ① 喂食：把白米饭拖到鲸鱼身上 → 吃进嘴里（嘴部动画 + 咀嚼抖动 + 一句台词）
 *   ② 饭碗循环：满碗喂掉后留**空碗**，左键单击空碗自动盛满，开始下一轮（状态持久化）
 *   ③ BongoCat 式反应：干活时敲键盘 + 露手，每次工具调用报工具名，
 *      工具失败抖动，收工伸懒腰（数据来自 /dsh-whale-food-expack/activity.json，1.2s 轮询）
 *
 *   ④ 饱食度：空闲 -1%/分钟、干活 ×5（-5%/分钟）；一碗饭 +5%；
 *      ≤50% 时每分钟主动喊一句饿话，每再降 10% 换一档（共 5 档）
 *
 * 不假设上游 DOM：鲸鱼根元素用 `window.__dshWhaleRoot`，拿不到再退回 `.dshwv-root`；
 * 鲸鱼图用上游的 `.dshwv-img`（回退：面积最大的 img），叠加层都与它同盒。
 *
 * 本文件由宿主以 `<script type="module">` 注入，所以能用 import 引纯逻辑模块（便于单测）。
 */
import { decay, feed, isHungry, tierOf, canEat, feedTier, pickFresh, HUNGER_INTERVAL_MS, HUNGER_TOAST_MS } from './satiety.mjs';

(function () {
  if (window.__dshWhalePlus) return;
  window.__dshWhalePlus = true;

  var PREFIX = '/dsh-whale-food-expack';
  var RICE_SVG = '';
  /**
   * 喂饭台词，按"吃之前"的饱食度分四种语境：
   *   starving ≤20% / hungry ≤50% / normal 其余 / full ≥80%（"再吃要变成大肥鱼"只在这档）。
   * 由 /dsh-whale-food-expack/feed-lines.json 覆盖（也兼容旧的扁平数组，会当成 normal）。
   */
  var FEED_LINES = {
    starving: ['终于…终于能吃上饭了！', '救命的饭！我不客气了！'],
    hungry: ['终于能吃上饭了，谢谢！', '饭真香…我开动啦！'],
    normal: ['啊呜~ 好吃！', '吧唧吧唧…真香！', '已经吃了 N 碗了，我是真能吃！'],
    full: ['再吃真的要变成大肥鱼了！', '嗝~ 已经饱到冒泡泡了…'],
  };
  /** 5 档饿话，从轻到重（由 /dsh-whale-food-expack/hunger-lines.json 覆盖）。 */
  var HUNGER_LINES = [['有点饿了…'], ['真的饿了…'], ['饿得不行了…'], ['快饿死了…'], ['饿…说不出话了…']];
  var KEY_COUNT = 'dshwv-feed-count';
  var KEY_SAT = 'dshwv-satiety';
  var KEY_SAT_AT = 'dshwv-satiety-at';

  // ---------- 小工具 ----------
  function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function load(key, fallback) { try { var v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ } }

  var feedCount = Number(load(KEY_COUNT, 0)) || 0;
  var lastFeedLine = '';

  // ---------- 饱食度（数值逻辑在 satiety.mjs；这里管计时、持久化、显示）----------
  var satiety = 100;          // 当前饱食度 0~100
  var satLastTick = Date.now();
  var satLastSave = Date.now();
  var satLastShown = -1;      // 上次渲染的整数百分比（避免每秒刷 DOM）
  var hungerLastAt = 0;       // 上次喊饿的时间；0 = 还没喊过 → 刚饿下来会立刻喊一句
  var lastHungerLine = '';    // 上一句饿话（相邻两句不重复）
  var workRunning = false;    // agent 是否在干活（决定是否 ×5 消耗）
  var satBubble = null;       // 饱食度气泡
  var satText = null;         // 气泡里的文字（镜像时只翻这层）
  var corner = null;          // 饭碗 + 气泡的锚定容器（与鲸鱼图同盒 → 随鲸鱼缩放/移动）

  /**
   * 读存档。页面关着的那段时间按"不工作"扣（1%/分钟）—— 挂件只在页面开着时才存在，
   * 所以离线期间没法知道 agent 是否在跑，取保守的那档。
   */
  function loadSatiety() {
    var v = parseFloat(load(KEY_SAT, '100'));
    if (!isFinite(v)) v = 100;
    var at = parseFloat(load(KEY_SAT_AT, '0'));
    var now = Date.now();
    if (at > 0 && now > at) v = decay(v, (now - at) / 60000, false);
    satLastTick = now;
    satLastSave = now;
    return v;
  }

  function saveSatiety() {
    save(KEY_SAT, satiety.toFixed(2));
    save(KEY_SAT_AT, String(Date.now()));
    satLastSave = Date.now();
  }

  /** 渲染气泡：>50% 正常、≤50% 警示、≤20% 危险。 */
  function renderSatiety() {
    if (!satText) return;
    var pct = Math.round(satiety);
    if (pct === satLastShown) return;
    satLastShown = pct;
    satText.textContent = pct + '%';
    satBubble.className = 'dshwp-sat' + (pct <= 20 ? ' dshwp-sat-bad' : (pct <= 50 ? ' dshwp-sat-warn' : ''));
  }

  /** 鲸鱼左吸附时上游给根元素加 `.dshwv-left`（transform:scaleX(-1)），文字要翻回来。 */
  function applyFlip() {
    var flipped = !!(root && root.classList && root.classList.contains('dshwv-left'));
    var t = flipped ? 'scaleX(-1)' : '';
    if (toastText && toastText.style.transform !== t) toastText.style.transform = t;
    if (satText && satText.style.transform !== t) satText.style.transform = t;
  }

  /** 每秒：按"是否在干活"扣饱食度；≤50% 每 30 秒喊一句（停留 3 秒），档位随饥饿加深而变。 */
  function tickSatiety() {
    var now = Date.now();
    var minutes = (now - satLastTick) / 60000;
    satLastTick = now;
    if (minutes > 0) satiety = decay(satiety, minutes, workRunning);
    renderSatiety();
    applyFlip();
    if (now - satLastSave > 10000) saveSatiety();

    if (!isHungry(satiety)) { hungerLastAt = 0; return; }   // 吃饱了 → 下次饿下来立刻喊
    if (hungerLastAt && now - hungerLastAt < HUNGER_INTERVAL_MS) return;  // 30 秒一句
    hungerLastAt = now;
    var tier = tierOf(satiety);
    var pool = (HUNGER_LINES[tier] && HUNGER_LINES[tier].length) ? HUNGER_LINES[tier] : ['饿了…'];
    lastHungerLine = pickFresh(pool, lastHungerLine);        // 相邻两句不重复
    showToast(lastHungerLine, tier >= 3 ? 'bad' : (tier >= 1 ? '' : 'done'), HUNGER_TOAST_MS);
  }

  var root = null;      // 鲸鱼根元素
  var img = null;       // 鲸鱼图
  var food = null;      // 食物元素
  var hands = null;     // 键盘 + 两只手的容器（与鲸鱼图同盒）
  var kbEl = null;      // 键盘
  var pawL = null;      // 左手
  var pawR = null;      // 右手
  var mouthWrap = null; // 嘴的定位容器（与鲸鱼图同盒）
  var mouth = null;     // 嘴形（在容器内按 54%/75% 定位）
  var toast = null;     // 吐司
  var toastText = null; // 吐司里的文字（镜像时只翻这一层）
  var cal = false;      // 调位置模式（Ctrl+Alt+M 切换，拖完自动存）
  var typingOn = false; // 当前是否处于"敲键盘"状态（调位置模式要能临时覆盖）

  // ---------- 素材 ----------
  fetch(PREFIX + '/rice-icon.svg').then(function (r) { return r.text(); }).then(function (t) {
    if (t && t.indexOf('<svg') === 0) { RICE_SVG = t; renderFood(); }
  }).catch(function () { /* 没有就用 emoji */ });
  fetch(PREFIX + '/feed-lines.json').then(function (r) { return r.json(); }).then(function (a) {
    if (Array.isArray(a) && a.length) { FEED_LINES = { starving: a, hungry: a, normal: a, full: a }; }
    else if (a && typeof a === 'object') {
      ['starving', 'hungry', 'normal', 'full'].forEach(function (k) {
        if (Array.isArray(a[k]) && a[k].length) FEED_LINES[k] = a[k];
      });
    }
  }).catch(function () { /* 用内置台词 */ });
  fetch(PREFIX + '/hunger-lines.json').then(function (r) { return r.json(); }).then(function (a) {
    if (Array.isArray(a) && a.length) HUNGER_LINES = a;
  }).catch(function () { /* 用内置兜底台词 */ });

  satiety = loadSatiety();

  // ---------- 找到鲸鱼 ----------
  function findRoot() { return window.__dshWhaleRoot || document.querySelector('.dshwv-root'); }

  /** 鲸鱼本体：上游用 `.dshwv-img`（right/bottom + 59.45% 方块）；没有就退回面积最大的图。 */
  function findImg(el) {
    var named = el.querySelector('.dshwv-img');
    if (named) return named;
    var best = null, area = 0, list = el.querySelectorAll('img');
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      var a = r.width * r.height;
      if (a > area) { area = a; best = list[i]; }
    }
    return best;
  }

  // ---------- 叠加层：键盘 / 手 / 嘴 / 吐司 ----------
  function buildOverlay() {
    hands = document.createElement('div');
    hands.className = 'dshwp-hands';
    kbEl = document.createElement('div');
    kbEl.className = 'dshwp-kb';
    // 5 个真实键帽：flex 均分 → 尺寸绝对一致（用渐变会因首尾裁切而一大一小）
    for (var ki = 0; ki < 5; ki++) {
      var keyEl = document.createElement('div');
      keyEl.className = 'dshwp-key';
      kbEl.appendChild(keyEl);
    }
    pawL = document.createElement('div');
    pawL.className = 'dshwp-paw dshwp-paw-l';
    pawR = document.createElement('div');
    pawR.className = 'dshwp-paw dshwp-paw-r';
    hands.appendChild(kbEl);
    hands.appendChild(pawL);
    hands.appendChild(pawR);
    root.appendChild(hands);

    // 嘴必须是两层：外层（.dshwp-mouthwrap）用 CSS 对齐到上游 .dshwv-img 的同一个盒子，
    // 内层才是嘴形（容器内 54%/36%、13%×5.5% 定位）。
    // 曾经把两层合成一层、又用 JS 量"根元素里最大的 img" → 嘴跑到头顶上去了。
    mouthWrap = document.createElement('div');
    mouthWrap.className = 'dshwp-mouthwrap';
    mouth = document.createElement('div');
    mouth.className = 'dshwp-mouth';
    mouthWrap.appendChild(mouth);
    root.appendChild(mouthWrap);

    toast = document.createElement('div');
    toast.className = 'dshwp-toast';
    toastText = document.createElement('span');
    toast.appendChild(toastText);
    root.appendChild(toast);

    // 饭碗 + 饱食度气泡锚在**鲸鱼图同一个盒子**里（.dshwp-corner）：
    // 鲸鱼缩放/移动/被拖到别处时它们一起跟着走 —— 这就是"相对大小和位置一致"。
    corner = document.createElement('div');
    corner.className = 'dshwp-corner';
    satBubble = document.createElement('div');
    satBubble.className = 'dshwp-sat';
    satText = document.createElement('span');
    satBubble.appendChild(satText);
    corner.appendChild(satBubble);
    root.appendChild(corner);
  }

  // ---------- 调位置（Ctrl+Alt+M：拖动虚线框，松手即存）----------
  var CAL_KEY = 'dshwp-cal';
  /** 存盘版本号：改了默认几何就 +1，旧存档自动失效（否则你永远看不到新默认值）。 */
  var CAL_V = 4;
  /** 各元素的默认位置（百分数，相对各自容器）——拖拽时作为起点，也是没存过时的取值。 */
  var CAL_DEFAULT = { mouth: [54, 75], kb: [19, 88], pawL: [25, 78.5], pawR: [41, 78.5] };

  function calParts() {
    return [
      ['mouth', mouth, mouthWrap],
      ['kb', kbEl, hands],
      ['pawL', pawL, hands],
      ['pawR', pawR, hands],
    ];
  }

  /** 应用存下来的位置（以及 localStorage['dshwp-mouth'] 这个简写覆盖）。 */
  function applyCal() {
    var box = null;
    var raw = load(CAL_KEY, '');
    if (raw) { try { box = JSON.parse(raw); } catch (e) { box = null; } }
    if (box && box._v !== CAL_V) box = null;   // 旧版本的存档作废
    if (box) {
      calParts().forEach(function (p) {
        var v = box[p[0]];
        if (!v || !p[1]) return;
        if (isFinite(v[0])) p[1].style.left = v[0] + '%';
        if (isFinite(v[1])) p[1].style.top = v[1] + '%';
      });
    }
    // 简写覆盖：localStorage['dshwp-mouth'] = 'left,top,width,height'
    var m = load('dshwp-mouth', '');
    if (m && mouth) {
      var q = String(m).split(',').map(function (x) { return parseFloat(x); });
      if (isFinite(q[0])) mouth.style.left = q[0] + '%';
      if (isFinite(q[1])) mouth.style.top = q[1] + '%';
      if (isFinite(q[2])) { mouth.style.width = q[2] + '%'; mouth.style.marginLeft = (-q[2] / 2) + '%'; }
      if (isFinite(q[3])) { mouth.style.height = q[3] + '%'; mouth.style.marginTop = (-q[3] / 2) + '%'; }
    }
  }

  /** 保存拖过的位置（只存拖动过的，避免把 0 写进去）。 */
  function saveCal() {
    var box = null;
    var raw = load(CAL_KEY, '');
    if (raw) { try { box = JSON.parse(raw) || {}; } catch (e) { box = {}; } }
    box = box || {};
    box._v = CAL_V;
    calParts().forEach(function (p) {
      var el = p[1];
      if (!el || (!el.style.left && !el.style.top)) return;
      box[p[0]] = [Number((parseFloat(el.style.left) || 0).toFixed(2)), Number((parseFloat(el.style.top) || 0).toFixed(2))];
    });
    save(CAL_KEY, JSON.stringify(box));
  }

  /** 让一个元素可以被拖动（仅调位置模式下生效）。 */
  function makeDraggable(key, el, parent) {
    if (!el || !parent || el.__dshwpDrag) return;
    el.__dshwpDrag = true;
    el.addEventListener('pointerdown', function (e) {
      if (!cal) return;
      e.preventDefault();
      e.stopPropagation();
      var pr = parent.getBoundingClientRect();
      if (!pr.width || !pr.height) return;
      var l0 = parseFloat(el.style.left);
      var t0 = parseFloat(el.style.top);
      if (!isFinite(l0)) l0 = CAL_DEFAULT[key][0];
      if (!isFinite(t0)) t0 = CAL_DEFAULT[key][1];
      var x0 = e.clientX, y0 = e.clientY, moved = false;
      function move(ev) {
        moved = true;
        el.style.left = (l0 + ((ev.clientX - x0) / pr.width) * 100).toFixed(2) + '%';
        el.style.top = (t0 + ((ev.clientY - y0) / pr.height) * 100).toFixed(2) + '%';
      }
      function up() {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        if (moved) saveCal();
      }
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
    }, true);
  }

  /** 进出调位置模式。 */
  function toggleCal() {
    cal = !cal;
    calParts().forEach(function (p) { if (p[1]) p[1].classList.toggle('dshwp-cal', cal); });
    if (hands) hands.classList.toggle('dshwp-hands-on', cal || typingOn);
    if (mouth) mouth.classList.toggle('dshwp-mouth-open', cal);
    if (cal) showToast('拖动虚线框调位置；再按 Ctrl+Alt+M 结束', 'done', 4000);
    else { saveCal(); showToast('位置已保存 ✓', 'done', 1500); }
  }

  // ---------- 吐司 ----------
  var toastTimer = null;
  function showToast(text, kind, ms) {
    if (!toast || !text) return;
    toast.className = 'dshwp-toast dshwp-toast-on' + (kind ? ' dshwp-toast-' + kind : '');
    if (toastText) toastText.textContent = text; else toast.textContent = text;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.className = 'dshwp-toast';
      toastTimer = null;
    }, ms || 1800);
  }

  // ---------- 食物：只有白米饭 ----------
  function renderFood() {
    if (!food) return;
    // 满碗（可投喂）/ 空碗（点击盛满）
    var url = PREFIX + (riceEmpty ? '/rice-empty.png' : '/rice-full.png');
    food.innerHTML = '<img alt="" src="' + url + '" style="width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;-webkit-user-drag:none;user-select:none">';
    food.classList.add('dshwp-rice');
    food.classList.toggle('dshwp-rice-empty', !!riceEmpty);
    // 贴图缺失时退回矢量饭碗（用户原实现里那只内联 SVG 碗）
    var im = food.firstChild;
    if (im && RICE_SVG) im.addEventListener('error', function () { food.innerHTML = RICE_SVG; });
  }

  var riceEmpty = load('dshwv-rice-empty', '0') === '1';

  /** 切换饭碗状态（满/空）并持久化 —— 空碗要留到用户左键点击续饭为止。 */
  function setRiceEmpty(v) {
    riceEmpty = !!v;
    save('dshwv-rice-empty', riceEmpty ? '1' : '0');
    renderFood();
  }

  function buildFood() {
    food = document.createElement('div');
    // 只挂 dshwp-food：饭碗现在**锚在鲸鱼内部**（随鲸鱼缩放/移动）。
    // 不能再挂 dshwv-food —— dsh-whale-skin-bridge 会在全屏时把 .dshwv-food 单独搬进
    // fullscreen 元素，那样它就会脱离锚点容器、跑偏。
    food.className = 'dshwp-food';
    (corner || root || document.body).appendChild(food);

    food.addEventListener('pointerdown', onFoodDown);
    // 右键：以前用来切「随机食物/白米饭」，现在只有白米饭了 —— 只吃掉浏览器菜单并提示一下
    food.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      showToast('🍚 大肥鱼现在只吃白米饭', 'done', 1400);
    });
    // 空碗：左键单击自动盛满，开始下一轮
    food.addEventListener('click', function () {
      if (riceEmpty) {
        setRiceEmpty(false);
        showToast('🍚 饭盛满了', 'done', 1200);
      }
    });
    renderFood();
  }

  function onFoodDown(e) {
    if (e.button === 2) return;             // 右键交给 contextmenu
    if (riceEmpty) return;                  // 空碗不拖，点了盛满
    e.preventDefault();
    var r = food.getBoundingClientRect();
    food.classList.add('dshwp-food-grabbing');
    food.style.transition = 'none';
    // 拖拽期间搬到 body 并用 fixed 定位：鲸鱼左吸附时上游会给根元素加 transform:scaleX(-1)，
    // 那会让"固定定位"的包含块变成这个被 transform 的祖先 → 视口坐标就错了。
    // 顺手把当前尺寸钉成 px，避免换容器时尺寸跳一下（resetFood 会清掉）。
    document.body.appendChild(food);
    food.style.position = 'fixed';
    food.style.width = r.width + 'px';
    food.style.height = r.height + 'px';
    food.style.left = (e.clientX - r.width / 2) + 'px';
    food.style.top = (e.clientY - r.height / 2) + 'px';
    document.addEventListener('pointermove', onFoodMove, true);
    document.addEventListener('pointerup', onFoodUp, true);
    document.addEventListener('pointercancel', onFoodReset, true);
  }

  function onFoodMove(e) {
    food.style.left = (e.clientX - food.offsetWidth / 2) + 'px';
    food.style.top = (e.clientY - food.offsetHeight / 2) + 'px';
  }

  function onFoodUp(e) {
    document.removeEventListener('pointermove', onFoodMove, true);
    document.removeEventListener('pointerup', onFoodUp, true);
    document.removeEventListener('pointercancel', onFoodReset, true);
    food.classList.remove('dshwp-food-grabbing');

    var target = whaleRect();
    var hit = target && e.clientX >= target.left && e.clientX <= target.right && e.clientY >= target.top && e.clientY <= target.bottom;
    if (!hit) { resetFood(); return; }
    swallow(target);
  }

  function onFoodReset() {
    document.removeEventListener('pointermove', onFoodMove, true);
    document.removeEventListener('pointerup', onFoodUp, true);
    document.removeEventListener('pointercancel', onFoodReset, true);
    food.classList.remove('dshwp-food-grabbing');
    resetFood();
  }

  /** 鲸鱼（或它的嘴）在视口里的矩形。 */
  function whaleRect() {
    if (img) { try { return img.getBoundingClientRect(); } catch (e) { /* fallthrough */ } }
    if (root) { try { return root.getBoundingClientRect(); } catch (e) { /* fallthrough */ } }
    return null;
  }

  /** 吃进嘴里：缩到嘴心、淡出，同时嘴张开 + 咀嚼。 */
  function swallow(target) {
    if (!canEat(satiety)) {
      // 太饱了就不消耗这碗饭（免得满值还白白吃掉一碗）
      showToast('🍚 已经吃得饱饱的，晚点再喂~', 'done', 1800);
      resetFood();
      return;
    }
    var satietyBefore = satiety;   // 台词语境看"吃之前"：饿着吃上 vs 平常 vs 已经很饱
    var mouthX = target.left + target.width * 0.54;
    var mouthY = target.top + target.height * 0.36;
    food.style.transition = 'left .28s ease-in,top .28s ease-in,width .28s ease,height .28s ease,opacity .28s ease';
    food.style.left = (mouthX - 4) + 'px';
    food.style.top = (mouthY - 4) + 'px';
    food.style.width = '8px';
    food.style.height = '8px';
    food.style.opacity = '0';

    if (mouth) {
      mouth.classList.add('dshwp-mouth-open');
      setTimeout(function () { mouth.classList.add('dshwp-mouth-chomp'); }, 60);
    }
    chew();
    riceEmpty = true;                        // 动画结束后 resetFood 会渲染成空碗
    save('dshwv-rice-empty', '1');

    feedCount += 1;
    save(KEY_COUNT, feedCount);
    satiety = feed(satiety);       // 一碗 +5%
    saveSatiety();
    renderSatiety();
    var msg = pickFeedLine(satietyBefore).replace('N', String(feedCount));
    showToast(msg, 'done', 2000);
    setTimeout(function () {
      // 吃完必须把嘴收回去，否则它会一直张着（曾经就是这个 bug）
      if (mouth) mouth.classList.remove('dshwp-mouth-open', 'dshwp-mouth-chomp');
      resetFood();
    }, 900);
  }

  /** 咀嚼抖动（原实现挂在鲸鱼根元素上）。 */
  function chew() {
    var el = img || root;
    if (!el) return;
    el.classList.add('dshwp-chewing');
    setTimeout(function () { el.classList.remove('dshwp-chewing'); }, 700);
  }

  /**
   * 台词：按语境选池子（饿着吃上饭 vs 平常 vs 已经很饱），相邻不重复。
   *
   * @param satietyBefore - **吃之前**的饱食度（"终于吃上饭"说的是挨饿那一刻）。
   */
  function pickFeedLine(satietyBefore) {
    var tier = feedTier(typeof satietyBefore === 'number' ? satietyBefore : satiety);
    var pool = FEED_LINES[tier] && FEED_LINES[tier].length ? FEED_LINES[tier] : FEED_LINES.normal;
    var fresh = pool.filter(function (l) { return l !== lastFeedLine; });
    if (!fresh.length) fresh = pool;
    lastFeedLine = pickOne(fresh);
    return lastFeedLine;
  }

  /** 回到锚定位置（饭碗容器内，随鲸鱼缩放/移动）。 */
  function resetFood() {
    if (!food) return;
    food.style.transition = 'left .3s ease,top .3s ease,width .25s ease,height .25s ease,opacity .25s ease';
    food.style.position = '';
    food.style.left = '';
    food.style.top = '';
    food.style.right = '';
    food.style.bottom = '';
    food.style.width = '';
    food.style.height = '';
    food.style.opacity = '';
    if (corner) corner.appendChild(food);   // 拖拽时被搬到 body，这里放回锚点容器
    // **不要**在这里清 riceEmpty：米饭模式喂完要留一个空碗，
    // 等用户左键点击才盛满开始下一轮（见 setRiceEmpty / 点击处理）。
    renderFood();
  }

  // ---------- 反应：打字手部 + 工具提示 ----------
  var state = { seq: -1, running: false, tool: '', toolOk: true, toolRunning: false, at: 0, stale: false };
  var popTimer = null, shakeTimer = null;

  function oneShot(cls, ms) {
    var el = img || root;
    if (!el) return;
    el.classList.add(cls);
    var timer = cls === 'dshwp-pop' ? popTimer : shakeTimer;
    if (timer) clearTimeout(timer);
    var t = setTimeout(function () { el.classList.remove(cls); }, ms);
    if (cls === 'dshwp-pop') popTimer = t; else shakeTimer = t;
  }

  function setTyping(on) {
    typingOn = !!on;
    var el = img || root;
    if (!el) return;
    el.classList.toggle('dshwp-typing', typingOn);
    if (hands) hands.classList.toggle('dshwp-hands-on', typingOn || cal);
  }

  function react(next) {
    var prev = state;
    var fresh = next.seq !== prev.seq;
    state = {
      seq: next.seq, running: !!next.running, tool: next.tool || '', toolOk: next.toolOk !== false,
      toolRunning: !!next.toolRunning, at: next.at || 0, stale: false,
    };
    // 陈旧兜底：声称在跑但很久没动静、且没有工具在飞 → 当作收工（工具在跑时不判）
    if (state.running && !state.toolRunning && state.at && Date.now() - state.at > 90000) state.stale = true;

    var running = state.running && !state.stale;
    workRunning = running;   // 饱食度消耗倍率看这个（干活 ×5）
    if (running !== prev.running || (fresh && running !== prev.running)) setTyping(running);

    if (fresh && running && !prev.running) showToast('🔧 开工！', 'done', 1600);
    if (fresh && !running && prev.running) {
      oneShot('dshwp-pop', 700);
      showToast('✨ 干完啦～', 'done', 2000);
    }
    if (fresh && state.tool && state.tool !== prev.tool) showToast('🛠 ' + state.tool, '', 1600);
    if (fresh && !state.toolOk) {
      oneShot('dshwp-shake', 900);
      showToast('💥 ' + (state.tool || '工具') + ' 失败了', 'bad', 2200);
    }
  }

  function poll() {
    if (document.hidden) return;
    fetch(PREFIX + '/activity.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { try { react(j); } catch (e) { /* 坏数据不能打断轮询 */ } })
      .catch(function () { /* 宿主没起或插件被卸载：静默 */ });
  }

  // ---------- 启动 ----------
  function boot() {
    var el = findRoot();
    if (!el) return false;
    root = el;
    img = findImg(root);
    buildOverlay();
    buildFood();
    applyCal();
    calParts().forEach(function (p) { makeDraggable(p[0], p[1], p[2]); });
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.altKey && String(e.key).toLowerCase() === 'm') { e.preventDefault(); toggleCal(); }
      else if (e.key === 'Escape' && cal) toggleCal();
    });
    setTyping(false);
    renderSatiety();
    poll();
    setInterval(poll, 1200);
    setInterval(tickSatiety, 1000);
    // 关页面 / 切后台时把饱食度和时间戳落盘（下次打开按离线时长扣）
    document.addEventListener('visibilitychange', function () { if (document.hidden) saveSatiety(); });
    window.addEventListener('beforeunload', saveSatiety);
    return true;
  }

  function wait() {
    if (boot()) return;
    var mo = new MutationObserver(function () { if (boot()) mo.disconnect(); });
    mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { mo.disconnect(); }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wait);
  else wait();
})();
