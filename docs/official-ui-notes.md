# 官方模型选择器 UI 细节提取（DSH 0.2.0-rc.2）

> 来源：`D:\Apps\Users\wang\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`（未混淆，2,348,005 行）。
> 全部行号为 asar 内的绝对行号。核心文件是官方插件 **`@deepseek-ai/dsh-client-ui-model-selection@0.2.0-rc.2`**，
> 其 client 半区位于 asar **435210–436189**（`//#region` 边界），package.json 在 **436202–436273**。
> 所有 CSS 集中在**单行 435342**（4,888 字符），class 名映射表在 **435351–435381**。
>
> 阅读约定：`§` 为提取结论，`锚点` 为 asar 行号，代码块为**可直接照抄**的原文片段（已去掉 TS 类型擦除后的运行时噪音，但结构逐字保留）。

---

## 1. 触发器 chip（trigger）的 DOM 结构与 class 名链

### 1.1 结论速览

| 项 | 值 | 锚点 |
| --- | --- | --- |
| 根元素 | `div`（**不是** button），class `wq12jW_root` | 435743–435745 |
| 触发器本体 | **`button type="button"`**，class `wq12jW_trigger` | 435752–435755 |
| 图标 | `IconDataOutlineRegular`，`size: 16`，class `wq12jW_triggerIcon` | 435772–435775 |
| 模型名 | `span.wq12jW_triggerLabel` | 435776–435779 |
| effort 名 | `span.wq12jW_triggerEffort`，**条件渲染**（`effortLabel !== undefined`） | 435780–435783 |
| 右端 | `busy ? StateDot({state:"ongoing"}) : IconChevronDownOutlineRegular`，class `wq12jW_chevron`（open 时追加 `wq12jW_chevronOpen`） | 435784 |
| CSS 前缀 | `wq12jW_`（CSS Modules 自动生成，**照抄可用**） | 435342 |

**关键事实：chip 是「一个 button 里 4 个 flex 子元素」**，不是多个按钮；模型名与档位名是两个并列 `<span>`，靠父级 `gap:4px` 分隔（DOM 里**没有**分隔符字符）。

### 1.2 结构代码（435743–435786）

```jsx
<div
  ref={rootRef}
  className={ModelSelect_module_css_default.root}      // wq12jW_root
  onKeyDown={onRootKeyDown}
  onBlur={onBlur}
  onMouseDown={(event) => {                            // 防止 button 抢焦点
    if (event.target instanceof Element && event.target.closest("button") !== null) event.preventDefault();
  }}
>
  <button
    ref={triggerRef}
    type="button"
    className={ModelSelect_module_css_default.trigger} // wq12jW_trigger
    aria-label={triggerAria}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={open ? `${id}-menu` : void 0}
    title={triggerLabel}
    aria-busy={busy}
    data-selection-focus={selectionFocus ? "" : void 0}   // 选中后抑制 focus ring
    onBlur={() => { setSelectionFocus(false); }}
    disabled={locked}
    onClick={() => { if (open) close(true); else show(); }}
  >
    <IconDataOutlineRegular className={css.triggerIcon} size={16} />
    <span className={css.triggerLabel}>{modelLabel}</span>
    {effortLabel !== void 0 && (
      <span className={css.triggerEffort}>{effortLabel}</span>
    )}
    {busy
      ? <StateDot state="ongoing" />
      : <IconChevronDownOutlineRegular
          className={clsx(css.chevron, open && css.chevronOpen)} />}
  </button>
  {/* …menu 见 §2… */}
</div>
```

### 1.3 两个 label 的计算（435728–435733）

```js
const waiting = state.current === null && state.status === "loading";
const modelLabel = waiting
  ? t("trigger.loading")
  : currentChoice?.model.name ?? (state.current === null
      ? t("trigger.fallback")
      : `${state.current.provider}/${state.current.model}`);

const triggerLabel = effortLabel === void 0 ? modelLabel : `${modelLabel} · ${effortLabel}`;
//  ↑ 仅用于 title 属性；可见 DOM 用两个 span，无 " · " 字符

const triggerAria = waiting
  ? t("trigger.loading")
  : state.current === null ? t("trigger.selectAria")
  : effortLabel === void 0 ? t("trigger.aria", { model: modelLabel })
  : t("trigger.ariaEffort", { model: modelLabel, effort: effortLabel });
```

`effortLabel` 的三分支（435479–435480）——**这是整个 chip 档位显示的唯一真相**：

```js
const reasoning     = currentChoice?.model.reasoning;
const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
const effortLabel =
  reasoning === void 0                       // ① 非推理模型 → 显示 retainedEffort（可为 undefined）
    ? state.retainedEffort
  : effectiveEffort === void 0                 // ② 推理模型但无档位可选 → 「Default」
    ? t("effort.providerDefault")
  : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name  // ③ 正常档位名
    ?? effectiveEffort;                        //    fallback：直接显示 id
```

> 分支 ① 的含义：切到一个**非推理**模型时，chip 仍然显示**上一个模型残留的档位名**（`state.retainedEffort`），
> 而不是隐藏档位——这个值由数据层维护（435235–435239、435253）。`reasoning` 为 `undefined` 时 `effortChoices` 为空（§2.3），
> 但 chip 上的文字仍会保留。**实现插件时要复刻这个「粘滞档位」行为，否则切换模型时 chip 会跳变。**

### 1.4 trigger 相关 CSS（逐条来自 435342）

