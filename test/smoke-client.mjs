/**
 * test/smoke-client.mjs —— 浏览器半侧装载冒烟测试
 *
 * 用一个最小沙箱（假 window / require / fetch / document / slots）真的执行 lib/client.js。
 *
 * 通道事实（DESIGN.md §7A，2026-10-15 实机验收）：Module Loader 包通道**没有**
 * `host` 全局、**没有** `styles` 全局；Host 通信走同源 fetch，样式走
 * document.head.appendChild(style)。因此本沙箱刻意不提供 host / styles，
 * 并断言它们不存在——这是防回归的关键一条。
 *
 * 验证：
 *   1. 模块能被 ModuleLoader 工厂正确求值并返回 exports
 *   2. exports.apply / exports.inject 形状正确，settings.section 注册形状不变
 *   3. 数据通路：首屏 1 次 GET；POST body 为 {method,args}；写 override 只带 efforts
 *   4. 失败路径：{ok:false,error} 与网络异常都变成可展示文案，不抛异常
 *
 * 运行：node test/smoke-client.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.join(HERE, '..', 'lib', 'client.js')
const SOURCE = fs.readFileSync(CLIENT, 'utf8')

const API = '/dsh-thinking-effort/api'

/* ── 最小 React 替身：createElement 记录调用，支持函数组件就地求值 ──────── */

function createElement(type, props, ...children) {
  const flat = []
  for (const child of children) {
    if (Array.isArray(child)) flat.push(...child)
    else if (child !== null && child !== undefined && child !== false) flat.push(child)
  }
  return { type, props: props || {}, children: flat }
}

/** 深度渲染：函数组件递归展开，只为拿到可断言的朴素树。 */
function render(node) {
  const tree = renderInner(node)
  attachRefs(tree)
  return tree
}

function renderInner(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (typeof node.type === 'function') return renderInner(node.type(node.props))
  return {
    type: typeof node.type === 'string' ? node.type : String(node.type),
    props: node.props,
    children: node.children.map(renderInner)
  }
}

/* ── 假 DOM 节点 + ref 挂载 ───────────────────────────────────────────────
   真实 React 在 commit 阶段把 DOM 节点写进 ref；本替身必须补上这一步，
   否则组件内的 sliderRef/menuRef 永远是 null，指针拖动等路径无法被测到。
   所有节点共用同一桩（宽 100px、左边界 0），使 0–1000 的坐标换算可预测。 */
const FAKE_NODE = {
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 }),
  focus() {},
  contains() { return false },
  setPointerCapture() {},
  releasePointerCapture() {},
  addEventListener() {},
  removeEventListener() {},
  offsetWidth: 300,
  offsetHeight: 200
}

function attachRefs(node) {
  if (!node || typeof node !== 'object') return
  const r = node.props && node.props.ref
  if (typeof r === 'function') r(FAKE_NODE)
  else if (r && typeof r === 'object') r.current = FAKE_NODE
  if (Array.isArray(node.children)) node.children.forEach(attachRefs)
}

/** 收集树中所有文本节点。 */
function textOf(node, out = []) {
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (node && Array.isArray(node.children)) node.children.forEach((c) => textOf(c, out))
  return out
}

/** 收集树中指定 tag 的节点。 */
function nodesOf(node, tag, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.type === tag) out.push(node)
  if (Array.isArray(node.children)) node.children.forEach((c) => nodesOf(c, tag, out))
  return out
}

/* ── React hooks 替身：固定顺序的一次性求值 ─────────────────────────────── */

let hookCursor = 0
const hookStates = []
let effectSeq = 0
const effectSeen = new Set()
/* 挂载世代：resetHooks() 递增。真实 React 里组件卸载后的 setState 会被丢弃，
   而本替身只有一份全局 hook 槽 —— 若不做世代校验，上一次挂载遗留的 Promise
   结算时会写进下一个组件的槽位（把 prev 写成 null）而误报崩溃。 */
let hookEpoch = 0

const React = {
  createElement,
  useState(initial) {
    const i = hookCursor++
    const epoch = hookEpoch
    if (!(i in hookStates)) hookStates[i] = typeof initial === 'function' ? initial() : initial
    return [hookStates[i], (next) => {
      if (epoch !== hookEpoch) return   // 已卸载实例的迟到更新：丢弃
      hookStates[i] = typeof next === 'function' ? next(hookStates[i]) : next
    }]
  },
  // 真执行 effect：浏览器半在 useEffect 里拉数据，测试需要这个副作用真实发生。
  // 依赖数组按调用点区分：数组非空即视为「已挂载过」，只跑一次。
  useEffect(fn, deps) {
    const key = deps ? deps.join('|') : String(effectSeq++)
    if (effectSeen.has(key)) return
    effectSeen.add(key)
    fn()
  },
  useCallback(fn) { return fn },
  // 浮层用 ref 存 DOM 引用与代次计数器；沙箱无 DOM，返回稳定空壳即可。
  useRef(initial) {
    if (!hookStates[hookCursor]) hookStates[hookCursor] = { current: initial }
    return hookStates[hookCursor++]
  }
}

/** 重跑组件但保留上次的 hook 状态（模拟一次真实重渲染）。 */
function rerender() {
  hookCursor = 0
}

/** 完全重置（模拟组件首次挂载）。 */
function resetHooks() {
  hookCursor = 0
  hookStates.length = 0
  effectSeen.clear()
  effectSeq = 0
  hookEpoch += 1
}

/** 放空微任务队列，让 fetch 的 Promise 链结算完。 */
async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0))
}

/* ── 假 fetch：实现 §7C 冻结契约 ──────────────────────────────────────── */

/** GET 响应形状：{ok:true, ...getState()}（快照字段摊在顶层）。 */
const GET_STATE = {
  ok: true,
  available: true,
  configFile: '~/.dsh/thinking-effort.json',
  config: { enabled: true, mode: 'auto', probe: false },
  overrides: {},
  levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  planned: [
    { route: 'deepseek', modelId: 'deepseek-v4.1-flash', source: 'knowledge', efforts: { off: null, low: 'low', high: 'high', max: 'max' }, defaultEffort: 'off' }
  ],
  rules: [{ id: 'deepseek-v4.1-flash', vendor: ['deepseek'], model: ['v4.1-flash'], efforts: { off: null, low: 'low', high: 'high', max: 'max' } }]
}

const requests = []   // 全部请求 {url, method, body}
let getCount = 0      // GET 次数
let failMode = null   // null | {kind:'http', status, error} | {kind:'network', message}

function jsonResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(payload)
  }
}

function fakeFetch(url, init) {
  const method = (init && init.method) || 'GET'
  const body = (init && init.body) || null
  requests.push({ url, method, body })

  if (failMode && failMode.kind === 'network') return Promise.reject(new Error(failMode.message))
  if (failMode && failMode.kind === 'http') return Promise.resolve(jsonResponse(failMode.status, { ok: false, error: failMode.error }))

  if (method === 'GET') {
    getCount += 1
    return Promise.resolve(jsonResponse(200, GET_STATE))
  }

  const { method: name, args } = JSON.parse(body)
  if (name === 'setConfig') {
    return Promise.resolve(jsonResponse(200, { ok: true, data: { config: Object.assign({}, GET_STATE.config, args) } }))
  }
  if (name === 'setOverrides') {
    return Promise.resolve(jsonResponse(200, { ok: true, data: { overrides: args.overrides } }))
  }
  if (name === 'rescan') return Promise.resolve(jsonResponse(200, { ok: true, data: { result: { skipped: 0 } } }))
  if (name === 'probe') return Promise.resolve(jsonResponse(200, { ok: true, data: { reason: '探测完成（假实现）。' } }))
  return Promise.resolve(jsonResponse(400, { ok: false, error: 'unknown method ' + name }))
}

/* ── 假 document：样式必须走 head.appendChild ─────────────────────────── */

const styleTags = []
const documentStub = {
  // body 存在 = 完整渲染分支（浮层菜单挂载）；真·无 DOM 才走 data-teff-placeholder。
  body: {},
  activeElement: null,
  head: { appendChild: (node) => { styleTags.push(node) } },
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tagName) => ({
    tagName,
    attrs: {},
    textContent: '',
    setAttribute(k, v) { this.attrs[k] = v }
  })
}

