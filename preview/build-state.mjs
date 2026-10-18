/*
 * 生成离线预览的数据 fixture：
 *   preview/vendor/state.json   —— 设置页 GET /dsh-thinking-effort/api 的真实返回形状
 *   preview/vendor/catalog.json —— 模型目录（ctx.get('connection').api.session.modelCatalog()）
 *
 * 关键点：**不手写假数据**。
 *   - state.json 用真实的 lib/index.js 纯函数（planReconcile / scanModels / DEFAULTS）
 *     对着用户真实 profile 的 llm-pi-ai 配置算出来，形状照抄 lib/index.js 的 getState()。
 *   - catalog.json 用官方档位解析算法（asar:860156-860164 + asar:861129-861138）
 *     对「插件写入后」的 reasoningEfforts 求值，所以预览里看到的档位
 *     就是插件跑完之后官方选择器会看到的档位。
 *
 * 只读：lib/index.js、真实 profile 的 cordis.patch.yml。只写：preview/vendor/。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DSH_HOME = 'C:\\Users\\wang\\.dsh'
const PATCH = path.join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml')

/* ── 读真实 profile 的 llm-pi-ai 配置段（插件看到的 user 层） ────────────── */
const requireFromProfile = createRequire(path.join(DSH_HOME, 'profiles', 'desktop', 'noop.js'))
const yaml = requireFromProfile('js-yaml')

const doc = yaml.load(fs.readFileSync(PATCH, 'utf8'))
const row = doc.find((r) => r && r.id === 'llm-pi-ai')
if (!row) throw new Error('profile 里没有 llm-pi-ai 行')
const descriptor = { user: row.config }

/* ── 复用 Host 半侧纯函数（不是复刻，是真身） ───────────────────────────── */
const host = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href)
const { DEFAULTS, THINKING_LEVELS, CONFIG_FILE, NS } = host.__internal
const { planReconcile, scanModels } = host

/* 知识库清单（设置页第三段要渲染它）。 */
const knowledge = await import(pathToFileURL(path.join(ROOT, 'lib', 'knowledge.js')).href)
const { listRules } = knowledge

const config = JSON.parse(JSON.stringify(DEFAULTS))
const plan = planReconcile(descriptor, config)

/* getState() 的形状（lib/index.js:824-848），providers 段按 providerViews 复刻。 */
const plannedByKey = new Map()
for (const item of plan.planned || []) plannedByKey.set(item.route + '/' + item.modelId, item)

function providerViews() {
  const out = []
  for (const [route, provider] of Object.entries(descriptor.user.providers)) {
    const models = []
    for (const scanned of scanModels({ user: { providers: { [route]: provider } } })) {
      const key = route + '/' + scanned.modelId
      const picked = config.models[key]
      models.push({
        id: scanned.modelId,
        name: typeof scanned.entry.name === 'string' ? scanned.entry.name : null,
        levels: picked && Array.isArray(picked.levels) ? [...picked.levels] : null,
        planned: plannedByKey.get(key) || null
      })
    }
    out.push({
      id: route,
      name: typeof provider.name === 'string' ? provider.name : null,
      api: typeof provider.api === 'string' ? provider.api : null,
      enabled: true,
      models
    })
  }
  return out
}

const state = {
  config: {
    enabled: config.enabled,
    mode: config.mode,
    probe: config.probe,
    providers: config.providers,
    models: config.models
  },
  overrides: config.overrides,
  providers: providerViews(),
  models: config.models,
  planned: plan.planned,
  levels: [...THINKING_LEVELS],
  rules: listRules(),
  configFile: CONFIG_FILE,
  available: true
}

/* ── 把计划写进一份副本，模拟「插件接管之后」的配置 ──────────────────────── */
const after = JSON.parse(JSON.stringify(descriptor.user))
for (const op of plan.ops) {
  if (op.op !== 'set') continue
  let cursor = after
  for (let i = 0; i < op.path.length - 1; i += 1) cursor = cursor[op.path[i]]
  cursor[op.path[op.path.length - 1]] = op.value
}

/* ── 官方档位解析（asar:860156-860164 getSupportedThinkingLevels + asar:861129-861138 reasoningInfo） ── */
function supportedLevels(map) {
  return THINKING_LEVELS.filter((level) => {
    const mapped = map ? map[level] : undefined
    if (mapped === null) return false
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function reasoningOf(entry) {
  const declared = entry.reasoningEfforts
  if (declared === false) return undefined // 明确非推理
  if (declared === undefined) return undefined // 自定义 provider 无 base → 无档位（根因分支）
  const map = {}
  for (const [level, wire] of Object.entries(declared)) {
    if (wire === 'inherit' || wire === undefined) continue
    map[level] = wire
  }
  if (!Object.keys(map).length) return undefined
  const efforts = supportedLevels(map).map((level) => ({ id: level, name: capitalize(level) }))
  if (!efforts.length) return undefined
  return { efforts }
}

const groups = []
for (const [route, provider] of Object.entries(after.providers)) {
  const models = []
  for (const entry of provider.models || []) {
    const model = { id: entry.id, name: entry.name || entry.id }
    const reasoning = reasoningOf(entry)
    if (reasoning) model.reasoning = reasoning
    models.push(model)
  }
  if (models.length) groups.push({ id: route, name: provider.displayName || route, models })
}

/* current：优先取 agent-default-model（若落在这些 provider 里），否则取第一个模型。 */
let current = null
const defaultRow = doc.find((r) => r && r.id === 'agent-default-model')
if (defaultRow && defaultRow.config) {
  const { provider, model } = defaultRow.config
  if (groups.some((g) => g.id === provider && g.models.some((m) => m.id === model))) {
    current = { provider, model }
  }
}
if (!current && groups.length) current = { provider: groups[0].id, model: groups[0].models[0].id }

const catalog = { current, retainedEffort: undefined, failures: [], groups }

fs.mkdirSync(path.join(HERE, 'vendor'), { recursive: true })
fs.writeFileSync(path.join(HERE, 'vendor', 'state.json'), JSON.stringify(state, null, 2))
fs.writeFileSync(path.join(HERE, 'vendor', 'catalog.json'), JSON.stringify(catalog, null, 2))

/* 预览页以 file:// 打开，fetch() 被 CORS 挡掉，所以把 fixture 直接嵌成脚本。 */
fs.writeFileSync(
  path.join(HERE, 'vendor', 'fixtures.js'),
  '/* 自动生成，勿手改：由 preview/build-state.mjs 产出（数据来自真实 profile + 真实 Host 纯函数）。 */\n' +
    'window.__PREVIEW_FIXTURES__ = ' +
    JSON.stringify({ state, catalog }) +
    ';\n'
)

console.log('provider 数:', groups.length, '模型数:', groups.reduce((n, g) => n + g.models.length, 0))
console.log('接管计划:', plan.ops.length, '条 op，覆盖', plan.planned.length, '个模型')
console.log('current:', JSON.stringify(current))
console.log('有档位的模型:', groups.flatMap((g) => g.models).filter((m) => m.reasoning).length)
for (const g of groups) {
  for (const m of g.models) {
    const r = m.reasoning
    console.log(
      '  ' + g.id + '/' + m.id + ' -> ' + (r ? r.efforts.map((e) => e.id).join('|') : '(无档位)')
    )
  }
}
console.log('知识库规则数:', state.rules.length, 'configFile:', state.configFile, 'NS:', NS)
