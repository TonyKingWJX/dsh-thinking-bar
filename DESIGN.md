# dsh-thinking-bar 设计文档（v2.0，2026-10-20）

> **一句话定位：这个插件只做 UI。**
> 它不推断档位、不探测能力、不写任何配置。档位从哪来、有几个、叫什么名字，全部由 DSH 自己决定；插件只负责把这些档位画成一个好看的滑杆，并把用户的选择提交回去。
>
> 行号锚点指向 DSH 安装 bundle：
> `D:\Apps\Users\wang\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`（约 230 万行，未混淆）。
> 用 grep 工具按内容检索；**不要用 read 读 asar**（会报 BigInt 错误）。
> asar 行号随版本变动，**不要硬编码**——所有抽取脚本必须按内容锚点扫描。

---

## 0. 项目定位与边界

### 0.1 做什么

| 职责 | 说明 |
|---|---|
| 顶替输入框的模型 chip | 在 `conversation.input.model` 单槽里以更低 priority 覆盖官方选择器 |
| Codex 风格档位弹层 | 大字档位名 + 胶囊滑杆 + 六套视觉皮肤 |
| 设置分区 | 视觉皮肤、调色板、自定义七色、模式开关、实时预览 |
| 提交选择 | 调官方 `directory.select({provider, model, reasoningEffort})` |

### 0.2 不做什么（重要，别再加回来）

| 不做 | 原因 |
|---|---|
| 写 `reasoningEfforts` | DSH 0.2.1-rc.2 起，设置页「提供商 → 模型 → 推理等级」原生可配，落到 `cordis.patch.yml`。插件再写一遍只会和官方抢同一份配置 |
| 内置厂商知识库 | 同上。官方 catalog 已经是唯一事实来源 |
| 探测上游能力 | `llm.discoverModels` 从不返回 `reasoningEfforts`（asar:859022/859269），探测只能回答"通不通"，答不出"有哪些档" |
| Host 半侧逻辑 / HTTP 路由 | 没有需要 Host 参与的数据了。`index.js` 现在是空壳 |
| 缓存/翻译档位名 | 档位名一律取服务端 `efforts[].name`，缺失才回落 id |

### 0.3 历史包袱（已清理，勿复活）

2026-10-20 之前，本项目存在一整套 Host 半侧实现，已全部删除：

| 已删文件 | 曾负责 |
|---|---|
| `lib/index.js` | 扫描 provider、三级能力瀑布、`settings.mutate` 补写、HTTP 路由 |
| `lib/knowledge.js` | 17 家族 33 条厂商档位规则表 |
| `lib/client.js` | 旧的浏览器半侧 bundle（`id: 'dsh-thinking-effort'`） |
| `test/smoke.mjs` / `test/smoke-knowledge.mjs` | 测上面两个 Host 文件 |
| `test/smoke-client.mjs` | 测旧 bundle 的死断言 |
| `preview/verify.mjs` / `preview/verify-page.mjs` | 测旧 bundle 与旧预览页结构 |
| `tools/asar-lines.mjs` | 按硬编码行号从 asar 取内容 |
| `preview/build-state.mjs` + `vendor/{state,catalog}.json`、`vendor/fixtures.js` | 用 Host 纯函数生成预览 fixture |

**教训：`DESIGN.md` v1.x 里凡是提到这些文件的地方都是历史，不要照着实现。**

---

## 1. 文件结构与构建

### 1.1 源文件

```
index.js                  Host 半侧入口，只有一个空的 apply()
cordis.patch.yml          3 行 insert，把插件挂进 bundle
package.json              type: module；exports / files / dsh 字段见 §1.4
lib/ui.js                 UI 核心（UMD，导出 globalThis.THINKING_UI_CORE）
plugin-client-body.js     浏览器半侧：槽位注册 + 设置分区 + 主渲染
client.js                 构建产物（不要手改）
locale/{zh,en}.json       插件元信息（title / description）
icon.svg / icon-v2.svg    图标（两份内容相同，package.json 用 icon-v2.svg）
tools/build-plugin.mjs    拼接器
tools/shoot-preview.mjs   重拍 README 截图（驱动 headless Edge 的 CDP，见 §8.2）
docs/screenshots/         README 引用的截图（由 shoot-preview.mjs 生成）
鲸鱼娘/*.jpg              原始出图素材（入库留源；成品 webp 见 preview/assets）
test/smoke-corner-shape.mjs   圆角超椭圆回归（8 条）
test/smoke-slider-visual.mjs  滑杆视觉回归（19 条）
test/smoke-effort-levels.mjs  档位来源与顺序（6 条）
test/smoke-level-mapping.mjs  档位→索引映射（9 条）
test/smoke-seat-compat.mjs    与官方槽位的兼容/让位/自愈（6 条）
preview/                  离线预览（见 §8）
```