/* ── 假 slots 记录注册 ────────────────────────────────────────────────── */

const registrations = []
const slots = {
  inject(name, fn) { registrations.push({ slot: name, register: fn }) },
  register(meta, renderFn) { registrations.push({ meta, render: renderFn }); return { meta, render: renderFn } }
}

/* ── 沙箱（刻意不给 host / styles）────────────────────────────────────── */

const sandbox = {
  window: {
    // 浮层在 open 时挂 scroll(capture)/resize 重定位监听；沙箱给空实现。
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1200,
    innerHeight: 800,
    __ModuleLoader__: {
      load(spec) {
        sandbox.__loaded = spec.factory(() => React)
      }
    }
  },
  fetch: fakeFetch,
  document: documentStub,
  console,
  Promise,
  Object,
  Array,
  String,
  Number,
  Boolean,
  JSON,
  Symbol,
  Error
}
sandbox.globalThis = sandbox

vm.createContext(sandbox)
vm.runInContext(SOURCE, sandbox, { filename: CLIENT })

/* ── 关键回归：包通道没有 host / styles 全局（§7A）────────────────────── */

assert.equal(
  vm.runInContext('typeof host', sandbox), 'undefined',
  '回归断言：真实包通道没有 host 全局，client.js 不得依赖它'
)
assert.equal(
  vm.runInContext('typeof styles', sandbox), 'undefined',
  '回归断言：真实包通道没有 styles 全局，样式必须走 document'
)

const pluginModule = sandbox.__loaded
assert.ok(pluginModule, 'factory 应返回 module.exports')
assert.equal(typeof pluginModule.apply, 'function', '应导出 apply')
assert.deepEqual(Array.from(pluginModule.inject), ['slots', 'connection'], 'inject 应含 slots 与 connection')

/* ── 假 connection 服务（浮层的模型目录来源）────────────────────────────
   浮层不用 fetch，而是 ctx.get('connection').api.session.modelCatalog()。
   目录形态刻意各异：m1 两档带 defaultEffort，m3 无 reasoning。 */
const overlayCatalog = {
  current: { provider: 'deepseek-account', model: 'm1' },
  retainedEffort: undefined,
  failures: [],
  groups: [
    {
      id: 'deepseek-account',
      name: '账号模型',
      models: [
        { id: 'm1', name: '模型一', reasoning: { efforts: [{ id: 'off', name: '关闭' }, { id: 'xhigh', name: '超高' }], defaultEffort: 'xhigh' } },
        { id: 'm3', name: '模型三' }
      ]
    }
  ]
}
const selectModelCalls = []
const fakeConnection = {
  api: {
    session: {
      modelCatalog: () => Promise.resolve({ result: { value: overlayCatalog } }),
      selectModel: (req) => { selectModelCalls.push(req); return Promise.resolve({ result: { value: { selected: req } } }) }
    }
  }
}
const pluginCtx = {
  slots,
  get: (name) => (name === 'connection' ? fakeConnection : undefined),
  on: () => () => {}
}

const disposer = pluginModule.apply(pluginCtx)
assert.equal(typeof disposer, 'function', 'apply 应返回 disposer')
assert.doesNotThrow(() => disposer())

/* ── 样式注入走 document.head.appendChild ─────────────────────────────── */

/* settings.section 走 ctx.effect 兜底注入；浮层 CSS 走同一兜底 → 共 2 个 tag */
assert.ok(styleTags.length >= 1, 'apply 应通过 document.head.appendChild 注入 CSS')
assert.ok(
  styleTags.some((t) => t.attrs['data-plugin-css'] === 'dsh-thinking-effort'),
  '面板样式标签应带稳定标记 dsh-thinking-effort'
)
assert.ok(
  styleTags.some((t) => t.attrs['data-plugin-css'] === 'dsh-thinking-effort-overlay'),
  '浮层样式标签应带稳定标记 dsh-thinking-effort-overlay'
)
assert.ok(styleTags.some((t) => t.textContent.includes('.__te_root')), '样式内容应为面板 CSS')
assert.ok(styleTags.some((t) => t.textContent.includes('.teff-root')), '样式内容应含浮层 CSS（teff- 前缀）')

/* ── 回归：弹层尺寸上限（用户 m03904「界面过于巨大，太丑了」）─────────────────
   这些断言从真实注入的 CSS 文本里提取数值，改回巨字号/巨宽度必须报错。 */
const overlayCss = (styleTags.find((t) => t.attrs['data-plugin-css'] === 'dsh-thinking-effort-overlay') || {}).textContent || ''
assert.ok(overlayCss.length > 0, '应能拿到浮层 CSS 文本用于尺寸回归断言')

function cssRule(sel) {
  /* 精确匹配选择器：'.teff-slider__label' 不能误命中容器 '.teff-slider__labels'
     （indexOf 不做词边界，会把后者的规则体当成前者的）。 */
  const probe = new RegExp(
    '(?:^|[},])\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{'
  )
  const m = probe.exec(overlayCss)
  if (!m) return ''
  const open = overlayCss.indexOf('{', m.index + m[0].length - 1)
  const close = overlayCss.indexOf('}', open)
  return open < 0 || close < 0 ? '' : overlayCss.slice(open + 1, close)
}
function cssNum(text, prop) {
  const m = text.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([0-9.]+)px'))
  return m ? Number(m[1]) : null
}

const popupModelRule = cssRule('.teff-popup__model')
const modelFontSize = cssNum(popupModelRule, 'font-size')
assert.ok(modelFontSize !== null, '回归断言：必须能在 CSS 里找到 .teff-popup__model 的 font-size')
assert.ok(
  modelFontSize <= 16,
  '回归断言：弹层大字行字号不得大于 16px（当前 ' + modelFontSize + 'px）——用户 m03904「模型名称字体太大了」'
)
const popupLevelFontSize = cssNum(cssRule('.teff-popup__level'), 'font-size')
assert.ok(popupLevelFontSize !== null && popupLevelFontSize <= 13, '弹层小字行字号不得大于 13px')

