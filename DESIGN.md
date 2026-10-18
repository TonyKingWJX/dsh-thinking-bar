# dsh-thinking-effort 插件设计文档（v1.1，2026-10-15，已吸收 docs/review-notes.md 评审 R1-R12）

> 本文档是团队共同参照。所有成员以本文件为唯一事实来源，行号锚点指向 DSH 安装 bundle：
> `D:\Apps\Users\wang\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`（约 230 万行，未混淆；用 grep 工具按行号检索，勿用 read 读 asar——会报 BigInt 错误；pwsh 在本会话环境不可用）。

## 0. 用户需求（验收标准）

1. 自定义 API（自定义 baseURL 的 provider）下的模型可以调整思考强度。
2. 对话框触发器与官方完全一致：模型名旁小字档位 chip + 下拉箭头（如 `DeepSeek-V4.1-Flash High ⌄`），无多余框。
3. 档位选择弹层与 Codex 对齐：居中显示模型名 + 下方小字当前档位名（用户 m02779 定稿「读法 A」）；下方胶囊形滑杆分档、节点吸附，最左端常驻 `off` 节点；左上闪电图标（思考开/关，右上「重置为默认档」已按用户 m05286 删除）。
4. 档位越高动画越强（用户 m01895 定稿，取代旧「仅最大档」）：滑杆蓝→紫渐变 + 星空粒子 + 最高档附「更快消耗使用额度」提示。
5. 自动接管：已配置模型生效，未来新增配置也自动生效。
6. 设置页：总开关（启用/禁用、接管/不接管）；per-provider/per-model 档位编辑（勾选档位 + 每档 wire 值重命名）；能力探测开关。
7. UI 全新实现（不 fork 现有插件），默认档位策略 = 知识库默认 → 上游探测（可选）→ 用户手动覆盖（最高优先）。

## 1. 根因与数据通路（已逆向确认）

- 自定义 provider 配置存于 settings namespace `llm-pi-ai`，路径 `llm-pi-ai.providers.<route>.models.<model-id>`（asar:479130「Only pi-ai routes can be hand-declared — the custom-API form writes into llm-pi-ai」）。
- 官方表单**刻意**不暴露 reasoningEfforts 字段（asar:479051 原文 "Reasoning effort is deliberately not among the editable fields: it is a per-model capability"）——但 zod schema 完整支持（860404/860411），写入即生效。插件补写正是官方留出的正确入口。
- 解析链（asar:859970-859991 `resolveModelReasoning(provider, entry, base)`）：
  - `entry.reasoningEfforts === void 0` → `{ reasoning: base?.reasoning ?? false }`（回退已安装目录；自定义 provider 无 base → 无档位 → 选择器不出现）。
  - `reasoningEfforts: false` → 明确声明非推理模型。
  - 空 dict / 非 off 档缺 wire 值 / 空字符串 wire 值 / 只声明 off → 校验报错（859974/859980/859981/859982，`PiAiCatalogError`）。
- 成功路径产出 `{ reasoning: true, thinkingLevelMap: map }`（859991）；`getSupportedThinkingLevels`（860156-161 / 1104454-4468）读 thinkingLevelMap 生成 efforts；`reasoningInfo`（861129-136）产出 `{efforts:[{id,name}], defaultEffort?}`。
- 分派：`model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort`（1096958 等）；off 仅当 `thinkingLevelMap.off !== null` 时下发（1096866-6961）。
- **THINKING_LEVELS = off / minimal / low / medium / high / xhigh / max**（859699）。每档值 = wire 字符串或 `null`（不支持）；可重命名（如 `"max": "ultra"`）。`reasoningEfforts` 的 dict 键用 THINKING_LEVELS 键集。
- 刷新链：配置写入 → `llm/adapters-updated`（无 payload，863508）+ `settings/document-updated` → Web 端 ModelCatalogDirectory（435288 ctx.remote.$on）、Models 设置页（479087/483338）、模型选择器自动 refetch，**无需重启**。
- Host 校验（写入错误数据才会触发）：efforts 空 → INVALID_MODEL_REASONING；defaultEffort 不在 efforts → 同左；请求档不在 efforts → UNSUPPORTED_REASONING_EFFORT（865819-870）。

## 2. 数据层规范（Host 半侧 lib/index.js）