```css
.wq12jW_root{min-width:0;position:relative}

.wq12jW_trigger{
  border-radius:var(--dsw-radius-sm);          /* 8px */
  min-width:0;
  max-width:min(360px,45cqw);                  /* cqw = 容器查询宽度单位 */
  height:28px;
  color:var(--dsw-alias-label-secondary);
  cursor:pointer;
  background:0 0;border:none;outline:none;
  align-items:center;gap:4px;
  padding:0 4px 0 8px;
  font-size:13px;font-weight:400;line-height:20px;
  display:flex;
}
.wq12jW_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}

/* 注意 :not([data-selection-focus]) —— 这是「选中后不显示焦点环」的机制 */
.wq12jW_trigger:focus-visible:not([data-selection-focus]){
  box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));
}

.wq12jW_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}

.wq12jW_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}

/* flex-shrink:1000 —— 极端压缩时档位名先被压掉，模型名保命 */
.wq12jW_triggerEffort{
  text-overflow:ellipsis;white-space:nowrap;min-width:0;
  color:var(--dsw-alias-label-caption);flex-shrink:1000;overflow:hidden;
}

/* 窄容器时 composer 会把文字换成图标，见 §1.5 */
.wq12jW_triggerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}
.wq12jW_triggerLabel,.wq12jW_triggerEffort{display:var(--dsh-composer-model-text-display,block)}

.wq12jW_chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}
.wq12jW_chevronOpen{transform:rotate(180deg)}
```

### 1.5 空间不足时的降级（官方文档，403251）

> "If they cannot share a line, the row sets `--dsh-composer-model-text-display: none` and
> `--dsh-composer-model-icon-display: block` for the model seat; their defaults are `block` and `none`."

即：**窄容器下官方 chip 会隐藏「模型名 + 档位名」两个 span，只显示 `IconDataOutlineRegular` 图标**。
`--dsh-composer-model-*` 由 composer 控制栏测量后写在祖先上（403251 / 403423 / 735732）。

### 1.6 挂载位置与槽位

chip 由官方自己注册在 **`conversation.input.model`** 槽（435796–435797 附近见 §2；注册在 436161–436180）：

```js
ctx.inject(["slots", "modelDirectories"], (scope) => {
  const models = scope.modelDirectories;
  const sessions = scope.sessions;
  scope.slots.inject("conversation.input.model", () => scope.slots.register({
    name: "conversation.input.model",
    locale: NS,                                  // NS = "model"
    inject: (sessionId) => {
      const directory = models.directoryFor(sessionId);
      const available = sessions.subagentAddress(sessionId) === void 0;
      return {
        available,
        directory: directory.store,
        load: () => { if (available) directory.load().catch(() => {}); },
        select: (selection) => available ? directory.select(selection) : Promise.resolve(void 0)
      };
    }
  }, ModelSelect));
});
```

槽位声明为 **`single` + `scope: "session"`**（421867–421870），在 composer 的 `standardControls` 里渲染，
紧跟在 `conversation.input.right` 之后（421078）：

```jsx
<div className={InputBar_module_css_default.standardControls} hidden={activity}>
  {input === void 0 || sessionId === void 0 ? null : renderSlot("conversation.input.right", {})}
  {sessionId === void 0 ? null : renderSlot("conversation.input.model", { locked: modelSeatLocked })}
</div>
```

> ⚠️ **槽是 `single`**：插件若同时注册 `conversation.input.model`，会与官方座位冲突。
> 插件应改用**自己的槽 id**，或按 DESIGN.md 的方案挂到官方槽之外的自定义座位。

---

## 2. effort 弹层（下拉菜单）

### 2.1 结论速览

| 项 | 值 | 锚点 |
| --- | --- | --- |
| 结构 | **两级菜单**：根面板 = `[模型 cell, 档位 cell]`，各自 drill 进独立列表 | 435396–435420（文档注释） |
| 渲染方式 | `MenuSurface` 原语 + **`createPortal(..., document.body)`** | 435787–435788、435980 |
| 定位 | **`position:fixed` + JS 从 trigger 的 `getBoundingClientRect()` 算坐标**；**不是**相对 `data-composer-card` | 435560–435575 |
| 坐标公式 | `x = rect.right - lw`，`y = rect.top - 8 - lh`，四周 12px 夹逼 | 435564–435574 |
| 重定位 | `window` 上 `scroll`（**capture:true**）+ `resize` | 435577–435581 |
| 测量 pass | 未定位时用 `MEASURE_STYLE`（`visibility:hidden;left:0;top:0`）保证 `offsetWidth/Height` 真实 | 435422–435427 |
| effort 面板 | **扁平列表**（无 MenuGroup），`button[role=menuitemradio]` | 435958–435978 |
| 选中态 | `aria-checked` + `IconCheckOutlineRegular`；**`.wq12jW_selected{background:0 0}` 即背景透明** | 435963、435976、435342 |
| 空值项 | 仅当 `reasoning !== undefined && reasoning.defaultEffort === undefined` 时插入首行 | 435481–435484 |
| Toast 锚点 | 唯一用 `data-composer-card` 的地方：`closest("[data-composer-card]")` | 435984 |

### 2.2 容器：MenuSurface + portal（435787–435794）

```jsx
{open && createPortal(
  <MenuSurface
    ref={menuRef}
    id={`${id}-menu`}
    className={css.menu}                       // wq12jW_menu
    style={menuPos ?? MEASURE_STYLE}
    role={pane === "model" ? "group" : "menu"} // 模型面板是 group，其余是 menu
    aria-label={t("menu.aria")}
    aria-busy={state.status === "loading" || busy}
  >
    {/* …见 2.4 / 2.5… */}
  </MenuSurface>,
  document.body)}
```

`MenuSurface` 原语实现（451412–451442）——**这是官方菜单材质的唯一入口**：

```js
const MenuSurface = forwardRef(function MenuSurface({ compact = false, className, style, children, ...props }, ref) {
  const id = useId();
  const backingRef = useRef(null);
  useLayoutEffect(() => { document.body.appendChild(backingRef.current); }, []);
  const anchorStyle = { "--dsh-menu-anchor": `--dsh-menu-${id.replaceAll(":", "")}` };
  return (
    <>
      <div {...props} ref={ref}
        data-menu-material="translucent"
        className={clsx(css$13.surface, compact && css$13.compact, className)}
        style={{ ...style, ...anchorStyle }}>
        <div aria-hidden="true" className={css$13.material} />
        {children}
      </div>
      {createPortal(
        <div ref={backingRef} aria-hidden="true" data-menu-backing=""
          className={clsx(css$13.backing, compact && css$13.compact)}
          style={{ ...anchorStyle, visibility: style?.visibility }} />,
        document.body)}
    </>
  );
});
```

