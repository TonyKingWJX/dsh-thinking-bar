/*
 * 无浏览器自检：用**真实 React** 在 Node 里把 lib/client.js 跑起来，
 * 验证预览链路的关键一环——模块契约、槽位注册、组件能真的渲染出 DOM 结构。
 *
 * 为什么需要：预览页要靠人眼打开浏览器看，但「它到底能不能加载」必须能自动判定。
 * 这里用 react-dom/server 的 renderToString 做一次真实渲染，
 * 所以它同时证明了 vendor/react-bundle.js 的 CJS 注册表是对的。
 *
 * 只读 lib/、vendor/。不写任何文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const REACT_ROOT = 'D:\\VibeCoding\\ZCode\\opus55-videos\\projects\\the-day\\node_modules'

const requireFromReact = createRequire(path.join(REACT_ROOT, 'noop.js'))
const React = requireFromReact('react')
const { renderToString } = requireFromReact('react-dom/server')

const FIX = JSON.parse(fs.readFileSync(path.join(HERE, 'vendor', 'state.json'), 'utf8'))
const CATALOG = JSON.parse(fs.readFileSync(path.join(HERE, 'vendor', 'catalog.json'), 'utf8'))

const fails = []
function check(name, cond, extra) {
  if (cond) console.log('PASS ' + name)
  else {
    console.log('FAIL ' + name + (extra === undefined ? '' : ' -> ' + extra))
    fails.push(name)
  }
}

/* ── 极简 DOM 桩：client.js 会碰 document.head/body/querySelector ────────── */
const styleTags = []
const documentStub = {
  head: {
    appendChild(node) {
      styleTags.push(node)
      return node
    }
  },
  body: {},
  activeElement: null,
  createElement() {
    return {
      setAttribute(k, v) {
        this[k] = v
      },
      textContent: '',
      parentNode: null
    }
  },
  querySelector() {
    return null
  },
  addEventListener() {},
  removeEventListener() {}
}

/* ── 捕获槽位注册 ──────────────────────────────────────────────────────── */
const registered = {}
const fakeConnection = {
  api: {
    session: {
      modelCatalog: () => Promise.resolve({ result: { value: CATALOG } }),
      selectModel: (req) => Promise.resolve({ result: { value: { selected: req } } })
    }
  }
}
const ctx = {
  get: (n) => (n === 'connection' ? fakeConnection : undefined),
  on: () => () => {},
  effect: (fn) => {
    const c = fn()
    return () => {
      if (typeof c === 'function') c()
    }
  },
  slots: {
    inject: (key, cb) => cb(),
    register: (reg, Component) => {
      registered[reg.name] = { reg, Component }
    }
  }
}

/* ── 加载真实 lib/client.js（走 __ModuleLoader__ 契约）──────────────────── */
let mod = null
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(def) {
        mod = def.factory((name) => {
          if (name === 'react') return React
          throw new Error('未提供的模块：' + name)
        })
      }
    }
  },
  document: documentStub,
  console
}
sandbox.window.document = documentStub
sandbox.globalThis = sandbox

const code = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'lib/client.js' })

check('lib/client.js 通过 __ModuleLoader__ 注册了模块', mod !== null)
check('导出 apply / inject', !!mod && typeof mod.apply === 'function' && Array.isArray(mod.inject))
check('inject 含 slots 与 connection', !!mod && mod.inject.join(',') === 'slots,connection', mod && mod.inject.join(','))

mod.apply(ctx)

check('注册了 conversation.input.model（顶替官方 chip）', !!registered['conversation.input.model'])
check('注册了 settings.section（设置页）', !!registered['settings.section'])
check('注入设置页样式标签', styleTags.some((t) => t['data-plugin-css'] === 'dsh-thinking-effort'))
check('注入浮层样式标签', styleTags.some((t) => t['data-plugin-css'] === 'dsh-thinking-effort-overlay'))

