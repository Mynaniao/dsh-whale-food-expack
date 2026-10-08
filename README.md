# dsh-whale-food-expansionpack

给**插件市场安装的大肥鱼**（`dsh-whale-widget`）叠加三项改动的附加插件。本体一个字节都不改，
所以上游更新照常：`dsh plugin --profile web update dsh-whale-widget` 之后附加功能继续生效。

## 加的是什么

| # | 功能 | 行为 |
|---|---|---|
| ① | **喂白米饭** | 右下角一碗白米饭，拖到鲸鱼身上 → 缩进嘴里、张嘴咀嚼、冒一句台词；没拖中飞回原位。喂了多少碗记在 `localStorage.dshwv-feed-count`，台词里的 `N` 会替换成次数（台词写的是"已经吃了 N **碗**了"） |
| ② | **饭碗循环** | 满碗喂掉后**留一个空碗**；**左键单击空碗**自动盛满，开始下一轮。空碗状态持久化在 `localStorage.dshwv-rice-empty`（刷新不会变回满碗），空碗不可拖动、鼠标变手型并轻微跳动提示可点 |
| ③ | **BongoCat 式反应** | agent 干活时鲸鱼**敲键盘**并**露出两只手**；每次工具调用吐司报工具名（`🛠 read`）；工具失败变红抖动（`💥 pwsh 失败了`）；开工「🔧 开工！」、收工「✨ 干完啦～」并伸个懒腰 |
| ④ | **饱食度** | 空闲 **−1%/分钟**、干活 **×5（−5%/分钟）**；喂一碗饭 **+5%**；**≤50%** 时每 30 秒主动喊一句饿话，每再降 10% 换一档（共 5 档，越饿越惨）。数值实时显示在**鲸鱼右上角的小气泡**里（饭碗下面、鱼头上面）：>50% 深蓝、≤50% 橙、≤20% 红并轻微跳动 |

> 随机食物（🐟🍣🍙…）与「随机/米饭」模式切换已按需求**移除**，现在只有白米饭。

## 饱食度细节

- **数值**都在 `assets/satiety.mjs` 顶部：`IDLE_PER_MIN=1`、`WORK_MULTIPLIER=5`、`FEED_GAIN=5`、`HUNGRY_AT=50`、`TIER_SPAN=10`、`TIER_COUNT=5`、`FULL_AT=99.5`、`HUNGER_INTERVAL_MS=30000`、`HUNGER_TOAST_MS=3000`。
- **节奏参考**（`test/satiety.mjs` 有断言）：一碗饭能撑 **5 分钟**不干活 / **1 分钟**干活；从满值饿到 0：空闲 **100 分钟** / 一直干活 **20 分钟**。嫌太快就改这两个常量。
- **饿话**：`assets/hunger-lines.json`，**5 个数组对应 5 档**（第 1 档最轻）。≤50% 时**每 30 秒**说一句、吐司**停留 3 秒**；想加就加，F5 生效。
- **相邻两句不重复**：饿话与喂饭台词都经 `pickFresh()` 选句，绝不会连着说同一句（跨池也不会有同一句，`test/satiety.mjs` 有断言守住）。事件类吐司（开工/工具名/失败/收工）是事实播报，不做去重。
- **喂饭台词按语境分四档**（`assets/feed-lines.json`）：`starving`(≤20%，"救命饭"那种) / `hungry`(≤50%，"终于能吃上饭了") / `normal`(其余) / `full`(**≥80%** —— "再吃真的要变成大肥鱼了"只在这一档，不饿了就不该说这句)。判断用的是**吃之前**的饱食度（说"终于吃上"的是挨饿那一刻）。也兼容旧的扁平数组写法（会被当成 `normal`），改完 F5 生效。
- **存档**：`localStorage['dshwv-satiety']` + `['dshwv-satiety-at']`。**页面关着的时间按空闲 −1%/分钟补扣**（离线时无法知道 agent 是否在跑，取保守档）；想改成"离线不扣"，删掉 `loadSatiety()` 里那次 `decay` 即可。
- **太饱不吃**：≥99.5% 时拖过去只提示「已经吃得饱饱的」且**不消耗**这碗饭（不想要就删 `swallow()` 开头那段）。
- 饭碗与气泡都锚在 `.dshwp-corner`（= 鲸鱼图那个 59.45% 方块），所以**鲸鱼缩放/移动时会一起跟随**；拖拽时 JS 把饭碗临时搬到 `body` 并改 `fixed`（躲开上游镜像造成的 transform 包含块问题），松手后放回容器。
- **左吸附镜像**（上游给根元素加 `.dshwv-left`）时，吐司与气泡里的文字会自动翻正。