const popupWidthRule = cssRule('.teff-menu--popup')
const widthCap = popupWidthRule.match(/max-width\s*:\s*min\(\s*([0-9.]+)px/)
assert.ok(widthCap, '回归断言：.teff-menu--popup 必须用 min(<上限>px, calc(100vw - 24px)) 限宽')
assert.ok(
  Number(widthCap[1]) <= 340,
  '回归断言：弹层 max-width 不得大于 340px（当前 ' + widthCap[1] + 'px）——否则内容显示不完全'
)

/* 闪电两态：开启态必须有蓝填充 + 淡蓝底；关闭态是空心描边（用户 m03925 定稿） */
const flashOnRule = cssRule('.teff-popup__iconbtn--flash[aria-pressed="true"]')
assert.ok(flashOnRule.length > 0, '回归断言：必须有闪电开启态规则 .teff-popup__iconbtn--flash[aria-pressed="true"]')
assert.ok(/background/.test(flashOnRule), '开启态闪电必须有淡蓝底色（否则用户看不出它是开着的）')
assert.ok(
  overlayCss.includes('.teff-popup__iconbtn--flash[aria-pressed="true"] svg path'),
  '回归断言：开启态必须有 svg path{fill:currentColor}（闪电「填充=开启」，m02593）'
)
const flashOffRule = cssRule('.teff-popup__iconbtn--flash svg')
assert.ok(/fill\s*:\s*none/.test(flashOffRule), '回归断言：闪电默认（关闭态）必须 fill:none（无填充=关闭）')
assert.ok(/stroke-width/.test(flashOffRule), '闪电关闭态必须有描边宽度（否则白底上看不见，m03904「闪电标显示不出来」）')

/* ── 回归：档位标签必须以刻度为中心（用户 m04522「字对不上挡位」）─────────────
   刻度与滑块都用同一个 left 锚点 + translate(-50%) 做居中补偿；标签此前漏了补偿，
   于是「左边缘」压在刻度「中心」上 → 文字整体右偏半个自身宽度、宽词挤住下一个刻度。 */
const labelRule = cssRule('.teff-slider__label')
assert.ok(labelRule.length > 0, '回归断言：必须存在 .teff-slider__label 规则')
assert.ok(
  /transform\s*:\s*translateX\(\s*-50%\s*\)/.test(labelRule),
  '回归断言：.teff-slider__label 必须 translateX(-50%) 居中，否则标签左边缘压在刻度中心上（m04522「字对不上挡位」）'
)
/* 刻度本身也有居中补偿 —— 两者必须同源，否则断言会各自漂移 */
assert.ok(
  /translate\(\s*-50%\s*,\s*-50%\s*\)/.test(cssRule('.teff-slider__tick')),
  '刻度必须 translate(-50%,-50%)：标签的居中语义要与刻度一致'
)

/* ── 回归：模型列表必须真能滚动（用户 m05519「模型选择应该像官方一样，是可以滑动选择的」）──
   菜单是 flex column + overflow:hidden 的定型盒。若 menu 与滚动区之间缺了 flex 链路
   （官方对应 .scrollable/.viewport），中间容器会因 min-height:auto 撑满内容高度，
   .teff-groups 的 min-height:0 失去参照 → overflow-y:auto 永不激活，
   列表被 max-height:min(360px,…) 一刀切且没有滚动条（截图里看不到后三组 provider）。 */
const viewportRule = cssRule('.teff-viewport')
assert.ok(viewportRule.length > 0, '回归断言：必须存在 .teff-viewport（menu ↔ 滚动区之间的 flex 链路）')
assert.ok(/display\s*:\s*flex/.test(viewportRule), '.teff-viewport 必须 display:flex(否则子项拿不到定高参照)')
assert.ok(
  /min-height\s*:\s*0/.test(viewportRule),
  '回归断言：.teff-viewport 必须 min-height:0 —— 否则 flex 子项不肯收缩、滚动永不激活（m05519）'
)
assert.ok(/flex\s*:\s*1\s+1\s+auto/.test(viewportRule), '.teff-viewport 必须 flex:1 1 auto 填满菜单剩余高度')

const groupsRule = cssRule('.teff-groups')
assert.ok(
  /overflow-y\s*:\s*auto/.test(groupsRule),
  '回归断言：.teff-groups 必须 overflow-y:auto（模型列表的滚动容器）'
)
assert.ok(
  /flex\s*:\s*1\s+1\s+auto/.test(groupsRule),
  '回归断言：.teff-groups 必须 flex:1 1 auto —— 只有拿到确定高度，overflow-y:auto 才会激活（m05519）'
)

/* 分组标题吸顶：CSS 只做 sticky 定位；底色由 data-stuck 驱动（原位透明），对齐官方 asar:446157-446193 */
const groupLabelRule = cssRule('.teff-groupLabel')
assert.ok(
  /position\s*:\s*sticky/.test(groupLabelRule),
  '回归断言：.teff-groupLabel 必须 position:sticky（分组标题吸顶，对齐官方）'
)
assert.ok(/top\s*:\s*0/.test(groupLabelRule), '.teff-groupLabel 吸顶位置必须是 top:0')
assert.ok(
  overlayCss.includes('.teff-groupLabel[data-stuck]'),
  '回归断言：必须有 .teff-groupLabel[data-stuck] 底色规则（吸顶时才铺 --dsw-alias-menu-group-header-fill）'
)
assert.ok(
  !/background\s*:\s*(?!0 0)/.test(groupLabelRule.split('data-stuck')[0].replace(/background\s*:\s*0 0/, '')),
  '.teff-groupLabel 原位背景必须透明（只有 data-stuck 才上底色）'
)



const section = registrations.find((r) => r.slot === 'settings.section')
assert.ok(section, '应向 settings.section 槽注册')

const registration = section.register()
assert.equal(registration.meta.id, 'dsh-thinking-effort', 'registration id 必须等于 loader entry 名')
assert.equal(registration.meta.order, 27, 'order 应为 27')
assert.equal(registration.meta.label, '思考强度', 'label 应为「思考强度」')

/* conversation.input.model：本卡已实现浮层顶替，必须注册 single 槽 */
const modelSlot = registrations.find((r) => r.slot === 'conversation.input.model')
assert.ok(modelSlot, '浮层卡：应注册 conversation.input.model 槽')

const modelReg = modelSlot.register()
assert.equal(modelReg.meta.name, 'conversation.input.model', 'meta.name 应为槽名')
assert.equal(typeof modelReg.meta.inject, 'function', 'meta.inject(sessionId) 应为函数')
const injectArgs = modelReg.meta.inject('sess-1')
assert.equal(injectArgs.sessionId, 'sess-1', 'inject 应回传 sessionId')

/* 沙箱带 documentStub，浮层走完整渲染分支（div.teff-root + button.teff-trigger）；
   真·无 DOM 环境才走 data-teff-placeholder 占位分支。两种形态都断言 trigger 语义。 */
resetHooks()
const overlayTree = render(modelReg.render({ sessionId: 'sess-1' }))
const overlayRoots = nodesOf(overlayTree, 'div').filter((n) => {
  const cls = n.props && n.props.className
  return typeof cls === 'string' && cls.split(' ').includes('teff-root')
})
assert.ok(overlayRoots.length >= 1, '浮层应渲染 teff-root 根节点（完整或占位分支）')
const overlayTrigger = nodesOf(overlayTree, 'button').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-trigger')
)
assert.ok(overlayTrigger, '浮层根内应有 teff-trigger 触发按钮（顶替官方 chip）')
assert.equal(overlayTrigger.props['aria-haspopup'], 'menu', 'trigger 语义：aria-haspopup=menu')

/* ── 回归：chip 里的图标必须真有 SVG（用户 m03951 第三张图：空间不足时只剩箭头）──
   官方在无法同行时隐藏文本 span、只留图标；我们此前渲染的是空 span，降级后一片空白。
   图标必须由 composer 写入 --dsh-composer-model-icon-display:block 时才显示。 */
const triggerIcons = nodesOf(overlayTrigger, 'svg').filter(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-triggerIcon')
)
assert.equal(triggerIcons.length, 1, '回归断言：trigger 内必须有 .teff-triggerIcon 的 SVG（空 span 会让降级形态无图标）')
assert.equal(triggerIcons[0].props.viewBox, '0 0 16 16', '图标应复用官方徽标视箱 0 0 16 16')
assert.equal(triggerIcons[0].props.width, 16, '图标尺寸应为 16（与官方 IconDataOutlineRegular size=16 一致）')
const iconPaths = nodesOf(triggerIcons[0], 'path')
assert.equal(iconPaths.length, 2, '官方 DataOutline 图标是两条 path（实心 + 描边）')
assert.ok(
  iconPaths.every((p) => typeof p.props.d === 'string' && p.props.d.length > 40),
  '两条 path 都必须带真实官方 d 路径（不得是占位空路径）'
)
assert.ok(
  overlayCss.includes('.teff-triggerIcon') && overlayCss.includes('--dsh-composer-model-icon-display'),
  '回归断言：.teff-triggerIcon 的显隐必须由官方 --dsh-composer-model-icon-display 变量门控'
)
const overlayLabel = textOf(overlayTree).join(' | ')
/* 沙箱 useEffect 同步执行：首帧 catalog 仍为初始 loading（setCatalog 不触发重渲染），
   故 label 为「加载中…」；无 conn 时 effect 落 error、无 current 时最终态为「选择模型」。 */
assert.ok(
  overlayLabel.includes('加载中…') || overlayLabel.includes('选择模型'),
  '浮层首帧 trigger label 应为 加载中…（loading）或 选择模型（无 current）'
)

/* ── 回归：root pane 必须真正渲染（曾整段丢失 → 已选中模型后菜单变空盒子）──
   用户可见路径：catalog 有 current 时打开 chip，pane 为 'root'，菜单必须渲染
   「模型」「思考强度」两行 cell；修复前 root pane 分支缺失，菜单为空。 */