菜单材质 CSS（446194–446242）：

```css
.surface, .backing { border-radius: var(--dsw-radius-lg); }   /* 16px */
.compact { border-radius: var(--dsw-radius-md); }             /* 12px */
:where(.surface) { position: relative; }
.surface { anchor-name: var(--dsh-menu-anchor); isolation: isolate; }

/* 只对背景层做 filter：避免给嵌套菜单/固定浮层制造 backdrop root 或新的 fixed 包含块 */
.material {
  position: absolute; inset: 0; z-index: -1;
  border-radius: inherit;
  background: var(--dsw-menu-surface-fill);          /* #f8f9fa94 */
  backdrop-filter: var(--dsw-menu-backdrop-filter);  /* blur(40px) saturate(150%) */
  pointer-events: none;
}

.backing { display: none; }   /* macOS 才 display:block，用 CSS anchor 定位做不透明底 */
:global(html[data-platform='darwin']) .backing {
  display: block; position: fixed;
  position-anchor: var(--dsh-menu-anchor);
  top: anchor(top); left: anchor(left);
  width: anchor-size(width, 0px); height: anchor-size(height, 0px);
  z-index: -1; background: var(--dsw-alias-bg-base); pointer-events: none;
}
```

> **重要**：菜单背景用的是 `--dsw-menu-surface-fill` + `--dsw-menu-backdrop-filter`，
> **不是** `--dsw-specific-menu`。`--dsw-specific-menu` 是「没有 menu backing 的其他浮层」用的
> （696680 / 696818 的官方样式规范原文明确区分了这两者）。
> DESIGN.md 里写「`--dsw-specific-menu`」的地方，若要 100% 对齐官方模型菜单，应改为 `MenuSurface` 或
> 直接抄 `.material` 的 `--dsw-menu-surface-fill` + `backdrop-filter`。

### 2.3 effort 选项构造（435481–435489）

```js
const effortChoices = useMemo(() => reasoning === void 0 ? [] : [
  // 「默认(provider)」空值项：仅当 provider 未声明 defaultEffort
  ...(reasoning.defaultEffort === void 0
      ? [{ key: "provider-default", effort: void 0, label: t("effort.providerDefault") }]
      : []),
  ...reasoning.efforts.map((effort) => ({
    key: `effort:${effort.id}`,
    effort: effort.id,
    label: effort.name
  }))
], [reasoning, t]);
```

**渲染条件精确表述**：`reasoning !== undefined`（是推理模型）**且** `reasoning.defaultEffort === undefined`（provider 没给默认档）
→ 列表首行是 `{effort: undefined, label: "Default"}`；否则首行直接是第一个真实档位。
`reasoning === undefined` → `effortChoices = []` → 走 `empty.efforts` 空态（435955–435957）。
**`reasoning.defaultEffort` 存在时官方绝不显示该空值项**——与 DESIGN.md 中「插件写配置时总是写 defaultEffort 以避免该项」的策略一致。

### 2.4 根面板的两个 cell（435796–435834）

```jsx
{pane === "root" && <>
  <button ref={itemRef()} type="button" role="menuitem"
    className={css.cell} onClick={() => drill("model")}>
    <span className={css.cellLabel}>{t("menu.model")}</span>
    <span className={css.cellValue}>{modelLabel}</span>
    <IconChevronRightOutlineRegular className={css.cellChevron} />
  </button>

  {reasoning !== void 0 && (
    <button ref={itemRef()} type="button" role="menuitem"
      className={css.cell} onClick={() => drill("effort")}>
      <span className={css.cellLabel}>{t("menu.effort")}</span>
      <span className={css.cellValue}>{effortLabel}</span>
      <IconChevronRightOutlineRegular className={css.cellChevron} />
    </button>
  )}
</>}
```

> **档位 cell 仅在 `reasoning !== void 0` 时渲染**（435815）——非推理模型下根面板只剩「模型」一行。

### 2.5 effort 面板列表（435947–435978）

```jsx
{pane === "effort" && <>
  {state.error !== null && lastActionRef.current === "load" && (
    <div className={css.error}>
      <span>{t("error.action", { message: state.error })}</span>
      <button type="button" className={css.retry} onClick={reload}>{t("action.reload")}</button>
    </div>
  )}

  {effortChoices.length === 0
    ? <div className={css.empty}>{t("empty.efforts")}</div>
    : effortChoices.map((level) => (
        <button key={level.key} ref={itemRef()} type="button"
          role="menuitemradio"
          aria-checked={effectiveEffort === level.effort}
          className={clsx(css.option, effectiveEffort === level.effort && css.selected)}
          disabled={busy}
          onClick={() => { chooseEffort(level.effort); }}>
          <span className={css.optionCopy}>
            <span className={css.modelName}>{level.label}</span>
          </span>
          <span className={css.check}>
            {pending !== null
              && pending.provider === state.current?.provider
              && pending.model === state.current.model
              && pending.reasoningEffort === level.effort
                ? <StateDot state="ongoing" />
                : effectiveEffort === level.effort
                  ? <IconCheckOutlineRegular />
                  : null}
          </span>
        </button>
      ))}
</>}
```

选中判定用的是 `effectiveEffort`（**含 defaultEffort 回退**），所以「provider 默认档」会被正确高亮成其实际档位，
而 `effort: undefined` 的那一行只在 `effectiveEffort === undefined` 时高亮。

提交逻辑（435715–435726）——注意 `undefined` 档位**不带** `reasoningEffort` 字段：

```js
const chooseEffort = (effort) => {
  if (state.current === null) return;
  if (effectiveEffort === effort) { closeAfterSelection(); return; }   // 同值不提交，直接关
  submit({
    provider: state.current.provider,
    model: state.current.model,
    ...effort === void 0 ? {} : { reasoningEffort: effort }
  });
};
```

### 2.6 模型面板（供参考，插件可能不需要）