- **配置树路径（已证实）**：`llm-pi-ai.config.providers.<providerId>.models.<modelId>.reasoningEfforts`（settingsPath 861924 `["providers", provider]`；与实机 cordis.patch.yml 中已有 provider 的 models[].reasoningEfforts 形状完全吻合）。形状吻合，但持久化落点分两层：settings.mutate → settings.yaml（971821/972302）；configEditor → cordis.patch.yml。两层合并优先级 [未验证]，**第一版只用 settings.mutate 单通道**（R1）。
- **写入机制（v2.1 修订，评审 R1 后）**：第一版**只走 `settings.mutate('llm-pi-ai', ops, expectedRevision)`**（JSON 路径操作，语义干净、可回滚、错误码明确）；必须**单写者队列**（同 ns 同时只有一个 in-flight 写）+ **永远带 expectedRevision**（实时取自 settings.describe，禁止缓存跨写周期）+ **conflict 后重算重试 ≤3 次退避 100/300/900ms** + **写后 resolveModelInfo 自检**（断言 efforts/defaultEffort 生效，不符告警不重试）。configEditor 留到 §7.2 full-replace 不确定性清零后再启用（届时加「通道锁」配置，运行期只允许一条通道活跃）。
- **扫描（v2.1 准入三条件，R2）**：读 llm-pi-ai user 层全部 `providers.<route>.models.*`，仅当 **reasoning===true 且 thinkingLevelMap 已存在 且 目标档在 map 中非 null** 时才补写。删除「未声明但疑似推理」猜测分支——写任何 dict 都会把 reasoning 钉为 true（859990），会误伤 reasoning:false 模型。
- **三级能力瀑布**：
  1. 内置知识库（静态表，按厂商/模型名匹配；条目结构含 `'inherit'` 表达「缺键兜底不写键」（R10）：claude 系 = `{off:null, xhigh:'xhigh', max:'max', low:'inherit', medium:'inherit', high:'inherit'}`；含各家 ladder 差异：如 hy3=noThink、minimax-m3=none、mimo/qwen 拒 max、GLM 无 minimal、DeepSeek V4.1 Flash 官方目录 = low/high/max）。
  2. 连通性/模型存在性探测（默认关闭；`llm.discoverModels` 结构上不携带 reasoningEfforts（859022/859269），探测只回答「route 通不通、有哪些模型 id」，不回答档位（R7）；「非法 effort 报错解析」旁路标注实验性，默认关，只在用户显式点击时触发）。
  3. 用户手动勾选（设置页，最高优先级，永远覆盖前两级）。
- **默认保守档位（v2.1，R3）**：只在「整个 map 不存在」且过准入三条件时使用四键保守档 `off:null, low:"low", high:"high", max:"max"`。已声明 dict 会展开成 7 档全量 map（未声明档位显式 null，859983-987）；已有 map 的模型补写必须是 **merge**：保留全部已有键，仅 `existing[k]===undefined` 时写知识库值，绝不 unset 用户键。
- **off 档三态（R4）**：null（UI 不展示、不下发）/ 缺键（UI 展示、多数适配器下发硬编码 "none"）/ 字符串（按 wire 下发）行为完全不同。补写时**保留现有 off 状态**（缺键就继续缺键）；内部建模用三态枚举 `{kind:'null'|'absent'|'wire'}；档位可用性判定逐字复刻 860158-861161`。
- **自动接管（v2.1，R6）**：监听 `settings/document-updated`（签名 (ns, revision)，1017934-36；带 revision 载荷用于回执抑制）+ `llm/adapters-updated`（无 payload，863508）。必须做：回执抑制（`ns==='llm-pi-ai' && revision<=lastSelfWrite.revision` 直接 return）、300ms 去抖合并、provider 签名去重、事件回调内只置 dirty 不同步写。
- **YAML 陷阱（v2.1，R5）**：off 键在任何 YAML 落盘点（settings.yaml / cordis.patch.yml）都必须带引号；mutate 只保证内存正确（JsonValue），不保证落盘字形——eemeli stringify 不会给 core-schema 字符串加引号。需启动自检（正则查裸 `off:`）与一键修复。
- **defaultGuard（R8）**：补写管线终点加**硬断言**：`reasoningEfforts` 落库前必须同时满足 `defaultEffort ∈ offeredLevels` 且 `offeredLevels.length ≥ 1`；不满足就中止该模型补写并进设置页错误列表（防 defaultEffort 双缺失 → 每请求 UNSUPPORTED_REASONING_EFFORT）。客户端 chip 复刻官方三态：`reasoning===undefined → 不显示档位`；`effectiveEffort===undefined → 显示 t("effort.providerDefault")/"Default"`；提交时 `""` 归一为 `undefined`，绝不透传给 `directory.select`。
- **插件自身配置**存本插件 namespace（总开关、接管模式、探测开关、per-model 覆盖表）。

## 3. UI 层规范（浏览器半侧 lib/client.js，全新实现）

- 装载：`window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => {...} })`；require('react') 手写 createElement；无构建步骤。
> **§3 已于 2026-10-15 按 UI 细节提取卡（docs/official-ui-notes.md，来源 asar 435210–436189 官方插件
> `@deepseek-ai/dsh-client-ui-model-selection@0.2.0-rc.2`）逐条校正。下面带 ⚠ 的条目是校正结果，
> 实现以它们为准，不要再按旧描述写。**

