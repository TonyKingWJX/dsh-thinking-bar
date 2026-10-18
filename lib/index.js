/**
 * lib/index.js —— dsh-thinking-effort Host 半侧（数据层）
 *
 * 职责（DESIGN.md §2 / §7B / §7C）：
 *   1. 扫描 settings namespace `llm-pi-ai` 的 user 层 providers.<route>.models.*
 *   2. 按 R2 准入三条件挑出「已声明 reasoningEfforts、但档位不全」的条目
 *   3. 按三级能力瀑布决定档位：用户手动覆盖 > 上游探测缓存 > 知识库静态表 > 默认保守档
 *   4. 经 settings.mutate('llm-pi-ai', ops, expectedRevision) 逐档 merge 补写
 *      （只写 reasoningEfforts，绝不写 defaultEffort —— R8）
 *   5. 监听 settings/document-updated + llm/adapters-updated 实现自动接管（R6）
 *   6. 双通道对浏览器半侧提供数据：HTTP 路由（主通道，§7C）+ host.call（兜底）
 *
 * 设计取舍：
 *   - R8：官方模型条目 schema 只有 reasoningEfforts，没有 defaultEffort
 *     （asar:860404/860411；defaultEffort 是 reasoningInfo 的派生字段，asar:861859-861867）。
 *     因此本文件产出的任何 ops 都不得包含 defaultEffort；decided.defaultEffort 只留在
 *     planned / overrides 里供设置页展示。
 *   - R2：写任何 reasoningEfforts dict 都会把 reasoning 钉为 true（asar:859990），
 *     所以只接管「已经自己声明了 reasoningEfforts」的条目，绝不替模型猜测推理能力。
 *   - R3：补写是 merge 不是 replace —— 逐档 set，已有键一律不动，缺键才写。
 *   - R4：off 键的三态（null / 缺键 / wire）原样保留，本文件既不新建也不改写 off 键。
 *   - R10：知识库值里的 'inherit' 表示「该档缺键兜底，不写这个键」，构造 ops 时过滤。
 *   - YAML 陷阱：settings.mutate 走 JSON 路径操作，不经过 YAML 解析，所以裸 "off"
 *     不会被 YAML 1.1 解析成布尔 false（DESIGN.md §2/R5）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_EFFORTS,
  THINKING_LEVELS,
  listRules,
  lookupKnowledge,
  normalizeEfforts
} from './knowledge.js'

const NS = 'thinking-effort'
const PKG = 'dsh-thinking-effort'

/** 被接管的 settings namespace（DESIGN.md §1）。 */
const LLM_NS = 'llm-pi-ai'

/** 插件自身配置文件位置：$DSH_HOME/thinking-effort.json，回落 ~/.dsh/thinking-effort.json。 */
const DSH_HOME = process.env.DSH_HOME || path.join(process.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'thinking-effort.json')

/** 浏览器半侧 HTTP 路由（DESIGN.md §7C，冻结契约）。 */
const ROUTE_PATH = '/dsh-thinking-effort/api'
/** POST body 上限，超出直接 400，避免把路由当成任意大小上传口。 */
const BODY_LIMIT = 64 * 1024

/** 自动接管去抖窗口（R6）：事件回调只置 dirty，窗口结束后才真正 reconcile。 */
const DEBOUNCE_MS = 300
/** R1：conflict 后重算重试，最多 3 次重试（合计 4 次尝试），退避 100/300/900ms。 */
const WRITE_BACKOFF_MS = [100, 300, 900]
const WRITE_ATTEMPTS = 1 + WRITE_BACKOFF_MS.length

/** 设置页与知识库共享的默认配置形状。 */
const DEFAULTS = {
  /** 总开关。false 时插件完全不动 settings（但设置页仍可读写自身配置）。 */
  enabled: true,
  /**
   * 接管模式：
   *   'auto'    自动补写 reasoningEfforts 到 settings（本卡片的默认行为）
   *   'overlay' 只做 UI 浮层，不改任何配置（后续 UI 卡片消费）
   */
  mode: 'auto',
  /** 上游探测开关，默认关闭（DESIGN.md §2.2）。 */
  probe: false,
  /**
   * 每提供商独立开关（新增）。
   * key   = '<route>'（settings 里 providers 的键）
   * value = { enabled: boolean }
   * 语义：enabled === false 时该 provider 下所有模型一律不接管，优先级高于
   * overrides / probes / 知识库 —— 关掉一个 provider 就该整体闭嘴。
   * 未登记的 route 视为接管（与旧配置向后兼容）。
   */
  providers: {},
  /**
   * 每模型勾选的档位（新增）。
   * key   = '<route>/<model-id>'
   * value = { levels: string[] }
   * 语义：levels 是数组时，只写这些档位 —— 与知识库/兜底算出的 efforts 取交集；
   * 交集为空则不接管。未登记的模型视为不限制（写全部算出来的档位）。
   */
  models: {},
  /** 知识库未命中时的默认档位表。 */
  defaultEfforts: { ...DEFAULT_EFFORTS },
  /**
   * 用户手动覆盖表，最高优先级，永不被自动接管覆盖。
   * key   = '<route>/<model-id>'
   * value = { efforts: {档位: wire|null}, defaultEffort: string|null }
   */
  overrides: {},
  /** 探测结果缓存：key → { efforts, source, at }，仅在 probe 开启时有内容。 */
  probes: {}
}

/* ------------------------------------------------------------------ *
 * 配置读写（原子写：tmp + rename）
 * ------------------------------------------------------------------ */