resetHooks()
render(modelReg.render({ sessionId: 'sess-1' }))   // 挂载：effect 拉目录
await flush()
rerender()
const opened0 = render(modelReg.render({ sessionId: 'sess-1' }))  // 目录已就绪，current 非空
const triggerBtn = nodesOf(opened0, 'button').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-trigger')
)
assert.ok(triggerBtn && typeof triggerBtn.props.onClick === 'function', 'trigger 应可点击')
triggerBtn.props.onClick()                        // 打开（current 非空 → pane='root'）
rerender()
const openedTree = render(modelReg.render({ sessionId: 'sess-1' }))
const menuNodes = nodesOf(openedTree, 'div').filter(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-menu')
)
assert.equal(menuNodes.length, 1, '打开后应有 1 个 teff-menu')
const menuChildren = menuNodes[0].children.filter((c) => c !== null && c !== undefined)
assert.ok(
  menuChildren.length > 0,
  '回归断言：pane=root 时菜单不得为空盒子（root pane 未渲染的 P0）'
)
const cells = nodesOf(menuNodes[0], 'button').filter(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-cell')
)
assert.equal(cells.length, 2, 'root pane 应渲染「模型」「思考强度」两行 cell')
const cellText = textOf(menuNodes[0]).join(' | ')
assert.ok(cellText.includes('模型'), 'root pane 应有「模型」cell')
assert.ok(cellText.includes('思考强度'), 'root pane 应有「思考强度」cell')
assert.ok(cellText.includes('超高'), '「思考强度」cell 应显示当前档位名（来自服务端 efforts.name）')
/* 两个 cell 必须能分别 drill 进各自 pane */
const cellModel = cells.find((c) => textOf(c).join('').includes('模型'))
const cellEffort = cells.find((c) => textOf(c).join('').includes('思考强度'))
assert.ok(cellModel && typeof cellModel.props.onClick === 'function', '「模型」cell 应可点击进 model pane')
assert.ok(cellEffort && typeof cellEffort.props.onClick === 'function', '「思考强度」cell 应可点击进 effort pane')
cellEffort.props.onClick()
rerender()
const effortTree = render(modelReg.render({ sessionId: 'sess-1' }))
const effortText = textOf(effortTree).join(' | ')
assert.ok(
  effortText.includes('off') && effortText.includes('超高'),
  'drill 进 effort pane 应列出该模型两档；官方 off 档统一显示为 off（用户裁决 m02779）'
)

/* ── Codex 风格档位弹层（DESIGN.md §0.3）：居中档位名 + 模型名 + 胶囊滑杆 ──
   铁律：完全按服务端 efforts 渲染，不假设七档、不假设存在 max。
   fixture 的 m1 只有 off/xhigh 两档（且无 max），正是用来钉死这条。 */
const popupNode = nodesOf(effortTree, 'div').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-popup')
)
assert.ok(popupNode, 'effort pane 应渲染 Codex 风格弹层（.teff-popup）')
assert.ok(
  typeof popupNode.props.className === 'string' && popupNode.props.className.includes('teff-popup--open'),
  '弹层打开时应带 teff-popup--open（动画门控依赖此类）'
)
const popupText = textOf(popupNode).join(' | ')
assert.ok(popupText.includes('超高'), '弹层应显示当前档位名（来自服务端 efforts.name，非硬编码）')

// 读法 A（用户 m02779）：大字行 = 模型名，下方小字行 = 当前思考强度。
// 用户 m03904：「这个界面过于巨大，太丑了，模型名称字体太大了」「内容显示不完全」
// → 大字行必须收敛到 16px（README 曾把 26px 锁死，是错的），弹层上限不得超 340px。
const popupModelEl = nodesOf(popupNode, 'button').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-popup__model')
)
const popupLevelEl = nodesOf(popupNode, 'div').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-popup__level')
)
assert.ok(popupModelEl, '弹层应有模型名大字行（teff-popup__model）')
assert.ok(popupLevelEl, '弹层应有当前档位小字行（teff-popup__level）')
assert.equal(textOf(popupModelEl).join(''), '模型一', '大字行必须显示模型名（读法 A）')
assert.equal(textOf(popupLevelEl).join(''), '超高', '小字行必须显示当前思考强度（读法 A）')
assert.ok(
  popupNode.children.map((c) => c && c.props && c.props.className).join(',').indexOf('teff-popup__model')
    < popupNode.children.map((c) => c && c.props && c.props.className).join(',').indexOf('teff-popup__level'),
  '回归断言：模型名行必须在档位行之前（读法 A 位置对调，m02779）'
)

// 滑杆：role=slider + aria 值域 0..1000 + aria-valuetext 用档位名
const slider = nodesOf(popupNode, 'div').find((n) => n.props && n.props.role === 'slider')
assert.ok(slider, '弹层应有 role=slider 的胶囊滑杆')
assert.equal(slider.props['aria-valuemin'], 0, '滑杆 aria-valuemin=0')
assert.equal(slider.props['aria-valuemax'], 1000, '滑杆 aria-valuemax=1000')
assert.equal(slider.props['aria-valuetext'], '超高', '滑杆 aria-valuetext 用服务端档位名')
assert.equal(slider.props.tabIndex, 0, '滑杆应可聚焦（键盘操作）')
assert.equal(typeof slider.props.onKeyDown, 'function', '滑杆应支持方向键切档')
assert.equal(typeof slider.props.onPointerDown, 'function', '滑杆应支持指针拖动')

// 节点/标签数量 = effortChoices 长度（常驻 off + 该模型实际档数），不假设七档。
// m1 自己声明了 off 档（efforts=[off,xhigh]）→ 该 off 节点本身就是常驻左端点，
// 不再前置第二个 provider-default（否则会出现两个都叫 off 的节点）→ 2 个节点。
const tickNodes = nodesOf(popupNode, 'span').filter(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-slider__tick')
)
assert.equal(tickNodes.length, 2, '模型自带 off 档时不得再补一个 provider-default（会出双 off），也不得硬编码七档')
const labelNodes = nodesOf(popupNode, 'span').filter(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-slider__label')
)
assert.equal(labelNodes.length, 2, '模型自带 off 档时应只有 2 个档位标签')
// 最左端节点必须叫 off（用户裁决：Default 改名 off；官方 off 档同样统一显示为 off）
assert.equal(
  textOf(labelNodes[0]).join(''), 'off',
  '回归断言：滑杆最左端常驻节点标签必须为 off（不得叫 Default，也不得与官方「关闭」混称）'
)
assert.equal(textOf(labelNodes[1]).join(''), '超高', '后续档位标签用服务端档位名')

// 顶栏只留左上闪电（用户 m05286 删除右上「重置为默认档」）
const iconBtns = nodesOf(popupNode, 'button').filter(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-popup__iconbtn')
)
assert.equal(iconBtns.length, 1, '弹层顶栏应只剩闪电一个图标按钮（右上重置按钮已删）')
assert.equal(
  iconBtns.filter((b) => b.props.className.includes('--refresh')).length, 0,
  '回归断言：右上「重置为默认档」按钮不得再出现（用户 m05286 认定其冗余）'
)
const flashBtn = iconBtns.find((b) => b.props.className.includes('--flash'))
// 闪电 = 开启/关闭思考开关（用户裁决 m02593）：有填充 = 开启，无填充 = 关闭。
// m1 当前生效档 xhigh（非 off）→ 处于开启态：aria-pressed=true、文案为「关闭思考」。
assert.ok(flashBtn && flashBtn.props['aria-pressed'] === true, '闪电按钮应为开关语义（aria-pressed），当前开启档 xhigh → true')
assert.equal(flashBtn.props['aria-label'], '关闭思考', '开启态下闪电 aria-label 应为「关闭思考」')

// 居中模型名可点击 → 回到模型选择
const modelBtn = nodesOf(popupNode, 'button').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-popup__model')
)
assert.ok(modelBtn, '弹层应居中显示模型名（可点击切回模型列表）')
assert.equal(typeof modelBtn.props.onClick, 'function', '模型名应可点击')
assert.ok(textOf(modelBtn).join('').includes('模型一'), '居中模型名应显示当前模型名')

/* ── 星空动画：每一档都有粒子，档位越高轨道越紫、粒子越多（用户定稿）──────────
   m1 当前档为 xhigh（index 1 / count 2，即该模型最高可用档）→ ratio 1。 */