### 1.2 构建链

`tools/build-plugin.mjs` 只做三件事，没有打包器、没有转译：

1. 读 `lib/ui.js`（核心）+ `plugin-client-body.js`（body）；
2. 把 `preview/assets/*.webp` 共 22 张转成 data URI，注入 `ASSETS` 常量；
3. 拼成 `window.__ModuleLoader__.load({ id: 'dsh-thinking-bar', factory(require) { ... } })` 写入 `client.js`。

```bash
node tools/build-plugin.mjs
# → client.js written: 1893797 chars; 22 assets inlined
```

### 1.3 安装（本机）

`npm install file:*.tgz` 在这个 profile 里会因**无关的** peer 冲突失败（`@kenz1117/dsh-ui-usage-billing`），所以用直接复制：

```powershell
Copy-Item client.js, package.json `
  -Destination C:\Users\wang\.dsh\profiles\desktop\node_modules\dsh-thinking-bar\ -Force
```

装完必须 **Ctrl+R 刷新页面**，client.js 才会被重新加载。

### 1.4 package.json 关键字段

| 字段 | 值 | 说明 |
|---|---|---|
| `type` | `module` | 注意：`lib/ui.js` 是 UMD，`require()` 它拿不到 `module.exports`，要取 `globalThis.THINKING_UI_CORE` |
| `engines.dsh` | `>=0.2.1-rc.2` | 依赖该版本的 provider 推理等级配置 |
| `exports["."]` | `./index.js` | Host 入口 |
| `exports["./client"]` | `./client.js` | 浏览器入口 |
| `dsh.bundle.patch` | `./cordis.patch.yml` | |
| `dsh.client.inject` | `dsh-client-ui-settings`、`-model-selection`、`-conversation` | 三个平台模块 |
| `dsh.client.immediately` | `true` | 立即装载 |

`files[]` 只含 `index.js / client.js / cordis.patch.yml / locale/*.json / icon.svg / icon-v2.svg`。**`lib/`、`test/`、`preview/`、`tools/` 都不打包**——改动它们不影响产物。

---

## 2. 运行时架构（plugin-client-body.js）

### 2.1 插件契约

```js
return {
  inject: ['locale', 'slots'],
  apply(ctx) { ... }
}
```

`apply` 里依次做五件事：

1. `UI.injectStyles()` —— 把 `lib/ui.js` 里那份巨型 CSS 注入 `<style id="teff-ui-styles">`（整块替换，便于热更新）。
2. `setTimeout(resyncPrefs, 0)` + `setTimeout(resyncPrefs, 1200)` —— 冷启动时 localStorage 可能未就绪，读到 null 会回落成 official，必须补读一次。
3. `ctx.locale.register('thinking-bar', {...})` —— 只注册一个 key：`section.label`（zh「思考等级栏」/ en「Thinking Bar」）。
4. 设置导航图标：宿主对未知 section id 一律给齿轮且**不开放自定义图标入口**，所以用 `MutationObserver` 观察 `document.body` 直接子节点，找到文案匹配的 nav 按钮打 `data-teff-nav` 标记，再用 CSS mask 换掉图标。宿主 DOM 变了就静默放弃（退回齿轮）。
5. 两个槽位注册（见 §2.2、§2.3）。

### 2.2 模型 chip 槽：`conversation.input.model`

- 这是 **single 槽**，官方选择器以 `priority: 0` 占位。
- DSH 规则「priority 越小越先渲染」（asar 提示原文：`register at a different priority to shadow it (lowest renders)`）→ 插件用 **`priority: -1`** 才能盖过官方。
- **子插槽不要重复声明**：官方那条仍在册，已经声明过 `conversation.input.model.label`，插件再声明会抛 `already declared`；组件里直接 `renderSlot` 即可。

**face（inject 函数）必须容错**，因为 DSH 会把抛错的条目判为**弃权（abdicated）并永久跳过**：

| 情况 | 处理 |
|---|---|
| `modelDirectories.directoryFor(sessionId)` 抛错（切会话/冷启动瞬间常见） | 吞掉异常，`return { available: false }`，置 `degraded = true` |
| `directory.store` 不存在 | 同上 |
| `sessions.subagentAddress(sessionId) !== undefined`（子代理会话） | `available: false` |

**`reasoning` 必须每次现取**：`directory.catalog.reasoningFor(selection)`。注册座位那一刻目录往往还没建好，若把 catalog 捕获成闭包常量，拿到的永远是 null，所有模型都退回快照里的 `model.reasoning`——而插件新增的模型没有这个字段，表现就是"我们这边没有思考等级，切回官方就有了"。

**自愈**：`degraded` 为真时每 700ms 重注册一次。否则被弃权的条目会一直显示内置选择器（看起来就像"变回官方默认"）。

**座位随模式开关**：`subscribePrefs` 里 `syncSeat()`，`prefs.mode !== 'codex'` 就 `closeSeat()` 让官方 chip 回来。

### 2.3 设置分区槽：`settings.section`

```js
ctx.slots.register({ name: 'settings.section', id: 'dsh-thinking-bar', order: 27, label: () => t('section.label') }, SettingsSection)
```

**必须与模型座位分属不同子 ctx**：座位依赖 `modelDirectories` / `sessions`，它抛错会连带销毁同一子 ctx 里的所有注册（历史上就是这样把设置分区一起带走的）。所以设置分区只依赖 `slots`，用独立的 `ctx.effect`。

### 2.4 偏好存储

| 项 | 值 |
|---|---|
| localStorage key | `dsh-thinking-bar.prefs.v1` |
| 结构 | `{ mode: 'codex' \| 'official', visual, palette, custom: string[7] }` |
| 默认 | `mode: 'codex'`、`visual: 'codex'`、`palette: 'codex'`、`custom: DEFAULT_CUSTOM` |
| 校验 | `visual` / `palette` 必须命中 `CORE.VISUALS` / `CORE.PALETTES` 的 id；`custom` 必须长度 7 且逐个匹配 `/^#[0-9a-f]{6}$/i`，否则回落 `#888888` |
| 写入 | `setPrefs(patch)` 后同步 `setItem`，再通知全部 `prefsListeners` |

**首次安装即默认启用 Codex 滑杆**（`mode: 'codex'`）。已保存的偏好不受影响——`readPrefs` 优先读已存值。

---

## 3. UI 核心契约（lib/ui.js）

### 3.1 UMD 外壳

```js
(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.THINKING_UI_CORE = api
})(globalThis /* ... */, function () {
  'use strict'
  ...
  return { /* 导出表 */ }
})
```

**测试里怎么取 API**：因为 `package.json` 是 `type: module`，`require('lib/ui.js')` 拿到的是空对象。正确姿势：

```js
require(path.join(ROOT, 'lib', 'ui.js'))
const CORE = globalThis.THINKING_UI_CORE
```

### 3.2 导出表

| 类别 | 成员 |
|---|---|
| 工厂 | `createThinkingUI(React)`、`injectStyles(doc)`、`CSS` |
| 视觉/调色板 | `VISUALS`、`PALETTES`、`THEME_COLORS`、`THEME_ASSETS`、`THEME_VISUALS`、`DEFAULT_CUSTOM`、`themeColors`、`resolvePalette`、`fillPalette`、`colorAt` |
| 档位 | `CANON`、`CANON_NAMES`、`ENGLISH_NAMES`、`LIANG_NAMES`、`DEFAULT_LEVEL_ID`、`DEFAULT_LEVEL`、`isDefaultLevel`、`withDefaultLevel`、`realRankOf`、`displayLabelOf`、`indexOfLevel`、`isOffLevel`、`findOffIndex`、`levelName`、`levelLabel` |
| 颜色工具 | `hexToRgb`、`relLuminance`、`contrast`、`ensureContrast`、`rgba` |

`createThinkingUI(React)` 返回 `{ providerLabel, injectStyles, icons: { Data, ChevronDown, ChevronRight, Check, Back, Bolt, Reset, Spinner } }`。

### 3.3 组件清单

| 组件 | 职责 |
|---|---|
| `Popup` | 档位弹层：大字档位名（换名交叉淡化）、模型名行、`EffortSlider`、开关/重置按钮 |
| `Trigger` | 输入框里的 chip：模型名 + 档位名 + chevron，两者各有独立换名动画 |
| `EffortSlider` | 滑杆本体：拖拽/键盘/吸附/提交、刻度、渐变、视觉层挂载 |
| `ParticleLayer` | Codex 星尘（**纯 CSS**，见 §5.4） |
| `EnergyLayer` / `WarpLayer` / `QuantumLayer` | 另外三套 canvas 视觉 |
| 图标 | `IconBolt`（viewBox 16）、`IconReset`、`IconSpinner`（SVG 圆弧，非 CSS border） |

---

## 4. 档位数据模型

### 4.1 规范档位

```js
CANON = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
```

服务端给几个档就渲染几个档。**永远不要假设七档**。

### 4.2 Default 哨兵档

- `DEFAULT_LEVEL_ID = '__provider_default__'`
- `withDefaultLevel(levels, enabled)`：开启时把 `DEFAULT_LEVEL` **插到最前**；已含则原样返回。
- `realRankOf(levels, index)`：跳过 Default 后计算真实序号。
- `paletteIndexFor(levels, index)`：`n === 7` 用原下标，否则 `Math.round(index * 6 / (n - 1))` 把任意档位映射到 7 色。
- `colorAt(levels, index, colors)`：Default 档返回 `colors[0]`（灰）；其余走 `paletteIndexFor`。
- `displayLabelOf(levels, index, isLiang)`：liang 皮肤用 `LIANG_NAMES = ['梁子','小梁','梁叔','梁哥','梁总','梁神','梁圣']`。

### 4.3 填充色与文字色必须分开取（重要）

| 函数 | 用途 | 是否压对比度 |
|---|---|---|
| `fillPalette(id, custom)` | **填充**用色 | ❌ 原色返回 |
| `resolvePalette(id, custom, tone)` | **文字**用色 | ✅ 逐个 `ensureContrast(c, bg, 4.5)` |

**踩过的坑**：早期填充直接复用 `resolvePalette`，于是为了让文字满足 4.5:1，七色被压向黑白——`#38BDF8` 变成 `#247aa0`，整条轨道发闷。这就是"配色不满意"的真根因。