搜索框仅在 `choices.length > 4` 时出现（`showSearch`，435462）；分组用 `MenuGroup`（435897–435938）；
每行 `button[role=menuitemradio][aria-checked]`，class `clsx(option, modelOption, selected && selected, index === activeModelIndex && optionActive)`（435913），
`tabIndex: showSearch ? -1 : 0`（435908）；`data-highlighted` 属性（435912）。

### 2.7 弹层 CSS（435342）

```css
.wq12jW_menu{
  z-index:1100;
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  width:max-content;
  min-width:min(240px,100vw - 32px);
  max-width:min(420px,100vw - 32px);
  max-height:min(360px,100vh - 96px);
  box-shadow:var(--dsw-elevation-prominent);
  color:var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);
  border:0;flex-direction:column;padding:4px;display:flex;
  position:fixed;overflow:hidden;
}

.wq12jW_status,.wq12jW_empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px}

.wq12jW_error,.wq12jW_warning{
  border-radius:var(--dsw-radius-md);
  background:var(--dsw-alias-interactive-bg-hover-danger);
  color:var(--dsw-alias-state-error-primary);
  justify-content:space-between;align-items:flex-start;gap:6px;
  margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px;display:flex;
}
.wq12jW_warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}
.wq12jW_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}

.wq12jW_groups{min-height:0;overflow-y:auto}

/* 列表项 —— effort 与 model 共用 .option */
.wq12jW_option{
  box-sizing:border-box;border-radius:var(--dsw-radius-md);
  width:auto;min-width:100%;min-height:34px;
  color:inherit;text-align:left;cursor:pointer;background:0 0;
  border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex;
}
.wq12jW_option:not(.wq12jW_modelOption):hover:not(:disabled),
.wq12jW_option:focus-visible,
.wq12jW_optionActive:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}

/* 选中态背景透明！选中只由右侧 check 图标表达 */
.wq12jW_selected{background:0 0}
.wq12jW_option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}

.wq12jW_optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}
.wq12jW_modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400;line-height:18px;overflow:hidden}
.wq12jW_check{color:var(--dsw-alias-label-primary);flex:0 0 14px;place-items:center;display:grid}
.wq12jW_check svg{width:14px;height:14px}

/* 根面板 cell */
.wq12jW_cell{
  box-sizing:border-box;border-radius:var(--dsw-radius-md);
  width:auto;min-width:100%;height:34px;
  color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;
  background:0 0;border:none;outline:none;align-items:center;gap:6px;
  padding:0 8px;font-size:13px;line-height:20px;display:flex;
}
.wq12jW_cell:hover,.wq12jW_cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.wq12jW_cellLabel{white-space:nowrap;flex:none}
.wq12jW_cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}
.wq12jW_cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}
```

搜索框相关（模型面板用，435342 后半）：

```css
.wq12jW_searchRow{flex-shrink:0;margin:2px 0 3px;position:relative}
.wq12jW_searchRow .wq12jW_search{border-radius:var(--dsw-radius-md);background:0 0;border:0 solid #0000;height:auto;padding:5px 7px;display:flex}
.wq12jW_searchRow .wq12jW_searchWithQuery{padding-right:34px}
.wq12jW_searchClear{corner-shape:round;width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex;position:absolute;top:50%;right:4px;transform:translateY(-50%)}
.wq12jW_searchClear:hover,.wq12jW_searchClear:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
.wq12jW_searchRow .wq12jW_search:focus-within{border-color:#0000}
.wq12jW_searchRow .wq12jW_search input{padding:0;font-size:12px;line-height:normal}
.wq12jW_searchRow .wq12jW_search input::placeholder{color:var(--dsw-alias-label-caption)}
```

### 2.8 MenuGroup（模型分组标题，吸顶）

`MenuGroup`（451913–451934）：

```js
function MenuGroup({ label, children }) {
  const headingId = useId();
  return (
    <section role="group" aria-labelledby={headingId} data-menu-group=""
      className={css$15.group}>
      <span aria-hidden="true" data-menu-group-start="" className={css$15.start} />
      <div id={headingId} data-menu-group-heading="" className={css$15.heading}>{label}</div>
      {children}
    </section>
  );
}
```

标题 CSS（446171–446193）：

```css
.group + .group { margin-top: 3px; }
.heading {
  position: sticky; top: 0; z-index: 1;
  padding: 4px 7px 2px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px; line-height: 16px; font-weight: 500;
}
.heading[data-stuck] { background: var(--dsw-alias-menu-group-header-fill); }  /* #f8f9faf0 */
:global(html:not([data-platform='darwin'])) .heading { border-radius: var(--dsw-radius-md); }
```

`data-stuck` 由 `observeStickyMenuGroups(viewport)`（451945 起）用 `IntersectionObserver` + `ResizeObserver`
异步置位：`const stuck = group.atTop && group.above;`（451966），`heading.toggleAttribute("data-stuck", stuck)`（451967）。
无 `IntersectionObserver`/`ResizeObserver` 时**标题保持透明**（451959）。

### 2.9 定位实现全文（435555–435588）

```js
useLayoutEffect(() => {
  if (!open) { setMenuPos(null); return; }
  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect === void 0) return;
    const MARGIN = 12;
    const lw = menuRef.current?.offsetWidth ?? 0;
    const lh = menuRef.current?.offsetHeight ?? 0;
    let x = rect.right - lw;          // 右对齐到 trigger 右缘
    let y = rect.top - 8 - lh;        // 浮在 trigger 上方 8px
    if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth  - lw - MARGIN);
    if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN);
    setMenuPos({ left: x, top: y });
  };
  place();
  window.addEventListener("scroll", place, true);   // capture：捕获所有滚动容器
  window.addEventListener("resize", place);
  return () => {
    window.removeEventListener("scroll", place, true);
    window.removeEventListener("resize", place);
  };
}, [open, pane, state, query]);
```

**结论：官方弹层不用 `data-composer-card` 做锚点，也不用 CSS Anchor Positioning 定位自己**
（CSS anchor 只用于 macOS 的 `.backing`）。定位完全由 JS 读 trigger 矩形 + 上下夹逼完成，`position:fixed`。
`data-composer-card`（定义在 InputBar card div，420990）**只被 Toast 用作锚点**：