function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {
    enabled: src.enabled === undefined ? DEFAULTS.enabled : !!src.enabled,
    mode: src.mode === 'overlay' ? 'overlay' : 'auto',
    probe: !!src.probe,
    providers: {},
    models: {},
    defaultEfforts: normalizeEfforts(src.defaultEfforts) || { ...DEFAULT_EFFORTS },
    overrides: {},
    probes: {}
  }
  // defaultEfforts 为空时回落到保守档，避免产出非法配置
  if (!Object.keys(out.defaultEfforts).length) out.defaultEfforts = { ...DEFAULT_EFFORTS }

  // providers：只保留 {enabled:boolean}，其余键一律丢弃
  const rawProviders = src.providers && typeof src.providers === 'object' && !Array.isArray(src.providers) ? src.providers : {}
  for (const [route, value] of Object.entries(rawProviders)) {
    if (!route || typeof route !== 'string') continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    out.providers[route] = { enabled: !!value.enabled }
  }

  // models：levels 只留 THINKING_LEVELS 内的合法档位，去重并按 THINKING_LEVELS 顺序归一
  const rawModels = src.models && typeof src.models === 'object' && !Array.isArray(src.models) ? src.models : {}
  for (const [key, value] of Object.entries(rawModels)) {
    if (!key || typeof key !== 'string') continue
    // key 必须是 '<route>/<model-id>' 且两段都非空，否则无法定位模型
    const slash = key.indexOf('/')
    if (slash <= 0 || slash === key.length - 1) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    if (!Array.isArray(value.levels)) continue
    const picked = new Set()
    for (const level of value.levels) {
      if (typeof level === 'string' && THINKING_LEVELS.includes(level)) picked.add(level)
    }
    out.models[key] = { levels: THINKING_LEVELS.filter((level) => picked.has(level)) }
  }

  const rawOverrides = src.overrides && typeof src.overrides === 'object' ? src.overrides : {}
  for (const [key, value] of Object.entries(rawOverrides)) {
    if (!key || typeof key !== 'string' || !value || typeof value !== 'object') continue
    const efforts = normalizeEfforts(value.efforts)
    if (!Object.keys(efforts).length) continue
    const defaultEffort =
      typeof value.defaultEffort === 'string' && THINKING_LEVELS.includes(value.defaultEffort) && value.defaultEffort in efforts
        ? value.defaultEffort
        : null
    out.overrides[key] = { efforts, defaultEffort }
  }

  const rawProbes = src.probes && typeof src.probes === 'object' ? src.probes : {}
  for (const [key, value] of Object.entries(rawProbes)) {
    if (!key || !value || typeof value !== 'object') continue
    const efforts = normalizeEfforts(value.efforts)
    if (!Object.keys(efforts).length) continue
    out.probes[key] = { efforts, source: String(value.source || 'probe'), at: Number(value.at) || 0 }
  }

  return out
}

function readConfig() {
  try {
    return normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
  } catch (err) {
    return normalize({})
  }
}

function writeConfig(next) {
  const cfg = normalize(next)
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  const tmp = CONFIG_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  fs.renameSync(tmp, CONFIG_FILE)
  return cfg
}

/* ------------------------------------------------------------------ *
 * 档位决策
 * ------------------------------------------------------------------ */

/**
 * 把「决策出来的档位表」收敛成「真正能写进 settings 的档位表」（R10）。
 *
 * 知识库规则的 efforts 值里可能出现字符串 'inherit'，含义是「该档靠缺键兜底，
 * 不要写这个键」；undefined 同理。这里只保留真实 wire 字符串或 null，
 * 让 planned 展示的形状与 ops 实际写入的形状保持一致。
 *
 * @param {object} efforts 原始档位表
 * @returns {object} 只含真实 wire 字符串 / null 的档位表
 */
export function writableEfforts(efforts) {
  const out = {}
  if (!efforts || typeof efforts !== 'object') return out
  for (const level of THINKING_LEVELS) {
    const wire = efforts[level]
    if (wire === undefined || wire === 'inherit') continue
    if (wire === null || (typeof wire === 'string' && wire)) out[level] = wire
  }
  return out
}

/**
 * 决定某个模型该写什么档位。
 *
 * 返回 null 表示「本模型不接管」（明确的 skip 信号）：
 *   - provider 单独开关被关掉（config.providers[route].enabled === false）
 *   - models[key].levels 是数组且与算出来的档位交集为空
 * 调用方（needsEfforts / planReconcile）据此跳过；绝不返回空 efforts 冒充接管。
 *
 * @param {object} args
 * @param {string} args.route       provider 路由名
 * @param {string} args.modelId     模型 id
 * @param {object} args.entry       模型条目（含 reasoningEfforts / name 等）
 * @param {object} args.config      插件配置
 * @returns {{efforts: object, defaultEffort: string|null, source: string, ruleId?: string, levels?: string[]} | null}
 */
export function decideEfforts({ route, modelId, entry, config }) {
  const key = route + '/' + modelId

  // 第零级：provider 单独开关。关掉即整体不接管，优先于任何档位来源。
  const provider = config?.providers?.[route]
  if (provider && provider.enabled === false) return null

  const decided = decideByWaterfall({ route, modelId, entry, config, key })
  if (!decided) return null

  // 每模型勾选的档位：是数组时只写这些档位（与瀑布算出的 efforts 取交集）。
  // 交集为空 → 不接管（返回 null），而不是伪装成空接管。
  const picked = config?.models?.[key]
  if (picked && Array.isArray(picked.levels)) {
    const allowed = new Set(picked.levels)
    const efforts = {}
    for (const level of THINKING_LEVELS) {
      if (allowed.has(level) && level in decided.efforts) efforts[level] = decided.efforts[level]
    }
    if (!Object.keys(efforts).length) return null
    return {
      ...decided,
      efforts,
      defaultEffort: chooseDefault(decided.defaultEffort, efforts),
      levels: [...picked.levels]
    }
  }

  return decided
}

/**
 * 三级能力瀑布（不含 provider 开关与 per-model 档位过滤，那两层在 decideEfforts 里）。
 * 返回值一定是「已收敛成可写档位表」的决策结果。
 */