`plugin-client-body.js` 里对应两个函数：`colorsFor()`（文字，走 `resolvePalette` / `themeColors`）与 `fillColorsFor()`（填充，走 `fillPalette` / `themeColors`），两者都传给 `Popup`。

---

## 5. 滑杆视觉规范

### 5.1 结构层次

```
div.teff-sliderWrap
├── div.teff-slider            role=slider，内联 --teff-fill / --teff-glow / --teff-glow-color
│   ├── div.teff-track         30px 高胶囊，overflow:hidden
│   │   ├── div.teff-clip      mask 竖切，只显示 0→当前档 那一半
│   │   │   └── 视觉层（六选一）
│   │   ├── span.teff-tick × n 刻度分隔线（在 clip 之外，不被遮罩裁掉）
│   │   └── span.teff-thumb    34px 白圆（artTheme 用 teff-artKnob）
│   └── div.teff-labels > button.teff-label × n   轨道下方档位文字
```

**尺寸常量**：轨道 30px；thumb 34px（比轨道大，是"压在轨道上的球"）；`thumbHalf = artTheme ? 10 : 17`。

**位置公式**（三处共用同一锚点，任一元素漏了 `translate(-50%,-50%)` 就会偏半个自身宽度）：

```js
positionForRatio(r) = 'calc(' + thumbHalf + 'px + ' + pct + '% - ' + trim + 'px)'
// pct = r*100, trim = ((thumbHalf*2)/100)*pct
```

