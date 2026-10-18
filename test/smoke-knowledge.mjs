/**
 * test/smoke-knowledge.mjs —— lib/knowledge.js 的独立冒烟测试
 *
 * 覆盖：导出契约、规则自洽性（键在 THINKING_LEVELS 内、值合法、ruleId 唯一）、
 * 家族覆盖度、'inherit' 缺键兜底语义、lookupKnowledge 的已知/未知返回形状。
 * 用法：node test/smoke-knowledge.mjs
 */
import assert from 'node:assert/strict'
import {
  THINKING_LEVELS,
  DEFAULT_EFFORTS,
  lookupKnowledge,
  listRules,
  normalizeEfforts
} from '../lib/knowledge.js'

const checks = []
let failed = 0

function check(name, fn) {
  try {
    fn()
    checks.push(['PASS', name])
  } catch (err) {
    failed++
    checks.push(['FAIL', name + ' -> ' + err.message])
  }
}

const rules = listRules()

// ── 1. 导出契约 ────────────────────────────────────────────────────────
check('THINKING_LEVELS 恰好七档且有序', () => {
  assert.deepEqual(THINKING_LEVELS, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
})
check('DEFAULT_EFFORTS 形状不变（跳过 minimal/medium/xhigh）', () => {
  assert.deepEqual(DEFAULT_EFFORTS, { off: null, low: 'low', high: 'high', max: 'max' })
})
check('导出函数齐全', () => {
  for (const [name, fn] of Object.entries({ lookupKnowledge, listRules, normalizeEfforts })) {
    assert.equal(typeof fn, 'function', name + ' 应为函数')
  }
})

// ── 2. 规则自洽性 ──────────────────────────────────────────────────────
check('ruleId 唯一', () => {
  const seen = new Set()
  for (const r of rules) {
    assert.ok(!seen.has(r.id), 'ruleId 重复: ' + r.id)
    seen.add(r.id)
  }
})
check('至少 15 条规则', () => {
  assert.ok(rules.length >= 15, '只有 ' + rules.length + ' 条规则')
})
check('所有 efforts 的键都在 THINKING_LEVELS 内', () => {
  for (const r of rules) {
    for (const key of Object.keys(r.efforts)) {
      assert.ok(THINKING_LEVELS.includes(key), r.id + ' 非法档位键: ' + key)
    }
  }
})
check('所有值要么 null、要么非空字符串、要么 inherit', () => {
  for (const r of rules) {
    for (const [key, value] of Object.entries(r.efforts)) {
      if (value === null) continue
      assert.equal(typeof value, 'string', r.id + '.' + key + ' 值类型应为 null/string')
      assert.ok(value.trim().length > 0, r.id + '.' + key + ' 值不能是空字符串')
      assert.notEqual(value.trim().toLowerCase(), 'none of the above', r.id + '.' + key)
    }
  }
})
check('每条规则产出非空档位表（允许官方形态的全 null 表）', () => {
  for (const r of rules) {
    assert.ok(Object.keys(r.efforts).length > 0, r.id + ' 产出空档位表')
  }
})

// ── 3. 模型族覆盖度（每族至少一条规则）──────────────────────────────────
const FAMILIES = {
  anthropic: [{ providerId: 'anthropic', baseId: 'claude-fable-5' }],
  claude: [{ providerId: 'anthropic', baseId: 'claude-sonnet-4-5-20250929' }],
  deepseek: [{ providerId: 'deepseek', baseId: 'deepseek-flash' }],
  'openai/gpt': [{ providerId: 'openai', baseId: 'gpt-5.2' }],
  'google/gemini': [{ providerId: 'google', baseId: 'gemini-3-pro-preview' }],
  'xai/grok': [{ providerId: 'xai', baseId: 'grok-4.7' }],
  'moonshot/kimi': [{ providerId: 'moonshotai', baseId: 'kimi-k3' }],
  'zhipu/glm': [{ providerId: 'zai', baseId: 'glm-5.3' }],
  qwen: [{ providerId: 'qwen-token-plan', baseId: 'qwen3.8-max' }],
  minimax: [{ providerId: 'minimax', baseId: 'minimax-m3' }],
  hunyuan: [{ providerId: 'hunyuan', baseId: 'hy3' }],
  stepfun: [{ providerId: 'stepfun', baseId: 'step-3' }],
  together: [{ providerId: 'together', baseId: 'MiniMaxAI/MiniMax-M2.7' }],
  baseten: [{ providerId: 'baseten', baseId: 'DeepSeek-V4-Flash-0731' }],
  cloudflare: [{ providerId: 'cloudflare-workers-ai', baseId: '@cf/deepseek-ai/deepseek-v4-flash-0731' }],
  opencode: [{ providerId: 'opencode-go', baseId: 'deepseek-v4-flash' }],
  'ant-ling': [{ providerId: 'ant-ling', baseId: 'Ring-2.6-1T' }]
}
for (const [family, cases] of Object.entries(FAMILIES)) {
  check('家族覆盖: ' + family, () => {
    for (const c of cases) {
      const hit = lookupKnowledge(c)
      assert.ok(hit, family + ' 未命中: ' + c.providerId + '/' + c.baseId)
    }
  })
}

// ── 4. 形态与实证目录一致 ──────────────────────────────────────────────
check('claude-fable-5 形态 = {off:null, xhigh, max}，low/medium/high 为 inherit', () => {
  const hit = lookupKnowledge({ providerId: 'anthropic', baseId: 'claude-fable-5' })
  assert.equal(hit.efforts.off, null)
  assert.equal(hit.efforts.xhigh, 'xhigh')
  assert.equal(hit.efforts.max, 'max')
  assert.equal(hit.efforts.low, 'inherit')
  assert.equal(hit.efforts.medium, 'inherit')
  assert.equal(hit.efforts.high, 'inherit')
})
check('deepseek-flash 形态 = {minimal:null, low, medium:null, high, max}', () => {
  const hit = lookupKnowledge({ providerId: 'deepseek', baseId: 'deepseek-flash' })
  assert.equal(hit.efforts.minimal, null)
  assert.equal(hit.efforts.low, 'low')
  assert.equal(hit.efforts.medium, null)
  assert.equal(hit.efforts.high, 'high')
  assert.equal(hit.efforts.max, 'max')
})
check('baseten DeepSeek 七档全开且 off="none"', () => {
  const hit = lookupKnowledge({ providerId: 'baseten', baseId: 'DeepSeek-V4-Flash-0731' })
  assert.equal(hit.efforts.off, 'none')
  for (const k of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    assert.equal(hit.efforts[k], k, k + ' 应同名')
  }
})
check('ant-ling Ring-2.6-1T 无 max 键（inherit）', () => {
  const hit = lookupKnowledge({ providerId: 'ant-ling', baseId: 'Ring-2.6-1T' })
  assert.equal(hit.efforts.max, 'inherit')
  assert.equal(hit.efforts.high, 'high')
  assert.equal(hit.efforts.xhigh, 'xhigh')
})
check('together MiniMax-M2.7 = {off:null, minimal:null, low:null, medium:null}', () => {
  const hit = lookupKnowledge({ providerId: 'together', baseId: 'MiniMaxAI/MiniMax-M2.7' })
  for (const k of ['off', 'minimal', 'low', 'medium']) assert.equal(hit.efforts[k], null, k)
  assert.equal(hit.efforts.high, 'inherit')
})
check('radius 一档映射到别的拼写（max -> xhigh）', () => {
  const hit = lookupKnowledge({ providerId: 'radius', baseId: 'deepseek-v4-pro' })
  assert.equal(hit.efforts.max, 'xhigh')
})
check('cloudflare-workers-ai 条目缺 off 键（inherit）', () => {
  const hit = lookupKnowledge({
    providerId: 'cloudflare-workers-ai',
    baseId: '@cf/deepseek-ai/deepseek-v4-flash-0731'
  })
  assert.equal(hit.efforts.off, 'inherit')
})
check('gemma-4 使用大写 wire 拼写 MINIMAL / HIGH', () => {
  const hit = lookupKnowledge({ providerId: 'google', baseId: 'gemma-4-31b' })
  assert.equal(hit.efforts.minimal, 'MINIMAL')
  assert.equal(hit.efforts.high, 'HIGH')
})

// ── 5. normalizeEfforts 保留 inherit ────────────────────────────────────
check("normalizeEfforts 保留 'inherit'（不被当非法值丢掉）", () => {
  const out = normalizeEfforts({ off: null, low: 'inherit', high: 'high', max: 'inherit' })
  assert.deepEqual(out, { off: null, low: 'inherit', high: 'high', max: 'inherit' })
  assert.ok('low' in out, 'low 键不应被丢弃')
  assert.ok('max' in out, 'max 键不应被丢弃')
})
check('normalizeEfforts 过滤 undefined / 空串 / 非档位键', () => {
  const out = normalizeEfforts({
    off: undefined,
    low: '  ',
    medium: 'medium',
    high: null,
    turbo: 'xhigh'
  })
  assert.deepEqual(out, { medium: 'medium', high: null })
})
check('normalizeEfforts 对非对象输入返回空表', () => {
  assert.deepEqual(normalizeEfforts(null), {})
  assert.deepEqual(normalizeEfforts('x'), {})
})

// ── 6. lookupKnowledge 返回形状 ─────────────────────────────────────────
check('lookupKnowledge 已知输入返回 {ruleId, source, efforts}', () => {
  const hit = lookupKnowledge({ providerId: 'deepseek', baseId: 'deepseek-v4.1-flash' })
  assert.ok(hit)
  assert.deepEqual(Object.keys(hit).sort(), ['efforts', 'ruleId', 'source'])
  assert.equal(hit.source, 'knowledge')
  assert.ok(rules.some((r) => r.id === hit.ruleId), 'ruleId 应存在于 listRules()')
})
check('lookupKnowledge 未知厂商/未知模型返回 null', () => {
  assert.equal(lookupKnowledge({ providerId: 'no-such-vendor', baseId: 'no-such-model' }), null)
  assert.equal(lookupKnowledge({}), null)
  assert.equal(lookupKnowledge(), null)
})
check('lookupKnowledge 接受 modelName 参与匹配', () => {
  const hit = lookupKnowledge({ providerId: 'anthropic', baseId: '', modelName: 'claude-fable-5' })
  assert.ok(hit)
  assert.equal(hit.ruleId, 'anthropic-claude-fable5')
})
check('lookupKnowledge 精确子族规则优先于家族兜底（vendor 优先于泛化 model）', () => {
  const sub = lookupKnowledge({ providerId: 'zai', baseId: 'glm-5.3' })
  const generic = lookupKnowledge({ providerId: 'zai', baseId: 'glm-4.7' })
  assert.equal(sub.ruleId, 'zai-glm-5.3')
  assert.equal(generic.ruleId, 'glm-generic')
})
// 2026-10-16 修正：反代/聚合商的 route 名不含厂商标识，第一趟 vendor 门必然 miss。
// 第二趟改用 modelName+baseId 匹配 vendor，兜住「route 是 someproxy 而模型是 deepseek-v4.1-flash」的形态。
check('lookupKnowledge 第二趟兜底：反代 route 也能命中知识库（2026-10-16 修正）', () => {
  const reseller = [
    ['cline', 'cline-pass/deepseek-v4.1-flash', 'deepseek-v4.1-flash'],
    ['cline', 'cline-pass/glm-5.3-flash', 'zai-glm-5.3'],
    ['mirasimcpa', 'deepseek-flash', 'deepseek-flash'],
    ['mirasimcpa', 'kimi-k3', 'moonshot-kimi'],
    ['xiaoqie', 'deepseek-v4.1-flash', 'deepseek-v4.1-flash'],
    ['xiaoqieglm', 'glm-5.3-flash', 'zai-glm-5.3']
  ]
  for (const [route, baseId, expected] of reseller) {
    const hit = lookupKnowledge({ providerId: route, baseId })
    assert.ok(hit, `${route}/${baseId} 应命中知识库（修复前 MISS）`)
    assert.equal(hit.ruleId, expected, `${route}/${baseId} 应命中 ${expected}`)
  }
})
check('lookupKnowledge 第二趟不改写第一趟已命中的结果（向后兼容）', () => {
  // 这些 route 名本身就是厂商标识，修复前后必须完全一致。
  const direct = [
    ['deepseek', 'deepseek-v4.1-flash', 'deepseek-v4.1-flash'],
    ['stepfun', 'step-5-preview', 'stepfun-step'],
    ['moonshot', 'kimi-k3', 'moonshot-kimi'],
    ['anthropic', 'claude-fable-5', 'anthropic-claude-fable5'],
    ['together', 'MiniMaxAI/MiniMax-M2.7', 'together-minimax'],
    ['radius', 'cheap', 'radius-cheap'],
    ['qwen', 'qwen3-max', 'qwen3']
  ]
  for (const [route, baseId, expected] of direct) {
    const hit = lookupKnowledge({ providerId: route, baseId })
    assert.ok(hit, `${route}/${baseId} 应命中`)
    assert.equal(hit.ruleId, expected, `${route}/${baseId} 的命中结果不得被第二趟改变`)
  }
})
check('lookupKnowledge 第二趟仍要求 vendor 与 model 双命中，不误伤同族', () => {
  // 危险面：反代上挂 qwen3-max 时，若落到兜底表会补上 qwen 官方目录里为 null 的 high/max。
  // 第二趟必须命中 qwen3 规则（high/max = null），而不是兜底表。
  const hit = lookupKnowledge({ providerId: 'someproxy', baseId: 'qwen3-max' })
  assert.ok(hit, 'someproxy/qwen3-max 应命中 qwen3 规则')
  assert.equal(hit.ruleId, 'qwen3')
  assert.equal(hit.efforts.high, null, 'qwen3 的 high 在官方目录为 null，不得被兜底表覆盖成 "high"')
  assert.equal(hit.efforts.max, null, 'qwen3 的 max 在官方目录为 null，不得被兜底表覆盖成 "max"')
  // 真正的未知模型仍必须 miss（第二趟不得变成「凡有模型名就命中」）。
  assert.equal(lookupKnowledge({ providerId: 'someproxy', baseId: 'no-such-model-xyz' }), null)
})
check('lookupKnowledge 返回的 efforts 是拷贝，调用方改它不影响知识库', () => {
  const hit = lookupKnowledge({ providerId: 'deepseek', baseId: 'deepseek-flash' })
  hit.efforts.low = 'MUTATED'
  const again = lookupKnowledge({ providerId: 'deepseek', baseId: 'deepseek-flash' })
  assert.equal(again.efforts.low, 'low')
})
check('listRules 返回拷贝', () => {
  const first = listRules()
  first[0].efforts.off = 'MUTATED'
  assert.notEqual(listRules()[0].efforts.off, 'MUTATED')
})

// ── 输出 ────────────────────────────────────────────────────────────────
for (const [status, name] of checks) {
  console.log(`${status}  ${name}`)
}
console.log('')
console.log(`规则条数: ${rules.length}`)
console.log(`ruleId 清单: ${rules.map((r) => r.id).join(', ')}`)
console.log(`覆盖家族: ${Object.keys(FAMILIES).length} 个 -> ${Object.keys(FAMILIES).join(', ')}`)
console.log(`断言: ${checks.length} 条，失败 ${failed} 条`)
if (failed > 0) {
  console.error('SMOKE FAILED')
  process.exit(1)
}
console.log('SMOKE OK')