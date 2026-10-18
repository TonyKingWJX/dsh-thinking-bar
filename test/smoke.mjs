/**
 * test/smoke.mjs —— 纯函数冒烟测试（不触碰 DSH runtime，只验证决策逻辑）
 *
 * 运行：node test/smoke.mjs
 *
 * 覆盖评审判据（DESIGN.md §7B）：R2 准入三条件、R3 merge 不 replace、
 * R4 off 三态、R8 不写 defaultEffort、R10 'inherit' 过滤、二次扫描幂等。
 */
import assert from 'node:assert/strict'

import { lookupKnowledge, listRules, normalizeEfforts, THINKING_LEVELS } from '../lib/knowledge.js'
import {
  __testing,
  decideEfforts,
  needsEfforts,
  passesWriteGuard,
  pickDefault,
  planReconcile,
  resolveEntryReasoning,
  writableEfforts
} from '../lib/index.js'

const { normalize } = __testing

/* ── 知识库 ───────────────────────────────────────────────────────────── */

/**
 * 知识库（并行卡）的取值语义：
 *   null        = 该档在官方目录里就是 null（不支持）
 *   'inherit'   = 该档缺键兜底，不要写这个键（R10）
 *   非空字符串   = wire 上的真实拼写
 * 这里只做结构性断言，避免与知识库的档位声明细节过度耦合。
 */
const isRealWire = (v) => typeof v === 'string' && v !== 'inherit' && v.length > 0

const dsFlash = lookupKnowledge({ providerId: 'deepseek', baseId: 'deepseek-v4.1-flash' })
assert.ok(dsFlash, 'DeepSeek V4.1 Flash 应命中知识库')
assert.ok(
  THINKING_LEVELS.every((level) => level in dsFlash.efforts),
  '知识库应显式声明全部七档（缺键语义由 inherit 表达）'
)
assert.equal(dsFlash.efforts.low, 'low')
assert.equal(dsFlash.efforts.high, 'high')
assert.equal(dsFlash.efforts.max, 'max')
assert.ok(!isRealWire(dsFlash.efforts.minimal), 'V4.1 Flash 不提供 minimal')
assert.ok(!isRealWire(dsFlash.efforts.medium), 'V4.1 Flash 不提供 medium')
assert.ok(!isRealWire(dsFlash.efforts.xhigh), 'V4.1 Flash 不提供 xhigh')

const glm = lookupKnowledge({ providerId: 'glm', baseId: 'glm-4.6' })
assert.ok(glm, 'GLM 应命中')
assert.ok(!isRealWire(glm.efforts.minimal), 'GLM 无 minimal 档')
assert.ok(!isRealWire(glm.efforts.max), 'GLM 拒 max')

const hy = lookupKnowledge({ providerId: 'hunyuan', baseId: 'hy3' })
assert.equal(hy.efforts.off, 'noThink', 'HY3 的关闭思考用 noThink')

const mm = lookupKnowledge({ providerId: 'minimax', baseId: 'minimax-m3' })
assert.equal(mm.efforts.off, 'none', 'MiniMax-M3 用 none')

assert.equal(lookupKnowledge({ providerId: 'nobody', baseId: 'x' }), null, '未知厂商不命中')
assert.ok(listRules().length >= 8, '知识库规则应有足够条目')
for (const rule of listRules()) {
  for (const [key, wire] of Object.entries(rule.efforts)) {
    assert.ok(THINKING_LEVELS.includes(key), '规则 ' + rule.id + ' 含非法档位 ' + key)
    assert.ok(wire === null || wire === 'inherit' || (typeof wire === 'string' && wire.length > 0), '规则 ' + rule.id + ' 的 ' + key + ' 取值非法：' + String(wire))
  }
}

/* ── normalizeEfforts ─────────────────────────────────────────────────── */

assert.deepEqual(normalizeEfforts({ off: null, low: 'low', bogus: 'x', high: '  ' }), { off: null, low: 'low' })
assert.deepEqual(normalizeEfforts(null), {})

/* ── pickDefault ───────────────────────────────────────────────────────── */