/* ── 用真实 React 真渲染一次 chip（服务端渲染，不跑 effect）────────────── */
const ModelChip = registered['conversation.input.model'].Component
const chipHtml = renderToString(React.createElement(ModelChip, { sessionId: 'preview' }))
check('chip 渲染出 teff-root', chipHtml.includes('teff-root'), chipHtml.slice(0, 160))
check('chip 渲染出 teff-trigger 按钮', chipHtml.includes('teff-trigger'))
check('chip 带 aria-haspopup=menu', chipHtml.includes('aria-haspopup="menu"'))
check('chip 显示「加载中…」（catalog 尚未返回）', chipHtml.includes('加载中'), chipHtml.replace(/<[^>]+>/g, '').slice(0, 120))

const SettingsPanel = registered['settings.section'].Component
const settingsHtml = renderToString(React.createElement(SettingsPanel, null))
check('设置页渲染不抛错且非空', settingsHtml.length > 0, settingsHtml.length)
/* renderToString 不跑 useEffect，所以 fetchState 永远不结算 —— 这里必须是空态。
   数据态的断言在 test/smoke-client.mjs 里（那边有真的 effect 替身）。 */
check('设置页 SSR 下是空态（「暂无数据」）', settingsHtml.includes('暂无数据'), settingsHtml.replace(/<[^>]+>/g, '').slice(0, 120))
check('设置页根节点用了 __te_root 类', settingsHtml.includes('__te_root'), settingsHtml.slice(0, 120))
check('设置页样式表含 __te_* 规则', styleTags.some((t) => String(t.textContent).includes('.__te_root')))

/* ── 纯函数抽查（预览用的 fixture 就是它们算的）────────────────────────── */
const pure = mod.__teff_pure
check('导出 __teff_pure.effortVisual', !!pure && typeof pure.effortVisual === 'function')
const v0 = pure.effortVisual(0, 4)
const v3 = pure.effortVisual(3, 4)
check('effortVisual 最低档 1 层粒子', v0.starLayers === 1, v0.starLayers)
check('effortVisual 最高档紫端到 100%', v3.purpleStop === 100, v3.purpleStop)
check('effortVisual 最高档 isTop', v3.isTop === true)

/* ── 用真 React 真渲染弹层（本轮交付的主体，必须被覆盖）──────────────────
   renderToString 不跑 useEffect，但 CodexEffortPopup 的 useState/useRef 都走
   首次取值路径，足以断言「读法 A 顺序」与「闪电开关两态」。
   choices **必须经 computeMenuData 从真实 catalog 推导**——若在测试里手写标签，
   断言就与实现解耦：把 label 从 off 改回 Default 也照样通过（已实测到的假绿）。 */
const comps = mod.__teff_components
check('导出 __teff_components.CodexEffortPopup', !!comps && typeof comps.CodexEffortPopup === 'function')

// 从真实 catalog 里取一个「有档位、且未自带 off 档」的模型，走真实推导路径
const group0 = CATALOG.groups.find((g) => g.models.some((m) => m.reasoning && m.reasoning.efforts))
const model0 = group0.models.find((m) => m.reasoning && m.reasoning.efforts)
const menu0 = pure.computeMenuData({ group: group0, model: model0, selection: {} }, { provider: group0.id, model: model0.id }, undefined)
const POPUP_CHOICES = menu0.effortChoices
check('computeMenuData 推导出的 choices 非空', POPUP_CHOICES.length > 0, POPUP_CHOICES.length)
const POPUP_MODEL = '模型一 · x2.00'   // 官方把倍率烘进 name（asar: 宿主半侧）

function renderPopup(current) {
  return renderToString(React.createElement(comps.CodexEffortPopup, {
    choices: POPUP_CHOICES,
    current: current,
    modelName: POPUP_MODEL,
    busy: false,
    onSelect() {},
    onPickModel() {}
  }))
}