const starsWrap = nodesOf(popupNode, 'div').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-slider__stars')
)
assert.ok(starsWrap, '轨道内应有星空粒子层（.teff-slider__stars）')
const starNodes = nodesOf(starsWrap, 'span').filter(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-star')
)
assert.equal(starNodes.length, 3, '最高可用档应铺满 3 层星（密度最高）')
assert.ok(
  starNodes.every((s) => typeof s.props.style.animationDuration === 'string' && /s$/.test(s.props.style.animationDuration)),
  '每个星层都应带 animationDuration（档位越高漂移越快）'
)

// 轨道渐变：紫端位置随档位推进（最低档 30% → 最高档 100%）
const fillNode = nodesOf(popupNode, 'div').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-slider__fill')
)
assert.ok(fillNode, '轨道应有填充层（.teff-slider__fill）')
assert.equal(fillNode.props.style['--teff-purple-stop'], '100%', '最高可用档时紫端应铺满整条轨道')

// 额度提示只在最高可用档出现（R9：不是硬编码 max）
const hintNode = nodesOf(popupNode, 'div').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-hint')
)
assert.ok(hintNode, '最高可用档应显示额度提示')
assert.ok(textOf(hintNode).join('').includes('更快消耗使用额度'), '额度提示文案应为「更快消耗使用额度」')

// 纯函数：视觉强度必须随档位单调递增（每一档都有粒子，不是只有最高档才有）
const { effortVisual } = pluginModule.__teff_pure
const v0 = effortVisual(0, 4)
const v1 = effortVisual(1, 4)
const v2 = effortVisual(2, 4)
const v3 = effortVisual(3, 4)
assert.equal(v0.starLayers, 1, '最低档也应有 1 层粒子（每一档都有粒子动效）')
assert.ok(v0.starLayers < v1.starLayers && v1.starLayers <= v2.starLayers && v2.starLayers <= v3.starLayers,
  '星层数应随档位单调不减')
assert.ok(v0.purpleStop < v1.purpleStop && v1.purpleStop < v2.purpleStop && v2.purpleStop < v3.purpleStop,
  '紫色占比应随档位严格递增（轨道由蓝渐变为紫）')
assert.ok(v0.starOpacity < v3.starOpacity, '星层亮度应随档位递增')
assert.ok(v0.driftSeconds > v3.driftSeconds, '档位越高粒子漂移越快')
assert.equal(v0.isTop, false, '最低档不应标记为最高可用档')
assert.equal(v3.isTop, true, '最高档应标记为最高可用档（额度提示依据）')
assert.equal(effortVisual(0, 1).isTop, true, '只有一个可用档时它就是最高可用档')

// 拖动/键盘提交：每次都用全新挂载，避免替身的全局 hook 槽在重复开关菜单时错位
const findSlider = (tree) => nodesOf(tree, 'div').find((n) => n.props && n.props.role === 'slider')

/** 全新挂载 → 等目录就绪 → 打开 chip → drill 进「思考强度」，返回该 pane 的渲染树。
    注意：新契约下松手/Enter 提交**不再关闭面板**（用户裁决 m02593），
    所以同一挂载内可以连续断言「提交后又定在新档位」。 */