function decideByWaterfall({ route, modelId, entry, config, key }) {
  // 第一级之上：用户手动覆盖永远优先（DESIGN.md §2.3）
  const override = config.overrides[key]
  if (override) {
    const efforts = writableEfforts(override.efforts)
    return {
      efforts,
      defaultEffort: chooseDefault(override.defaultEffort, efforts),
      source: 'override',
      ruleId: key
    }
  }

  // 第二级：上游探测（默认关闭；当前实现只消费缓存结果，采集留给后续卡片）
  if (config.probe) {
    const probed = config.probes[key]
    if (probed) {
      const efforts = writableEfforts(probed.efforts)
      return {
        efforts,
        defaultEffort: pickDefault(efforts),
        source: probed.source || 'probe',
        ruleId: key
      }
    }
  }

  // 第三级：知识库静态表
  const hit = lookupKnowledge({
    providerId: route,
    baseId: modelId,
    modelName: entry?.name
  })
  if (hit) {
    const efforts = writableEfforts(hit.efforts)
    return {
      efforts,
      defaultEffort: pickDefault(efforts),
      source: hit.source,
      ruleId: hit.ruleId
    }
  }

  // 兜底：默认保守档位
  const efforts = writableEfforts(config.defaultEfforts)
  return { efforts, defaultEffort: pickDefault(efforts), source: 'default' }
}

/**
 * defaultEffort 选档规则：
 *   1. 有 off 档时选 off —— 官方把「不思考」当默认，用户可自行上调
 *   2. 否则取档位表中声明顺序的最后一个（通常是最高档）
 * 空档位表返回 null。
 *
 * 注意：defaultEffort 只是给设置页展示用（R8），永远不会写进 llm-pi-ai。
 */
export function pickDefault(efforts) {
  const keys = THINKING_LEVELS.filter((level) => level in efforts)
  if (!keys.length) return null
  if (keys.includes('off')) return 'off'
  return keys[keys.length - 1]
}

/**
 * R8 defaultGuard 的展示侧：首选档位必须真的在「可写档位表」里，否则回落到
 * pickDefault。防止把用户覆盖表里指向 inherit/已过滤档位的 defaultEffort
 * 显示成一个根本不提供的档位（那会让每请求都 UNSUPPORTED_REASONING_EFFORT）。
 */
function chooseDefault(preferred, efforts) {
  if (typeof preferred === 'string' && preferred in efforts) return preferred
  return pickDefault(efforts)
}

/**
 * 按官方 resolveModelReasoning（asar:860700-860722）的同一套规则，从模型条目上
 * 取回 reasoning / thinkingLevelMap 两个派生字段。
 *
 * 为什么需要推导：settings 的 user 层是原始配置值，模型条目 schema
 * （asar:861136-861142）只有 reasoningEfforts，没有 reasoning、也没有
 * thinkingLevelMap；这两个字段是官方构建 catalog 时现场派生的。本插件读的就是
 * user 层，所以必须自己复刻派生规则，R2 的准入条件才有东西可判。
 *
 * 派生规则（逐字复刻官方）：
 *   - reasoningEfforts 缺省 / false / null → reasoning = false，无 map
 *     （自定义 provider 没有已安装目录可回退，base 为 undefined）
 *   - 非空 dict → reasoning = true，map 按 THINKING_LEVELS 展开：
 *       dict 缺键      → map[level] = null（该档不提供）
 *       dict 显式 null → map 该键不存在（该档提供，但 wire 为空）
 *       dict 字符串    → map[level] = wire
 *   - 官方会判 invalid 的 dict（空表 / 只有 off 档 / 非 off 档 wire 为 null /
 *     空串 wire）一律按「不可接管」处理，避免往坏配置上继续叠写
 *
 * 条目上不带 reasoningEfforts、却 literal 带着 reasoning / thinkingLevelMap 时
 * （例如将来 Host 直接喂 catalog 条目），以条目上的值为准。
 *
 * @param {object} entry 模型条目
 * @returns {{reasoning: boolean, thinkingLevelMap: object|null}}
 */
export function resolveEntryReasoning(entry) {
  const none = { reasoning: false, thinkingLevelMap: null }
  if (!entry || typeof entry !== 'object') return none

  if ('reasoningEfforts' in entry) {
    const efforts = entry.reasoningEfforts
    if (efforts === undefined || efforts === false || efforts === null) return none
    if (typeof efforts !== 'object' || Array.isArray(efforts)) return none

    const declared = THINKING_LEVELS.filter((level) => efforts[level] !== undefined)
    if (!declared.length) return none
    // 必须至少声明一个非 off 档，否则官方判 invalid
    if (!declared.some((level) => level !== 'off')) return none
    for (const level of declared) {
      const wire = efforts[level]
      // 只有 off 允许空 wire；空串 wire 官方直接报错
      if (wire === null) {
        if (level !== 'off') return none
        continue
      }
      if (typeof wire !== 'string' || !wire) return none
    }

    const map = {}
    for (const level of THINKING_LEVELS) {
      const wire = efforts[level]
      if (wire === undefined) map[level] = null
      else if (wire !== null) map[level] = wire
    }
    return { reasoning: true, thinkingLevelMap: map }
  }

  const map = entry.thinkingLevelMap
  return {
    reasoning: entry.reasoning === true,
    thinkingLevelMap: map && typeof map === 'object' && !Array.isArray(map) ? map : null
  }
}

/**
 * 该条目是否需要我们补写（R2 准入三条件，DESIGN.md §2/§7B）。
 *
 * 三个条件必须同时成立：
 *   1. entry.reasoning === true
 *   2. entry.thinkingLevelMap 已存在且是对象
 *   3. 目标档位中至少有一档在 thinkingLevelMap 里非 null
 *
 * 删除「未声明 reasoning 但知识库命中 → 疑似推理」的猜测分支：写任何
 * reasoningEfforts dict 都会把 reasoning 钉为 true（asar:859990），会误伤
 * reasoning:false 的模型（groq llama / azure 全系 / together Qwen2.5）。
 *
 * @param {object} entry   模型条目
 * @param {object} decided decideEfforts 的返回值
 * @returns {boolean}
 */