## 怎么做到的（不碰本体）

```
浏览器                          宿主（dsh web）
  plus.js  ──1.2s 轮询────────►  /dsh-whale-food-expansionpack/activity.json   ← lib/index.js 折叠 agent 活动
     │                           /dsh-whale-food-expansionpack/plus.js|plus.css
     │                           /dsh-whale-food-expansionpack/rice-icon.svg|feed-lines.json
     ├─ 找鲸鱼：window.__dshWhaleRoot，回退 .dshwv-root
     ├─ 取鲸鱼图：根元素内**面积最大**的 img
     └─ 叠加层（键盘/手/嘴/吐司）按这张图的包围盒定位
```

- **活动折叠**：宿主订阅 `session/event`、`agent/status`、`agent/error`（先试 `{ global: true }` 再退回无选项），
  按 `turn/start` / `step/start` / `tool/call` / `tool/result` / `assistant/message` / `turn/end` 折叠；
  `tool/result` **不带工具名**，用 `content[0].toolCallId` 反查；失败 = `content[0].isError === true || data.error !== undefined`；
  并用 `ctx.get('agents')?.get(id)?.status` 做权威校准。
- **前端**：按 `seq` 判定"有没有新事实"，避免同一状态反复触发；`document.hidden` 时跳过轮询；
  声称在跑但 90s 没动静且没有工具在飞 → 当作收工（工具在飞时不判）。

## 与 dsh-whale-skin-bridge 的关系

食物元素同时挂了 `dshwv-food` 类，所以**装了桥接时**它会顺手获得两项好处：抬到鲸鱼之上（皮肤不会盖住它）、
全屏时跟随搬进 `fullscreen` 元素。**没装桥接也完全可用**（自身样式已带层级）。

## 怎么改

- **前端改完 F5 即生效**：宿主每次请求都读盘 `assets/plus.js`、`assets/plus.css`。
- **宿主改完要重启 `dsh web`**（ESM 已缓存）。

### 调位置：Ctrl+Alt+M

上游的立绘是**脸部特写**，所以原实现的几何（按全身立绘量的）不能直接用。按 **Ctrl+Alt+M** 进入调位置模式：

- 嘴、键盘、左手、右手会出现**红色虚线框**，直接**拖动**它们到想要的位置；
- 再按一次 **Ctrl+Alt+M**（或 Esc）结束 —— **松手即存**，位置保存在 `localStorage['dshwp-cal']`，刷新后仍生效。

默认值（百分数，相对"鲸鱼图那个盒子"）：嘴 `54%,75%`、键盘 `35%,88%`、左手 `41%,81%`、右手 `55%,81%`。
手填充 `#aabae0`（头发主色 `#566cad` 提亮）、描边 `#3f5598`；键盘深蓝 `#203170` + 浅色键条纹；吐司 left 50% / top 32%。

- 台词在 `assets/feed-lines.json`（`N` = 喂食次数）。
- 米饭贴图：`assets/rice-full.png`（可投喂）/ `assets/rice-empty.png`（空碗，点击续饭）；缺失时退回 `assets/rice-icon.svg`。
- 只调嘴也可以：`localStorage['dshwp-mouth'] = 'left,top,width,height'`（百分数）再 F5。

## 测试

```bash
node test/host.mjs      # 20 项：注入幂等、折叠规则、失败判定、并行工具、FIFO 兜底、多会话、回收
```

不联网、不启动 DSH、不碰真实 `~/.dsh`。

## 素材来源（重要）

本插件的 CSS 几何、配色、台词、米饭 SVG、动画 keyframes **全部取自用户 2026-10 期间被插件市场
"重装"操作误删的自建大肥鱼**，代码是从 DSH 会话日志（`.jsonl.zstd`，逐帧解压）里逐行复原出来的 ——
详见工作区 `AGENTS.md` 与 `C:\Mao\DSH\_rebuild\RECOVERED\`。复原是跨版本按行号拼接的，
所以这里只取了**能确认属于该功能**的部分（几何、配色、台词、SVG、keyframes），逻辑按当时的实现文档重写。

## 安装 / 卸载

```bash
dsh plugin --profile web add "link:C:/Users/maoyi/.dsh/plugins/dsh-whale-food-expansionpack"
# 卸载
dsh plugin --profile web remove dsh-whale-food-expansionpack
```

安装后**重启 `dsh web`**（宿主半端在启动时加载），再刷新页面。
