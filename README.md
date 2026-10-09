# dsh-whale-food-expack

> 🍚 给 DSH 的**小鲸鱼记账挂件**加上「喂白米饭 + 干活敲键盘 + 工具显示」的附加包
>
> **不修改本体插件** · 纯本机运行 · **不向任何服务器发送数据** · 非官方项目

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-whale-food-expack.svg)](https://www.npmjs.com/package/dsh-whale-food-expack)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/mynaniao/dsh-whale-food-expack)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](#开发与测试)
[![test](https://github.com/Mynaniao/dsh-whale-food-expack/actions/workflows/test.yml/badge.svg)](https://github.com/Mynaniao/dsh-whale-food-expack/actions/workflows/test.yml)

当前版本 **1.0.1**（[npm](https://www.npmjs.com/package/dsh-whale-food-expack)）· 依赖本体 `dsh-whale-widget` ≥ 0.3.0（建议，非强制） · 包体积约 **350 KB**

---

## 演示

喂白米饭 + 干活敲键盘 + 工具显示，同时进行：

<img src="https://raw.githubusercontent.com/Mynaniao/dsh-whale-food-expack/main/docs/demo-overview.webp" width="420" alt="喂饭与敲键盘同时进行">

| 不干活时：喂白米饭 | 干活时：敲键盘 + 工具显示 |
|---|---|
| <img src="https://raw.githubusercontent.com/Mynaniao/dsh-whale-food-expack/main/docs/demo-feed.webp" width="300" alt="拖饭喂食"> | <img src="https://raw.githubusercontent.com/Mynaniao/dsh-whale-food-expack/main/docs/demo-typing.webp" width="300" alt="干活敲键盘"> |

- **喂白米饭**：把饭碗拖到鲸鱼身上 → 张嘴吃掉 → 冒一句台词；吃完留一个空碗，**左键点一下**自动盛满
- **敲键盘 + 工具显示**：agent 干活时鲸鱼露出手敲键盘，实时吐司报使用的工具名（`🛠 read`），失败时变红抖动

## 使用指南

| # | 功能 | 使用方法与效果 |
|---|---|---|
| ① | **喂白米饭** | 把白米饭🍚拖到鲸鱼身上 → 鲸鱼张嘴咀嚼、冒一句对应台词并增加饱食度（没拖中会飞回原位） |
| ② | **续饭功能** | 满碗喂掉后**留一个空碗**；**左键单击空碗**自动盛满，开始下一轮（刷新后仍保持空碗）；注意⚠️：空碗🥣无法拖动 |
| ③ | **饱食度系统** | 空闲 **−1%/分钟**、干活 **×5（−5%/分钟）**；喂一碗饭 **+5%**。**≤50%** 时每 30 秒主动喊一句饿话，越饿说得越惨（5 档）。数值实时显示在**右上角小气泡**里：深蓝 = 正常、橙色 = 饿了、红色 = 快饿死了 |
| ④ | **敲键盘反应** | agent 干活时鲸鱼**敲键盘**并**露出两只手**；每次工具调用吐司报工具名（`🛠 read`）；工具失败变红抖动（`💥 pwsh 失败了`）；开工「🔧 开工！」、收工「✨ 干完啦～」并伸个懒腰 |

## 安装

**前置条件**：先装好本体 —— 插件市场里的「**DSH 小鲸鱼记账挂件**」（包名 `dsh-whale-widget`，版本 **≥ 0.3.0**）。
本插件只是它的附加层，**没有本体不会显示任何东西**。

```bash
# 从 npm / 插件市场安装（推荐，已发布 v1.0.1）
dsh plugin --profile web add dsh-whale-food-expack

# 或者直接从 GitHub 安装
dsh plugin --profile web add github:Mynaniao/dsh-whale-food-expack
```

装好后**重启 `dsh web`**（宿主半端在启动时加载），然后刷新页面。

```bash
# 卸载（鲸鱼娘本体不受影响，继续正常工作）
dsh plugin --profile web remove dsh-whale-food-expack
```

## 配置与数据

**饱食度数值**都在 `assets/satiety.mjs` 顶部，改完刷新页面即生效：

| 常量 | 当前值 | 含义 |
|---|---|---|
| `IDLE_PER_MIN` | `1` | 空闲每分钟掉 1% |
| `WORK_MULTIPLIER` | `5` | 干活时快 5 倍（即 5%/分钟） |
| `FEED_GAIN` | `5` | 一碗饭 +5% |
| `HUNGRY_AT` | `50` | ≤50% 开始喊饿 |
| `TIER_SPAN` / `TIER_COUNT` | `10` / `5` | 每降 10% 换一档，共 5 档 |
| `HUNGER_INTERVAL_MS` / `HUNGER_TOAST_MS` | `30000` / `3000` | 每 30 秒一句，吐司停留 3 秒 |

**台词**都在 `assets/` 里，直接编辑、刷新即生效：

- `hunger-lines.json` —— 5 档饿话（第 1 档最轻），相邻两句不重复
- `feed-lines.json` —— 喂饭台词，按**吃之前**的状态分四档：`starving`(≤20%) / `hungry`(≤50%) / `normal` / `full`(≥80%)

**数据与隐私** —— 全部只存在你自己的浏览器里，**本插件不向任何服务器发送数据**：

| localStorage 键 | 存什么 | 想清零怎么办 |
|---|---|---|
| `dshwv-satiety` / `dshwv-satiety-at` | 当前饱食度 + 时间戳（用于离线补算） | 删除这两个键 → 回到 100% |
| `dshwv-feed-count` | 累计喂了多少碗 | 删掉 |
| `dshwv-rice-empty` | 饭碗是空是满 | 删掉（恢复满碗） |
| `dshwp-cal` | 你调过的位置 | 删掉（恢复默认位置） |
| `dshwp-mouth` | 只调嘴的简写覆盖：`'left,top,width,height'` | 删掉 |

> 页面关着的时间按**空闲速率**补算（离线时无法知道 agent 在不在干活，取保守值）。
> 想改成"离线不扣"，删掉 `assets/plus.js` 里 `loadSatiety()` 中的那次 `decay` 调用即可。

## 常见问题

**装了没反应？**
先确认本体在不在（插件市场里的「DSH 小鲸鱼记账挂件」）。本插件只给本体加东西，没本体就什么都不显示。
装完记得**重启 `dsh web`**，然后刷新页面。

**叠加层错位了（嘴跑到额头、手飘在半空）？**
上游换立绘或挂了别的皮肤插件时会发生。按 **`Ctrl+Alt+M`** 进入调整模式 → 嘴/键盘/左手/右手会出现红色虚线框，直接拖动；再按一次 `Ctrl+Alt+M`（或 `Esc`）结束，**松手即存**。位置存在 `localStorage['dshwp-cal']`。。

**想彻底关掉？**
`dsh plugin --profile web remove dsh-whale-food-expack`，然后重启；本体继续正常工作。

**饥饿模式台词不出现？**
饱食度要**降到 50% 以下**才会开始说；而且**每分钟（30 秒）一句**，不是一直在说。想立刻看效果：
控制台执行 `localStorage['dshwv-satiety']='45'; localStorage['dshwv-satiety-at']=Date.now()` 再刷新。

**它会读取我的对话内容吗？**
不读。宿主半端只订阅 agent 的**状态事件**（开工/收工/工具名/成败），不含对话内容；前端也只是把这些状态画成动画。

## 开发与测试

```bash
npm test                 # = node test/host.mjs && node test/satiety.mjs
node test/host.mjs       # 25 项：注入幂等、事件折叠、失败判定、并行工具、FIFO 兜底、静态资源解析
node test/satiety.mjs    # 24 项：下降速率、喂食、档位、语境、相邻不重复、台词文件一致性
```

**49 条断言**，不联网、不启动 DSH、不碰真实 `~/.dsh`。CI 见 [`.github/workflows/test.yml`](.github/workflows/test.yml)（push / PR 自动跑）。

- Node ≥ 20（仅开发与测试需要；装插件本身不需要）
- 结构：宿主 `lib/index.js`（折叠 agent 活动成 `/dsh-whale-food-expack/activity.json`，并白名单式暴露 `assets/`）；
  前端 `assets/plus.js` + `plus.css`（1.2 秒轮询，按 `seq` 判新事件）；纯逻辑抽在 `assets/satiety.mjs` 便于单测。
- **实现细节**（架构图、activity 折叠规则、饱食度常量表、几何与校准坐标、本地存档键、调试方法）见
  [`docs/tech-notes.md`](docs/tech-notes.md)

## 许可与致谢

- **本体**：「DSH 小鲸鱼记账挂件」由 [@MeteorNOX](https://github.com/MeteorNOX) 开发
  （[DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)，MIT）。
  **本插件与作者无隶属关系，也不是 DeepSeek 官方产品。**
- **不含上游素材**：本插件不包含本体的任何代码或美术素材（图片 / 动图 / 音效），运行时只通过公开的
  DOM 类名（`.dshwv-img` 等）对接；上游改版可能导致叠加层错位，用 `Ctrl+Alt+M` 重新对齐即可。
- **本插件**：几何、配色、台词、米饭贴图与动画由本插件作者提供，按 **MIT** 授权分发，见 [LICENSE](LICENSE)。
- **免责与第三方**：非官方项目、不含上游素材、商标与权利主张的完整说明见 [NOTICE.md](NOTICE.md)。