```jsx
<Toast
  text={toast.text}
  icon={<IconWarningOutlineRegular />}
  anchor={rootRef.current?.closest("[data-composer-card]") ?? null}
  onDone={() => { setToast(null); }}
  key={toast.seq} />
```

---

## 3. 设计 token 清单与实际值

### 3.1 圆角 / 字体 / 焦点环（698051、698060）

```css
:root{
  --dsw-radius-xs:4px; --dsw-radius-sm:8px; --dsw-radius-md:12px;
  --dsw-radius-lg:16px; --dsw-radius-xl:20px; --dsw-radius-panel:28px;

  --dsw-font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --dsw-font-family-brand:"Montserrat", var(--dsw-font-family);
  --ds-font-family-code:"SF Mono", "JetBrains Mono", "Fira Code", Consolas,
    "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei";

  --ds-ease-in-out:cubic-bezier(.4, 0, .2, 1);
  --ds-transition-duration:.2s; --ds-transition-duration-fast:.1s; --ds-transition-duration-slow:.3s;
}
:root{ --dsw-focus-ring-width:2px }
:focus-visible{
  outline-color:var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-width:var(--dsw-focus-ring-width);
}
/* 指针操作时焦点环透明 */
html[data-input-modality=pointer] body :focus-visible:not(:read-write){
  --dsw-focus-ring-color:transparent; outline-color:#0000;
}
```

### 3.2 阴影与层级（698069）

```css
body{
  --dsw-shadow-lv1:0 2px 4px 0 #0000000d;
  --dsw-shadow-lv1-blur:0 4px 12px 0 #00000005;
  --dsw-shadow-lv2:0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a;
  --dsw-shadow-lv3:0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014;
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l4);
  --dsw-mask-blur:none;
  --dsw-menu-backdrop-filter:blur(40px) saturate(150%);
}
body[data-ds-dark-theme] [data-menu-material]{ --dsw-elevation-stroke-color:var(--dsw-alias-border-l3) }

body, body *{
  --dsw-elevation-stroke:0 0 0 .5px var(--dsw-elevation-stroke-color);
  --dsw-elevation-panel:var(--dsw-elevation-stroke), 0 3px 8px 0 #00000008, 0 0 16px 0 #00000005;
  --dsw-elevation-prominent:var(--dsw-elevation-stroke), 0 3px 8px 0 #0000000a, 0 0 20px 0 #0000000d;
  --dsw-elevation-soft:var(--dsw-elevation-stroke), 0 4px 16px 0 #00000008, 0 0 24px 0 #00000008;
}
```

> ⚠️ **`--dsw-shadow-lv3` 与 `--dsw-elevation-prominent` 是两个不同的东西。**
> 官方模型菜单用的是 `--dsw-elevation-prominent`（带 0.5px 描边 + 三层阴影）；
> `--dsw-shadow-lv3` 只在少数旧组件出现。DESIGN.md 提到的 `--dsw-shadow-lv3` 建议改为 `--dsw-elevation-prominent`。

### 3.3 菜单材质与特定表面（698057）

```css
body{
  --dsw-menu-surface-fill:#f8f9fa94;                 /* 58% 不透明浅色 */
  --dsw-alias-menu-group-header-fill:#f8f9faf0;      /* 94% 不透明，吸顶标题用 */
  --dsw-specific-menu:var(--dsw-menu-surface-fill);  /* 无 menu backing 的其他浮层 */
}
```

官方规范原文（696680，中文 696818）：

> 公共菜单通过 `MenuSurface` 共享 `--dsw-menu-surface-fill` 和模糊，平台代码须保留这些 token 值。
> 菜单吸顶分组标题可使用 `--dsw-alias-menu-group-header-fill`，其浅／深色填充均为 94% 不透明度，独立于菜单材质。
> 其他浮层使用 `--dsw-specific-menu`，在没有菜单底层时保留 macOS 上接近不透明的填充。

### 3.4 别名色（`--dsw-alias-*`，698057；`body` 作用域）

| Token | 解析值 | 最终 hex |
| --- | --- | --- |
| `--dsw-alias-label-primary` | `var(--dsw-static-neutral-bluish-1000)` | `#0f1115` |
| `--dsw-alias-label-secondary` | `var(--dsw-static-neutral-bluish-700)` | `#61666b` |
| `--dsw-alias-label-tertiary` | `var(--dsw-static-neutral-bluish-600)` | `#81858c` |
| `--dsw-alias-label-caption` | `var(--dsw-static-neutral-bluish-400)` | `#adb2b8` |
| `--dsw-alias-label-dimmed` | `var(--dsw-static-neutral-bluish-200)` | `#e1e5ee` |
| `--dsw-alias-menu-icon` | `var(--dsw-static-neutral-bluish-800)` | `#353638` |
| `--dsw-alias-interactive-bg-hover` | 直接字面量 | `#2631480f`（≈9% 蓝灰） |
| `--dsw-alias-interactive-bg-hover-danger` | 直接字面量 | `#ec13130d` |
| `--dsw-alias-border-l1` | 直接字面量 | `#0000000a` |
| `--dsw-alias-border-l2` | 直接字面量 | `#0000001a` |
| `--dsw-alias-border-l3` | 直接字面量 | `#0000001f` |
| `--dsw-alias-border-l4` | 直接字面量 | `#00000029` |
| `--dsw-alias-state-business-primary` | `var(--dsw-static-deepseek-500)` | `#4176e6` |
| `--dsw-alias-scrollbar-bg-l2` | `var(--dsw-static-neutral-200)` | `#e5e5e5` |
| `--dsw-alias-scrollbar-hover-l2` | `var(--dsw-static-neutral-300)` | `#d4d4d4` |
| `--dsw-alias-bg-module-platform` | `var(--dsw-static-neutral-bluish-60)` | `#f5f6f7` |
| `--dsw-alias-state-warn-label` | `var(--dsw-static-amber-600)` | `#dd8629` |
| `--dsw-alias-state-error-primary` | `var(--dsw-static-red-600)` | （red-600，hex 未单独取） |

