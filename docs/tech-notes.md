# 技术细节（实现与维护）

> 这份文档是 README 的补充：README 面向**使用者**，这里记录**实现机制、可调参数、调试方法与踩过的坑**。
> 数值都对着当前代码核对过（2026-10-08，v1.0.0）。

## 一、总体架构（本体一字节不改）

```
浏览器                                  宿主（dsh web）—— lib/index.js
  plus.js ──1.2s 轮询───────────────►  /dsh-whale-food-expack/activity.json
     │                                  /dsh-whale-food-expack/plus.js | plus.css
     │                                  /dsh-whale-food-expack/rice-icon.svg | feed-lines.json
     ├─ 找鲸鱼：window.__dshWhaleRoot，回退 .dshwv-root
     ├─ 取鲸鱼图：根元素里那张（上游的）立绘 img
     └─ 叠加层（饭碗 / 饱食度气泡 / 键盘 / 手 / 嘴 / 吐司）按它的包围盒定位
```

- 宿主用 `ctx.webServer.tapIndex()` 往页面注入 `<link>` 与 `<script type="module">`，注入点带标记
  `data-plugin="dsh-whale-food-expack"`（注入前先清旧的，保证幂等）。
- 路由是**前缀式白名单**：只在 `/dsh-whale-food-expack/` 下暴露 `assets/` 里已知的文件；
  图片长缓存，`plus.js` / `plus.css` / `activity.json` 不缓存（所以前端改完 F5 就生效）。
- **上游更新照常**：我们只读 `window.__dshWhaleRoot` / `.dshwv-root` 和公开的 DOM 类名，不改本体代码。

## 二、agent 活动是怎么折叠出来的

宿主订阅 `session/event`、`agent/status`、`agent/error`（先试 `{ global: true }`，失败再退回无选项调用），
把事件折叠成 `activity.json`：

- 关注 `turn/start`、`step/start`、`tool/call`、`tool/result`、`assistant/message`、`turn/end`。
- **事件字段在 `event.data.*`**（`data.name` / `data.callId` / `data.turn` / `data.step` / `data.reason` /
  `data.message.content[0].toolCallId`）—— 曾经取错层级，结果吐司显示字面量 `tool`。
- `tool/result` **不带工具名**，用 `content[0].toolCallId` 反查之前的 `tool/call`；
  失败判定 = `content[0].isError === true || data.error !== undefined`。
- 再用 `ctx.get('agents')?.get(id)?.status` 做权威校准（自称在跑、实际已停时纠正）。

前端侧：

- 按 `seq` 判断"有没有新事实"，避免同一状态反复触发动画与吐司；
- `document.hidden` 时跳过轮询；
- 声称在跑但 **90 秒**没动静、且没有工具在飞 → 当作收工（有工具在飞时不判，避免误伤长任务）。

## 三、饱食度

数值全部在 `assets/satiety.mjs` 顶部（纯逻辑、不碰 DOM，所以能在 Node 里单测）：

| 常量 | 值 | 含义 |
|---|---|---|
| `IDLE_PER_MIN` | 1 | 空闲每分钟 −1% |
| `WORK_MULTIPLIER` | 5 | 干活 ×5 → −5%/分钟 |
| `FEED_GAIN` | 5 | 一碗饭 +5% |
| `HUNGRY_AT` | 50 | ≤50% 开始喊饿话 |
| `TIER_SPAN` / `TIER_COUNT` | 10 / 5 | 每降 10% 换一档，共 5 档 |
| `FULL_AT` | 99.5 | ≥此值不吃，只提示"已经吃得饱饱的"，且**不消耗**这碗饭 |
| `HUNGER_INTERVAL_MS` | 30000 | 饿话每 30 秒一句 |
| `HUNGER_TOAST_MS` | 3000 | 饿话吐司停留 3 秒 |
| `FED_FULL_AT` / `FED_HUNGRY_AT` / `FED_STARVING_AT` | 80 / 50 / 20 | 喂饭台词分档阈值 |

- **节奏**（`test/satiety.mjs` 有断言）：一碗饭撑 **5 分钟**空闲 / **1 分钟**干活；
  从满值饿到 0：空闲 **100 分钟** / 一直干活 **20 分钟**。
- **台词**：喂饭 `assets/feed-lines.json`（四档 `starving` / `hungry` / `normal` / `full`，
  "再吃真的要变成大肥鱼了"**只在 `full`**；`N` 替换成喂食次数）；
  饿话 `assets/hunger-lines.json`（5 个数组对应 5 档）。
- **相邻不重复**：两个池子都经 `pickFresh()` 选句，绝不会连着说同一句（跨池也不重复，测试有断言）。
  事件类吐司（开工 / 工具名 / 失败 / 收工）是事实播报，不做去重。
- **分档依据**：喂饭台词看的是**吃之前**的饱食度（说"终于能吃上饭了"的应该是挨饿那一刻）。
- **存档**：`dshwv-satiety` + `dshwv-satiety-at`。**页面关着的时间按空闲速率补扣**
  （离线时无法知道 agent 在不在跑，取保守档）；想改成"离线不扣"，删掉 `loadSatiety()` 里那次 `decay` 即可。