### 5.2 刻度分隔线（`teff-tick`）

| 属性 | 值 | 理由 |
|---|---|---|
| 宽 × 高 | `3px × 8px` | 落在 30px 轨道里上下各留 11px（"居中、不占满"）；试过 4px 被用户判为"太粗" |
| 圆角 | `1.5px` + `corner-shape: round` | 胶囊形态是用户认可的样式，不要改成直角 |
| 位置 | `top:50%; margin:-4px 0 0 -1.5px` | 垂直居中 + 水平中心补偿 |
| 层级 | `z-index: 1` | 在 clip 之上 |
| 首末档 | **不画** | 它们贴着端帽，画上去会被圆角裁掉一截，看着比中间的细 |
| 两态 | `--teff-tick` / `--teff-tick-on` | 未到达 / 已到达 |
| 淡出 | `opacity: calc(1 - var(--teff-glow,0) * .85)` | 滑块越靠右，左侧已到达的线越淡，最右剩 15% |

**粗细一致靠像素栅格对齐，不是靠加宽**：7 档时 `positionOf(3)` 算出小数，3px 宽的条落在半像素上会被抗锯齿左右各吃半个像素。解法是量出轨道宽度后把圆心吸附到 `1/DPR` 的整数倍：

```js
var dpr = Math.min(3, devicePixelRatio || 1)
var snap = function (v) { return Math.round(v * dpr) / dpr }
var travel = w - thumbHalf * 2
next.push(snap(thumbHalf + (i / (n - 1)) * travel))
```