export function needsEfforts(entry, decided) {
  if (!entry || typeof entry !== 'object') return false
  if (!decided || !decided.efforts || typeof decided.efforts !== 'object') return false

  // 条件 1 + 条件 2：reasoning 与 thinkingLevelMap 均按官方语义派生
  const resolved = resolveEntryReasoning(entry)
  if (resolved.reasoning !== true) return false
  const map = resolved.thinkingLevelMap
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false

  // 条件 3：目标档位中至少一档在 map 里非 null
  const targets = Object.keys(decided.efforts)
  if (!targets.length) return false
  return targets.some((level) => map[level] !== null && map[level] !== undefined)
}

/**
 * 某个档位能不能写进 settings（R3/R4/R10 合并后的写入判据）。
 *
 *   - 'off' 键一律不写：off 的三态（null / 缺键 / wire）必须原样保留（R4），
 *     缺键就继续缺键，绝不新建
 *   - 'inherit' / undefined / 空串一律不写（R10：缺键兜底，不写这个键）
 *   - null 一律不写：null 只对 off 合法，而 off 又不写
 *   - 只有非空字符串 wire 才真正落盘
 */
function isWritableWire(level, wire) {
  if (level === 'off') return false
  if (wire === 'inherit' || wire === undefined || wire === null) return false
  return typeof wire === 'string' && wire.length > 0
}

/* ------------------------------------------------------------------ *
 * 扫描与写入
 * ------------------------------------------------------------------ */

/**
 * 在 llm-pi-ai 的 user 层里找出所有 provider / 模型条目。
 * 只读 user 层：base 层是官方目录，不该被我们改。
 *
 * models 有两种形状都要认：
 *   - 数组（官方 schema 形状，asar:861155-861184）：id 在条目自己的 id 字段上，
 *     写入路径用字符串下标寻址（applyPathOp 支持，asar:965753）
 *   - dict（历史形状 / 测试夹具）：id 就是 dict 的键
 *
 * @returns {Array<{route: string, modelId: string, segment: string, entry: object}>}
 *   segment 是写入路径里用的那一段（数组下标或 dict 键）
 */
export function scanModels(descriptor) {
  const out = []
  const user = descriptor?.user
  if (!user || typeof user !== 'object') return out
  const providers = user.providers
  if (!providers || typeof providers !== 'object') return out
  for (const [route, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== 'object') continue
    const models = provider.models
    if (!models || typeof models !== 'object') continue
    if (Array.isArray(models)) {
      models.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return
        const modelId = typeof entry.id === 'string' && entry.id ? entry.id : String(index)
        out.push({ route, modelId, segment: String(index), entry })
      })
      continue
    }
    for (const [modelId, entry] of Object.entries(models)) {
      if (!entry || typeof entry !== 'object') continue
      out.push({ route, modelId, segment: modelId, entry })
    }
  }
  return out
}

/**
 * R8 defaultGuard（写入侧硬断言）。
 *
 * 我们不写 defaultEffort（官方模型条目 schema 没有这个字段，asar:860404/860411），
 * 所以这里守的是真正会让每个请求都报错的另一条：补写之后整个 reasoningEfforts
 * dict 必须仍然满足官方 resolveModelReasoning 的校验（asar:855485-855493）——
 *   1. 至少声明一个非 off 档
 *   2. 只有 off 允许空 wire（null）
 *   3. wire 不能是空字符串
 * 不满足就中止该模型的补写（只在「条目 literal 带着坏 reasoningEfforts、
 * 又没有可合并的既有 dict」这种边角才会触发，属于防御性断言）。
 *
 * @param {object|null} existing 条目上已有的 reasoningEfforts
 * @param {object} pending      本轮打算补写的档位
 * @returns {boolean}
 */
export function passesWriteGuard(existing, pending) {
  const merged = { ...(existing || {}) }
  for (const [level, wire] of Object.entries(pending)) merged[level] = wire
  const declared = THINKING_LEVELS.filter((level) => merged[level] !== undefined)
  if (!declared.some((level) => level !== 'off')) return false
  for (const level of declared) {
    const wire = merged[level]
    if (wire === null) {
      if (level !== 'off') return false
      continue
    }
    if (typeof wire !== 'string' || !wire) return false
  }
  return true
}

/**
 * 纯函数式计算：给定 descriptor + config，返回要写的 ops 与人类可读的计划。
 * 抽出来是为了让浏览器半侧能「预览将要发生什么」而不必真的写。
 *
 * R3（merge 不 replace）：逐档 set，只补 dict 里缺的键；已有键一律不动，
 * 绝不 unset 用户键，也绝不整表覆盖。
 * R8：ops 里永远不出现 defaultEffort；写入前过 passesWriteGuard 硬断言。
 */
