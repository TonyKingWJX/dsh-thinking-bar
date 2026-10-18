/**
 * lib/knowledge.js —— 思考强度能力知识库（静态表，可扩展）
 *
 * 位置：三级能力瀑布的第一级，也是唯一的离线来源。瀑布顺序（DESIGN.md §2）：
 *   1. 本模块静态表（按厂商 + 模型名模糊匹配）
 *   2. 上游探测（默认关闭，见 lib/index.js 的 probe 分支）
 *   3. 用户手动覆盖（设置页，永远最高优先）
 *
 * 数据契约
 * --------
 * 一条规则 = {
 *   id:        规则标识（写进插件配置里的 source，便于排障）
 *   vendor:    厂商匹配：字符串（子串，忽略大小写）或字符串数组（任一命中）
 *   model:     模型名匹配：字符串（子串）或字符串数组（任一命中）
 *   effortKeys: 命中的档位键集合，数组，来自 THINKING_LEVELS 的子集
 *   wire:      档位键 → wire 值的显式覆盖表；未列出的键按同名同值推导（off 默认 null）
 *   source:    'knowledge'（默认）
 * }
 *
 * 档位键必须来自 THINKING_LEVELS = off/minimal/low/medium/high/xhigh/max
 * （asar:859699）。
 *
 * 三种值语义（DESIGN.md §7B R10）
 * --------------------------------
 *   null          该档在官方目录里就是 null，保留为「按下发即关闭/不下发」处理
 *                 （官方 resolveModelReasoning 允许 off 为 null）。
 *   'inherit'     **缺键兜底**：官方目录根本没有这一档，本模块显式声明
 *                 「不要写这个键」，dispatch 侧回落厂商默认值。
 *                 与 Host 半侧的约定：lib/index.js 会过滤掉 'inherit' 与 undefined，
 *                 只把真实 wire 字符串或 null 写进最终配置。
 *                 例如 claude 系的真实形态就是 {off:null, xhigh:'xhigh', max:'max'}，
 *                 low/medium/high 全部靠缺键兜底，而不是「同名同值」。
 *   非空字符串    该档在 wire 上就是这个拼写，可能是与档位键不同的重命名
 *                 （radius 的 max → 'xhigh'、google gemma 的 minimal → 'MINIMAL'）。
 *
 * 匹配优先级（lookupKnowledge，自上而下）
 * --------------------------------------
 *   1. 精确 modelId 命中：RULES 数组里靠前、model needle 更具体（长版本号/子族名）
 *      的规则先匹配；因此同厂商内「子族规则 → 家族兜底规则」的顺序不能随意调换。
 *   2. 模型名模糊命中：needle 在 modelName + baseId 拼接串上做忽略大小写的子串匹配。
 *   3. 厂商前缀命中（**两趟**，2026-10-16 修正）：vendor needle 必须命中，但命中对象分两趟——
 *      第一趟对 providerId（route 名即厂商，如 deepseek / moonshot / stepfun）；
 *      仅当第一趟全 miss 才走第二趟，改对模型名串（modelName + baseId）匹配，
 *      兜住「route 名是反代/聚合商、厂商标识只写在模型 id 里」的场景
 *      （如 cline 的 `cline-pass/deepseek-v4.1-flash`、mirasimcpa 的 `kimi-k3`）。
 *      没有第二趟时这些 route 会整体漏过知识库、退化成兜底表，
 *      可能给模型写它并不支持的档位（qwen3 的 high/max 在官方目录里就是 null）。
 *      两趟都要求 vendor 与 model 双命中，防止 DeepSeek / Qwen / GLM 等互为子串的家族名互相误伤。
 *   命中多条时取数组中第一条（更靠前 = 更具体）；全部不命中返回 null。
 *
 * 实证来源
 * --------
 * 规则形态逐条对照官方内置目录（asar 第 1105014–1105054 行各 provider JSON
 * catalog 的 thinkingLevelMap 字段），例如：
 *   anthropic/claude-fable-5        = {off:null, xhigh:'xhigh', max:'max'}
 *   anthropic/claude-opus-5-5       = 七档全给（off:null, minimal:null, low/medium/high/xhigh/max 同名）
 *   deepseek/deepseek-flash         = {minimal:null, low:'low', medium:null, high:'high', max:'max'}
 *   deepseek/deepseek-v4.1-flash    = {off:'none', minimal:null, low:'low', medium:null, high:'high', xhigh:null, max:'max'}
 *   baseten DeepSeek-V4-Flash-0731  = {off:'none', minimal:'minimal', low:'low', medium:'medium',
 *                                     high:'high', xhigh:'xhigh', max:'max'}（七档全开）
 *   ant-ling/Ring-2.6-1T            = {off:null, minimal:null, low:null, medium:null, high:'high', xhigh:'xhigh'}（无 max）
 *   together MiniMaxAI/MiniMax-M2.7 = {off:null, minimal:null, low:null, medium:null}
 *   together MiniMaxAI/MiniMax-M3   = {minimal:null, low:null, medium:null}（连 off 键都没有）
 *   radius/cheap                    = {off:'none', ..., xhigh:'xhigh', max:'xhigh'}（一档映射到别的拼写）
 *   cloudflare-workers-ai @cf/deepseek-* = {minimal:null, low:null, medium:null, high:'high', max:'max'}（无 off 键）
 *   google/gemma-4-*                = {off:null, minimal:'MINIMAL', low:null, medium:null, high:'HIGH'}（大写拼写）
 *
 * 校验自保：任何一条规则若含非法档位键、wire 键越界、空字符串值，或产出空档位表，
 * 导出时直接抛错，让插件在启动期就暴露知识库写错，而不是等到用户发请求才失败。
 * 注意：七档全为 null / 'inherit' 是**合法**的（如 together MiniMax-M2.7），
 */