用 `ResizeObserver` 观察 root，宽度变化重算；测宽完成前退回 `positionOf(i)` 的 calc 方案，避免首帧闪跳。

### 5.3 填充渐变：按当前档重标定

```js
var baseColor = colorAt(levels, 0, fillColors)
if (n <= 1 || pos <= 0.0001) {
  gradient = 'linear-gradient(90deg,' + baseColor + ',' + baseColor + ')'   // Off 是纯色
} else {
  for (var gi = 0; gi < n; gi++) {
    var gPos = gi / (n - 1) / pos        // 把 0→当前档 的色阶拉伸到整宽
    if (gPos > 1.0001) break
    gStops.push(colorAt(levels, gi, fillColors) + ' ' + (gPos * 100).toFixed(2) + '%')
  }
  gStops.push(color + ' 100%')           // 右端（旋钮脚下）永远是当前档色
  gradient = 'linear-gradient(90deg,' + gStops.join(',') + ')'
}
```

语义：调色板仍然决定填充；左端恒为调色板首色，右端恒为当前档色，中段连续插值。被 `mask` 裁掉后半截后，看起来就是"档位越高，紫得越深"。

### 5.4 Codex 星尘（`ParticleLayer`，纯 CSS）

**已彻底移除 canvas / `requestAnimationFrame` / `Math.random`**——随机数导致每次重挂载星图都不一样，且不可离线断言。

| 常量 | 值 |
|---|---|
| `STAR_TOTAL` | `72`（参考实现 22 颗是 28px 短轨道口径；本插件轨道更长且盖着星云层，故翻倍） |
| `GOLDEN_RATIO` | `0.6180339887498949` |
| 相位 | `phase = ((i + 1) * GOLDEN_RATIO) % 1` |
| 确定性伪随机 | `starHash01(index, salt)`：`((((index+1) * salt * 2654435761) % 4294967296) >>> 0 >>> 8) % 1000 / 1000` |
| 亮度 | `0.55 + 0.45 * starHash01(i, 61)` |
| 速度 | `clamp(3.6 * pos - 1, 0.4, 4.6)` |
| 能量 | `clamp((pos - 0.08) / (1 - 0.08), 0, 1)`（0.08 起手，不是 1/3） |
| 颗数 | `Math.round(energy * STAR_TOTAL)` |
| 星层透明度 | `0.7 + 0.3 * energy` |

**高度与相位必须解耦**：早期版本两者同源，导致"越靠右的星越高"，22 颗排成一条斜线（相关系数 0.999）。现在相位按黄金比排序后，再用 `starHash01(a, 71)` 重排到等距槽位，`y = 10 + (slots[i] / (STAR_TOTAL - 1)) * 80`（10%–90% 高度）。

**负相位必须内联在元素上**：

```js
animationDuration: dur + 's',
animationDelay: -delaySec + 's'
```

写成 CSS 变量在真宿主里**负相位不生效**——会出现"一打开星星全挤在起点，十几秒后才靠速度差散开"。

CSS 侧：`.teff-stars` 是 `overflow:hidden` 的容器；`.teff-star` 是 `height:0` 的横扫轨道，内部 `i` 绝对定位在 `left:100%`，靠容器 `translate3d(-100%)` 从右往左扫。

### 5.5 星云（`teff-nebula`）

```css
.teff-nebula{
  position:absolute;inset:0;pointer-events:none;
  opacity:calc(var(--teff-glow,0) * .9);
  background:radial-gradient(140% 180% at 6% 50%,var(--teff-glow-color),transparent 64%);
  background-size:220% 100%;background-repeat:no-repeat;
  animation:teff-nebula-drift var(--teff-energy-dur,2.4s) ease-in-out infinite alternate
}
.teff-nebula::after{ /* 斜向扫光 */ mix-blend-mode:screen; animation:teff-nebula-sweep calc(var(--teff-energy-dur) * 1.4) linear infinite }
```