// 用「该模型声明的最高档」作为开启态样本，确保它一定不是 off
const onEffort = (function () {
  for (let i = POPUP_CHOICES.length - 1; i >= 0; i -= 1) {
    const e = POPUP_CHOICES[i].effort
    if (e !== undefined && e !== 'off') return e
  }
  return undefined
})()
check('样本模型存在非 off 档（开启态可测）', onEffort !== undefined, String(onEffort))

const onHtml = renderPopup(onEffort)
const offHtml = renderPopup(undefined)

// 读法 A：大字行 = 模型名，下方小字行 = 当前思考强度（用户裁决 m02779，顺序不得反）
const iModel = onHtml.indexOf('teff-popup__model')
const iLevel = onHtml.indexOf('teff-popup__level')
check('弹层同时渲染模型名行与强度行', iModel >= 0 && iLevel >= 0)
check('读法 A：模型名行在小字强度行之前', iModel >= 0 && iLevel > iModel, iModel + ' vs ' + iLevel)
check('大字行放的是模型名（含倍率全文，不截断）', onHtml.includes(POPUP_MODEL), onHtml.replace(/<[^>]+>/g, '').slice(0, 160))
const onLabel = (POPUP_CHOICES.find((c) => c.effort === onEffort) || {}).label
check('小字行放的是当前思考强度（服务端档位名）', onLabel && onHtml.includes(onLabel), onLabel)

// 档位标签：最左端必须叫 off（用户裁决 m02779：Default 常驻、改名 off，不得再出现 Default）
const labelTexts = [...onHtml.matchAll(/class="teff-slider__label(?:\s[^"]*)?"[^>]*>([^<]*)</g)].map((m) => m[1])
check('滑杆档位标签数量等于 choices 数', labelTexts.length === POPUP_CHOICES.length, labelTexts.length + ' -> ' + labelTexts.join('|'))
check('最左端档位标签是 off（不再叫 Default）', labelTexts[0] === 'off', labelTexts.join('|'))
check('弹层 HTML 里不得再出现 Default 字样', !onHtml.includes('Default'))

// 闪电 = 开启/关闭思考开关：有填充=开启，无填充=关闭（用户裁决 m02731）
check('思考开启时闪电为按下态（有填充）', /teff-popup__iconbtn--flash[^>]*aria-pressed="true"/.test(onHtml), onHtml.slice(0, 400))
check('思考开启时闪电 aria-label 为「关闭思考」', onHtml.includes('aria-label="关闭思考"'))
check('思考关闭（off）时闪电为未按下态（无填充）', /teff-popup__iconbtn--flash[^>]*aria-pressed="false"/.test(offHtml))
check('思考关闭时闪电 aria-label 为「开启思考」', offHtml.includes('aria-label="开启思考"'))
check('关闭态小字行显示 off', offHtml.includes('aria-valuetext="off"'))
check('弹层默认就是打开态（松手不关的前提）', onHtml.includes('teff-popup--open'))
// 右上「重置为默认档」已按用户 m05286 删除（最左常驻 off 即回到默认，按钮冗余）
check('弹层不得再有右上重置按钮', !onHtml.includes('--refresh') && !onHtml.includes('重置为默认档'))

/* ── fixture 与真实 profile 的一致性 ───────────────────────────────────── */
check('fixture 覆盖 6 个 provider', FIX.providers.length === 6, FIX.providers.length)
check('fixture 有 13 个模型', FIX.providers.reduce((n, p) => n + p.models.length, 0) === 13)
check('fixture 含接管计划', (FIX.planned || []).length > 0, (FIX.planned || []).length)
check('catalog 有 current', !!CATALOG.current, JSON.stringify(CATALOG.current))
check('catalog 里有无档位模型（验证不假设七档）', CATALOG.groups.some((g) => g.models.some((m) => !m.reasoning)))

console.log('')
if (fails.length) {
  console.log('PREVIEW VERIFY FAILED — ' + fails.length + ' 项：' + fails.join(' / '))
  process.exit(1)
}
console.log('preview verify ok — 模块契约 / 槽位注册 / 真实 React 渲染 / fixture 一致性全部通过')