assert.equal(pickDefault({ off: null, low: 'low' }), 'off')
assert.equal(pickDefault({ low: 'low', high: 'high', max: 'max' }), 'max')
assert.equal(pickDefault({}), null)

/* ── 决策瀑布 ──────────────────────────────────────────────────────────── */

const config = {
  enabled: true,
  mode: 'auto',
  probe: false,
  defaultEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
  overrides: {
    'deepseek/deepseek-chat': { efforts: { off: null, low: 'low', max: 'ultra' }, defaultEffort: 'max' }
  },
  probes: {}
}

const overridden = decideEfforts({ route: 'deepseek', modelId: 'deepseek-chat', entry: {}, config })
assert.equal(overridden.source, 'override')
assert.equal(overridden.efforts.max, 'ultra')
assert.equal(overridden.defaultEffort, 'max')

const knowledge = decideEfforts({ route: 'deepseek', modelId: 'deepseek-v4.1-flash', entry: {}, config })
assert.equal(knowledge.source, 'knowledge')
assert.equal(knowledge.ruleId, 'deepseek-v4.1-flash')

const fallback = decideEfforts({ route: 'unknown-vendor', modelId: 'mystery-1', entry: {}, config })
assert.equal(fallback.source, 'default')
assert.equal(fallback.defaultEffort, 'off')

/* ── R10：'inherit' 与 undefined 一律不写 ──────────────────────────────── */

const claudeLike = { off: null, xhigh: 'xhigh', max: 'max', low: 'inherit', medium: 'inherit', high: 'inherit' }
assert.deepEqual(writableEfforts(claudeLike), { off: null, xhigh: 'xhigh', max: 'max' }, "'inherit' 表示缺键兜底，不写这个键")
assert.deepEqual(writableEfforts({ low: 'inherit' }), {}, '全是 inherit 时无可写档位')
assert.deepEqual(writableEfforts({ low: undefined, bogus: 'x' }), {}, 'undefined 与非档位键都不写')
assert.deepEqual(writableEfforts(undefined), {})

const claudeDecided = decideEfforts({
  route: 'anthropic',
  modelId: 'claude-sonnet-4.5',
  entry: { reasoningEfforts: { xhigh: 'xhigh' } },
  config
})
assert.equal(claudeDecided.source, 'knowledge', 'Claude 系命中知识库')
// R10：'inherit' 表示缺键兜底，决策结果里不得出现，也不得产生没有真实 wire 的档位
for (const [level, wire] of Object.entries(claudeDecided.efforts)) {
  assert.notEqual(wire, 'inherit', 'Claude 的 ' + level + ' 档不该把 inherit 带进决策结果')
}
assert.equal(claudeDecided.efforts.xhigh, 'xhigh')
assert.equal(claudeDecided.efforts.max, 'max')
assert.ok(!isRealWire(claudeDecided.efforts.low), 'Claude 的低档没有真实 wire')

// R10 端到端：inherit 档位绝不产生 op（也不得被写成 null）
const claudeDescriptor = {
  ns: 'llm-pi-ai',
  revision: 1,
  user: {
    providers: {
      anthropic: { models: { 'claude-sonnet-4.5': { reasoningEfforts: { xhigh: 'xhigh' } } } }
    }
  }
}
const claudePlan = planReconcile(claudeDescriptor, config)
assert.ok(claudePlan.ops.every((op) => typeof op.value === 'string' && op.value.length > 0), '只写真实 wire 字符串')
assert.ok(!claudePlan.ops.some((op) => op.value === 'inherit'), 'inherit 不落盘')
assert.ok(
  !claudePlan.ops.some((op) => ['low', 'medium', 'high'].includes(op.path[op.path.length - 1])),
  '继承来的低档不写键（缺键兜底）'
)

/* ── R2：resolveEntryReasoning 逐字复刻官方派生 ───────────────────────── */

