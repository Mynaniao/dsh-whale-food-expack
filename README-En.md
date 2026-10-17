# dsh-whale-food-expack

[English](README-En.md) | [中文](README.md)

> 🍚 An add-on for DSH's **Little Whale balance widget** — feed it white rice, watch it type when the agent works, and see which tool is running
>
> **Does not modify the upstream widget** · Runs entirely on your machine · **Sends nothing to any server** · Unofficial project

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-whale-food-expack.svg)](https://www.npmjs.com/package/dsh-whale-food-expack)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/mynaniao/dsh-whale-food-expack)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](#development--testing)
[![test](https://github.com/Mynaniao/dsh-whale-food-expack/actions/workflows/test.yml/badge.svg)](https://github.com/Mynaniao/dsh-whale-food-expack/actions/workflows/test.yml)

Current version **1.6.0** ([npm](https://www.npmjs.com/package/dsh-whale-food-expack)) · Requires the upstream widget `dsh-whale-widget` ≥ 0.3.0

---

## Demo

Feeding rice, typing, and tool calls — all at once:

<img src="https://raw.githubusercontent.com/Mynaniao/dsh-whale-food-expack/main/docs/demo-overview.webp" width="420" alt="Feeding and typing at the same time">

| Idle: feed white rice | Working: typing + tool indicator |
|---|---|
| <img src="https://raw.githubusercontent.com/Mynaniao/dsh-whale-food-expack/main/docs/demo-feed.webp" width="300" alt="Drag rice to feed"> | <img src="https://raw.githubusercontent.com/Mynaniao/dsh-whale-food-expack/main/docs/demo-typing.webp" width="300" alt="Typing while working"> |

- **Feed white rice**: drag the bowl onto the whale → it opens its mouth and eats → says a line; an empty bowl is left behind, **left-click it** to refill
- **Typing + tool indicator**: while the agent works the whale shows both hands typing, and a toast reports the tool in use (`🛠 read`); failures turn red and shake

## Usage

| # | Feature | How it works |
|---|---|---|
| ① | **Feed white rice** | Drag the rice bowl 🍚 onto the whale → it chews, says a matching line, and gains satiety (misses fly back to their spot) |
| ② | **Refill** | After a full bowl is eaten an **empty bowl** is left behind; **left-click it** to fill it up and start the next round (it stays empty after a refresh). Note ⚠️: the empty bowl 🥣 cannot be dragged |
| ③ | **Satiety system** | **−1%/min** while idle; **while working, consumption follows token usage** (3,000 tokens = −1%, tuned to match real work pace); one bowl of rice = **+5%**. At **≤50%** it complains about being hungry every 30 seconds, in 5 increasingly miserable tiers. The value is shown live in a **small bubble in the top-right corner**: deep blue = fine, orange = hungry, red = starving |
| ④ | **Typing reaction** | While the agent works the whale **types** with **both hands showing**; every tool call pops a toast with the tool name (`🛠 read`); failures turn red and shake (`💥 pwsh failed`); a `🔧 Starting!` toast on start, and on finish `✨ All done~ 12.3K tokens this round · satiety -8.0%` plus a stretch |

## Installation

**Prerequisite**: install the upstream widget first — "**DSH Little Whale balance widget**" in the plugin marketplace (package `dsh-whale-widget`, version **≥ 0.3.0**).
This plugin is only an add-on layer; **nothing will show up without the upstream widget**.

```bash
# From npm / the plugin marketplace (recommended, v1.6.0 published)
dsh plugin --profile web add dsh-whale-food-expack

# Or straight from GitHub
dsh plugin --profile web add github:Mynaniao/dsh-whale-food-expack
```

After installing, **restart `dsh web`** (the host half is loaded at startup), then refresh the page.

```bash
# Uninstall (the whale widget itself keeps working)
dsh plugin --profile web remove dsh-whale-food-expack
```

## Configuration & data

**Satiety values** all live at the top of `assets/satiety.mjs`; edit and refresh the page to apply:

| Constant | Current value | Meaning |
|---|---|---|
| `IDLE_PER_MIN` | `1` | −1% per minute while idle |
| `TOKENS_PER_PERCENT` | `3000` | Tokens per 1% while working (larger = more filling, smaller = hungrier) |
| `FEED_GAIN` | `5` | One bowl = +5% |
| `HUNGRY_AT` | `50` | Hunger complaints start at ≤50% |
| `TIER_SPAN` / `TIER_COUNT` | `10` / `5` | A new tier every 10%, 5 tiers total |
| `HUNGER_INTERVAL_MS` / `HUNGER_TOAST_MS` | `30000` / `3000` | One line every 30 s, toast stays 3 s |

> The 3,000 figure is measured from real session logs: actual work burns about **14,574 tokens/minute**,
> and dividing that by the old "5% per minute while working" gives ≈ 2,900 — rounded to 3,000, so
> **switching to token-based billing leaves the drain rate essentially unchanged**. Derivation and billing
> rules are in [`docs/tech-notes.md`](docs/tech-notes.md) (Chinese).

**Dialogue lines** live in `assets/`, edit and refresh:

- `hunger-lines.json` — 5 tiers of hunger lines (tier 1 is the mildest); consecutive lines never repeat
- `feed-lines.json` — feeding lines, split into four tiers by the satiety **before** eating: `starving`(≤20%) / `hungry`(≤50%) / `normal` / `full`(≥80%)

**Data & privacy** — everything stays in your own browser; **this plugin sends no data to any server**:

| localStorage key | What it stores | How to reset |
|---|---|---|
| `dshwv-satiety` / `dshwv-satiety-at` | Current satiety + timestamp (for offline catch-up) | Delete both keys → back to 100% |
| `dshwv-feed-count` | Total bowls fed | Delete |
| `dshwv-rice-empty` | Whether the bowl is empty or full | Delete (restores a full bowl) |
| `dshwp-cal` | Your adjusted positions | Delete (restores defaults) |
| `dshwp-mouth` | Shorthand override for the mouth only: `'left,top,width,height'` | Delete |

> Time while the page is closed is caught up at the **idle rate** (there's no way to know whether the agent
> was working while offline, so it takes the conservative value). To skip that, remove the `decay` call
> inside `loadSatiety()` in `assets/plus.js`.

## FAQ

**Installed but nothing happens?**
First check the upstream widget is installed ("DSH Little Whale balance widget" in the marketplace). This
plugin only adds to it — without it nothing shows. Remember to **restart `dsh web`** after installing, then refresh.

**Overlay is misaligned (mouth on the forehead, hands floating)?**
Happens when the upstream changes its art or another skin plugin is active. Press **`Ctrl+Alt+M`** to enter
adjust mode → red dashed boxes appear around the mouth / keyboard / hands, drag them directly; press
`Ctrl+Alt+M` again (or `Esc`) to finish — **it saves on release**. Positions are stored in `localStorage['dshwp-cal']`.

**How do I turn it off completely?**
`dsh plugin --profile web remove dsh-whale-food-expack`, then restart; the upstream widget keeps working.

**Hunger lines never appear?**
Satiety has to **drop below 50%** first, and then it's **one line every 30 seconds** — not constant. To see it
immediately, run `localStorage['dshwv-satiety']='45'; localStorage['dshwv-satiety-at']=Date.now()` in the
console and refresh.

**Does it read my conversations?**
No. The host half only subscribes to the agent's **status events** (start / finish / tool name / success),
never conversation content; the front end only draws those states as animation.

## Compatibility

**Desktop (DeepSeek Orb)**: supported. The desktop `index.html` is served statically from the installer, so
the `tapIndex` path used by the web version is never called there — this plugin therefore also hooks
`webserver/index-inject`. When both channels are present, `window.__dshWhalePlus` ensures it only boots once.
On desktop, **fully restart Orb** after changes.

**UI skins (e.g. `dsh-macos-skin`) and fullscreen**: supported. Skins insert an opaque fullscreen wallpaper
(`z-index: 2147483000`); when detected, this plugin raises the whale, the rice bowl, the context menu, and the
app's own dialogs and menus (they portal to `<body>` with **no z-index**, so without raising them "settings
won't open") above that wallpaper. In fullscreen the whale and menu are moved into `document.fullscreenElement`.

Layer order: wallpaper `2147483000` < whale `2147483100` < rice bowl `2147483105` < context menu `2147483110` < app layer `2147483200` < the skin's own popups `2147483300+`.

When debugging conflicts, run `localStorage['dshwp-compat']='0'` and refresh to switch that compatibility layer
off; set it back to `'1'` to restore it.

## Development & testing

```bash
npm test                 # = node test/host.mjs && node test/satiety.mjs && node test/layers.mjs
node test/host.mjs       # 31 checks: injection idempotency, event folding, token billing, failure detection, parallel tools, FIFO fallback, static asset resolution
node test/satiety.mjs    # 31 checks: decay rate, feeding, tiers, context, no consecutive repeats, token conversion, dialogue file consistency
node test/layers.mjs     # 45 checks: stacking layers, skin/fullscreen compatibility, desktop injection row, mirrored-text correction
```

**107 assertions**, no network, no DSH startup, no touching your real `~/.dsh`. CI runs on push / PR — see
[`.github/workflows/test.yml`](.github/workflows/test.yml).

- Node ≥ 20 (development and testing only; not needed to install the plugin)
- Layout: host `lib/index.js` folds agent activity into `/dsh-whale-food-expack/activity.json` and exposes
  `assets/` through a whitelist; front end `assets/plus.js` + `plus.css` (1.2 s polling, `seq`-based
  new-event detection); pure logic is factored into `assets/satiety.mjs` for unit testing.
- **Implementation notes** (architecture, activity folding rules, satiety and token conversion derivation,
  geometry and calibration coordinates, storage keys, debugging) are in
  [`docs/tech-notes.md`](docs/tech-notes.md) (Chinese).

## License & credits

- **Upstream widget**: "DSH Little Whale balance widget" by [@MeteorNOX](https://github.com/MeteorNOX)
  ([DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget), MIT).
  **This plugin is not affiliated with the author and is not an official DeepSeek product.**
- **No upstream assets**: this plugin contains none of the upstream widget's code or artwork (images / GIFs /
  sounds); at runtime it only hooks public DOM class names (`.dshwv-img` etc.). Upstream redesigns may
  misalign the overlay — realign it with `Ctrl+Alt+M`.
- **This plugin**: geometry, colours, dialogue, rice artwork and animations are provided by this plugin's
  author and distributed under **MIT** — see [LICENSE](LICENSE).
- **Disclaimer & third parties**: the full statement on being unofficial, containing no upstream assets, and
  trademarks and claims is in [NOTICE.md](NOTICE.md).