async function openEffortPane() {
  resetHooks()
  render(modelReg.render({ sessionId: 'sess-1' }))
  await flush()
  rerender()
  const t0 = render(modelReg.render({ sessionId: 'sess-1' }))
  const trg = nodesOf(t0, 'button').find(
    (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-trigger')
  )
  assert.ok(trg && typeof trg.props.onClick === 'function', '新挂载后 trigger 应可点击')
  trg.props.onClick()
  rerender()
  const t1 = render(modelReg.render({ sessionId: 'sess-1' }))
  const cell = nodesOf(t1, 'button').find(
    (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-cell')
      && textOf(n).join('').includes('思考强度')
  )
  assert.ok(cell, '打开后应能 drill 进「思考强度」cell（回归：root pane 不得为空）')
  cell.props.onClick()
  rerender()
  return render(modelReg.render({ sessionId: 'sess-1' }))
}

/** 当前 trigger 的 aria-expanded（面板是否还开着）。
    替身的 render() 不重置 hookCursor（只有 rerender() 会），
    所以任何独立渲染都必须先 rerender()，否则会从上次渲染的末尾继续读 hook 槽。 */
function panelOpen() {
  rerender()
  const trg = nodesOf(render(modelReg.render({ sessionId: 'sess-1' })), 'button').find(
    (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-trigger')
  )
  return trg ? trg.props['aria-expanded'] : null
}

selectModelCalls.length = 0
const sliderBefore = findSlider(await openEffortPane())
assert.ok(sliderBefore, 'drill 进档位面板后应有滑杆')
sliderBefore.props.onPointerDown({ clientX: 0, pointerId: 1, currentTarget: FAKE_NODE })
rerender()
const sliderAfter = findSlider(render(modelReg.render({ sessionId: 'sess-1' })))
assert.equal(sliderAfter.props['aria-valuenow'], 0, '拖到最左端后 aria-valuenow 应为 0')
sliderAfter.props.onPointerUp({ clientX: 0 })
await flush()
rerender()
assert.equal(selectModelCalls.length, 1, '松手应提交一次 selectModel')
assert.equal(selectModelCalls[0].reasoningEffort, 'off', '拖到最左端应提交 off 档')
assert.equal(selectModelCalls[0].sessionId, 'sess-1', '提交应带 sessionId')
assert.equal(selectModelCalls[0].provider, 'deepseek-account', '提交应带 provider')
assert.equal(selectModelCalls[0].model, 'm1', '提交应带 model')
// 用户裁决 m02593：「拉动完成之后就直接退出去了，没有定在那个位置」→ 松手必须不关。
assert.equal(panelOpen(), true, '回归断言：松手提交后弹层必须仍然打开（m02593 松手不关）')
rerender()
const sliderHeld = findSlider(render(modelReg.render({ sessionId: 'sess-1' })))
assert.equal(sliderHeld.props['aria-valuenow'], 0, '回归断言：松手后滑块必须停在提交位置，不得弹回')
// 乐观更新必须把新档位写进 current，否则小字行/触发器仍显示旧档（用户可见的「没定住」）
assert.equal(sliderHeld.props['aria-valuetext'], 'off', '回归断言：提交后弹层小字行应显示新档位 off')

// 键盘两段式（用户裁决 m02593）：Home/方向键只移动草稿，不提交；Enter/Space 才提交，且提交后不关。
selectModelCalls.length = 0
const sliderKey = findSlider(await openEffortPane())
assert.ok(sliderKey, '重开后仍应有滑杆')
let prevented = false
sliderKey.props.onKeyDown({ key: 'Home', preventDefault() { prevented = true } })
await flush()
rerender()
assert.ok(prevented, '方向键/Home 应 preventDefault 阻止页面滚动')
assert.equal(selectModelCalls.length, 0, '回归断言：Home 只移动草稿档位，不得直接提交（两段式键盘）')
assert.equal(panelOpen(), true, 'Home 后弹层仍应打开')
rerender()
const afterHome = findSlider(render(modelReg.render({ sessionId: 'sess-1' })))
assert.equal(afterHome.props['aria-valuenow'], 0, 'Home 应把草稿滑块移到最低档')
assert.equal(afterHome.props['aria-valuetext'], 'off', 'Home 后小字行应显示最低档 off')
afterHome.props.onKeyDown({ key: 'Enter', preventDefault() {} })
await flush()
rerender()
assert.equal(selectModelCalls.length, 1, 'Enter 才提交一次 selectModel')
assert.equal(selectModelCalls[0].reasoningEffort, 'off', 'Enter 应提交当前草稿档位（最低档 off）')
assert.equal(panelOpen(), true, '回归断言：Enter 提交后弹层也必须仍然打开（松手/提交不关）')

// End 跳到该模型最高可用档：只移动草稿，不提交，也不关闭（旧契约是「只关闭、不重复提交」）
selectModelCalls.length = 0
const sliderEnd = findSlider(await openEffortPane())
sliderEnd.props.onKeyDown({ key: 'End', preventDefault() {} })
await flush()
rerender()
assert.equal(selectModelCalls.length, 0, 'End 只移动草稿，不提交')
assert.equal(panelOpen(), true, 'End 后弹层仍应打开（新契约：关闭只由外部点击/Escape 触发）')
rerender()
const afterEnd = findSlider(render(modelReg.render({ sessionId: 'sess-1' })))
assert.equal(afterEnd.props['aria-valuetext'], '超高', 'End 应把草稿移到该模型最高可用档')

// 滑杆 aria-valuetext 必须用服务端档位名
const sliderText = findSlider(await openEffortPane())
assert.equal(sliderText.props['aria-valuetext'], '超高', 'aria-valuetext 应显示服务端档位名（超高）')

/* ── 闪电 = 思考开关，且点它**不得关闭面板**（用户 m03904：「点击闪电标之后就立刻退出了」）──
   根因：toggleThinking 调 props.onSelect(target) 漏传 keepOpen → submit → closeAfterSelection。
   派生要求（用户 m03904）：关的时候到 off 档；开的时候滑块到 minimal 档。 */
function findIconBtn(tree, kind) {
  return nodesOf(tree, 'button').find(
    (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-popup__iconbtn--' + kind)
  )
}

// ① 当前 xhigh（开启态）→ 点闪电 = 关闭思考 → 提交 off 档，面板必须仍开着
selectModelCalls.length = 0
const popupOn = await openEffortPane()
const flashOn = findIconBtn(popupOn, 'flash')
assert.ok(flashOn, '弹层顶栏应有闪电按钮')
assert.equal(flashOn.props['aria-pressed'], true, '当前档 xhigh（非 off）→ 闪电应为开启态')
flashOn.props.onClick()
await flush()
rerender()
assert.equal(selectModelCalls.length, 1, '点闪电应提交一次 selectModel（关闭思考）')
assert.equal(selectModelCalls[0].reasoningEffort, 'off', '关闭思考必须落到 off 档（用户 m03904）')
assert.equal(panelOpen(), true, '回归断言：点闪电后弹层必须仍然打开（不得立刻退出）')

// ② 同一挂载内（此时已在 off 档）再点闪电 = 开启思考 → 提交首个非 off 档，面板仍开。
//    注意不能重开挂载：resetHooks 会丢掉上一轮的乐观更新，catalog 会退回 fixture 的 defaultEffort。
selectModelCalls.length = 0
rerender()
const popupOff = render(modelReg.render({ sessionId: 'sess-1' }))
const flashOff = findIconBtn(popupOff, 'flash')
assert.equal(flashOff.props['aria-pressed'], false, '关闭思考后闪电应回到关闭态（无填充）')
assert.equal(flashOff.props['aria-label'], '开启思考', '关闭态闪电 aria-label 应为「开启思考」')
flashOff.props.onClick()
await flush()
rerender()
assert.equal(panelOpen(), true, '回归断言：开启思考后弹层仍必须打开')
// m1 的档位只有 off/xhigh，没有 minimal —— 铁律「不假设七档」：必须退到首个非 off 档
assert.equal(
  selectModelCalls.length, 1,
  '回归断言：开启思考必须提交一次档位（当前 m1 无 minimal，退到首个非 off 档）'
)
assert.equal(
  selectModelCalls[0].reasoningEffort, 'xhigh',
  '开启思考优先 minimal；模型没有 minimal 时必须退到首个非 off 档（m1 → xhigh），不得硬编码'
)
rerender()
const flashNow = findIconBtn(render(modelReg.render({ sessionId: 'sess-1' })), 'flash')
assert.equal(flashNow.props['aria-pressed'], true, '开启后闪电应回到开启态')
assert.equal(flashNow.props['aria-label'], '关闭思考', '开启态闪电 aria-label 应为「关闭思考」')

// ③ 右上「重置为默认档」按钮已按用户 m05286 删除：回到默认只能靠滑杆最左端常驻 off 档。
//    单独重新打开面板验证（组件级断言之外再确认一次 API 面收窄）。
selectModelCalls.length = 0
const popupNoReset = await openEffortPane()
assert.equal(
  findIconBtn(popupNoReset, 'refresh'), undefined,
  '回归断言：弹层顶栏不得再有刷新/重置按钮（功能由常驻 off 档承担）'
)

/* ── 回归：模型列表必须是真滚动容器（用户 m05519「模型选择应该像官方一样，是可以滑动选择的」）──
   结构契约（对齐官方 asar:435787-435896）：
   ① .teff-groups 的最近 className 祖先必须是 .teff-viewport（官方 .scrollable/.viewport 链路）；
   ② .teff-groups 与 .teff-menu 必须挂**两个不同的 ref**（官方 menuRef/groupsRef 分工）；
      此前同一个 menuRef 挂两处，最终指向 .teff-groups → place() 量的是列表内容高度（定位误差）；
   ③ model pane 的外层容器 role 必须是 group（内层 .teff-groups 才是 role=menu 的复合菜单）；
   ④ 每个分组必须是滚动容器的**直接子节点**并带 data-menu-group（吸顶观察器按 :scope > 选择）。 */
async function openModelPane() {
  resetHooks()
  render(modelReg.render({ sessionId: 'sess-1' }))
  await flush()
  rerender()
  const t0 = render(modelReg.render({ sessionId: 'sess-1' }))
  const trg = nodesOf(t0, 'button').find(
    (n) => n.props && typeof n.props.className === 'string' && n.props.className.includes('teff-trigger')
  )
  assert.ok(trg && typeof trg.props.onClick === 'function', '新挂载后 trigger 应可点击')
  trg.props.onClick()
  rerender()
  const t1 = render(modelReg.render({ sessionId: 'sess-1' }))
  const cell = nodesOf(t1, 'button').find(
    (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-cell')
      && textOf(n).join('').includes('模型') && !textOf(n).join('').includes('思考强度')
  )
  assert.ok(cell, '打开后应能 drill 进「模型」cell')
  cell.props.onClick()
  rerender()
  return render(modelReg.render({ sessionId: 'sess-1' }))
}

const modelPaneTree = await openModelPane()
const groupsEl = nodesOf(modelPaneTree, 'div').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-groups')
)
assert.ok(groupsEl, '回归断言：model pane 必须有 .teff-groups 滚动容器')
const menuEl = nodesOf(modelPaneTree, 'div').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-menu')
)
assert.ok(menuEl, 'model pane 应仍渲染在 .teff-menu 内')

/* ① flex 链路：滚动容器的父节点必须带 teff-viewport（缺它则 overflow-y:auto 永不激活） */
const viewportEl = nodesOf(menuEl, 'div').find(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-viewport')
)
assert.ok(
  viewportEl,
  '回归断言：模型 pane 必须有 .teff-viewport（menu ↔ 滚动区的 flex 链路），否则列表被裁死不滚动（m05519）'
)
assert.ok(
  nodesOf(viewportEl, 'div').includes(groupsEl),
  '回归断言：.teff-groups 必须在 .teff-viewport 内部（中间无 min-height:auto 的裸 div）'
)

/* ② 双 ref 分工：menuRef 只挂 .teff-menu，groupsRef 只挂 .teff-groups */
assert.equal(
  typeof menuEl.props.ref === 'object' && menuEl.props.ref !== null, true,
  '回归断言：.teff-menu 必须挂 ref（menuRef，供 place() 量菜单盒尺寸）'
)
assert.equal(
  typeof groupsEl.props.ref === 'object' && groupsEl.props.ref !== null, true,
  '回归断言：.teff-groups 必须挂自己的 ref（groupsRef，吸顶观察器的 root）'
)
assert.notEqual(
  menuEl.props.ref, groupsEl.props.ref,
  '回归断言：.teff-menu 与 .teff-groups 必须挂两个不同的 ref —— 同一 ref 挂两处会让 place() 量到列表内容高度（m05519）'
)

/* ③ 无障碍对齐官方 asar:435792：model pane 外层 role=group，内层列表 role=menu */
assert.equal(menuEl.props.role, 'group', 'model pane 外层容器 role 必须为 group（对齐官方 MenuSurface）')
assert.equal(groupsEl.props.role, 'menu', '内层模型列表 role 必须为 menu')

/* ④ 分组必须是滚动容器的直接子节点 + 带官方 data 钩子（吸顶观察器用 :scope > [data-menu-group]） */
const groupNodes = nodesOf(groupsEl, 'div').filter(
  (n) => n.props && n.props['data-menu-group'] !== undefined
)
assert.ok(groupNodes.length >= 1, '模型 pane 应按 provider 分组（挂在滚动容器下）')
assert.ok(
  groupNodes.every((g) => g.props.role === 'group'),
  '分组节点必须 role=group（官方 MenuGroup 同构）'
)
const headingNodes = nodesOf(groupsEl, 'div').filter(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-groupLabel')
)
assert.equal(headingNodes.length, groupNodes.length, '每组应有且仅有一个 .teff-groupLabel 标题')
assert.ok(
  headingNodes.every((hd) => hd.props['data-menu-group-heading'] !== undefined),
  '回归断言：分组标题必须带 data-menu-group-heading（吸顶观察器的钩子）'
)
const startNodes = nodesOf(groupsEl, 'span').filter(
  (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('teff-groupStart')
)
assert.equal(
  startNodes.length, groupNodes.length,
  '回归断言：每组必须有一个 .teff-groupStart 隐形探针（观察器判断该组是否滚出上方）'
)
assert.ok(
  startNodes.every((s) => s.props['data-menu-group-start'] !== undefined && s.props['aria-hidden'] === true),
  '探针必须 data-menu-group-start + aria-hidden（不得被读屏）'
)

/* ── 浮层纯函数：catalog 不假设七档 + effortChoices 公式 ──────────────── */

const pure = pluginModule.__teff_pure
assert.ok(pure, '应导出 __teff_pure 纯函数集（orderModelProviders/rankByName/buildChoices/findCurrentChoice/computeMenuData）')

// ① 目录形态各异（官方实证）：{off:null,xhigh,max}、{off:null,minimal,low,medium}、无 max。
//    渲染契约铁律：完全按 reasoning.efforts 渲染，不假设七档。
const catalogGroups = [
  {
    id: 'deepseek-account',
    name: '账号模型',
    models: [
      { id: 'm1', name: '模型一', reasoning: { efforts: [{ id: 'off', name: '关闭' }, { id: 'xhigh', name: '超高' }], defaultEffort: 'xhigh' } },
      { id: 'm2', name: '模型二', reasoning: { efforts: [{ id: 'off', name: '关闭' }, { id: 'minimal', name: '极简' }, { id: 'low', name: '低' }, { id: 'medium', name: '中' }], defaultEffort: undefined } },
      { id: 'm3', name: '模型三' } // reasoning === undefined → 档位区不显示
    ]
  },
  { id: 'deepseek-official', name: '官方', models: [{ id: 'm4', name: '模型四' }] },
  { id: 'third-party', name: '第三方', models: [{ id: 'm5', name: '模型五', reasoning: { efforts: [{ id: 'max', name: '最大' }], defaultEffort: 'max' } }] }
]

const ordered = pure.orderModelProviders(catalogGroups)
assert.deepEqual(
  ordered.map((g) => g.id),
  ['deepseek-account', 'deepseek-official', 'third-party'],
  'orderModelProviders：account → official → 其余保持相对顺序'
)
assert.notEqual(ordered, catalogGroups, 'orderModelProviders 不应原地修改入参')

const choices = pure.buildChoices(ordered)
assert.equal(choices.length, 5, 'buildChoices 应平铺全部模型')
const m1 = choices.find((c) => c.model.id === 'm1')
assert.equal(m1.selection.reasoningEffort, 'xhigh', 'catalog 带 defaultEffort 时选模型应一并提交')
const m3 = choices.find((c) => c.model.id === 'm3')
assert.equal(m3.selection.reasoningEffort, undefined, '无 defaultEffort 不应携带 reasoningEffort')

// effortChoices 公式（逐字照官方契约）
const current = { provider: 'deepseek-account', model: 'm2' }
const currentChoice = pure.findCurrentChoice(choices, current)
assert.ok(currentChoice && currentChoice.model.id === 'm2', 'findCurrentChoice 应命中当前选择')

const menu2 = pure.computeMenuData(currentChoice, current, undefined)
assert.equal(menu2.reasoning.efforts.length, 4, 'm2 只有 4 档，不假设七档')
assert.equal(menu2.effectiveEffort, undefined, 'defaultEffort === undefined → effectiveEffort undefined')
assert.equal(menu2.effortLabel, 'off', 'effectiveEffort undefined → 触发条档位文案为 off（用户裁决 m02779，不再叫 Default）')
assert.equal(
  menu2.effortChoices.map((l) => l.label).join('|'),
  ['off', '极简', '低', '中'].join('|'),
  'm2 自带 off 档 → 不重复补 provider-default，只把官方 off 档标签统一为 off'
)
assert.equal(
  menu2.effortChoices.filter((l) => l.key === 'provider-default').length, 0,
  '回归断言：模型自己声明了 off 档时不得再补一个 provider-default 节点（否则滑杆出现双 off）'
)

const menu1 = pure.computeMenuData(
  choices.find((c) => c.model.id === 'm3'),
  { provider: 'third-party', model: 'm3' },
  '保留值'
)
assert.equal(menu1.effortLabel, '保留值', 'reasoning === undefined → effortLabel 用 retainedEffort')
assert.equal(menu1.effortChoices.length, 0, 'reasoning === undefined → effortChoices 为空（档位区不显示）')

const menu5 = pure.computeMenuData(
  choices.find((c) => c.model.id === 'm5'),
  { provider: 'third-party', model: 'm5' },
  undefined
)
const menu5Choices = menu5.effortChoices.map((l) => ({ key: l.key, effort: l.effort, label: l.label }))
assert.equal(menu5Choices.length, 2, 'm5 没声明 off 档 → 最左端常驻一个 provider-default off 节点 + 其唯一档位 max')
assert.equal(menu5Choices[0].key, 'provider-default', '最左端必须是常驻 provider-default 节点（用户裁决 m02779：Default 常驻、改名 off）')
assert.equal(menu5Choices[0].effort, undefined, 'provider-default 节点不下发 reasoningEffort（交给 provider 默认值）')
assert.equal(menu5Choices[0].label, 'off', 'provider-default 节点标签必须叫 off（不得叫 Default）')
assert.equal(menu5Choices[1].key, 'effort:max', '模型实际档位紧随常驻 off 之后')
assert.equal(menu5Choices[1].effort, 'max', '模型实际档位 effort 原样保留')
assert.equal(menu5Choices[1].label, '最大', '模型实际档位标签用服务端 name')

/* ── 回归：弹层定位必须会向下翻转（用户 m04522「有东西会遮挡」）───────────────
   真实 DSH 里 chip 在窗口底部，永远向上弹；但触发按钮贴近视口顶部时，只会上弹的
   实现会被夹到 MENU_MARGIN=12 贴住顶边、钻进顶部 chrome 的领地（预览页实测重现）。
   几何抽成纯函数 menuPlacement，才能在这里把「翻转」钉死。 */
const placing = pure.menuPlacement
assert.equal(typeof placing, 'function', '应导出 menuPlacement 纯函数用于位置回归')

// ① 触发条在窗口底部（真实 DSH 场景）→ 向上弹，且顶部 = rect.top - gap - lh
const up = placing({ rect: { top: 700, bottom: 728, right: 1200 }, lw: 340, lh: 200, vw: 1280, vh: 800, margin: 12, gap: 8 })
assert.equal(up.side, 'up', '底部触发条应向上弹（真实 DSH 的常规路径）')
assert.equal(up.top, (700 - 8 - 200) + 'px', '向上弹时顶部应为 rect.top - gap - lh')

// ② 触发条贴住视口顶部、上方装不下 → 必须向下翻转，绝不贴顶
const down = placing({ rect: { top: 40, bottom: 68, right: 1200 }, lw: 340, lh: 200, vw: 1280, vh: 800, margin: 12, gap: 8 })
assert.equal(
  down.side, 'down',
  '回归断言：上方空间不足时必须向下翻转（否则弹层被夹到 top=12 贴住顶边、被顶部 chrome 盖住 —— m04522「有东西会遮挡」）'
)
assert.equal(down.top, (68 + 8) + 'px', '向下翻转时顶部应为 rect.bottom + gap（不贴顶）')

// ③ 上下都很挤时选空间更大的一侧，而不是无脑夹到 12
const tight = placing({ rect: { top: 100, bottom: 128, right: 1200 }, lw: 340, lh: 200, vw: 1280, vh: 260, margin: 12, gap: 8 })
assert.equal(tight.side, 'down', '上方空间更小时仍须选下方（不得无脑贴顶）')

// ④ 水平仍然夹进视口（原有行为不得回归）
const sideways = placing({ rect: { top: 700, bottom: 728, right: 1270 }, lw: 340, vh: 800, vw: 1280, margin: 12, gap: 8 })
assert.equal(sideways.left, (1280 - 340 - 12) + 'px', '弹层右缘不得越出视口（水平夹取保持）')

// rankByName：大小写不敏感有序子序列，前缀 > 对齐分 > catalog 顺序（官方 asar:455666）
// 注：沙箱 vm realm 的数组原型与宿主不同，deepStrictEqual 会因原型不一致误报，
// 故统一用 id 串比较。
const idsOf = (list) => Array.prototype.map.call(list, (m) => m.id).join(',')

// 规则一：前缀优先——'Beta Pro' 对齐分更高，但 'Pro Max' 命中前缀，必须排前。
const rankPrefix = pure.rankByName(
  [{ id: 'beta', name: 'Beta Pro' }, { id: 'pro', name: 'Pro Max' }],
  'pro'
)
assert.equal(idsOf(rankPrefix), 'pro,beta', '前缀命中优先于对齐分')

// 规则二：对齐分优先于 catalog 顺序——'caxb' 跳字符且 catalog 在后，仍应排后。
// （注意不能用 'a-x-b'：'-' 边界加权会让它反超，这正是官方 boundaryBonus 的行为。）
const rankAlign = pure.rankByName(
  [{ id: 'gapped', name: 'caxb' }, { id: 'tight', name: 'cab' }],
  'ab'
)
assert.equal(idsOf(rankAlign), 'tight,gapped', '相邻命中得分高于跳字符命中')

// 规则二补：'-' 后的命中享有边界加权（boundaryBonus = 8），可反超相邻命中。
const rankBoundary = pure.rankByName(
  [{ id: 'tight', name: 'cab' }, { id: 'boundary', name: 'ca-b' }],
  'ab'
)
assert.equal(idsOf(rankBoundary), 'boundary,tight', '分隔符边界命中享有加权（官方 boundaryBonus）')

// 规则三：同名平局由 catalog 顺序决定（稳定性）。
const rankTie = pure.rankByName(
  [{ id: 'first', name: 'Same Name' }, { id: 'second', name: 'Same Name' }],
  'same'
)
assert.equal(idsOf(rankTie), 'first,second', '同分平局按 catalog 顺序稳定排序')

// 过滤：非子序列必须被丢弃；大小写不敏感。
const rankFilter = pure.rankByName(
  [{ id: 'flash', name: 'DeepSeek Flash' }, { id: 'lite', name: 'Lite Model' }],
  'DS'
)
assert.equal(idsOf(rankFilter), 'flash', '大小写不敏感；Lite Model 不含 ds 子序列应被过滤')

// label 作第二检索键（官方 keys = label === undefined ? [name] : [name, label]）。
const rankLabel = pure.rankByName([{ id: 'lbl', name: 'Zzz', label: 'DeepSeek' }], 'deep')
assert.equal(idsOf(rankLabel), 'lbl', 'label 是第二检索键')

// 空 query 返回全部（副本，不改原数组）。
const rankAll = pure.rankByName([{ id: 'x', name: 'X' }], '')
assert.equal(idsOf(rankAll), 'x', '空 query 返回全部条目')
assert.equal(pure.rankByName([], 'x').length, 0, '空列表安全')

/* ── 首屏：1 次 GET，空态 ─────────────────────────────────────────────── */

resetHooks()
const emptyTree = render(registration.render())
assert.ok(textOf(emptyTree).some((t) => t.includes('暂无数据')), '首屏应显示加载态')
assert.equal(getCount, 1, '首屏应只发 1 次 GET /dsh-thinking-effort/api')
assert.equal(requests.length, 1, '首屏只应有 1 次网络请求')
assert.equal(requests[0].url, API, 'GET 应打到 /dsh-thinking-effort/api')
assert.equal(requests[0].method, 'GET', '首屏读状态必须用 GET')

// 数据异步回来：放空微任务队列后重渲染，才是有数据态。
await flush()

rerender()
const tree = render(registration.render())
const texts = textOf(tree).join(' | ')

assert.ok(texts.includes('deepseek/deepseek-v4.1-flash'), '应列出待接管的模型')
assert.ok(texts.includes('启用思考强度接管'), '应有总开关')
assert.ok(texts.includes('自动补写'), '应有接管模式选择')
assert.ok(texts.includes('上游探测'), '应有探测开关')
assert.ok(texts.includes('立即扫描'), '应有立即扫描按钮')
assert.ok(texts.includes('清除覆盖'), '应有清除覆盖按钮')
assert.ok(texts.includes('deepseek-v4.1-flash · off=null'), '应展示知识库规则')

/* 「默认档位」不再是可写 select：只读展示 */
assert.ok(texts.includes('默认档位：off'), '默认档位应只读展示')
assert.equal(nodesOf(tree, 'select').length, 1, '全页只应剩 1 个 select（接管模式），默认档位 select 已删除')

/* 档位勾选框数量 = 7 档 × 模型数（1）+ 总开关 + 探测开关 */
const checkboxes = nodesOf(tree, 'input').filter((n) => n.props.type === 'checkbox')
assert.ok(checkboxes.length >= 7 + 2, '应有总开关/探测开关 + 每个模型 7 个档位勾选')

/* ── POST 契约：body {method,args}；写 override 只带 efforts ─────────── */

// 第 1 个 checkbox = 总开关
checkboxes[0].props.onChange({ target: { checked: false } })
await flush()
const setConfigReq = requests.filter((r) => r.method === 'POST').map((r) => JSON.parse(r.body)).find((b) => b.method === 'setConfig')
assert.ok(setConfigReq, '总开关变更应 POST setConfig')
assert.deepEqual(setConfigReq.args, { enabled: false }, 'POST body 应为 {method,args}，args 只带补丁字段')

// 档位勾选框（index 2 起）：勾一个档位 → 触发写 override
checkboxes[3].props.onChange({})
await flush()
const setOverridesReq = requests.filter((r) => r.method === 'POST').map((r) => JSON.parse(r.body)).find((b) => b.method === 'setOverrides')
assert.ok(setOverridesReq, '改档位应 POST setOverrides')
const written = setOverridesReq.args.overrides['deepseek/deepseek-v4.1-flash']
assert.ok(written, '覆盖键应为 <route>/<modelId>')
assert.deepEqual(
  Object.keys(written), ['efforts'],
  '回归断言：写 override 只能提交 efforts，defaultEffort 不是模型条目字段（§7B R8）'
)
assert.ok(Object.keys(written.efforts).length >= 1, '新勾选的档位应进入 efforts')

/* ── 失败路径：{ok:false,error} 与网络异常都变成文案，不崩 ───────────── */

failMode = { kind: 'http', status: 400, error: '配置写入被拒绝：revision 冲突' }
resetHooks()
const failTree = render(registration.render())
assert.ok(textOf(failTree).some((t) => t.includes('暂无数据')), '失败首屏仍应渲染出结构，不抛异常')
await flush()
rerender()
const errTexts = textOf(render(registration.render())).join(' | ')
assert.ok(
  errTexts.includes('配置写入被拒绝：revision 冲突'),
  '400 {ok:false,error} 的 error 应原样变成可展示文案'
)

failMode = { kind: 'network', message: 'Failed to fetch' }
resetHooks()
assert.doesNotThrow(() => render(registration.render()), '网络异常不得让设置页崩溃')
await flush()
rerender()
const netTexts = textOf(render(registration.render())).join(' | ')
assert.ok(
  netTexts.includes('无法连接 Host 端点 ' + API),
  '网络异常应转成可读文案（含端点路径）'
)

failMode = null

console.log(
  'smoke-client ok — settings.section 注册形状不变，样式走 document.head，' +
  '首屏 1 次 GET，POST 契约 {method,args} 对齐，写 override 仅带 efforts，' +
  'host/styles 全局缺席回归通过；面板渲染 ' + texts.length + ' 字'
)