`--teff-glow` 是滑杆上已有的内联变量（0→1 的档位比例），Off 时 opacity 自然为 0。

### 5.6 六套视觉与调色板

**视觉（`VISUALS`）**：`codex`（蓝紫渐变 + 星尘）、`energy`（格点充能场）、`warp`（星流加速）、`quantum`（双波干涉）、`whale`（鲸鱼娘深海主题）、`liang`（梁系登基金色）。后两者是 `THEME_VISUALS`，用立绘 + 专属配色，不走调色板。

**调色板（`PALETTES`，6 套 × 7 色）**：

| id | 七色 |
|---|---|
| `codex` | `#4DA9FF` `#3B82F6` `#6366F1` `#7C3AED` `#9333EA` `#C026D3` `#FF4FD8` |
| `aurora` | `#7DD3FC` `#5EEAD4` `#60A5FA` `#A78BFA` `#FBBF24` `#FB7185` `#EF4444` |
| `solar` | `#FFC46B` `#D9C27A` `#F0A868` `#F58A5B` `#EC6A5C` `#D9568A` `#B44BE0` |
| `ocean` | `#22D3EE` `#67E8F9` `#38BDF8` `#2DD4BF` `#34D399` `#A3E635` `#FDE047` |
| `neon` | `#38BDF8` `#22D3EE` `#3B82F6` `#8B5CF6` `#EC4899` `#F97316` `#FACC15` |
| `morandi` | `#9FB2C6` `#8FA8A0` `#8FA3B8` `#9C96B5` `#B5A38F` `#B08E96` `#A88F8F` |

**六套的首色都必须够亮**（`max >= 140`，色差门槛 morandi 放宽到 30）——首色决定 Off 之上第一档的观感，灰首色会让低档发闷。

---

## 6. 交互规范

### 6.1 滑杆操作

| 操作 | 行为 |
|---|---|
| 指针拖拽 | `window` 上挂 `pointermove/up/cancel`；`pointermove` 用 `requestAnimationFrame` 节流（`pendingX`） |
| 松手 | `applyDraft → commit → animateTo(snapOf(i))`，**不关闭弹层** |
| 取消（pointercancel） | 回滚到 `snapOf(draftRef.current)`，并 `onLevelChange(props.current)` |
| 方向键 | ←/↑ −1，→/↓ +1，`Home` 0，`End` n−1；动画 220ms `easeOutCubic` 手写 rAF |
| Enter / Space | 直接 `commit(idx)` |
| 拖拽中外部 `current` 变化 | 不介入（`dragging` 守卫） |

**乐观更新**：`commit` 立刻改本地显示，不等写入回执；写入期间不冻结交互。

### 6.2 换名动画

| 位置 | 形态 | 触发 |
|---|---|---|
| 弹层大字档位名 | **双层交叉**：旧层 `blur(0→6px)` + `opacity(1→0)` + `translateY(0→-3px)`，新层反向，240ms | `teff-levelSwap` grid 叠层，防宽度抖动 |
| 底部档位名 / 模型名 / 弹层模型名 | **单层重挂载**：`blur(4px→0)` + `opacity(0→1)` + `translateY(2px→0)`，200ms | `data-fx="true"` 触发 `teff-effort-in` |

**实现模式（可复用）**：

```js
var fxState = useState({ key: 0, text: props.effortName })
if (fx.text !== props.effortName) setFx({ key: fx.key + 1, text: props.effortName })  // 渲染期比对，不是 useEffect
```

- 必须在**渲染期**比对，用 `useEffect` 事后补会让新字先无动画刷一帧再重播，看着闪一下。
- 递增的 `key` 挂**内层文字 span**，不要挂外层 `button`（会丢焦点、重建 `aria-expanded`）。
- 多个文字变体（档位名 / 模型名）**各自独立 state**，否则改其一会让另一个白白重播。

**为什么底部不做交叉淡化**：它在横向 flex 行里带 `flex-shrink:1000` + 省略号，双层叠层会撑宽导致右侧箭头抖动。

---

## 7. 主题与宿主 CSS 约束

### 7.1 超椭圆陷阱（最容易踩）

DSH 全局注入了：

```css
@supports (corner-shape: superellipse(1.5)) {
  :root { --dsw-corner-shape: superellipse(1.5) }
  *, :before, :after { corner-shape: var(--dsw-corner-shape) }
}
```

于是**任何 `border-radius: 50%` 都会被渲染成圆角矩形**（超椭圆），`999px` 胶囊的端帽会被压出方角。