export function planReconcile(descriptor, config) {
  const ops = []
  const planned = []
  const blocked = []
  for (const { route, modelId, segment, entry } of scanModels(descriptor)) {
    const decided = decideEfforts({ route, modelId, entry, config })
    if (!needsEfforts(entry, decided)) continue

    const existing =
      entry.reasoningEfforts && typeof entry.reasoningEfforts === 'object' && !Array.isArray(entry.reasoningEfforts)
        ? entry.reasoningEfforts
        : null
    const base = ['providers', route, 'models', segment]

    // 先算差集：只补缺失的档位（R3），off 键绝不新建（R4），inherit/undefined/null 不写（R10）
    const pending = {}
    for (const level of THINKING_LEVELS) {
      if (existing && level in existing) continue
      if (!isWritableWire(level, decided.efforts[level])) continue
      pending[level] = decided.efforts[level]
    }
    // 没有可补的档位就不进计划，保证 planned 与 ops 一一对应
    if (!Object.keys(pending).length) continue

    const summary = {
      route,
      modelId,
      source: decided.source,
      ruleId: decided.ruleId || null,
      efforts: { ...decided.efforts },
      defaultEffort: decided.defaultEffort || null
    }
    // R8：写完之后仍不满足官方校验就中止该模型的补写（进 blocked 列表，由调用方告警）
    if (!passesWriteGuard(existing, pending)) {
      blocked.push({ route, modelId, reason: 'write-guard' })
      continue
    }

    for (const [level, wire] of Object.entries(pending)) {
      ops.push({ op: 'set', path: [...base, 'reasoningEfforts', level], value: wire })
    }
    planned.push(summary)
  }
  return { ops, planned, blocked }
}

/* ------------------------------------------------------------------ *
 * 插件
 * ------------------------------------------------------------------ */

const name = NS
const inject = ['settings', 'webServer']

/**
 * 取 settings 服务。Host 半侧按依赖注入拿到它；取不到时退化为 null，
 * 此时自动接管不工作，但插件仍然 APPLIED（设置页自身配置仍可读写）。
 */
function resolveSettings(ctx) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
    if (viaGet) return viaGet
  } catch (err) {
    /* 取不到就当没有 */
  }
  return ctx.settings
}

/**
 * 取 webServer 服务（DESIGN.md §7A/§7C：浏览器半侧走 fetch 同源相对路径，
 * Module Loader 包通道没有 host.call，必须由 Host 半注册 HTTP 路由）。
 */
function resolveWebServer(ctx) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (viaGet) return viaGet
  } catch (err) {
    /* 取不到就当没有 */
  }
  return ctx.webServer
}