（`--dsw-static-neutral-bluish-600:#81858c`、`700:#61666b`、`800:#353638`、`400:#adb2b8`、`200:#e1e5ee`、
`--dsw-static-neutral-200:#e5e5e5`、`300:#d4d4d4`、`--dsw-static-deepseek-500:#4176e6`、`--dsw-static-amber-600:#dd8629`
均在 698057。）

### 3.5 滚动条变量（698066 + 696719 规范）

```css
body{
  --dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l1);
  --dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l1);
  --dsh-scrollbar-thumb-border:0px; --dsh-scrollbar-track-margin:0px;
  --dsh-scrollbar-width:5px;
}
@supports not selector(::-webkit-scrollbar){
  body,body *{ scrollbar-width:thin; scrollbar-color:var(--dsh-scrollbar-thumb) transparent }
}
::-webkit-scrollbar{ width:var(--dsh-scrollbar-width); height:var(--dsh-scrollbar-width) }
::-webkit-scrollbar-track{ margin-block:var(--dsh-scrollbar-track-margin); background:0 0 }
::-webkit-scrollbar-thumb{
  border:var(--dsh-scrollbar-thumb-border) solid transparent;
  corner-shape:round; background:var(--dsh-scrollbar-thumb);
  background-clip:content-box; border-radius:999px;
}
::-webkit-scrollbar-thumb:hover{ background-color:var(--dsh-scrollbar-thumb-hover) }
```

官方规范（696719）：**高层级表面（菜单/浮层/对话框）必须在自己容器上把这对变量重绑到 `l2` 版本**——
这正是 `.wq12jW_menu` 里那两行的作用。另一个合法目标是 `transparent`。

### 3.6 容器查询变量（403251）

| 变量 | 默认 | 语义 |
| --- | --- | --- |
| `--dsh-composer-model-text-display` | `block` | 模型名/档位名两个 span 的 `display` |
| `--dsh-composer-model-icon-display` | `none` | 图标 span 的 `display`；空间不足时反转为 `block`/`none` |

---

## 4. 键盘导航与关闭行为

### 4.1 事件监听挂载点总表

| 事件 | 挂载点 | 锚点 |
| --- | --- | --- |
| `keydown` | 根 `div.wq12jW_root` 的 `onKeyDown={onRootKeyDown}`（React 合成事件，**冒泡**） | 435746 / 435632 |
| `blur` | 根 `div` 的 `onBlur`（React，`focusout` 语义） | 435747 / 435685 |
| `mousedown`（点击外部关闭） | **`document.addEventListener("mousedown", closeOutside)`**，仅在 `open` 时挂载 | 435496–435507 |
| `mousedown`（防止按钮抢焦点） | 根 `div` 的 `onMouseDown`，`closest("button") !== null` → `preventDefault()` | 435748–435750 |
| `scroll` / `resize`（重定位） | **`window`**，`scroll` 用 `capture: true` | 435577–435581 |
| 吸顶标题观察 | `IntersectionObserver` + `ResizeObserver`（`groupsRef` 滚动容器） | 435537–435546 / 451945 |

### 4.2 Escape（435634–435639）

```js
if (event.key === "Escape" && open) {
  event.preventDefault();
  if (pane !== "root" && state.current !== null) back(pane);   // 先退回根面板
  else close(true);                                            // 再关闭并把焦点还给 trigger
  return;
}
```

**两级语义**：在 drilled 面板里按 Escape → 回到根面板并把焦点交还给对应的 cell（`back(pane)`，435621–435625）；
在根面板再按 → 关闭 + 焦点回 trigger。注意 `state.current !== null` 是必要条件：
**未选择模型时 Escape 直接关闭**。

### 4.3 点击外部关闭（435496–435507）

```js
useEffect(() => {
  if (!open) return;
  const closeOutside = (event) => {
    if (rootRef.current?.contains(event.target) === true) return;   // 触发器区域
    if (menuRef.current?.contains(event.target) === true) return;   // portal 里的菜单
    setOpen(false);
  };
  document.addEventListener("mousedown", closeOutside);
  return () => { document.removeEventListener("mousedown", closeOutside); };
}, [open]);
```

用 `mousedown`（不是 `click`），且**不恢复焦点**（直接 `setOpen(false)`，没有 `focus()` 调用）。
因为菜单在 `document.body` 的 portal 里，所以必须同时检查 `rootRef` 与 `menuRef` 两个子树。

### 4.4 方向键（435680–435683 / 435641–435648）

```js
// 模型面板 + 搜索模式：方向键只移动高亮，焦点留在搜索框
if (pane === "model" && showSearch && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
  event.preventDefault();
  if (!busy && visibleModels.length > 0) {
    setHighlightedIndex((activeModelIndex + (event.key === "ArrowDown" ? 1 : -1) + visibleModels.length) % visibleModels.length);
    searchRef.current?.focus();
  }
  return;
}
// 其余情况：在 itemRefs 的按钮之间循环移动真实焦点
if (event.key === "ArrowDown" || event.key === "ArrowUp") {
  event.preventDefault();
  moveFocus(event.key === "ArrowDown" ? 1 : -1);
}
```

```js
const moveFocus = (offset) => {
  const items = itemRefs.current.filter((item) => item !== null);
  if (items.length === 0) return;
  const active = items.findIndex((item) => item === document.activeElement);
  items[active === -1
    ? (offset > 0 ? 0 : items.length - 1)
    : (active + offset + items.length) % items.length]?.focus();
};
```

### 4.5 Tab / Shift+Tab（435656–435679）

- `Shift+Tab`：与 Escape 同级——drilled 面板 → `back(pane)`；根面板 → `close(true)`。
- `Tab`（非 shift）焦点在某个 row button 上 → `preventDefault()` 并 `focused.click()`（激活该行）。
- `Tab` 焦点在 trigger 上 → `preventDefault()`；搜索模式聚焦搜索框，否则聚焦「已选中项（`[role=menuitemradio][aria-checked=true]:not([disabled])`）或第一个可用行」。
- 搜索框里 `Enter` 或 `Tab`（非 shift）→ 选中当前高亮项（435649–435654）。