**规则：凡是圆形或全圆胶囊，必须在同一条规则里显式写 `corner-shape: round`。** 官方组件表里共有 55 处这么写，本插件现有 11 处（`lib/ui.js` 10 处 + `plugin-client-body.js` 1 处）。

`test/smoke-corner-shape.mjs` 会扫描 `lib/ui.js` 与 `plugin-client-body.js` 里所有 `border-radius: 50% / 999px` 规则，缺 `corner-shape: round` 就报错，并带反向自检防止解析器失效假绿。

### 7.2 令牌使用

- 只用 `--dsw-alias-*` 与 `--dsw-static-*`；**不要** require `@deepseek-ai/dsh-client-ui-primitives`（官方规范明令禁止，asar:292610），要抄 markup/CSS 就抄，class 一律加 `teff-` 前缀。
- 不要用 `--dsw-specific-menu`、`--dsw-shadow-lv3`（语义不对）。
- 可用：`--dsw-radius-xs/sm/md/lg/xl/panel`、`--dsw-font-family`、`--dsw-focus-ring-width`、`--dsw-elevation-prominent`、`--dsw-menu-surface-fill`、`--dsw-menu-backdrop-filter`。

### 7.3 明暗与主题变量

`--teff-track` / `--teff-thumb` / `--teff-thumb-ring` / `--teff-tick` / `--teff-tick-on` 按 `.teff-card[data-tone="light"|"dark"]` 与 `[data-visual="whale"|"liang"]` 分别定义。whale 浅色轨道 `#d8f3ff`、深色 `#0d3047`；liang 轨道 `#2b1b10`。

### 7.4 降级

`@media (prefers-reduced-motion: reduce)` 里关掉：卡片入场、thumb/chevron 过渡、立绘光晕、轨道扫光、能量层、星尘（`display:none`）、星云漂移、换名动画（`animation:none` + `--out` 直接 `opacity:0`）。

---

## 8. 测试与预览

### 8.1 五个测试套件（共 48 条，全部源码级断言，无需浏览器）

```bash
node test/smoke-corner-shape.mjs    # 8 条：圆角必须配 corner-shape:round
node test/smoke-slider-visual.mjs   # 19 条：刻度/星尘/渐变/调色板/量子
node test/smoke-effort-levels.mjs   # 6 条：档位只认服务端 efforts[]，空档位按模型区分缓存
node test/smoke-level-mapping.mjs   # 9 条：档位 id → 固定槽位（不按第几档取名）
node test/smoke-seat-compat.mjs     # 6 条：目录未就绪时让位、自愈立即重试且带配额
```

`smoke-seat-compat.mjs` 锁的是三件事：降级时必须 `degraded = true` 后抛错（不能吞成 `available:false`）、自愈定时器不能被静默失败卡死、`healKick()` 立即追赶且受 `HEAL_FAST_LIMIT` 配额约束。

`smoke-slider-visual.mjs` 覆盖：刻度节点与 `data-on`、首末不画、粗细统一、像素吸附、六套视觉配色、星尘黄金比与哈希、无 canvas/rAF、时长与负延迟内联、能量曲线、reduced-motion、渐变右端锚定当前档、`fillPalette` 未被压暗、孤儿色板、Off 纯色、量子提速。

**写测试的坑**：断言切片要用 `source.indexOf('function EffortSlider')` 作右边界，不要用 `function EnergyLayer`——`QuantumLayer` 排在它后面，会切出空串导致断言假通过。加 `assert.ok(body.length > 2000)` 兜底。

### 8.2 离线预览

```
preview/index.html        预览页（简化版，见 §9）
preview/app.js            预览逻辑，自带 PREVIEW_MODEL / PREVIEW_LEVELS，不依赖外部 fixture
preview/build-theme.mjs   从 app.asar 抽取主题 CSS + corner-shape 全局规则 → vendor/dsh-theme.css
preview/build-react.mjs   复制 React 到 vendor/react-bundle.js
preview/assets/*.webp     22 张立绘素材（构建时会内联进 client.js）
鲸鱼娘/*.jpg              原始出图素材（入库留源，重压 webp 时可回溯）
```

预览页支持 URL 参数直接开到指定状态，不必手点：

```
?mode=codex&visual=liang&pane=model&open=1&dark=1
```

`open=1` 直接展开弹层，`pane=effort|model` 选面板，`dark=1` 在首次绘制前就挂上暗色（避免闪白）。