const NONE = { reasoning: false, thinkingLevelMap: null }
assert.deepEqual(resolveEntryReasoning(undefined), NONE)
assert.deepEqual(resolveEntryReasoning({}), NONE, '未声明 reasoningEfforts → reasoning 回落 false')
assert.deepEqual(resolveEntryReasoning({ reasoningEfforts: false }), NONE, 'reasoningEfforts:false → 明确非推理')
assert.deepEqual(resolveEntryReasoning({ reasoningEfforts: {} }), NONE, '空 dict 官方判 invalid')
assert.deepEqual(resolveEntryReasoning({ reasoningEfforts: { off: null } }), NONE, '只有 off 档官方判 invalid')
assert.deepEqual(resolveEntryReasoning({ reasoningEfforts: { low: null } }), NONE, '非 off 档 wire 为 null 官方判 invalid')
assert.deepEqual(resolveEntryReasoning({ reasoningEfforts: { low: '' } }), NONE, '空串 wire 官方判 invalid')

assert.deepEqual(
  resolveEntryReasoning({ reasoningEfforts: { low: 'low' } }),
  {
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: null, xhigh: null, max: null }
  },
  'dict 缺键 → map[level] = null'
)
assert.deepEqual(
  resolveEntryReasoning({ reasoningEfforts: { off: null, low: 'low' } }),
  {
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: 'low', medium: null, high: null, xhigh: null, max: null }
  },
  'dict 显式 null → map 该键不存在'
)
assert.deepEqual(
  resolveEntryReasoning({ reasoning: true, thinkingLevelMap: { low: 'low' } }),
  { reasoning: true, thinkingLevelMap: { low: 'low' } },
  '条目 literal 带派生字段时以条目为准'
)

/* ── R2：needsEfforts 准入三条件 ──────────────────────────────────────── */

assert.equal(needsEfforts({ reasoning: true }, knowledge), false, '没有 thinkingLevelMap 不接管')
assert.equal(
  needsEfforts({ reasoning: true, reasoningEfforts: { low: 'low' } }, knowledge),
  true,
  '已声明 dict 且目标档有真实 wire → 补缺失档'
)
assert.equal(
  needsEfforts({ reasoning: false, reasoningEfforts: { low: 'low' } }, knowledge),
  true,
  'reasoningEfforts 存在即 reasoning:true（官方派生），literal 的 reasoning:false 被忽略'
)
assert.equal(
  needsEfforts({ reasoning: true, reasoningEfforts: false }, knowledge),
  false,
  'reasoningEfforts:false 是显式关闭，literal 的 reasoning:true 同样被忽略'
)
assert.equal(needsEfforts({ reasoning: false }, fallback), false, '显式非推理模型不动')
assert.equal(needsEfforts({}, fallback), false, '未声明且知识库不命中 → 不动')
assert.equal(needsEfforts({ name: 'hy3' }, hy), false, '未声明 reasoning 但知识库命中 → 不接管（R2 推翻旧行为）')
assert.equal(needsEfforts(null, knowledge), false, '非对象条目不接管')
// R2 条件三：目标档位在 map 里全是 null（= 都不提供）时不动
assert.equal(
  needsEfforts({ reasoning: true, reasoningEfforts: { off: null, low: 'low' } }, knowledge),
  true,
  '目标档 low 有真实 wire → 接管'
)
assert.equal(
  needsEfforts({ reasoning: true, thinkingLevelMap: { off: null } }, knowledge),
  false,
  'R2 条件三：目标档位全为 null（都不提供）时不动'
)
assert.equal(needsEfforts({ reasoning: true }, null), false, '没有决策结果不接管')

/* ── planReconcile ─────────────────────────────────────────────────────── */