## 四、几何与定位（踩坑最多的地方）

- 所有叠加层都锚在 `.dshwp-corner` 这个盒子里 —— 它与上游立绘 `.dshwv-img` **是同一个 59.45% 方块**，
  所以鲸鱼缩放 / 移动时饭碗、气泡、键盘、手会一起跟随。
- **不要用 JS 去量"根元素里最大的 img"**：上游根里还有别的图，量错嘴会跑到额头上。
- 拖动饭碗时把元素**临时搬到 `body` 并改 `position: fixed`**：上游给根元素加了镜像 `scaleX(-1)`，
  `fixed` 会被那个 transform 当成包含块，不搬就会跟着镜像跑。
- 上游进入**左吸附镜像**（根元素带 `.dshwv-left`）时，吐司与气泡里的文字会自动翻正。
- 饭碗**故意不挂 `dshwv-food`** 类 ✗：`dsh-whale-skin-bridge` 会在全屏时把 `.dshwv-food`
  单独搬进 fullscreen 元素，那样饭碗会和气泡、饱食度分离。本插件用自己的层级与样式。

### 调位置：Ctrl+Alt+M

上游立绘是**脸部特写**，按全身立绘量的几何直接用会错位。按 **Ctrl+Alt+M**：

- 嘴、键盘、左手、右手会出现**红色虚线框**，直接拖动到位；
- 再按一次（或 Esc）结束 —— **松手即存**到 `dshwp-cal`，刷新后仍生效。

当前默认值（百分数，相对"鲸鱼图那个盒子"）：
嘴 `54,75`、键盘 `19,88`、左手 `25,78.5`、右手 `41,78.5`。
改默认值时要同时把 `CAL_V` 加 1，让旧存档失效。
只想改嘴也可以用简写：`localStorage['dshwp-mouth'] = 'left,top,width,height'` 再 F5。

## 五、本地存档一览

| 键 | 内容 |
|---|---|
| `dshwv-satiety` / `dshwv-satiety-at` | 饱食度与时间戳（离线补扣用）|
| `dshwv-feed-count` | 累计喂饭碗数（台词里的 `N`）|
| `dshwv-rice-empty` | 是否留着空碗（刷新不会变回满碗）|
| `dshwp-cal` | Ctrl+Alt+M 保存的几何 |
| `dshwp-mouth` | 只覆盖嘴位置的简写 |

> 内部 CSS 前缀 `dshwp-` 与这些键**故意保持原名**：插件改过两次名，改键就会丢用户的存档。

## 六、改代码 / 调试

- **前端改完 F5 即生效**（宿主每次请求都读盘 `assets/plus.js`、`assets/plus.css`）。
- **宿主（`lib/index.js`）改完要重启 `dsh web`**（ESM 已缓存）。
- 只改台词 JSON → F5 即生效。

## 七、测试

```bash
node test/host.mjs      # 25 项：注入幂等、activity 折叠、失败判定、并行工具、FIFO 兜底、多会话、回收
node test/satiety.mjs   # 24 项：常量、衰减、喂食、档位、选句不重复
```

不联网、不启动 DSH、不碰真实的 `~/.dsh`。CI 见 `.github/workflows/test.yml`。

## 八、素材来源（重要）

本插件的 CSS 几何、配色、台词、米饭 SVG、动画 keyframes **全部取自用户 2026-10 期间被插件市场
"重装"操作误删的自建大肥鱼** —— 代码是从 DSH 会话日志（`.jsonl.zstd`，**多帧 zstd，必须逐帧解压**）
里逐行复原的，详见工作区 `AGENTS.md` 与 `C:\Mao\DSH\_rebuild\RECOVERED\`。
复原是跨版本按行号拼接的，所以只取了**能确认属于该功能**的部分（几何、配色、台词、SVG、keyframes），
逻辑按当时的实现文档重写。

**上游（`dsh-whale-widget`）的图片 / 动图 / 音效一个都没有打进本包** —— 上游 MIT 不覆盖 `assets/**`，
且明确不授予再许可，详见 [NOTICE.md](../NOTICE.md)。

## 九、文件结构

| 路径 | 作用 |
|---|---|
| `lib/index.js` | 宿主半端：注入、路由白名单、activity 折叠 |
| `assets/plus.js` | 前端主体：轮询、动画、拖拽、饱食度 tick |
| `assets/plus.css` | 几何 / 配色 / 动画 keyframes |
| `assets/satiety.mjs` | 饱食度纯逻辑（可单测）|
| `assets/feed-lines.json` / `assets/hunger-lines.json` | 台词池（四档 / 五档）|
| `assets/rice-full.png` / `rice-empty.png` / `rice-icon.svg` | 米饭贴图（缺失时退回 SVG）|
| `test/host.mjs` / `test/satiety.mjs` | 断言（25 + 24 项）|
| `cordis.patch.yml` | 往 profile 里插一行 |