`build-theme.mjs` **按内容锚点扫描**，不硬编码行号：

- 主题 CSS 锚点：`body{--dsw-static-amber-100: rgb(`
- corner-shape 锚点：`corner_shape_css_default`（取其后第一个 `"` 到 `";` 之间）

抽不到就 `throw`；抽到但不含 `--dsw-alias-` / `--dsw-corner-shape` 也 `throw`。**没有 corner-shape 那段，预览里的圆是真圆，真机是方角——预览就失去意义了。**

---

## 9. 已知限制

1. **`preview/index.html` 是简化版**（约 385 行）。它只验证渲染与主题，不模拟宿主槽位；早期那套 `pv-*` 元素断言的页面已不存在。
2. **截图靠 `tools/shoot-preview.mjs`**（本机没有 playwright / puppeteer，故直接驱动 Edge 的 CDP）。它启动 headless Edge，从页面里量出弹层卡片的实际包围盒后按盒裁切，所以卡片尺寸改了也不用改脚本。

   ```bash
   node tools/shoot-preview.mjs                    # 全部重拍
   node tools/shoot-preview.mjs --only popup-model-dark
   node tools/shoot-preview.mjs --out .tmp/probe --scale 1
   ```

   产物默认写 `docs/screenshots/`，README 直接引用这些文件；清单在脚本顶部的 `SHOTS` 数组里。
3. **`icon.svg` 与 `icon-v2.svg` 内容完全相同**，`package.json` 只引用 `icon-v2.svg`。
4. **安装不能走 `npm install`**（profile 内有无关的 peer 冲突），只能复制文件。
5. **`npm pack` 出来的 tgz 需要手动重打**，否则会是旧产物。
6. **被寻址的子智能体会话不显示模型/档位芯片——这是官方设计，不是 bug。** 官方 `ui-model-selection` 的 `ModelSelect` 里写着 `if (!available) return null`，它自己也写着同一条 `available = sessions.subagentAddress(sessionId) === void 0`；我们逐行同构（`plugin-client-body.js:1137-1141` + `plugin-client-body.js:635`）。这类会话里 `available:false` 是**稳定的正常状态**（`degraded` 不置位、自愈不空转、目录不加载），只是本条目占了 single 槽 winner 却渲染 0 像素。**不要**把它改回抛错让位：弃权按 `(slotKey, entry)` 记而非按 session 记，在子会话里抛一次会让皮肤对**所有**会话掉线。
7. **冷启动/切会话瞬间可能闪一下官方芯片**。目录未就绪时我们主动抛错让位（弃权 → 内置选择器兜底），随后 `healKick()` 立即重注册把皮肤换回来；`HEAL_FAST_LIMIT` 配额耗尽后退到 `700ms` 慢拍。这是「宁可见一下官方芯片，也不要空白」的取舍，不是故障。

---

## 10. 改动检查清单

改 UI 时按这个顺序走：

1. 改 `lib/ui.js`（样式/组件）或 `plugin-client-body.js`（槽位/设置页）；
2. `node --check lib/ui.js`（`plugin-client-body.js` 是被拼接的片段，`node --check` 会报 `Illegal return statement`，**属正常**）；
3. 跑全部五个测试套件（§8.1，48 条）；
4. `node tools/build-plugin.mjs` 重建 `client.js`；
5. 复制 `client.js` + `package.json` 到 profile，校验两边 SHA256 一致；
6. 刷新页面验收；
7. 补 `CHANGELOG.md`；
8. 需要发布时 `npm pack` 重打 tgz。

**注意**：`plugin-client-body.js` 与 `CHANGELOG.md` 含中文，用 PowerShell `Get-Content` 读会显示 GBK 乱码，**必须用 read 工具**。

---

## 变更记录

- **v2.0（2026-10-20）**：按当前实现整体重写。删除 v1.x 中所有已作废内容——Host 数据层规范、三级能力瀑布、`settings.mutate` 单写者队列、YAML off 引号陷阱、`defaultEffort` 禁写、HTTP 路由契约、`effortVisual()` / `teff-star--a/b/c` 三层星层方案、看板任务表。新增：纯 UI 定位与边界、构建链、槽位注册与降级自愈、填充/文字取色分离、刻度分隔线与像素吸附、CSS 星尘规格、超椭圆 `corner-shape` 约束、测试与预览现状。
- **v1.1（2026-10-15）**：吸收 `docs/review-notes.md` 评审 R1–R12（历史）。