const descriptor = {
  ns: 'llm-pi-ai',
  revision: 7,
  user: {
    providers: {
      deepseek: {
        models: {
          // 缺 max 档 → 应补 max
          'deepseek-v4.1-flash': { reasoningEfforts: { low: 'low', high: 'high' } },
          // 档位已齐 + 有手动覆盖 → 一律不动（覆盖只决定将来怎么写，不许可改写既有配置）
          'deepseek-chat': { reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' } },
          // 没有 reasoningEfforts → 不过 R2 准入
          'deepseek-plain': { reasoning: false },
          'deepseek-nodict': { reasoning: true }
        }
      },
      // 知识库不命中 → 走默认保守档，补 high/max
      'unknown-vendor': { models: { 'mystery-1': { reasoningEfforts: { low: 'low' } } } }
    }
  }
}

const plan = planReconcile(descriptor, config)
const plannedKeys = plan.planned.map((p) => p.route + '/' + p.modelId).sort()
assert.deepEqual(plannedKeys, ['deepseek/deepseek-v4.1-flash', 'unknown-vendor/mystery-1'])

// R8：绝不写 defaultEffort（schema 无此字段，asar:860404/860411）
assert.ok(plan.ops.every((op) => !op.path.includes('defaultEffort')), 'ops 里不得出现 defaultEffort')
assert.ok(plan.ops.every((op) => op.op === 'set'), '本卡片只用 set op，不产生 unset')

// R3：逐档 set，不是整表覆盖；off 键绝不新建（R4）；已有键一律不动
assert.deepEqual(
  plan.ops.map((op) => op.path),
  [
    ['providers', 'deepseek', 'models', 'deepseek-v4.1-flash', 'reasoningEfforts', 'max'],
    ['providers', 'unknown-vendor', 'models', 'mystery-1', 'reasoningEfforts', 'high'],
    ['providers', 'unknown-vendor', 'models', 'mystery-1', 'reasoningEfforts', 'max']
  ]
)
assert.equal(plan.ops[0].value, 'max')

// planned 仍带 defaultEffort 供设置页展示，但它绝不进 ops
assert.ok(plan.planned.every((p) => p.defaultEffort === null || typeof p.defaultEffort === 'string'))
assert.equal(plan.planned.find((p) => p.modelId === 'mystery-1').defaultEffort, 'off')

/* merge：用户自己写的 wire 永不被覆盖 */
const mergeDescriptor = {
  ns: 'llm-pi-ai',
  revision: 1,
  user: {
    providers: {
      deepseek: { models: { 'deepseek-v4.1-flash': { reasoningEfforts: { low: 'my-own-wire', high: 'high' } } } }
    }
  }
}
const mergePlan = planReconcile(mergeDescriptor, config)
assert.deepEqual(mergePlan.ops.map((op) => op.path[op.path.length - 1]), ['max'], '只补缺失档，已声明档位一律不动')
assert.equal(mergePlan.ops[0].value, 'max')
assert.ok(!mergePlan.ops.some((op) => op.path.includes('low')), '不得覆盖用户已有的 low wire')

/* 官方 models 数组形状：id 在条目上，写入路径用字符串下标 */
const arrayDescriptor = {
  ns: 'llm-pi-ai',
  revision: 1,
  user: {
    providers: {
      deepseek: { models: [{ id: 'deepseek-v4.1-flash', reasoningEfforts: { low: 'low', high: 'high' } }] }
    }
  }
}
const arrayPlan = planReconcile(arrayDescriptor, config)
assert.deepEqual(arrayPlan.ops.map((op) => op.path), [['providers', 'deepseek', 'models', '0', 'reasoningEfforts', 'max']])
assert.equal(arrayPlan.planned[0].modelId, 'deepseek-v4.1-flash', '数组形状用条目自己的 id 作为 modelId')

/* ── R8：写入侧 defaultGuard（合并后必须仍满足官方校验） ───────────────── */

assert.equal(passesWriteGuard({ low: 'low' }, { high: 'high' }), true, '补 high 后仍合法')
assert.equal(passesWriteGuard(null, { low: 'low', high: 'high' }), true, '从零建 dict 也合法')
assert.equal(passesWriteGuard(null, {}), false, '空 dict 官方判 invalid')
assert.equal(passesWriteGuard(null, { off: null }), false, '只有 off 官方判 invalid')
assert.equal(passesWriteGuard({ low: null }, { high: 'high' }), false, '非 off 档 wire 为 null 官方判 invalid')
assert.equal(passesWriteGuard({ low: '' }, { high: 'high' }), false, '空串 wire 官方判 invalid')
assert.equal(passesWriteGuard({ low: 'low' }, {}), true, '没有待写档位时看既有 dict 本身')
assert.ok(plan.blocked === undefined || Array.isArray(plan.blocked), '正常计划不带 blocked 项')

/* 幂等：写回之后再扫一次，第二次没有待写项（模拟 settings 已含字段） */
const after = JSON.parse(JSON.stringify(descriptor))
for (const op of plan.ops) {
  let node = after.user
  for (let i = 0; i < op.path.length - 1; i += 1) node = node[op.path[i]]
  node[op.path[op.path.length - 1]] = op.value
}
const second = planReconcile(after, config)
assert.equal(second.planned.length, 0, '二次扫描应无事可做（不重复写、不覆盖用户配置）')
assert.equal(second.ops.length, 0, '二次扫描不产生任何 op')
assert.ok(!second.blocked || !second.blocked.length, '二次扫描不产生 blocked 项')

// 数组形状同样幂等
const arrayAfter = JSON.parse(JSON.stringify(arrayDescriptor))
for (const op of arrayPlan.ops) {
  let node = arrayAfter.user
  for (let i = 0; i < op.path.length - 1; i += 1) node = node[op.path[i]]
  node[op.path[op.path.length - 1]] = op.value
}
const arraySecond = planReconcile(arrayAfter, config)
assert.equal(arraySecond.ops.length, 0, '数组形状二次扫描不产生任何 op')

/* ── 新增：provider 独立开关 / 每模型档位复选框 / normalize 清洗 ────────── */

/** 知识库命中 + 默认兜底都覆盖到的完整配置（含新增两层）。 */
const scopedConfig = {
  enabled: true,
  mode: 'auto',
  probe: false,
  providers: {},
  models: {},
  defaultEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
  overrides: {},
  probes: {}
}

// 1. provider 开关关闭 → 该 provider 的所有模型一律不接管（明确 skip，不是空 efforts）
const providerOff = { ...scopedConfig, providers: { deepseek: { enabled: false } } }
assert.equal(
  decideEfforts({ route: 'deepseek', modelId: 'deepseek-v4.1-flash', entry: {}, config: providerOff }),
  null,
  'provider 开关关闭时应返回 null（明确的 skip 信号），不得返回空 efforts 冒充接管'
)
assert.equal(
  needsEfforts({ reasoning: true, reasoningEfforts: { low: 'low' } }, decideEfforts({
    route: 'deepseek', modelId: 'deepseek-v4.1-flash', entry: {}, config: providerOff
  })),
  false,
  'provider 关闭 → needsEfforts 不接管'
)
// provider 开关关闭时，即使该模型有手动覆盖也不接管（开关优先级最高）
const providerOffWithOverride = {
  ...scopedConfig,
  providers: { deepseek: { enabled: false } },
  overrides: { 'deepseek/deepseek-v4.1-flash': { efforts: { low: 'low' }, defaultEffort: 'low' } }
}
assert.equal(
  decideEfforts({ route: 'deepseek', modelId: 'deepseek-v4.1-flash', entry: {}, config: providerOffWithOverride }),
  null,
  'provider 关闭优先于 overrides：关掉一个 provider 就该整体闭嘴'
)
// provider 开关开启（或未登记）不影响原有瀑布
const providerOn = { ...scopedConfig, providers: { deepseek: { enabled: true } } }
assert.equal(
  decideEfforts({ route: 'deepseek', modelId: 'deepseek-v4.1-flash', entry: {}, config: providerOn }).source,
  'knowledge',
  'provider 开关开启时按原有瀑布决策'
)
assert.equal(
  decideEfforts({ route: 'deepseek', modelId: 'deepseek-v4.1-flash', entry: {}, config: scopedConfig }).source,
  'knowledge',
  '未登记的 provider 视为接管（向后兼容旧配置）'
)

// 2. models.levels 交集过滤生效
// 知识库 deepseek-v4.1-flash 的 7 档齐全 = {off:'none', minimal:null, low:'low',
// medium:null, high:'high', xhigh:null, max:'max'}（null = 该档存在但不支持，仍是结果里的键）
const onlyMax = { ...scopedConfig, models: { 'deepseek/deepseek-v4.1-flash': { levels: ['max'] } } }
const maxDecided = decideEfforts({ route: 'deepseek', modelId: 'deepseek-v4.1-flash', entry: {}, config: onlyMax })
assert.deepEqual(maxDecided.efforts, { max: 'max' }, 'levels=[max] 时只写 max，与瀑布结果取交集')
assert.equal(maxDecided.defaultEffort, 'max', '交集后 defaultEffort 应按新档位表重算')
assert.equal(maxDecided.source, 'knowledge', '档位过滤不改变来源标注')

// 交集为空 → 不接管（返回 null）
// 注意：33 条知识库规则都声明了完整 7 档，所以知识库命中的模型不可能被 levels 抽空；
// 只有走 defaultEfforts 兜底（4 档 off/low/high/max）的模型才可能与 levels 完全不相交。
const emptyIntersection = {
  ...scopedConfig,
  models: { 'deepseek/totally-unknown-model': { levels: ['minimal', 'xhigh'] } }
}
assert.equal(
  decideEfforts({ route: 'deepseek', modelId: 'totally-unknown-model', entry: {}, config: emptyIntersection }),
  null,
  'levels 与瀑布结果交集为空 → 不接管（null），不是空接管'
)
// 同一兜底模型下，非空交集照常过滤
assert.deepEqual(
  decideEfforts({
    route: 'deepseek',
    modelId: 'totally-unknown-model',
    entry: {},
    config: { ...scopedConfig, models: { 'deepseek/totally-unknown-model': { levels: ['minimal', 'off', 'low'] } } }
  }).efforts,
  { off: null, low: 'low' },
  '兜底 4 档模型同样受 levels 交集过滤（minimal 不在兜底表里被剔除）'
)
// 空数组同样不接管
const noLevels = { ...scopedConfig, models: { 'deepseek/deepseek-v4.1-flash': { levels: [] } } }
assert.equal(
  decideEfforts({ route: 'deepseek', modelId: 'deepseek-v4.1-flash', entry: {}, config: noLevels }),
  null,
  'levels=[] → 一档都不勾 → 不接管'
)
// 保留 off 档时 defaultEffort 回到 off
const offAndLow = { ...scopedConfig, models: { 'deepseek/deepseek-v4.1-flash': { levels: ['off', 'low'] } } }
const offLowDecided = decideEfforts({ route: 'deepseek', modelId: 'deepseek-v4.1-flash', entry: {}, config: offAndLow })
assert.deepEqual(offLowDecided.efforts, { off: 'none', low: 'low' }, 'levels=[off,low] 只留这两档')
assert.equal(offLowDecided.defaultEffort, 'off', '含 off 档时默认档仍选 off')

// 端到端：levels 过滤真的减少落盘 op
const scopedDescriptor = {
  ns: 'llm-pi-ai',
  revision: 3,
  user: {
    providers: {
      deepseek: {
        models: {
          'deepseek-v4.1-flash': { reasoningEfforts: { low: 'low' } }
        }
      }
    }
  }
}
const unrestricted = planReconcile(scopedDescriptor, scopedConfig)
assert.deepEqual(
  unrestricted.ops.map((op) => op.path[op.path.length - 1]),
  ['high', 'max'],
  '未登记 levels 时按知识库补全部缺失档'
)
// levels 过滤端到端减少 op：
// 该条目 dict 只声明了 low，R2 条件 3 要求「过滤后的目标档里至少一档在派生的
// thinkingLevelMap 里非 null」，所以 levels 必须同时含一个已声明档（low，用于过准入）
// 和一个缺失档（high，用于真正补写）。
const restricted = {
  ...scopedConfig,
  models: { 'deepseek/deepseek-v4.1-flash': { levels: ['low', 'high'] } }
}
assert.deepEqual(
  planReconcile(scopedDescriptor, restricted).ops.map((op) => op.path[op.path.length - 1]),
  ['high'],
  'levels=[low,high] 时只补 high（max 被交集过滤掉）'
)
// 只留缺失档 → 过滤后没有任何「已声明档」过 R2 准入 → 一档都不写
const onlyMissing = { ...scopedConfig, models: { 'deepseek/deepseek-v4.1-flash': { levels: ['max'] } } }
assert.equal(
  planReconcile(scopedDescriptor, onlyMissing).ops.length,
  0,
  'levels 只留条目未声明的档 → R2 条件 3 不过 → 不写（保守，不凭空发明档位）'
)
// 端到端：levels 抽空该模型 → 计划里一档不补、也不进 planned
const emptiedLevels = { ...scopedConfig, models: { 'deepseek/deepseek-v4.1-flash': { levels: [] } } }
const blockedPlan = planReconcile(scopedDescriptor, emptiedLevels)
assert.equal(blockedPlan.ops.length, 0, '交集为空时不产生任何 op')
assert.equal(blockedPlan.planned.length, 0, '交集为空的模型不进 planned')
const providerOffPlan = planReconcile(scopedDescriptor, providerOff)
assert.equal(providerOffPlan.ops.length, 0, 'provider 关闭时不产生任何 op')
assert.equal(providerOffPlan.planned.length, 0, 'provider 关闭时该 provider 的模型不进 planned')

// 3. normalize 清洗非法档位 / providers / models
const cleaned = normalize({
  providers: {
    deepseek: { enabled: false, junk: 1 },
    'bad-null': null,
    'bad-array': [1, 2],
    anthropic: { enabled: 'yes' }
  },
  models: {
    // 非法档位剔除 + 重复去重 + 按 THINKING_LEVELS 顺序归一
    'deepseek/deepseek-v4.1-flash': { levels: ['max', 'bogus', 'off', 'max', 'low', 42, null, 'low'] },
    'deepseek/no-levels': { foo: 1 },
    'bad-key-no-slash': { levels: ['low'] },
    'bad-key-trailing/': { levels: ['low'] },
    '/bad-key-leading': { levels: ['low'] },
    'anthropic/claude': { levels: 'not-an-array' },
    'google/gemini': { levels: ['high', 'xhigh'] }
  }
})
assert.deepEqual(
  cleaned.providers,
  { deepseek: { enabled: false }, anthropic: { enabled: true } },
  'providers 只保留 {enabled:boolean}，非法项丢弃，非布尔值强制转布尔'
)
assert.deepEqual(
  cleaned.models['deepseek/deepseek-v4.1-flash'].levels,
  ['off', 'low', 'max'],
  'levels 剔除非法档位/非字符串、去重、按 THINKING_LEVELS 顺序归一'
)
assert.deepEqual(
  cleaned.models['google/gemini'].levels,
  ['high', 'xhigh'],
  'levels 顺序按 THINKING_LEVELS（high 在 xhigh 前）'
)
assert.equal(cleaned.models['deepseek/no-levels'], undefined, '没有 levels 数组的模型项被丢弃')
assert.equal(cleaned.models['bad-key-no-slash'], undefined, '非 <route>/<modelId> 形状的键被丢弃')
assert.equal(cleaned.models['bad-key-trailing/'], undefined, 'route/model 任一段为空时被丢弃')
assert.equal(cleaned.models['/bad-key-leading'], undefined, 'route 为空时被丢弃')
assert.equal(cleaned.models['anthropic/claude'], undefined, 'levels 非数组时被丢弃')

// 脏输入不炸：providers / models 给错类型时回落空表
const dirty = normalize({ providers: 'nope', models: [1, 2, 3] })
assert.deepEqual(dirty.providers, {}, 'providers 非对象 → 空表')
assert.deepEqual(dirty.models, {}, 'models 非对象 → 空表')
// 旧配置（完全没有 providers / models）仍能解析，且默认为空表
const legacy = normalize({ enabled: true, mode: 'auto', probe: false })
assert.deepEqual(legacy.providers, {}, '旧配置缺 providers → 空表（向后兼容）')
assert.deepEqual(legacy.models, {}, '旧配置缺 models → 空表（向后兼容）')

console.log(
  'smoke ok — 知识库 ' +
    listRules().length +
    ' 条规则，接管计划覆盖 ' +
    plannedKeys.length +
    ' 个模型，共 ' +
    plan.ops.length +
    ' 个档位 op（无 defaultEffort）'
)
console.log(
  'smoke ok — 新增配置层：provider 开关 skip 语义、models.levels 交集过滤（含空交集不接管）、' +
    'normalize 清洗非法档位/provider/models 共 ' +
    '14 条断言通过'
)