- ⚠ **槽位（校正，关键）**：官方把 chip 注册在 `conversation.input.model`，该槽声明为 **`single` + `scope:'session'`**（asar:421867-421870），在 composer `standardControls` 里紧跟 `conversation.input.right` 之后渲染（asar:421078）。**槽是 single，插件再注册同 id 会与官方座位冲突** → 插件必须用自己的槽 id 或另找挂载点，**不能**直接占用 `conversation.input.model`。挂载点选择在实现卡内定，定前先 `cordis_inspect_query` 读 slots 树确认可用槽。
- 数据：`ctx.modelDirectories.directoryFor(sessionId).load()` → 可订阅 store（getSnapshot/subscribe，配 useSyncExternalStore）。snapshot 形状：groups[].models[]，model.reasoning.{efforts[],defaultEffort}，state.current.{provider,model,reasoningEffort}。
- 提交：`directory.select({provider, model, reasoningEffort})`，失败回滚草稿（官方同通路，/model 弹窗与 composer 共用同一份每会话目录）。
- 触发器 chip（对齐官方 asar:435743-435786 / 435479-435481）：
  - 结构：根 `div`（**不是 button**）> `button`，内部 4 个 flex 子元素：`IconDataOutlineRegular`(size 16) + `span`(模型名) + ⚠ `span`(档位名，条件渲染) + 右端 `busy ? StateDot({state:'ongoing'}) : IconChevronDownOutlineRegular`（open 时加 chevronOpen）。模型名与档位名是**两个并列 span，DOM 里没有分隔符字符**（只有 title 属性用 ` · ` 拼）。
  - `effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort`
  - label：`reasoning===void 0 ? state.retainedEffort : effectiveEffort===void 0 ? t('effort.providerDefault') : reasoning.efforts.find(l=>l.id===effectiveEffort)?.name ?? effectiveEffort`（**name 必须来自服务端 efforts，禁止客户端硬编码档位字典**（R11）；name 缺失才回落 id）。
  - ⚠ **粘滞档位**：切到非推理模型时 chip 仍显示上一个模型残留的档位名（`state.retainedEffort`，asar:435235-435239），不是隐藏 —— 复刻它，否则切模型时 chip 会跳变。
  - ⚠ **「默认」项只在模型未声明 defaultEffort 时出现**：仅当 `reasoning.defaultEffort === void 0` 时官方在列表头插入 `{key:'provider-default', effort:void 0, label:t('effort.providerDefault')}`（asar:435481-435489）；提交时 `undefined` 档位**不带** `reasoningEffort` 字段（asar:435715-435726）。i18n `effort.providerDefault` 在 zh 与 en 下**都是 "Default"**（asar:436017/436043）；`t('retry')` 是孤儿 key（asar:435874/435886 用了但字典里没有），**别照抄**，用 `action.reload` 风格。
  - ⚠ **样式修正**：用 `--dsw-alias-*` + `--dsw-menu-surface-fill` + `--dsw-elevation-prominent`。**`--dsw-specific-menu` 与 `--dsw-shadow-lv3` 不要用**（前者是「没有 menu backing 的其他浮层」，后者是别的东西）。官方 trigger **有** hover 背景（`--dsw-alias-interactive-bg-hover`）与 focus-visible 焦点环（`0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))`），所以「零自定义外框」的旧说法需按此修正。触发器等宽 28px、`border-radius:var(--dsw-radius-sm)`、`max-width:min(360px,45cqw)`；档位 span 用 `color:var(--dsw-alias-label-caption);flex-shrink:1000`（极端压缩时档位名先被压掉）；窄容器降级靠 `--dsh-composer-model-text-display` / `--dsh-composer-model-icon-display`（asar:403251，默认 block/none，空间不足时反转成只显示图标）。抄官方 class 时一律加 `teff-` 前缀重命名（R12/§2.7）。
  - ⚠ **token 存在性校正**（推翻 [docs/review-notes.md:668](docs/review-notes.md#L668) 的「不存在」判断）：`--dsw-radius-xs/sm/md/lg/xl/panel`（4/8/12/16/20/28px）、`--dsw-font-family`、`--dsw-focus-ring-width:2px` **都存在**（asar:698051/698057/698060），可放心用。`--dsw-elevation-prominent` = 0.5px 描边 + 3 层阴影（asar:698069）。
- Codex 弹层：大字行居中模型名（可点回模型列表）+ 下方小字行当前档位名（用户 m02779「读法 A」）；胶囊滑杆（分档节点、吸附、0-1000 草稿值映射 efforts 列表、松手提交最近档且**不关面板**）；左上闪电 = 思考开/关。右上「重置为默认档」已按用户 m05286 删除（最左端常驻 `off` 节点即可回到默认，该按钮是冗余的第二条路径；`RefreshIcon` 与 `onReset` prop 一并移除）。
  - ⚠ **材质与定位**：用 `MenuSurface` 原语 + `createPortal(..., document.body)`（asar:435787-435794、435980）；材质 = `--dsw-menu-surface-fill` + `backdrop-filter:var(--dsw-menu-backdrop-filter)`（asar:446194-446242）。定位 `position:fixed` 由 JS 从 `trigger.getBoundingClientRect()` 算（`x = rect.right - lw`、MARGIN=12 四周夹逼，asar:435555-435588），监听 `window` 的 `scroll`(**capture:true**) + `resize`；未定位时用 `visibility:hidden;left:0;top:0`。**不要用 data-composer-card 做锚点**（该属性只给 Toast 用）。
    - ⚠ **必须会向下翻转**（2026-10-16 用户 m04522 定案，推翻上面那条「只 y = rect.top - 8 - lh」的照抄）：官方 chip 永远在窗口底部，只向上弹不会出事；但触发按钮贴近视口顶部时（预览页、窄窗口），只上弹的实现会被 `Math.max(MARGIN, …)` 夹到 `top=12` 贴住顶边、钻进顶部 chrome 的领地 → 就是「有东西会遮挡」。实现 = 纯函数 `menuPlacement({rect,lw,lh,vw,vh,margin,gap})`：`spaceAbove = rect.top - margin - gap`、`spaceBelow = vh - rect.bottom - margin - gap`，`side = (spaceAbove >= lh || spaceAbove >= spaceBelow) ? 'up' : 'down'`，`y = side==='up' ? rect.top-gap-lh : rect.bottom+gap`，最后仍夹进视口；返回 `{left,top,side}`（`side` 供测试断言方向）。**`place()` 只做 DOM 读取，几何全在纯函数里**，否则「翻转」永远测不到。
  - ⚠ **选中态无背景**：列表项是 `button[role=menuitemradio]` + `aria-checked`，选中项 `background:0 0`（透明），**只由右侧 check 图标表达**（asar:435342）。面板 CSS：`z-index:1100;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent);padding:4px`；选项 `min-height:34px;border-radius:var(--dsw-radius-md)`。
  - ⚠ **关闭/键盘行为**（必须复刻）：Escape 两级（drilled → back(pane)；根 → close 且要求 `state.current !== null`）；`document.addEventListener('mousedown', closeOutside)` **必须同时检查 rootRef 与 menuRef 两个子树**（菜单在 portal 里）；ArrowUp/Down 移动真实焦点；输入法组合期间 `if (event.nativeEvent.isComposing) return`。
  - ⚠ **模型列表必须能滚动**（2026-10-16 用户 m05519 定案：列表摊到 `max-height` 就被硬切、看不到后面的 provider 组）：
    - flex 链路缺一不可：`.teff-menu`（`display:flex;flex-direction:column;overflow:hidden;max-height:min(360px,calc(100vh - 96px))`）→ 中间容器 `.teff-viewport`（`display:flex;flex-direction:column;min-height:0;flex:1 1 auto`）→ 滚动区 `.teff-groups`（`min-height:0;overflow-y:auto;flex:1 1 auto`）。**中间容器不能是裸 `div`**：默认 `min-height:auto` 会让它撑满内容高度，`.teff-groups` 拿不到确定高度 → `overflow-y:auto` 永不激活，内容被 `overflow:hidden` 一刀切。
    - **双 ref 分工**（对齐官方 asar:435788 的 `menuRef` vs asar:435890 的 `groupsRef`）：`menuRef` 只挂 `.teff-menu`（定位与外部点击判定都读它），`groupsRef` 单独挂 `.teff-groups`。**同一 ref 挂两处**会让 `place()` 量到列表内容高度而非菜单高度。
    - **键盘高亮自动滚入视野**：`itemRefs.current[activeModelIndex]?.scrollIntoView({block:'nearest'})`（官方 asar:435547-435554 用 `useLayoutEffect`；本插件**只能用 `useEffect`** —— 测试替身的假 React 只实现 5 个 hook）。
    - **分组标题吸顶**：`.teff-groupLabel{position:sticky;top:0;z-index:1}` + `.teff-groupLabel[data-stuck]{background:var(--dsw-alias-menu-group-header-fill)}`；`data-stuck` 由 `observeStickyMenuGroups(groupsRef.current)`（逐字对齐官方 asar:451945-452023，导出到 `__teff_pure`）用 `IntersectionObserver` + `ResizeObserver` 异步切换 —— **分组成员在 setup 时捕获，分组变化（含筛选）必须 dispose 重建**；无这两个 observer 时直接返回空清理函数，标题保持透明（CSS sticky 仍然生效）。
    - **无障碍对齐官方 asar:435792**：`pane==='model'` 时外层 `.teff-menu` 的 `role` 是 **`group`**（内层 `.teff-groups` 才是 `role=menu` 的复合菜单），`root`/`effort` pane 用 `menu`。
- 档位动画（**2026-10-16 用户定稿，取代旧「仅最高档触发」规格**）：**每一档都有粒子动效**；档位越高 → 轨道由蓝渐变为紫（紫端占比 30%→100%）→ 星层越多（1→3 层）→ 越亮（opacity .22→.85）→ 漂移越快（20s→7s）。实现 = 纯函数 `effortVisual(index, count)`（`lib/client.js`，导出到 `__teff_pure`）产出 `{ratio, purpleStop, starLayers, starOpacity, driftSeconds, isTop}`，轨道渐变紫端由 CSS 变量 `--teff-purple-stop` 驱动，星层数决定挂载几个 `span.teff-star--a/b/c`。
  - ⚠ **档位标签必须与刻度同心**（2026-10-16 用户 m04522「字对不上挡位」定案）：tick、thumb、label 三者共用同一个锚点 `left: sliderOffset(pct)`；其中 tick 与 thumb 自带 `transform:translate(-50%,-50%)` 做居中补偿，**label 此前漏了补偿** → 标签「左边缘」压在刻度「中心」上，整段文字右偏半个自身宽度，宽词（Minimal/Medium）挤住下一个刻度、短词之间留下大空隙，实测最右 `Max` 冲出轨道右端 48px。修法：`.teff-slider__label` 加 `transform:translateX(-50%)`。**新增/移动任何绝对定位在 `sliderOffset` 锚点上的元素，都必须同时确认它有没有居中补偿。**
  - 「更快消耗使用额度」提示**仍只在最高可用档出现**（`isTop`），因为只有顶档才真的更费额度。
  - 最高可用档 = `efforts` 按 `LEVEL_ORDER=['off','minimal','low','medium','high','xhigh','max']` 序的**最后一个可用档**（R9：很多模型无 max，可能是 high/xhigh）—— 不是硬编码 `'max'`。档位数完全按服务端 `efforts.length` 渲染。
  - 性能与降级：星层 CSS 默认 `animation-play-state:paused`，仅 `.teff-popup--open` 下 running；`@media (prefers-reduced-motion:reduce)` 关掉全部漂移/闪烁/过渡，退化为静态渐变。硬编码色值仅限 artwork（星点白/紫、渐变三色 `#2f6bff / #6a5cff / #a855f7`）。完整规格见 docs/review-notes.md §2（DOM 结构/CSS/React 集成/性能预算/自测清单），其中「仅 isMax 挂载」的旧门控已被本条取代。

## 4. 设置页规范（settings.section 槽）

- 一节一页（list 槽，registration: {id, order?, label}）。
- 内容：总开关（启用/禁用）；接管模式（自动补写 / 仅浮层显示不改配置）；探测开关；per-provider → per-model 档位编辑器（勾选档位、每档 wire 值输入、defaultEffort 选择）；探测结果展示（档位 + 置信度）。
- 手写 React，参考样例插件 `D:\VibeCoding\DSH\.dsh-probe\startup-screen\package\lib\client.js` 的 settings.section 注册写法。

## 5. 插件骨架约定

- package.json：main=lib/index.js（Host 半侧，导出 name/inject/apply）；exports "./client"→lib/client.js；`dsh.bundle.patch: ./cordis.patch.yml`；`dsh.client.inject` 列出所需平台模块（slots/locale/runtime/api-remotes/dsh-client-ui-model-selection 按需）。
- cordis.patch.yml：`- insert: [{id: <plugin-id>, name: <包名>}]`。
- 配置存 `~/.dsh/<plugin-id>.json`（Host 半侧）或插件自身 settings namespace。
- 参考实现（只读借鉴，代码全新写）：D:\VibeCoding\DSH\.dsh-probe\startup-screen\package\、D:\VibeCoding\DSH\.dsh-probe\out\550c\package\。

## 6. 任务分工与状态

| 卡片 | 模型 | 范围 | 状态 |
|---|---|---|---|
| UI 细节提取 | workbuddy-global/deepseek-v4.1-flash | 官方 chip/弹层精确 DOM+token → docs/official-ui-notes.md | ✅ 完成 |
| 骨架+数据层+设置页 | workbuddy/space-bunny | 插件骨架、settings.mutate 数据层、设置页 | ✅ 完成 |
| 设计评审+动画方案 | stepfun/step-5-preview | 评审本文件、风险清单、Codex 动画实现规格 → docs/review-notes.md | ✅ 完成 |
| 修复 Host 数据层 | stepfun/step-5-preview | R1/R2/R3/R6/R7/R8 + §7C HTTP 路由服务端 → lib/index.js、test/smoke.mjs | ✅ 完成（主会话复验通过） |
| 修复浏览器半通道 | workbuddy-global/deepseek-v4.1-flash | host.call → fetch 同源路由；删除 defaultEffort 写入 → lib/client.js、test/smoke-client.mjs | ✅ 完成（主会话复验通过） |
| 补强知识库 | workbuddy/space-bunny | R10 'inherit' 语义 + 按官方 catalog 补全 17 家族 33 条规则 → lib/knowledge.js、test/smoke-knowledge.mjs | ✅ 完成（42 断言 0 失败） |
| UI-1 数据层 | workbuddy-global/deepseek-v4.1-flash | 总开关+每提供商独立开关+每模型档位复选框的配置层与 getState 扩字段 → lib/index.js、test/smoke.mjs | 运行中（卡 cdda70c2-0b98-465c-bfff-bb37716e1b4b） |
| UI-2 弹层外壳 | xiaoqieglm/glm-5.3-flash | 注册 single 槽 `conversation.input.model` 顶替官方 chip + Codex 两级菜单 → lib/client.js、test/smoke-client.mjs | 运行中（卡 37ef7432-827b-41de-9eda-4c1dacd82b5b） |
| UI-3 最大档星空动画 | workbuddy-global/deepseek-v4.1-flash | 蓝紫渐变滑杆 + 星空粒子 + 额度提示（规格 docs/review-notes.md L327-684） | 待运行（卡 ff3493c0-682a-49e1-9e80-90ee819819b1，等 UI-2 落地） |
| UI-4 设置页改造 | xiaoqieglm/glm-5.3-flash | 总开关 + 提供商列表与独立开关 + 每模型档位复选框 | 待运行（卡 d97efebe-a1af-4b13-8003-ae24108c5933，等 UI-3 落地） |
| UI-5 对抗验收 | stepfun/step-5-preview | 只读逐条核对 §0 七条验收标准 → docs/ui-verification.md | 待运行（卡 952e9cd5-807a-4d3f-a213-2cdfe32832ed，等 UI-1..4 落地） |
| 联调+验收 | 主会话 | 装插件实测（安装前征求用户批准） | 未开始 |

UI 五卡串行规则：UI-2 → UI-3 → UI-4 三者同写 `lib/client.js`，必须严格串行（看板无 `blocked_by` 字段，由主会话在上一卡落地后才 `run` 下一卡）；UI-1 独占 `lib/index.js`，与 UI-2 可并行；UI-5 只读，最后运行。

### 方案要点（2026-10-15 用户批准，m00841「开始吧」）

- **B 方案覆盖机制（已实证）**：`conversation.input.model` 是 single 槽，只渲染第一个 entry；动态注册的 entry 自动获得比官方更低的 priority，因此成为 winner，整体顶替官方 chip（asar:736916「a dynamically registered entry is assigned a lower priority than the shipped one, which makes it the winner」、asar:694697「register at a different priority to shadow it (lowest renders)」、asar:733004-733005 `nextPriority = 0` / asar:733227 `allocatePriority: () => --this.nextPriority`）。
- **两套职责分离**：数据层只接管自定义 API provider（`llm-pi-ai`，我们写 `reasoningEfforts`）；其余 provider（官方/第三方/插件）**一律不写**，它们的思考档位由各自的 `resolveModelInfo` 提供，但 UI 走我们同一套 Codex 弹层。官方模型目录 `buildModelCatalog`（asar:326486-326533）天然覆盖全部 provider，所以 UI 覆盖无需特殊适配。
- **永久接管**：插件启用即无条件覆盖官方 chip（用户 m00824 定）；设置页总开关只控制「是否写配置」。代价是用户无法切回官方 chip，只能停用插件。
- **客户端数据通路**：主路径 `ctx.get('connection').api.session.modelCatalog()` → `{result:{value:{groups,default,failures}}}`；提交 `conn.api.session.selectModel({sessionId,provider,model,reasoningEffort?})`（已安装第三方插件 @linxin666/dsh-client-ui-task-board 的实证路径，lib/client.js:12875-12907）。走原始 RPC 须自建①代次计数器（旧响应不覆盖新结果）②刷新时机 `ctx.on('connection/reset', ...)`。
- **弹层铁律**：不得假设七档，完全按 `reasoning.efforts` 数组渲染；`reasoning === undefined` → 档位区不显示（与官方一致）。

## 7. 残留不确定性（如实记录，验收时逐项清零）

## 7A. 浏览器半通道契约（2026-10-15 验收时验证，权威）

DSH 浏览器半存在**两条通道**（asar:717385/717613），本插件走 Module Loader 包通道：

| | Module Loader 包（factory(require)，本插件） | cordis-client-runner 闭包 |
|---|---|---|
| 符号面 | `require`（隐式 baseline external：`@deepseek-ai/dsh-client-ui-primitives`） | 固定 `React/console/styles/host` |
| `host.call` | **不存在** | 存在，直达本插件 Host 半 |
| `styles.insert` | **不存在**（用 document 或 require 的样式模块） | 存在 |
| Host 通信 | **fetch 同源相对路径**到 Host 半 webServer.register 的路由 | host.call |

结论（asar:732350 文档描述的是 runner 闭包通道，勿混淆）：
- client.js 必须用 `fetch('/dsh-thinking-effort/api', {method, body})` 与 Host 半通信（参考 startup-screen 插件 lib/client.js:24 `var API='/dsh-startup/config'`、lib/index.js:292-363 路由形状 `{kind:'exact', path, handler(req,res)}` + sendJson/readBody）。
- index.js 必须补 `inject: ['webServer', ...]` + `webServer.register`，否则设置页无端点可达。
- UI 层样式注入用 `document.head.appendChild(style)`（web profile 下 document 可用，参考插件即如此）。
- ⚠ **primitives 的裁决（2026-10-15 复核，推翻本节旧说法）**：`@deepseek-ai/dsh-client-ui-primitives` 在 Module Loader 通道**技术上可达**（asar:717385 说它是隐式 baseline external，可用 loader 的 `require` 解析 `MenuItemButton`），但**官方插件编写规范明令禁止 require 它**：asar:292610 原文 "Do not `require('@deepseek-ai/dsh-client-ui-primitives')` or load any other Harness Client package as a module... Write your own controls and match the host instead: copy markup, CSS, and behavior from the primitive into the plugin... Rename copied classes under your plugin's prefix, keep only `--dsw-alias-*` token references"。理由是这类包会无预警变化、纯 JS 插件无类型检查、组件抛错会整块清空槽位（console: `slot entry crashed in '<slot>'`）。
  **结论：不 require primitives；自己写控件，从官方 primitive 抄 markup/CSS/行为，class 加 `teff-` 前缀，只保留 `--dsw-alias-*` token 引用。**（[docs/review-notes.md:672](docs/review-notes.md#L672) 的「不 require」是对的，本节旧句是错的，已按此改正。）

## 7B. 评审决定（评审卡 step-5-preview 交付 12 条风险，主会话裁决后生效）

### 阻塞级修复（必须落地，否则不许安装）

- **R1 单写者**：第一版**只走 `settings.mutate('llm-pi-ai', ops, expectedRevision)` 单通道**，configEditor 不启用（避免双写竞态）。所有写串行进 `writeQueue`；`expectedRevision` 每次实时 `describe()` 取，禁止缓存；`settings/conflict` → 重新 describe + 重算差集 + 最多重试 3 次（退避 100/300/900ms），仍失败进设置页「待应用」列表，不静默丢弃。
- **R2 准入三条件**（删掉「疑似推理」猜测分支）：仅当 `reasoning === true` **且** 已有 `thinkingLevelMap`（即已存在 `reasoningEfforts`）**且** 目标档在该 map 中非 null 时才补写。理由：写任何 dict 都会把模型钉成 `reasoning:true`（asar:859990-991），非推理模型（groq llama / azure 全系 / together Qwen2.5）会被误伤成推理模型。
- **R3 merge 不 replace**：补写算法必须是 `next = {...existing}; 仅 existing[k]===undefined 时才写 kb 值`。理由：resolveModelReasoning 会把未声明的档位显式展开成 `null`（asar:859983-987），跳过 medium 等于宣布「不支持 medium」，会把本来有 medium 的模型（grok-4.3、gpt-oss-120b）功能回退。
- **R4 off 键三态**：内部建模用 `{kind:'null'|'absent'|'wire', value?}`，不用布尔。缺键 ≠ null：缺键时 UI 照常展示 off 档，多数适配器会下发硬编码 `"none"`（asar:1096914/1096930/1096952）。补写时保留现有 off 状态，缺键就继续缺键。
- **R8 defaultEffort 不可写进配置**（本轮 grep 实证，推翻骨架卡实现）：`describableReasoningLevel` = `return getSupportedThinkingLevels(model).some((l) => l === effort) ? effort : void 0`（asar:861105），`defaultEffort` 由 `reasoningInfo(model, defaultLevel)` 从 `profile.reasoning` 推导（asar:861222/861136）——**llm-pi-ai 模型条目 schema 无 `defaultEffort` 字段**（860404/860411 仅 `reasoningEfforts`）。因此：**lib/index.js 必须删除所有向模型条目写 `defaultEffort` 的代码**，改为只写 `reasoningEfforts`；默认档由官方 UI 的「默认(provider)」项或用户选择决定。

### 高优先修复

- **R5 YAML off 引号**：落盘是 **settings.yaml**（asar:971821/972302），不是 patch.yml。mutate 只保证内存正确，不保证落盘字形（eemeli stringify 不给 core-schema 字符串加引号）。插件 apply 时启动自检：读 settings.yaml 原文正则查裸 `off:`，命中即设置页横幅告警 + 一键修复。
- **R6 事件回环抑制**：`settings/document-updated` **带载荷** `(ns, revision)`（asar:972389/1017934）。维护 `lastSelfWrite={ns,revision}`，`ns==='llm-pi-ai' && revision<=lastSelfWrite.revision` 直接 return；事件回调只置 dirty 标志，实际扫描 300ms 去抖合并；按 provider 计算签名去重，签名不变跳过。
- **R7 探测降级**：`llm.discoverModels` 回复**从不携带 reasoningEfforts**（asar:859022/859269）。三级瀑布改名为「**知识库 → 用户覆盖**」；探测降级为「连通性/模型存在性探测」，设置页文案改为「模型清单+可达性」，不呈现「档位+置信度」。

### 中低优先

- **R9 动画触发条件**：`currentLevel === efforts 中按 THINKING_LEVELS 序的最后一个`（最高可用档），不是硬编码 `'max'`（ant-ling/together/google-vertex 等无 max 档）。
- **R10 知识库支持 `'inherit'`**：claude 系真实形态是 `{off:null,xhigh:"xhigh",max:"max"}`，low/medium/high **靠缺键兜底**（dispatch 回落厂商默认）。知识库值允许 `'inherit'` 表示「不写这个键」。
- **R11 chip 档位名用服务端 `name`**：渲染 `efforts.find(e=>e.id===effective)?.name`，不硬编码中英文字典。
- **R12 主题**：不缓存主题，开弹层前取当前值；动画 artwork 允许硬编码色值，弹层文字/边框必须走 token。

## 7C. Host↔Client API 契约（冻结，两侧按此实现）

- **路由**：Host 半 `inject` 必须含 `webServer`；注册 `{kind:'exact', path:'/dsh-thinking-effort/api', handler}`。
- **GET** `/dsh-thinking-effort/api` → `200 {ok:true, ...getState()}`。
- **POST** `/dsh-thinking-effort/api`，body `{method, args}` → `200 {ok:true, data}` / `400 {ok:false, error}`；method 取 `getState|setConfig|setOverrides|clearOverride|rescan|probe`。
- **getState() 返回**：`{config:{enabled,mode:'auto'|'overlay',probe}, overrides:{'<route>/<modelId>':{efforts,defaultEffort}}, planned:[{route,modelId,source,efforts,defaultEffort}], levels:[...THINKING_LEVELS], rules:[{id,vendor,model,efforts}], configFile, available:boolean}`。
- **Client 半**：`var API='/dsh-thinking-effort/api'`，`fetch(API)` 读、`fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})})` 写；`styles`/`host` 全局**不可用**（§7A），样式走 `document.head.appendChild(style)`。

---

1. **表单字段复读未完成**：asar 479201/479272 的自定义模型子表单字段列表未逐行复读，「reasoningEfforts 是隐藏字段」的判断依据 = backend schema 存在（860404/860411）+ 早前批次对表单区的确认 + 实机 UI 无该输入。验收时用 cordis_inspect 或 grep 补一刀确认。
2. **configEditor.edit 后是否必发 full replace**：取决于 llm-pi-ai 对 fiber config 更新的监听实现（866145 一致性哨兵表明 replace 路径可预期）。缓解：写完后若 `llm/adapters-updated` 未触发，可主动再触发一次 registry replace，或同时依赖 `settings/document-updated`（Web 设置页也在订阅清单）。数据层实现需内置「写入后确认 efforts 生效」的自检逻辑。
3. **settings.mutate 与官方设置页并发写**：官方 Models 页随时可能 mutate 同一 ns（489353），自动接管批量补写时冲突窗口大。缓解（R1）：单写者队列 + 永远带 expectedRevision + conflict 后重算重试（≤3 次退避 100/300/900ms）+ 补写幂等（`desired ⊆ existing` 只写差集，缺键才写，绝不 unset）+ 失败进设置页「待应用」列表不静默丢弃。
4. **探测通道的凭据**：上游探测走同源代理路由需要凭据服务端解析，Host 半侧注册路由的具体 API 未验证——探测已降级为「连通性/模型存在性」（R7），「非法 effort 报错解析」为实验性旁路（默认关、单模型每日限流、仅用户显式点击触发）。