/** 沿 JSON 路径读一个值，读不到返回 undefined。 */
function readPath(root, pathSegments) {
  let node = root
  for (const segment of pathSegments) {
    if (node === null || node === undefined) return undefined
    if (Array.isArray(node)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined
      node = node[Number(segment)]
    } else if (typeof node === 'object') {
      node = node[segment]
    } else {
      return undefined
    }
  }
  return node
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function apply(ctx) {
  const disposers = []
  let settings = null
  try {
    settings = resolveSettings(ctx)
  } catch (err) {
    settings = null
  }

  let config = readConfig()
  /** 最近一次扫描结果，供设置页展示「当前接管计划」。 */
  let lastPlan = { ops: [], planned: [] }
  /** 最近一次「我们自己写进去」的 revision，用于回执抑制（R6）。 */
  let lastSelfWrite = { ns: LLM_NS, revision: -1 }
  /** 上一次真正扫过的 provider 签名，用于 provider 签名去重（R6）。 */
  let lastSignature = null
  /** 单写者队列的尾巴（R1）：同一时刻只有一个 reconcile 在写 settings。 */
  let writeTail = Promise.resolve()

  const log = (level, message) => {
    try {
      const fn = ctx?.logger?.[level] || ctx?.logger?.info
      fn?.call(ctx?.logger, '[' + PKG + '] ' + message)
    } catch (err) {
      /* 日志失败不影响功能 */
    }
  }

  /** 实时 describe 一次 llm-pi-ai（R1：expectedRevision 禁止缓存跨写周期）。 */
  async function describeLLM() {
    const descriptors = await settings.describe({ redactSecrets: false })
    if (!Array.isArray(descriptors)) return null
    return descriptors.find((d) => d && d.ns === LLM_NS) || null
  }

  /** provider 签名：route + 条目键集合。签名不变说明没有新模型、没有档位增减。 */
  function providerSignature(descriptor) {
    try {
      return scanModels(descriptor)
        .map((m) => m.route + '/' + m.segment + '#' + Object.keys(m.entry).sort().join(','))
        .join('|')
    } catch (err) {
      return null
    }
  }

  /** R1：把所有写操作串行到单写者队列里，前一个失败不阻塞后一个。 */
  function enqueueWrite(task) {
    const run = writeTail.then(task, task)
    writeTail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /**
   * 跑一轮接管：扫描 → 计算 ops → 写回 → 自检。
   *
   * R1 写入通道：
   *   - 单写者队列（同 ns 同时只有一个 in-flight 写）
   *   - expectedRevision 每次实时 describe 取，禁止缓存
   *   - settings/conflict → 重新 describe + 重算差集，最多重试 3 次
   *     （退避 100/300/900ms）
   *   - 写后 describe 自检：每个 op 的路径都必须已经是目标值，不符只告警不重试
   *
   * @param {string} reason  触发原因（写日志用）
   * @param {{force?: boolean}} options force=true 时跳过 provider 签名去重
   */
  async function reconcile(reason, options) {
    const force = !!(options && options.force)
    if (!settings || typeof settings.describe !== 'function' || typeof settings.mutate !== 'function') {
      return { ok: false, skipped: 'settings-unavailable', planned: [] }
    }
    const configNow = readConfig()
    if (!configNow.enabled || configNow.mode !== 'auto') {
      return { ok: true, skipped: 'disabled', planned: [] }
    }
    return enqueueWrite(() => runReconcile(reason, configNow, force))
  }

  async function runReconcile(reason, configNow, force) {
    let lastError = null
    for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
      let descriptor = null
      let signature = null
      try {
        descriptor = await describeLLM()
        if (!descriptor) return { ok: true, skipped: 'namespace-missing', planned: [] }

        // R6：provider 签名去重，签名不变就跳过本轮（配置变更/手动扫描都走 force）
        signature = force ? null : providerSignature(descriptor)
        if (signature !== null && signature === lastSignature) {
          return { ok: true, skipped: 'signature-unchanged', planned: lastPlan.planned }
        }

        const plan = planReconcile(descriptor, configNow)
        lastPlan = plan
        for (const item of plan.blocked || []) {
          log('warn', '模型 ' + item.route + '/' + item.modelId + ' 补写后无法满足官方 reasoningEfforts 校验（' + item.reason + '），已跳过（' + reason + '）。')
        }
        if (!plan.ops.length) {
          if (signature !== null) lastSignature = signature
          return { ok: true, skipped: 'up-to-date', planned: plan.planned }
        }

        const view = await settings.mutate(LLM_NS, plan.ops, descriptor.revision)

        // 写后自检：重新 describe，确认每个档位都已生效
        const after = await describeLLM()
        const revision = Number(view?.revision ?? after?.revision)
        if (Number.isFinite(revision)) lastSelfWrite = { ns: LLM_NS, revision }
        const missing = plan.ops.filter((op) => readPath(after?.user, op.path) !== op.value)
        if (signature !== null) lastSignature = signature
        if (missing.length) {
          log('warn', '写入后自检未发现 ' + missing.length + ' 个档位生效（' + reason + '），可手动点「立即扫描」重试。')
          return { ok: true, planned: plan.planned, verified: false }
        }

        log('info', '已按 ' + reason + ' 补写 ' + plan.planned.length + ' 个模型的思考档位（' + plan.ops.length + ' 个档位）。')
        return { ok: true, planned: plan.planned, verified: true }
      } catch (err) {
        lastError = err
        const conflict = err?.code === 'settings/conflict' || /conflict/i.test(String(err?.message))
        // revision 冲突：退避后重新 describe + 重算差集再写
        if (conflict && attempt < WRITE_ATTEMPTS) {
          await sleep(WRITE_BACKOFF_MS[attempt - 1])
          continue
        }
        break
      }
    }
    log('warn', '本轮接管（' + reason + '）失败：' + (lastError?.message || String(lastError)))
    return { ok: false, error: String(lastError?.message || lastError), planned: [] }
  }

  /* ---------------- 浏览器半侧 API（host.call 兜底 + HTTP 主通道共用） ---------------- */

  /** §7C 冻结的 getState 形状：config 暴露开关字段 + 新增 providers / models。 */
  function configView(cfg) {
    return {
      enabled: cfg.enabled,
      mode: cfg.mode,
      probe: cfg.probe,
      providers: cfg.providers,
      models: cfg.models
    }
  }

  /**
   * 从 llm-pi-ai 的 user 层扫描 provider 列表，供设置页渲染「每提供商开关 + 每模型档位复选框」。
   *
   * 与 scanModels 的区别：这里 provider 本身也要出现（哪怕它还没有任何模型条目），
   * 所以直接遍历 user.providers，而不是复用只吐模型的 scanModels。
   *
   * 每项形状：
   *   { id, name, api, enabled, models: [{ id, name, levels, planned }] }
   *   - api：provider profile 的 api 字段，仅作协议展示标注
   *     （值域 openai-completions / openai-responses / anthropic-messages）
   *   - enabled：config.providers[route].enabled，未登记视为 true
   *   - levels：config.models[key].levels，未登记为 null（设置页自行决定勾选态）
   *   - planned：该模型当前算出来的接管计划，不接管时为 null
   *
   * planned 直接取自 planReconcile 的结果（按 <route>/<modelId> 建索引），
   * 而不是在这里重算一遍 decideEfforts —— 否则 providerViews.planned 与
   * getState().planned 会在「决策出档位但无可写 wire」时给出互相矛盾的两份计划。
   */
  function providerViews(descriptor, cfg, plannedByKey) {
    const out = []
    const user = descriptor?.user
    const providers = user && typeof user === 'object' ? user.providers : null
    if (!providers || typeof providers !== 'object') return out

    for (const [route, provider] of Object.entries(providers)) {
      if (!provider || typeof provider !== 'object') continue
      const providerCfg = cfg.providers[route]
      const models = []
      for (const scanned of scanModels({ user: { providers: { [route]: provider } } })) {
        const key = route + '/' + scanned.modelId
        const picked = cfg.models[key]
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
        enabled: providerCfg ? providerCfg.enabled !== false : true,
        models
      })
    }
    return out
  }

  /** 返回插件配置 + 当前接管计划 + 知识库清单（设置页首屏一次性拉齐）。 */
  async function getState() {
    config = readConfig()
    let descriptor = null
    try {
      descriptor = await describeLLM()
    } catch (err) {
      descriptor = null
    }
    const view = descriptor ? planReconcile(descriptor, config) : { ops: [], planned: [] }
    lastPlan = view
    // 每模型的接管计划按 <route>/<modelId> 建索引，供 providerViews 复用同一份计划
    const plannedByKey = new Map()
    for (const item of view.planned || []) plannedByKey.set(item.route + '/' + item.modelId, item)
    return {
      config: configView(config),
      overrides: config.overrides,
      providers: descriptor ? providerViews(descriptor, config, plannedByKey) : [],
      models: config.models,
      planned: view.planned,
      levels: [...THINKING_LEVELS],
      rules: listRules(),
      configFile: CONFIG_FILE,
      available: !!settings
    }
  }

  /** 写插件配置（总开关 / 接管模式 / 探测开关 / 覆盖表），随后立刻跑一轮接管。 */
  async function setConfig(args) {
    const next = readConfig()
    const patch = args && typeof args === 'object' ? args : {}
    if (patch.enabled !== undefined) next.enabled = !!patch.enabled
    if (patch.mode !== undefined) next.mode = patch.mode === 'overlay' ? 'overlay' : 'auto'
    if (patch.probe !== undefined) next.probe = !!patch.probe
    if (patch.defaultEfforts !== undefined) {
      const efforts = normalizeEfforts(patch.defaultEfforts)
      next.defaultEfforts = Object.keys(efforts).length ? efforts : { ...DEFAULT_EFFORTS }
    }
    config = writeConfig(next)
    const result = await reconcile('setConfig', { force: true })
    return { config, overrides: config.overrides, result }
  }

  /** 设置页的 per-provider → per-model 覆盖表整体覆盖写入。 */
  async function setOverrides(args) {
    const next = readConfig()
    const overrides = args && typeof args === 'object' ? args.overrides : args
    next.overrides = overrides && typeof overrides === 'object' ? overrides : {}
    config = writeConfig(next)
    const result = await reconcile('setOverrides', { force: true })
    return { config, overrides: config.overrides, result }
  }

  /** 删除单个覆盖项（key = '<route>/<model-id>'）。 */
  async function clearOverride(args) {
    const key = String((args && args.key) || '')
    const next = readConfig()
    delete next.overrides[key]
    config = writeConfig(next)
    const result = await reconcile('clearOverride', { force: true })
    return { config, result }
  }

  /** 手动触发一轮扫描（按钮「立即扫描」）。 */
  async function rescan() {
    const result = await reconcile('手动扫描', { force: true })
    return { result, planned: lastPlan.planned }
  }

  /**
   * 写单个 provider 的独立开关（设置页每提供商一行开关）。
   * 只动 providers[route]，其余配置原样保留；写完立刻跑一轮强制接管。
   */
  async function setProvider(args) {
    const route = String((args && args.route) || '')
    if (!route) return { ok: false, error: 'route 必填' }
    const next = readConfig()
    const enabled = !!(args && args.enabled)
    next.providers[route] = { enabled }
    config = writeConfig(next)
    const result = await reconcile('setProvider', { force: true })
    return { config, providers: config.providers, result }
  }

  /**
   * 写单个模型的勾选档位（设置页每模型一组复选框）。
   * levels 只保留 THINKING_LEVELS 内的合法档位、去重并按 THINKING_LEVELS 顺序归一；
   * 传空数组表示「该模型一档都不勾」→ 与任何瀑布结果交集为空 → 不接管。
   */
  async function setModelLevels(args) {
    const route = String((args && args.route) || '')
    const modelId = String((args && args.modelId) || '')
    if (!route || !modelId) return { ok: false, error: 'route 与 modelId 必填' }
    const key = route + '/' + modelId
    const picked = new Set()
    const rawLevels = args && Array.isArray(args.levels) ? args.levels : []
    for (const level of rawLevels) {
      if (typeof level === 'string' && THINKING_LEVELS.includes(level)) picked.add(level)
    }
    const levels = THINKING_LEVELS.filter((level) => picked.has(level))
    const next = readConfig()
    next.models[key] = { levels }
    config = writeConfig(next)
    const result = await reconcile('setModelLevels', { force: true })
    return { config, models: config.models, result }
  }

  /**
   * 上游探测入口（R7 降级）。
   *
   * 官方 discoverModels 结构上不携带 reasoningEfforts（asar:859022/859269），
   * 所以探测回答不了「这个模型有哪些档位」，只能回答「route 通不通、有哪些模型 id」。
   * 这里明确返回降级结论，绝不声称能探测到档位；连通性探测本身留给后续卡片。
   */
  async function probe() {
    return {
      supported: false,
      reason:
        '上游探测已降级为连通性/模型存在性探测：官方 discoverModels 结构上不携带 reasoningEfforts，' +
        '无法探测档位。当前档位来源仅知识库与手动覆盖。'
    }
  }

  /** §7C 冻结的方法面（短名 → 实现），HTTP 与 host.call 共用同一批函数。 */
  const api = { getState, setConfig, setOverrides, clearOverride, setProvider, setModelLevels, rescan, probe }

  /* ---------------- HTTP 路由（浏览器半侧主通道，DESIGN.md §7C） ---------------- */

  function sendJson(res, code, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store'
    })
    res.end(body)
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          reject(new Error('request body too large'))
          req.destroy?.()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  /** 归一化方法名：既接受 §7C 的短名，也容忍带命名空间前缀的旧写法。 */
  function resolveApi(method) {
    if (typeof method !== 'string' || !method) return null
    const short = method.startsWith(NS + '/') ? method.slice(NS.length + 1) : method
    return typeof api[short] === 'function' ? api[short] : null
  }

  async function handleHttp(req, res) {
    const method = String(req.method || 'GET').toUpperCase()
    if (method === 'GET' || method === 'HEAD') {
      try {
        sendJson(res, 200, { ok: true, ...(await getState()) })
      } catch (err) {
        sendJson(res, 400, { ok: false, error: String(err?.message || err) })
      }
      return
    }
    if (method !== 'POST') {
      sendJson(res, 400, { ok: false, error: 'method not allowed: ' + method })
      return
    }

    let payload = null
    try {
      const raw = await readBody(req, BODY_LIMIT)
      payload = raw.trim() ? JSON.parse(raw) : {}
    } catch (err) {
      sendJson(res, 400, { ok: false, error: 'invalid json body: ' + String(err?.message || err) })
      return
    }

    const name0 = payload && typeof payload === 'object' ? payload.method : undefined
    const fn = resolveApi(name0)
    if (!fn) {
      sendJson(res, 400, { ok: false, error: 'unknown method: ' + String(name0) })
      return
    }
    try {
      const args = payload && typeof payload === 'object' ? payload.args : undefined
      const data = await fn(args ?? null)
      sendJson(res, 200, { ok: true, data: data ?? null })
    } catch (err) {
      sendJson(res, 400, { ok: false, error: String(err?.message || err) })
    }
  }

  /**
   * 注册 HTTP 路由（浏览器半侧主通道）。
   * 拿不到 webServer 服务时只 warn：host.call 兜底通道与其余功能都不受影响。
   */
  function registerHttpRoute() {
    let webServer = null
    try {
      webServer = resolveWebServer(ctx)
    } catch (err) {
      webServer = null
    }
    if (!webServer || typeof webServer.register !== 'function') {
      log('warn', '未拿到 webServer 服务，浏览器半侧 HTTP 通道未注册（host.call 兜底通道仍可用）。')
      return
    }
    try {
      const off = webServer.register({ kind: 'exact', path: ROUTE_PATH, handler: handleHttp })
      if (typeof off === 'function') disposers.push(off)
      else if (off && typeof off.dispose === 'function') disposers.push(() => off.dispose())
      log('info', '已注册 HTTP 路由 ' + ROUTE_PATH + '（浏览器半侧主通道）。')
    } catch (err) {
      log('warn', '注册 HTTP 路由 ' + ROUTE_PATH + ' 失败：' + (err?.message || err))
    }
  }

  /* ---------------- 自动接管（R6） ---------------- */

  let dirty = false
  let debounceTimer = null

  function scheduleDebounced() {
    if (debounceTimer) return
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (!dirty) return
      dirty = false
      void reconcile('事件去抖后扫描')
    }, DEBOUNCE_MS)
    // 别让这个定时器把进程钉住
    debounceTimer.unref?.()
  }

  /**
   * 订阅官方刷新事件（R6）：
   *   - settings/document-updated(ns, revision)：带 revision 载荷，用于回执抑制
   *   - llm/adapters-updated：无 payload
   * 回调里只置 dirty 并去抖，绝不在事件回调里同步写 settings。
   */
  function listenUpdates() {
    try {
      const bus = ctx?.on || ctx?.events || ctx
      if (bus && typeof bus.on === 'function') {
        const onDocumentUpdated = (ns, revision) => {
          // 回执抑制：我们自己写 llm-pi-ai 触发的事件直接忽略
          if (ns === LLM_NS) {
            const rev = Number(revision)
            if (Number.isFinite(rev) && rev <= lastSelfWrite.revision) return
          } else if (ns) {
            // 别的 namespace 的提交与我们无关
            return
          }
          dirty = true
          scheduleDebounced()
        }
        const onAdaptersUpdated = () => {
          dirty = true
          scheduleDebounced()
        }

        const offDoc = bus.on('settings/document-updated', onDocumentUpdated)
        if (typeof offDoc === 'function') disposers.push(offDoc)
        else if (offDoc && typeof offDoc.dispose === 'function') disposers.push(() => offDoc.dispose())

        const offAdapters = bus.on('llm/adapters-updated', onAdaptersUpdated)
        if (typeof offAdapters === 'function') disposers.push(offAdapters)
        else if (offAdapters && typeof offAdapters.dispose === 'function') disposers.push(() => offAdapters.dispose())

        log('info', '已订阅 settings/document-updated 与 llm/adapters-updated，新增模型将自动接管。')
      } else {
        log('warn', '当前 ctx 没有事件总线，自动接管未启用（可手动点「立即扫描」）。')
      }
    } catch (err) {
      log('warn', '订阅刷新事件失败：' + (err?.message || err))
    }
  }

  /* ---------------- host.call 方法面（兜底通道） ---------------- */

  /**
   * 注册 host.call 方法面。
   *
   * 官方契约是「Host 半侧用 harness.handle(method, fn) 注册」（asar:732666/732680/739155），
   * 但 harness 是加载器注入的宿主对象，插件经 ctx 拿到的是服务面；因此这里按
   * 「ctx.host.handle → ctx.harness.handle → ctx.handle」依次探测，取第一个存在的。
   * 全部不存在时只 warn：插件照常 APPLIED，HTTP 主通道与其余功能都不受影响。
   *
   * 注意：Module Loader 包通道的浏览器半侧没有 host.call（DESIGN.md §7A），
   * 这条通道只是兜底，主通道是上面的 HTTP 路由。
   */
  function registerHandlers() {
    const candidates = [
      ctx?.host && typeof ctx.host.handle === 'function' ? ctx.host : null,
      ctx?.harness && typeof ctx.harness.handle === 'function' ? ctx.harness : null,
      typeof ctx?.handle === 'function' ? ctx : null
    ].filter(Boolean)
    const carrier = candidates[0]
    if (!carrier) {
      log('warn', '未找到 host.handle 方法面，设置页可能读不到数据（HTTP 主通道不受影响）。')
      return
    }
    for (const [short, fn] of Object.entries(api)) {
      const method = NS + '/' + short
      try {
        const off = carrier.handle(method, async (args) => (await fn(args || null)) ?? null)
        if (typeof off === 'function') disposers.push(off)
        else if (off && typeof off.dispose === 'function') disposers.push(() => off.dispose())
      } catch (err) {
        log('warn', '注册 host 方法 ' + method + ' 失败：' + (err?.message || err))
      }
    }
    log('info', '已注册 ' + Object.keys(api).length + ' 个 host 方法（兜底通道）。')
  }

  // 方法面兜底通道 + 浏览器半侧 HTTP 主通道 + 事件订阅 + 首次接管
  registerHandlers()
  registerHttpRoute()
  listenUpdates()
  void reconcile('插件启动')

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    dirty = false
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch (err) {
        /* 释放失败不影响其他 disposer */
      }
    }
  }
}

export { apply, inject, name }
// 刻意不导出 default 与 Config：本包没有自己的设置表单（设置页在浏览器半侧手写），
// 导出 Config 会让 Host 生成一个自动表单页面，与手写页重复。
export const __testing = {
  normalize,
  readConfig,
  writeConfig,
  planReconcile,
  scanModels,
  decideEfforts,
  needsEfforts,
  pickDefault,
  resolveEntryReasoning,
  writableEfforts,
  passesWriteGuard
}
export const __internal = { NS, PKG, LLM_NS, CONFIG_FILE, DEFAULTS, THINKING_LEVELS, DEFAULT_EFFORTS, ROUTE_PATH }