/** 官方档位键集（asar:859699）。这里是唯一的真值来源，规则只允许引用其中的键。 */
export const THINKING_LEVELS = Object.freeze([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])

/** 缺键兜底哨兵（DESIGN.md §7B R10）：wire 值写它表示「官方目录没有这一档，不要写这个键」。 */
export const INHERIT = 'inherit'

/** 知识库无匹配时的默认保守档位（DESIGN.md §2）：跳过 minimal/medium/xhigh，后端不支持就报错。 */
export const DEFAULT_EFFORTS = Object.freeze({
  off: null,
  low: 'low',
  high: 'high',
  max: 'max'
})

/** 内部便捷别名：规则通常声明全部七档，再由 wire 表把不支持的档位压成 null / 'inherit'。 */
const ALL_LEVELS = THINKING_LEVELS

/**
 * 静态规则表。顺序即优先级：更具体的厂商/模型组合放前面，
 * 同一厂商内的「子族规则」必须在「家族兜底规则」之前。
 * 新增厂商时追加到数组末尾即可，无需改动引擎代码。
 */
export const RULES = Object.freeze([
  // ── Anthropic / Claude 系 ────────────────────────────────────────────────
  {
    // claude 5.5 代首次给出完整七档（minimal/high 仍为 null）。
    id: 'anthropic-claude-full-ladder',
    vendor: ['anthropic', 'claude'],
    model: ['claude-5-5', 'opus-5-5', 'opus-5.5', 'fable-5-5', 'sonnet-5-5', 'haiku-5-5'],
    effortKeys: ALL_LEVELS,
    wire: {
      off: null,
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max'
    }
  },
  {
    // claude-fable-5 / claude-opus-5：只有 off(null) + xhigh + max 三档。
    id: 'anthropic-claude-fable5',
    vendor: ['anthropic', 'claude'],
    model: ['claude-fable-5', 'fable-5', 'claude-opus-5', 'claude-sonnet-5'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: INHERIT, low: INHERIT, medium: INHERIT, high: INHERIT, xhigh: 'xhigh', max: 'max' }
  },
  {
    // claude-opus-4-6 ~ 4-8 / sonnet-4-6：xhigh + max，低档全靠缺键兜底。
    id: 'anthropic-claude-4-late',
    vendor: ['anthropic', 'claude'],
    model: ['opus-4-6', 'opus-4-7', 'opus-4-8', 'opus-4.6', 'opus-4.7', 'opus-4.8', 'sonnet-4-6', 'sonnet-4.6'],
    effortKeys: ALL_LEVELS,
    wire: { off: INHERIT, minimal: INHERIT, low: INHERIT, medium: INHERIT, high: INHERIT, xhigh: 'xhigh', max: 'max' }
  },
  {
    // Anthropic 通用兜底（4.5 及更早、haiku/sonnet-4-5 等目录无 thinkingLevelMap）。
    id: 'anthropic-claude-generic',
    vendor: ['anthropic', 'claude'],
    model: ['claude', 'sonnet', 'opus', 'haiku', 'fable', 'mythos'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: INHERIT, low: INHERIT, medium: INHERIT, high: INHERIT, xhigh: 'xhigh', max: 'max' }
  },
  {
    // 云网关侧的 Claude 转发（cloudflare-ai-gateway / copilot / opencode / bedrock）
    // 与官方 anthropic 同形态：{off:null, xhigh:'xhigh', max:'max'}。
    id: 'claude-gateway',
    vendor: ['cloudflare-ai-gateway', 'github-copilot', 'opencode', 'amazon-bedrock', 'bedrock', 'copilot', 'vercel-ai-gateway'],
    model: ['claude', 'sonnet', 'opus', 'haiku', 'fable'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: INHERIT, low: INHERIT, medium: INHERIT, high: INHERIT, xhigh: 'xhigh', max: 'max' }
  },

  // ── OpenAI / GPT 系 ─────────────────────────────────────────────────────
  {
    // gpt-5.6 / gpt-6 系列：off 用 'none'，七档全开。
    id: 'openai-gpt-5.6-plus',
    vendor: ['openai', 'openai-codex', 'azure-openai-responses', 'codex'],
    model: ['gpt-5.6', 'gpt-6', 'gpt5.6', 'gpt5-6'],
    effortKeys: ALL_LEVELS,
    wire: {
      off: 'none',
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max'
    }
  },
  {
    // gpt-5 ~ 5.5 / codex / o 系列：off='none'，封顶 xhigh（目录里 max 为 null）。
    id: 'openai-gpt-5',
    vendor: ['openai', 'openai-codex', 'azure-openai-responses', 'codex'],
    model: ['gpt-5', 'gpt5', 'gpt-4', 'o1', 'o3', 'o4', 'gpt-oss', 'codex'],
    effortKeys: ALL_LEVELS,
    wire: {
      off: 'none',
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: INHERIT
    }
  },

  // ── Google / Gemini 系 ──────────────────────────────────────────────────
  {
    // gemma-4 系列用大写拼写，且只有 minimal / high 两档。
    id: 'google-gemma-4',
    vendor: ['google', 'google-vertex', 'gemini'],
    model: ['gemma-4'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: 'MINIMAL', low: null, medium: null, high: 'HIGH', xhigh: INHERIT, max: INHERIT }
  },
  {
    // gemini-3.x：minimal/low/medium/high 四档，不接受 xhigh / max。
    id: 'google-gemini-3',
    vendor: ['google', 'google-vertex', 'gemini'],
    model: ['gemini-3', 'gemini3'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null }
  },
  {
    // gemini-2.5 / 3-pro 等目录缺档：按 gemini-3 的保守形态兜底（minimal~high 可用）。
    id: 'google-gemini-generic',
    vendor: ['google', 'google-vertex', 'gemini'],
    model: ['gemini', 'gemma', 'thinking'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null }
  },

  // ── xAI / Grok ───────────────────────────────────────────────────────────
  {
    id: 'xai-grok',
    vendor: ['xai', 'grok', 'spacexai'],
    model: ['grok'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null }
  },

  // ── Moonshot / Kimi ─────────────────────────────────────────────────────
  {
    // kimi-k3 / k2.7-code / kimi-for-coding 的目录形态；k2.6 等无独立 map 的版本按此保守兜底。
    id: 'moonshot-kimi',
    vendor: ['moonshot', 'kimi', 'moonshotai', 'kimi-coding'],
    model: ['kimi', 'moonshot', 'k2', 'k3', 'moonshot-v'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' }
  },
  

  // ── DeepSeek 系 ─────────────────────────────────────────────────────────
  {
    id: 'deepseek-v4.1-flash',
    vendor: ['deepseek'],
    model: ['v4.1-flash', 'v4-1-flash', 'deepseek-v4.1-flash'],
    effortKeys: ALL_LEVELS,
    wire: { off: 'none', minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' }
  },
  {
    id: 'deepseek-v4-pro',
    vendor: ['deepseek'],
    model: ['v4-pro', 'deepseek-v4-pro'],
    effortKeys: ALL_LEVELS,
    wire: { off: 'none', minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max' }
  },
  {
    id: 'deepseek-flash',
    vendor: ['deepseek'],
    model: ['deepseek-flash', 'v4-flash', 'v4.1', 'v3.2', 'v3.1', 'v3', 'r1', 'r2', 'reasoner'],
    effortKeys: ALL_LEVELS,
    wire: { off: 'none', minimal: null, low: 'low', medium: null, high: 'high', xhigh: INHERIT, max: 'max' }
  },
  {
    // baseten 转售的 DeepSeek：七档全开，off 用 'none'。
    id: 'baseten-deepseek',
    vendor: ['baseten'],
    model: ['deepseek'],
    effortKeys: ALL_LEVELS,
    wire: {
      off: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max'
    }
  },
  {
    // fireworks 的 deepseek：off='none'，medium/xhigh 不支持。
    id: 'fireworks-deepseek',
    vendor: ['fireworks'],
    model: ['deepseek'],
    effortKeys: ALL_LEVELS,
    wire: { off: 'none', minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' }
  },
  {
    // opencode-go 的 deepseek-v4-flash 目录里连 off 键都没有。
    id: 'opencode-go-deepseek',
    vendor: ['opencode-go'],
    model: ['deepseek'],
    effortKeys: ALL_LEVELS,
    wire: { off: INHERIT, minimal: null, low: 'low', medium: null, high: 'high', xhigh: INHERIT, max: 'max' }
  },

  // ── Zhipu / Z.ai / GLM ──────────────────────────────────────────────────
  {
    id: 'zai-glm-5.3',
    vendor: ['zai', 'zhipu', 'z-ai', 'zhipuai', 'bigmodel', 'glm'],
    model: ['glm-5.3', 'glm-5-3'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' }
  },
  {
    id: 'zai-glm-5.2',
    vendor: ['zai', 'zhipu', 'z-ai', 'zhipuai', 'bigmodel', 'glm'],
    model: ['glm-5.2', 'glm-5-2', 'glm-5', 'glm-5-'],
    effortKeys: ALL_LEVELS,
    wire: { off: 'none', minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max' }
  },
  {
    // GLM 家族兜底：无 minimal，不接受 xhigh / max。
    id: 'glm-generic',
    vendor: ['zai', 'zhipu', 'z-ai', 'zhipuai', 'bigmodel', 'glm'],
    model: ['glm'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: INHERIT, max: INHERIT }
  },

  // ── Qwen / 阿里 ─────────────────────────────────────────────────────────
  {
    // qwen3.x：low/medium/xhigh 可用，high 与 max 目录为 null。
    id: 'qwen3',
    vendor: ['qwen', 'alibaba', 'dashscope', 'aliyun'],
    model: ['qwen', 'qwq'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: null, low: 'low', medium: 'medium', high: null, xhigh: 'xhigh', max: null }
  },

  // ── MiniMax ─────────────────────────────────────────────────────────────
  {
    id: 'minimax-m3',
    vendor: ['minimax'],
    model: ['m3', 'm2.7', 'm2.5', 'm2.1', 'minimax'],
    effortKeys: ALL_LEVELS,
    wire: { off: 'none', minimal: INHERIT, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }
  },

  // ── Xiaomi MiMo ─────────────────────────────────────────────────────────
  {
    id: 'mimo',
    vendor: ['mimo', 'xiaomi'],
    model: ['mimo', 'mimo-v2'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: INHERIT, low: 'low', medium: 'medium', high: 'high', xhigh: INHERIT, max: INHERIT }
  },

  // ── 腾讯混元 HY3 ────────────────────────────────────────────────────────
  {
    id: 'hy3-nothink',
    vendor: ['hunyuan', 'tencent', 'hy'],
    model: ['hy3', 'hy4', 'hunyuan'],
    effortKeys: ALL_LEVELS,
    // 混元用 noThink 布尔位表达「不思考」，不是 effort 字符串。
    wire: { off: 'noThink', minimal: INHERIT, low: 'low', medium: 'medium', high: 'high', xhigh: INHERIT, max: INHERIT }
  },

  // ── StepFun ─────────────────────────────────────────────────────────────
  {
    id: 'stepfun-step',
    vendor: ['stepfun', 'step'],
    model: ['step-', 'step3', 'step-3'],
    effortKeys: ALL_LEVELS,
    wire: { off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: INHERIT, max: INHERIT }
  },

  // ── Together ────────────────────────────────────────────────────────────
  {
    // together MiniMax-M2.7：只有 off/minimal/low/medium 四键，且全为 null。
    id: 'together-minimax',
    vendor: ['together'],
    model: ['minimax-m2.7', 'minimaxai/minimax-m2.7', 'minimax'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: null, low: null, medium: null, high: INHERIT, xhigh: INHERIT, max: INHERIT }
  },
  {
    // together 其余推理模型：只给 minimal/low/medium 三个 null 键，连 off 键都没有。
    id: 'together-generic',
    vendor: ['together'],
    model: ['qwen', 'glm', 'kimi', 'deepseek', 'gemma', 'nemotron', 'inkling'],
    effortKeys: ALL_LEVELS,
    wire: { off: INHERIT, minimal: null, low: null, medium: null, high: INHERIT, xhigh: INHERIT, max: INHERIT }
  },

  // ── Cloudflare Workers AI ───────────────────────────────────────────────
  {
    // @cf/deepseek-* 与 @cf/zai-org/glm-5.2/5.3：minimal/low/medium 为 null，无 off 键。
    id: 'cloudflare-workers-deepseek-glm',
    vendor: ['cloudflare-workers-ai', 'cloudflare'],
    model: ['deepseek', 'glm'],
    effortKeys: ALL_LEVELS,
    wire: { off: INHERIT, minimal: null, low: null, medium: null, high: 'high', xhigh: INHERIT, max: 'max' }
  },
  {
    id: 'cloudflare-workers-generic',
    vendor: ['cloudflare-workers-ai', 'cloudflare'],
    model: ['kimi', 'nemotron', 'gpt-oss', 'qwen', 'gemma', 'k2', 'k3'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null }
  },

  // ── Radius ──────────────────────────────────────────────────────────────
  {
    // radius 的 cheap/precise 档把 max 映射到 'xhigh'（一档映射到别的拼写）。
    id: 'radius-cheap',
    vendor: ['radius'],
    model: ['cheap', 'precise', 'balanced', 'deepseek', 'glm', 'gpt', 'kimi', 'claude'],
    effortKeys: ALL_LEVELS,
    wire: {
      off: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'xhigh'
    }
  },

  // ── ant-ling ────────────────────────────────────────────────────────────
  {
    // Ring-2.6-1T：off/minimal/low/medium 为 null，没有 max 键。
    id: 'ant-ling-ring',
    vendor: ['ant-ling', 'antling'],
    model: ['ring', 'ling'],
    effortKeys: ALL_LEVELS,
    wire: { off: null, minimal: null, low: null, medium: null, high: 'high', xhigh: 'xhigh', max: INHERIT }
  },

  // ── OpenRouter / Vercel 网关兜底 ─────────────────────────────────────────
  {
    id: 'gateway-generic',
    vendor: ['openrouter', 'vercel-ai-gateway'],
    model: ['claude', 'gemini', 'gpt', 'deepseek', 'glm', 'kimi', 'grok', 'qwen', 'step', 'hy'],
    effortKeys: ALL_LEVELS,
    wire: {
      off: 'none',
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: null
    }
  }
])

/** 命中任意一个 needle（字符串或数组，忽略大小写的子串匹配）。 */
function matches(needles, haystack) {
  const text = String(haystack || '').toLowerCase()
  if (!text) return false
  const list = Array.isArray(needles) ? needles : [needles]
  return list.some((needle) => {
    const n = String(needle || '').toLowerCase()
    return !!n && text.includes(n)
  })
}

/**
 * 把一条规则编译成 efforts dict。
 * effortKeys → 同名 wire（off 默认 null），再叠 wire 覆盖。
 * 值语义：null = 目录里就是 null；'inherit' = 缺键兜底，不要写这个键；
 * 非空字符串 = wire 上的真实拼写。
 */
function compileRule(rule) {
  const efforts = {}
  for (const key of rule.effortKeys || []) {
    if (!THINKING_LEVELS.includes(key)) {
      throw new Error(
        '[dsh-thinking-effort] 知识库规则 ' + rule.id + ' 含非法档位键 ' + JSON.stringify(key) +
          '（合法集合：' + THINKING_LEVELS.join('/') + '）'
      )
    }
    efforts[key] = key === 'off' ? null : key
  }
  for (const [key, value] of Object.entries(rule.wire || {})) {
    if (!(key in efforts)) {
      throw new Error(
        '[dsh-thinking-effort] 知识库规则 ' + rule.id + ' 的 wire 覆盖键 ' + JSON.stringify(key) +
          ' 不在 effortKeys 内'
      )
    }
    if (value !== null && typeof value !== 'string') {
      throw new Error(
        '[dsh-thinking-effort] 知识库规则 ' + rule.id + ' 的 wire 值必须是字符串或 null'
      )
    }
    if (typeof value === 'string' && !value.trim()) {
      throw new Error(
        '[dsh-thinking-effort] 知识库规则 ' + rule.id + ' 的 wire 值不能是空字符串（官方校验会报 PiAiCatalogError）'
      )
    }
    efforts[key] = value
  }
  // 官方目录里确实存在「七档全为 null / inherit」的形态（如 together 的
  // MiniMax-M2.7 = {off:null,minimal:null,low:null,medium:null}），语义等同
  // 「该模型在本插件下不下发 effort，由厂商默认兜底」，因此只禁止空键表。
  if (!Object.keys(efforts).length) {
    throw new Error(
      '[dsh-thinking-effort] 知识库规则 ' + rule.id + ' 产出空档位表（effortKeys 为空）'
    )
  }
  return efforts
}

/** 预编译全部规则；模块加载期即完成校验（写错规则在启动时就炸，不拖到请求期）。 */
const COMPILED = Object.freeze(
  RULES.map((rule) =>
    Object.freeze({
      id: rule.id,
      vendor: rule.vendor,
      model: rule.model,
      efforts: Object.freeze(compileRule(rule))
    })
  )
)

/**
 * 查知识库。匹配优先级见文件头注释：精确 modelId > 模型名模糊 > 厂商前缀。
 *
 * @param {object} args
 * @param {string} args.providerId  provider 路由名/厂商标识（如 deepseek、moonshot）
 * @param {string} args.baseId      模型 id（可空；为空时只按厂商匹配）
 * @param {string} [args.modelName] 模型展示名（可选，参与匹配）
 * @returns {{efforts: object, ruleId: string, source: 'knowledge'} | null}
 */
export function lookupKnowledge({ providerId, baseId, modelName } = {}) {
  const haystack = [modelName, baseId].filter(Boolean).join(' ')

  // 第一趟：vendor 对 providerId（route 名即厂商）匹配。这是正常形态。
  const direct = findRule((entry) => matches(entry.vendor, providerId), haystack)
  if (direct) return direct

  // 第二趟：vendor 改对模型名串匹配，兜住「route 是反代/聚合商」的形态。
  // 仅在第一趟全 miss 时启用，因此永远不会改变既有命中结果（向后兼容）。
  return findRule((entry) => matches(entry.vendor, haystack), haystack)
}

/**
 * 在 RULES 里按顺序找第一条「vendor 门通过 + 模型门通过」的规则。
 * 顺序即优先级：数组中靠前 = 更具体。
 *
 * @param {(entry: object) => boolean} vendorPass vendor 门判据（第一趟看 route，第二趟看模型名）
 * @param {string} haystack 模型名 + baseId 拼接串，供 model needle 匹配
 * @returns {{efforts: object, ruleId: string, source: 'knowledge'} | null}
 */
function findRule(vendorPass, haystack) {
  for (const entry of COMPILED) {
    if (!vendorPass(entry)) continue
    if (entry.model && !matches(entry.model, haystack)) continue
    return {
      efforts: { ...entry.efforts },
      ruleId: entry.id,
      source: 'knowledge'
    }
  }
  return null
}

/** 设置页展示用：列出知识库全部规则（值已拷贝，调用方可安全改）。 */
export function listRules() {
  return COMPILED.map((entry) => ({
    id: entry.id,
    vendor: entry.vendor,
    model: entry.model,
    efforts: { ...entry.efforts }
  }))
}

/**
 * 把任意来源的 efforts dict 规范化：去 undefined、保留 null wire 与 'inherit' 哨兵、剔除非法键。
 * 'inherit' 必须原样保留 —— 它是「缺键兜底」的语义载体，由 Host 侧（lib/index.js）过滤掉。
 */
export function normalizeEfforts(efforts) {
  const out = {}
  if (!efforts || typeof efforts !== 'object') return out
  for (const [key, value] of Object.entries(efforts)) {
    if (!THINKING_LEVELS.includes(key)) continue
    if (value === undefined) continue
    if (value === INHERIT) {
      out[key] = INHERIT
      continue
    }
    if (value !== null && (typeof value !== 'string' || !value.trim())) continue
    out[key] = value
  }
  return out
}