### 4.6 失焦关闭（435685–435688）

```js
const onBlur = (event) => {
  if (event.relatedTarget instanceof Node
      && (rootRef.current?.contains(event.relatedTarget) === true
       || menuRef.current?.contains(event.relatedTarget) === true)) return;
  close();      // 注意：不恢复焦点
};
```

### 4.7 打开 / 关闭 / 焦点返回

```js
const show = () => {                                  // 435590–435599
  setSelectionFocus(false);
  triggerRef.current?.focus();
  setQuery(""); setHighlightedIndex(null);
  if (state.current === null) paneFocus.current = "drill";
  setPane(state.current === null ? "model" : "root");  // 未选模型 → 直接进模型列表
  setOpen(true);
  reload();
};

const close = (restoreFocus = false) => {              // 435604–435610
  setOpen(false);
  setPane("root");
  if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus(); });
};

const closeAfterSelection = () => {                    // 435611–435614
  setSelectionFocus(true);                             // → data-selection-focus，抑制 focus ring
  close(true);
};
```

焦点归还 intent 机制（435516–435536）：`paneFocus.current` 记 `"drill"` 或 `"effort"/"model"`（`back(from)` 用 `from`），
在下一次 effect 里执行。`"drill"` → 优先聚焦已选中 radio，否则第一个可用项；
`"back"` → 聚焦 `itemRefs.current[intent === "effort" ? 1 : 0]`（**cell 索引 1 = 档位 cell**）。

### 4.8 选中失败提示（435689–435701）

```js
const settleSelection = (result) => {
  if (result === void 0) return;
  if (result.ok) { if (rootRef.current !== null) closeAfterSelection(); return; }
  const { error } = result;
  toastSeq.current += 1;
  setToast({
    seq: toastSeq.current,
    text: error.code === "session/writer-held"
      ? t("error.sessionInUse")
      : t("error.action", { message: `${error.code}: ${error.message}` })
  });
};
```

Toast 的 `anchor` 即 §2.9 的 `closest("[data-composer-card]")`。

### 4.9 其他细节

- 输入法组合期间忽略按键：`if (event.nativeEvent.isComposing) return;`（435633）。
- 模型面板选中项滚动入视野：`itemRefs.current[activeModelIndex]?.scrollIntoView({ block: "nearest" })`（435547–435553）。
- 行 hover：`onMouseMove` 里，非搜索模式下直接 `itemRefs.current[index]?.focus()`；搜索模式下 `setHighlightedIndex(index)`（435914–435917）。
- `busy`（`pending !== null`）期间所有行 `disabled`，trigger 显示 `StateDot state="ongoing"` 替代 chevron。

---

## 5. i18n key 清单与 `t()` 用法

### 5.1 命名空间与注册（436101–436123）

```js
const NS = "model";                                   // 436102

ctx.effect(() => ctx.locale.register(NS, { zh, en }),
           "ui-model-selection: dictionaries");       // 436119–436122

const t = ctx.locale.bind(NS);                        // 436123
```

槽位注册时也带上 `locale: NS`（436166）。**插件的 `t()` 应绑定自己的 NS**，不要复用 `model`。

### 5.2 完整 key 清单（zh = key-set 唯一真相，436004–436028；en 436030–436054）

| key | zh | en |
| --- | --- | --- |
| `provider.account` | `DeepSeek 账号` | `DeepSeek Account` |
| `command.label` | `模型` | `Model` |
| `command.description` | `选择本会话使用的模型` | `Select the model for this conversation` |
| `option.loadError` | `目录加载失败：{message}` | `Catalog failed to load: {message}` |
| `trigger.fallback` | `请选择模型` | `Select model` |
| `trigger.loading` | `正在加载模型…` | `Loading models…` |
| `trigger.selectAria` | `请选择模型` | `Select model` |
| `trigger.aria` | `选择模型，当前 {model}` | `Select model, current {model}` |
| `trigger.ariaEffort` | `选择模型，当前 {model}，推理等级 {effort}` | `Select model, current {model}, reasoning effort {effort}` |
| `menu.aria` | `模型与推理等级` | `Model and reasoning effort` |
| `menu.model` | `模型` | `Model` |
| `menu.effort` | `推理等级` | `Effort` |
| **`effort.providerDefault`** | **`Default`** | **`Default`** |
| `status.loading` | `正在刷新模型列表…` | `Refreshing model list…` |
| `error.action` | `模型操作失败：{message}` | `Model operation failed: {message}` |
| `error.sessionInUse` | `当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），请退出其他正在运行的 DSH 后重试。` | `This session is already in use, possibly by another running DSH instance (such as dsh web or the desktop app). Quit other running DSH instances and try again.` |
| `action.reload` | `重新加载` | `Reload` |
| `warning.groupLoad` | `{name} 加载失败：{message}` | `{name} failed to load: {message}` |
| `search.placeholder` | `搜索模型…` | `Search models…` |
| `search.clear` | `清除搜索` | `Clear search` |
| `search.empty` | `没有匹配的模型。` | `No matching models.` |
| `empty.models` | `没有可用的模型。` | `No models available.` |
| `empty.efforts` | `当前模型未提供推理等级。` | `This model provides no reasoning effort levels.` |
| `retry` | ⚠️ **见下** | ⚠️ **见下** |

> ⚠️ **`t("retry")` 是孤儿 key**：模型面板的错误条用 `t("retry")`（435874、435886），
> 但 zh/en 字典里**没有 `retry` 键**（只有 `action.reload`）。同一个 UI 的 effort 面板错误条用的是
> `t("action.reload")`（435953）。**这是官方的一处不一致（潜在 bug）**。
> 插件复刻时应统一用 `action.reload` 风格的键，不要照抄 `retry`。

`effort.providerDefault` 在 zh 与 en 下**都是 `"Default"`**（436017、436043）——
即中文界面下这一行也显示英文 "Default"，而不是「默认」。

### 5.3 `t()` 调用点与插值用法

| 位置 | 调用 | 锚点 |
| --- | --- | --- |
| 触发器 aria | `t("trigger.aria", { model })` / `t("trigger.ariaEffort", { model, effort })` | 435730–435733 |
| 档位标签 | `t("effort.providerDefault")` | 435480、435484 |
| 根面板 | `t("menu.model")` / `t("menu.effort")` | 435807、435826 |
| 菜单 aria | `t("menu.aria")` | 435793 |
| 空态 | `t("empty.efforts")` | 435957 |
| 搜索 | `t("search.placeholder")` / `t("search.clear")` | 435843/435846、435855 |
| 错误 | `t("error.action", { message })` / `t("error.sessionInUse")` | 435699、435870、435948 |
| 分组标题 | `t("provider.account")` | 435879、435898 |
| 警告 | `t("warning.groupLoad", { name, message })` | 435879–435881 |
| 空模型 | `t(choices.length === 0 ? "empty.models" : "search.empty")` | 435944 |
| 命令贡献 | `t("command.label")` / `t("command.description")` | 436131–436132 |

**插值语法是 `{name}` 占位符**（如 `"选择模型，当前 {model}"` → `t("trigger.aria", { model: modelLabel })`）。

### 5.4 命令贡献（`/model`，436129–436159）

```js
scope.effect(() => command.register({
  name: "model",
  label: () => t("command.label"),
  description: () => t("command.description"),
  icon: IconDataOutlineRegular,
  available: (session) => sessions.subagentAddress(session.sessionId) === void 0,
  ui: {
    kind: "popupSelect",
    searchMode: "fuzzy-label",
    searchLabels: () => ({
      placeholder: t("search.placeholder"),
      empty: t("empty.models"),
      noResults: t("search.empty")
    }),
    options: async (session) => optionsOf(await models.directoryFor(session.sessionId).load(), t),
    onSelect: async (option, session) => { /* … */ }
  }
}), "ui-model-selection: /model contribution");
```

---

## 6. 与 DESIGN.md 的差异清单（实现时必须修正）

| DESIGN.md 的说法 | 官方实际 | 锚点 |
| --- | --- | --- |
| 弹层用 `--dsw-specific-menu` | 用 `MenuSurface` → `--dsw-menu-surface-fill` + `--dsw-menu-backdrop-filter` | 446219–446220 |
| 弹层用 `--dsw-shadow-lv3` | 用 `--dsw-elevation-prominent`（含 0.5px stroke + 3 层阴影） | 435342 |
| 「触发器与官方完全一致…无多余框」 | 官方 trigger 有 `:hover` 背景 `--dsw-alias-interactive-bg-hover`、`:focus-visible` 2px box-shadow | 435342 |
| chip 是「模型名旁小字档位 chip」 | 档位**不是独立胶囊**，只是同一 button 内的 `span.triggerEffort`（`color:label-caption`，13px） | 435780–435783 |
| 未选模型时 chip 隐藏档位 | 切到非推理模型时显示**上一个模型的残留档位**（`retainedEffort`） | 435480、435235 |
| 选中项有选中背景 | `.wq12jW_selected{background:0 0}` —— 选中**只有右侧 check 图标** | 435342 |
| `retry` 之类的键可直接用 | 官方 `t("retry")` 是**孤儿 key**；应统一用 `action.reload` | 435874 vs 435953 |

**其余 DESIGN.md 结论均与源码一致**：`effectiveEffort` 公式（435479）、「默认(跟随 provider)」空值项条件（435481–435484）、
`effort.providerDefault`（436017）、槽位 `conversation.input.model`（436164）、
`directory.select({provider, model, reasoningEffort})`（436152）、`--dsw-alias-*` 系 token 用法。

---

## 附：文件级索引

| 区域 | 内容 | 行号 |
| --- | --- | --- |
| `ModelDirectory` 数据层 | 快照、`retainedEffort`、`pending` | 435210–435265 |
| `ModelDirectoryResolver` 服务 | `super(ctx, "modelDirectories")`、`directoryFor(sessionId)` | 435268–435325 |
| `clsx` 内联副本 | | 435326–435339 |
| **CSS 单行（4888 字符）** | 全部 `wq12jW_*` 规则 | **435342** |
| class 名映射表 | `ModelSelect_module_css_default` | 435351–435381 |
| `orderModelProviders` | `deepseek-account` → 0，`deepseek-official` → 1 | 435390–435392 |
| `ModelSelect` 组件 | 全部 UI 逻辑 | 435394–435991 |
| `locales.js` | zh/en 字典 | 435993–436055 |
| `rowId` / `optionsOf` / `selectionOf` | 命令面板适配 | 436057–436100 |
| `NS` / `inject` / `apply` | 插件入口 | 436101–436181 |
| `exports` | `ModelDirectory`、`ModelDirectoryResolver`、`apply`、`inject` | 436183–436187 |
| 宿主半区 | 空 `apply() {}` | 436191–436201 |
| `package.json` | 版本 / exports / `dsh.client.inject` | 436202–436273 |
| `MenuSurface` 原语 | 菜单材质 + macOS backing | 451412–451442 |
| `MenuGroup` | 吸顶分组 | 451913–451935 |
| `observeStickyMenuGroups` | Intersection/Resize 观察 | 451945–451990 |
| 菜单材质 CSS | `.surface/.material/.backing/.heading` | 446170–446242 |
| 设计 token（圆角/字体） | `base_css_default` | 698051 |
| 设计 token（色板/别名） | `design_platform_css_default` | 698057 |
| 焦点环 | `focus_css_default` | 698060 |
| 滚动条 | `scrollbar_css_default` | 698066 |
| 阴影 / 层级 / 菜单模糊 | `gradient_shadow_text_css_default` | 698069 |
| 样式规范原文 | menu material 与 `--dsw-specific-menu` 的区别 | 696680 / 696818 |
| composer 窄容器降级文档 | `--dsh-composer-model-*` | 403251 / 403423 / 735732 |
| `data-composer-card` 定义 | InputBar card div | 420990 |
| `conversation.input.model` 渲染点 | `standardControls` | 421078 |
| 槽位声明 | `single` / `session` | 421867–421870 |
