/*
 * dsh-thinking-effort — shared UI core
 *
 * Classic-script factory (no ESM) so the same file can be loaded by:
 *   - preview/index.html via <script> and window.THINKING_UI_CORE
 *   - lib/client.js via the DSH Module Loader wrapper (later)
 *
 * The only React access is through createThinkingUI(React), so the preview can
 * hand in its vendored React 19 while the plugin hands in require('react').
 */
(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.THINKING_UI_CORE = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  var CANON = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  var CANON_NAMES = {
    off: '关闭',
    minimal: '极简',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '极高',
    max: '最高'
  }

  /* Codex 形态固定显示英文档位名；官方形态仍用目录里的名字。 */
  var ENGLISH_NAMES = {
    off: 'Off',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Xhigh',
    max: 'Max'
  }

  /* 官方把「跟随 provider 默认」做成档位列表首行的空值项（label=Default、value=""），
   * 只在模型没有 defaultEffort 时才出现（见 docs/official-ui-notes.md:297-312）。
   * 我们把它落成一格真实的档位，好让滑条、闪电、重置都有确定的落点：
   * id 用一个任何 provider 都不会用到的哨兵，提交时翻译成"省略 reasoningEffort"。
   * 不能用 '' 或 null —— indexOfLevel 是严格比较，commitKeyOf 又用 '' 拼键，
   * 两者都会和"没有档位"撞在一起。 */
  var DEFAULT_LEVEL_ID = '__provider_default__'
  var DEFAULT_LEVEL = { id: DEFAULT_LEVEL_ID, name: 'Default' }

  function isDefaultLevel(level) {
    return !!(level && level.id === DEFAULT_LEVEL_ID)
  }

  /* enabled 由调用方按 reasoning.defaultEffort 决定：有 defaultEffort 时不插，
   * 与官方一致（官方在有 defaultEffort 时绝不显示那一行空值项）。 */
  function withDefaultLevel(levels, enabled) {
    if (!levels || !levels.length) return levels || []
    if (!enabled) return levels
    if (indexOfLevel(levels, DEFAULT_LEVEL_ID) >= 0) return levels
    return [DEFAULT_LEVEL].concat(levels)
  }

  var DEFAULT_CUSTOM = [
    '#7DD3FC',
    '#5EEAD4',
    '#60A5FA',
    '#A78BFA',
    '#FBBF24',
    '#FB7185',
    '#EF4444'
  ]

  /* 七色色阶 = 填充的取样表。第一色是填充左端锚点（Off/Default 与一切低档都从它开始），
   * 所以它不能是灰的——灰底一压，整条轨道从最左就发闷，档位拉低时尤其明显。
   * 每套都换成同色系的亮版本：左端起手就是有颜色的，右端收在自己最浓的那一档。 */
  var PALETTES = [
    { id: 'codex', name: 'Codex', colors: ['#4DA9FF', '#3B82F6', '#6366F1', '#7C3AED', '#9333EA', '#C026D3', '#FF4FD8'] },
    { id: 'aurora', name: '极光', colors: ['#7DD3FC', '#5EEAD4', '#60A5FA', '#A78BFA', '#FBBF24', '#FB7185', '#EF4444'] },
    { id: 'solar', name: '暖阳', colors: ['#FFC46B', '#D9C27A', '#F0A868', '#F58A5B', '#EC6A5C', '#D9568A', '#B44BE0'] },
    { id: 'ocean', name: '深海', colors: ['#22D3EE', '#67E8F9', '#38BDF8', '#2DD4BF', '#34D399', '#A3E635', '#FDE047'] },
    { id: 'neon', name: '霓虹', colors: ['#38BDF8', '#22D3EE', '#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#FACC15'] },
    { id: 'morandi', name: '莫兰迪', colors: ['#9FB2C6', '#8FA8A0', '#8FA3B8', '#9C96B5', '#B5A38F', '#B08E96', '#A88F8F'] }
  ]

  var VISUALS = [
    { id: 'codex', name: 'Codex', desc: '蓝紫渐变 + 粒子，档位越高越多越快' },
    { id: 'energy', name: '能量充能', desc: '格点充能场，越靠近当前档越亮' },
    { id: 'warp', name: '曲率跃迁', desc: '星流加速，档位越高越接近光速' },
    { id: 'quantum', name: '量子纠缠', desc: '双波干涉，档位越高振荡越密' },
    { id: 'whale', name: '鲸鱼娘', desc: '鲸鱼娘表情滑块，整层深海主题' },
    { id: 'liang', name: '梁圣', desc: '梁系强度，头像与弹层随档位登基' }
  ]

  var LIANG_NAMES = ['梁子', '小梁', '梁叔', '梁哥', '梁总', '梁神', '梁圣']

  var THEME_COLORS = {
    whale: {
      light: ['#2E607D', '#267295', '#1D6A95', '#195B85', '#284D91', '#463D91', '#633A91'],
      dark: ['#9BDDF5', '#7BD2F2', '#5EC6EE', '#45B2E6', '#6E9BE8', '#9A8BE8', '#C08BE8']
    },
    liang: {
      light: ['#B59A72', '#CDAE75', '#E0C07A', '#EDCF82', '#F6DA8E', '#FFE3A0', '#FFF0C2'],
      dark: ['#B59A72', '#CDAE75', '#E0C07A', '#EDCF82', '#F6DA8E', '#FFE3A0', '#FFF0C2']
    }
  }

  function themeColors(visual, tone) {
    var entry = THEME_COLORS[visual]
    if (!entry) return null
    return entry[tone] || entry.light
  }

  /** Resolve a bundled asset filename either from an inline map or an asset base. */
  function assetUrl(base, name, assets) {
    if (assets && assets[name]) return assets[name]
    return (base == null ? 'assets/' : base) + name
  }

  var THEME_ASSETS = {
    whale: {
      hero: 'whale-bg.webp',
      frames: [
        'whale-0.webp',
        'whale-1.webp',
        'whale-2.webp',
        'whale-3.webp',
        'whale-4.webp',
        'whale-5.webp',
        'whale-6.webp'
      ]
    },
    liang: {
      hero: [
        'liang-hero-0.webp',
        'liang-hero-1.webp',
        'liang-hero-2.webp',
        'liang-hero-3.webp',
        'liang-hero-4.webp',
        'liang-hero-5.webp',
        'liang-hero-6.webp'
      ],
      frames: [
        'liang-bg-0.webp',
        'liang-bg-1.webp',
        'liang-bg-2.webp',
        'liang-bg-3.webp',
        'liang-bg-4.webp',
        'liang-bg-5.webp',
        'liang-bg-6.webp'
      ]
    }
  }

  var THEME_VISUALS = ['whale', 'liang']

  /* ------------------------------------------------------------------ */
  /* color helpers                                                       */
  /* ------------------------------------------------------------------ */

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n))
  }

  function hexToRgb(hex) {
    var s = String(hex || '').replace('#', '')
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return { r: 128, g: 128, b: 128 }
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16)
    }
  }

  function rgbToHex(c) {
    function p(n) {
      var v = clamp(Math.round(n), 0, 255).toString(16)
      return v.length === 1 ? '0' + v : v
    }
    return '#' + p(c.r) + p(c.g) + p(c.b)
  }

  function mix(a, b, t) {
    return {
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t
    }
  }

  function channel(n) {
    var v = n / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }

  function relLuminance(rgb) {
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  }

  function contrast(a, b) {
    var l1 = relLuminance(a)
    var l2 = relLuminance(b)
    if (l1 < l2) {
      var t = l1
      l1 = l2
      l2 = t
    }
    return (l1 + 0.05) / (l2 + 0.05)
  }

  function ensureContrast(hex, bgHex, minRatio) {
    var color = hexToRgb(hex)
    var bg = hexToRgb(bgHex)
    if (contrast(color, bg) >= minRatio) return rgbToHex(color)
    var toward = relLuminance(bg) > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }
    for (var i = 0; i < 24; i++) {
      color = mix(color, toward, 0.07)
      if (contrast(color, bg) >= minRatio) return rgbToHex(color)
    }
    return rgbToHex(color)
  }

  function rgba(hex, alpha) {
    var c = hexToRgb(hex)
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')'
  }

  /* 调色板原色：给「填充」用。
   * 填充是整块色面，色相本身才是信息，不该为了文字可读性被拉去撞黑白。 */
  function fillPalette(id, custom) {
    var base = id === 'custom' ? custom : null
    if (!base) {
      for (var i = 0; i < PALETTES.length; i++) {
        if (PALETTES[i].id === id) {
          base = PALETTES[i].colors
          break
        }
      }
    }
    if (!base || !base.length) base = PALETTES[0].colors
    return base.slice(0, 7)
  }

  /* 调色板"可读色"：给「文字」用。
   * 每档的标签、档位大标题都要压在背景上读得清，所以逐个顶到 4.5:1。
   * 别拿它去填色面——那会把 #38BDF8 这类亮蓝压成灰蓝，画面立刻发闷。 */
  function resolvePalette(id, custom, tone) {
    var bg = tone === 'light' ? '#ffffff' : '#18181b'
    return fillPalette(id, custom).map(function (c) {
      return ensureContrast(c, bg, 4.5)
    })
  }

  function paletteIndexFor(levels, index) {
    var n = levels.length
    if (n <= 1) return 3
    if (n === 7) return clamp(index, 0, 6)
    return Math.round((index * 6) / (n - 1))
  }

  /* 第 index 格在"真实档位"里的排位（Default 格不占位）。
   * 色阶、梁系命名、主题帧都按它算，插了 Default 也不会整体错位一格。 */
  function realRankOf(levels, index) {
    if (!levels || index < 0 || index >= levels.length) return -1
    var rank = -1
    for (var i = 0; i <= index; i++) {
      if (!isDefaultLevel(levels[i])) rank++
    }
    return rank
  }

  function colorAt(levels, index, colors) {
    if (!levels || !levels.length) return colors[3] || '#a78bfa'
    var safe = clamp(index, 0, levels.length - 1)
    if (isDefaultLevel(levels[safe])) return colors[0] || '#8a93a3'
    var ranked = []
    for (var ri = 0; ri < levels.length; ri++) {
      if (!isDefaultLevel(levels[ri])) ranked.push(levels[ri])
    }
    var id = levels[safe] && levels[safe].id
    var canon = CANON.indexOf(id)
    if (canon >= 0 && ranked.length === 7) return colors[canon] || colors[3]
    return colors[paletteIndexFor(ranked, realRankOf(levels, safe))] || colors[3]
  }

  function indexOfLevel(levels, id) {
    if (!levels) return -1
    for (var i = 0; i < levels.length; i++) {
      if (levels[i].id === id) return i
    }
    return -1
  }

  // 关闭档的 id 未必叫 'off'：自定义 provider 可能用 none / 关闭 / 无，
  // 也可能只给 name 不给 id。只认 id 会让"一键关思考"在那些模型上静默失效
  // （offIndex 变 -1，闪电按钮的落点和 powerOn 判断全歪）。
  var OFF_ALIASES = ['off', 'none', '关闭', '无', 'disabled', 'disable']

  function normalizeLevelKey(value) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
  }

  /* Default 格也算"没有开启推理"：闪电按下时它不是"开"，关掉时它正是落点。
   * 这样 findOffIndex 在插了 Default 的模型上恒为 0，
   * 「关闭 / 重置」天然落在 Default 上，不需要额外分支。 */
  function isOffLevel(level) {
    if (!level) return false
    if (isDefaultLevel(level)) return true
    var id = normalizeLevelKey(level.id)
    var name = normalizeLevelKey(level.name)
    for (var i = 0; i < OFF_ALIASES.length; i++) {
      var alias = normalizeLevelKey(OFF_ALIASES[i])
      if (id === alias || name === alias) return true
    }
    return false
  }

  function findOffIndex(levels) {
    if (!levels || !levels.length) return -1
    for (var i = 0; i < levels.length; i++) {
      if (isOffLevel(levels[i])) return i
    }
    return -1
  }

  function levelName(id) {
    return CANON_NAMES[id] || id || ''
  }

  function levelLabel(id, fallback) {
    return ENGLISH_NAMES[id] || fallback || CANON_NAMES[id] || id || ''
  }

  /* 一格档位在界面上显示的名字。Default 格固定显示 Default（官方 zh 也是 Default，
   * 见 docs/official-ui-notes.md:871），不参与梁系命名，否则会变成"梁子"那种
   * 强度名，看起来像是在说某个具体档位。 */
  function displayLabelOf(levels, index, isLiang) {
    if (!levels || index < 0 || index >= levels.length) return ''
    var level = levels[index]
    if (isDefaultLevel(level)) return 'Default'
    if (isLiang) {
      return LIANG_NAMES[clamp(realRankOf(levels, index), 0, LIANG_NAMES.length - 1)]
    }
    return levelLabel(level.id, level.name)
  }

  /* ------------------------------------------------------------------ */
  /* styles                                                              */
  /* ------------------------------------------------------------------ */

  var CSS = [
    '.teff-trigger{display:inline-flex;align-items:center;height:28px;max-width:min(360px,45cqw);padding:0 2px 0 4px;color:var(--dsw-alias-label-secondary,#8a8f98);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;user-select:none}',
    '.teff-triggerModel,.teff-triggerEffortBtn{display:inline-flex;align-items:center;gap:4px;height:28px;min-width:0;padding:0 4px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap}',
    '.teff-triggerEffortBtn{gap:2px;flex-shrink:1000;padding:0 3px}',
    '.teff-triggerModel:hover,.teff-triggerEffortBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
    '.teff-triggerModel:focus-visible,.teff-triggerEffortBtn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe));outline-offset:-2px}',
    '.teff-triggerModel:disabled,.teff-triggerEffortBtn:disabled{opacity:.55;cursor:default;background:transparent}',
    '.teff-triggerIcon{display:var(--dsh-composer-model-icon-display,none);width:16px;height:16px;flex:none;align-items:center;justify-content:center}',
    '.teff-triggerIcon svg{width:16px;height:16px}',
    '.teff-triggerLabel{display:var(--dsh-composer-model-text-display,block);min-width:0;overflow:hidden;text-overflow:ellipsis}',
    // 底部那个档位文字：真机上圆角被宿主的 corner-shape 抹过，这里只做动画。
    '.teff-triggerEffort{display:var(--dsh-composer-model-text-display,block);flex-shrink:1000;overflow:hidden;text-overflow:ellipsis;font-weight:600}',
    // 换名时都走一趟小幅模糊淡入：模型名和档位名同一个节奏，不硬切。
    // 模型名有两处（弹层标题行、底部触发器），共用一条规则。
    '.teff-triggerLabel[data-fx="true"],.teff-triggerEffort[data-fx="true"],.teff-modelName[data-fx="true"]{animation:teff-effort-in .2s cubic-bezier(.22,.85,.24,1) both}',
    '.teff-triggerChevron{width:12px;height:12px;flex:none;opacity:.75;transition:transform .12s ease}',
    '.teff-triggerEffortBtn[aria-expanded="true"] .teff-triggerChevron{transform:rotate(180deg)}',
    '.teff-triggerModel:active,.teff-triggerEffortBtn:active{background:var(--teff-hover)}',
    '.teff-spin{display:block;flex:none;transform-origin:50% 50%;animation:teff-spin .75s linear infinite}',
    '.teff-slot{position:relative;display:inline-flex;align-items:center}',
    '.tb-seatToast{position:absolute;bottom:calc(100% + 6px);left:50%;z-index:1100;max-width:320px;padding:6px 10px;transform:translateX(-50%);border-radius:8px;background:var(--dsw-alias-state-error-primary,#dc2626);color:#fff;font-family:inherit;font-size:12px;line-height:16px;box-shadow:0 10px 24px -12px rgba(0,0,0,.5);white-space:normal}',
    // 浮层挂到 body 上（和官方一样脱离输入框那棵子树）：宿主重排、裁剪、
    // 合成层提升都不会再拖着菜单一起重绘，划过行的时候只脏这一小块区域。
    '.tb-portal{position:fixed;left:0;top:0;width:0;height:0;z-index:1100;pointer-events:none}',
    '.tb-portal .teff-card{pointer-events:auto}',

    '.teff-card[data-pane="effort"]{height:130px!important;box-sizing:border-box}',
    '.teff-card{position:absolute;right:0;bottom:calc(100% + 8px);width:min(356px,calc(100vw - 32px));z-index:1100;border-radius:12px;border:1px solid var(--teff-border);background:var(--teff-surface);color:var(--teff-text);box-shadow:var(--teff-shadow);overflow:hidden;font-family:inherit;font-size:13px;line-height:20px;transform-origin:bottom right}',
    '.teff-card[data-tone="dark"]{--teff-surface:#1c1c1f;--teff-border:rgba(255,255,255,.09);--teff-text:#ededed;--teff-text-2:#a1a1aa;--teff-text-3:#71717a;--teff-hover:rgba(255,255,255,.06);--teff-hover-strong:rgba(255,255,255,.1);--teff-divider:rgba(255,255,255,.07);--teff-rail:rgba(255,255,255,.11);--teff-track:rgba(255,255,255,.1);--teff-dot:rgba(255,255,255,.2);--teff-power:#a78bfa;--teff-kbd-border:rgba(255,255,255,.12);--teff-kbd:rgba(255,255,255,.06);--teff-shadow:0 12px 32px -16px rgba(0,0,0,.55),0 1px 2px rgba(0,0,0,.2);--teff-thumb:#fafafa;--teff-thumb-ring:rgba(0,0,0,.2);--teff-tick:rgba(255,255,255,.3);--teff-tick-on:rgba(255,255,255,.9);--teff-menu-surface:#1f1f22;--teff-glass:rgba(31,31,34,.78);--teff-menu-pinned:rgba(32,32,36,.985);--teff-menu-shadow:0 18px 42px -18px rgba(0,0,0,.72),0 1px 2px rgba(0,0,0,.42);--teff-scroll:rgba(255,255,255,.2);--teff-scroll-hover:rgba(255,255,255,.38)}',
    '.teff-card[data-tone="light"]{--teff-surface:#ffffff;--teff-border:rgba(0,0,0,.08);--teff-text:#18181b;--teff-text-2:#52525b;--teff-text-3:#8b8b93;--teff-hover:rgba(0,0,0,.045);--teff-hover-strong:rgba(0,0,0,.07);--teff-divider:rgba(0,0,0,.06);--teff-rail:rgba(0,0,0,.1);--teff-track:rgba(0,0,0,.07);--teff-dot:rgba(0,0,0,.16);--teff-power:#6d28d9;--teff-kbd-border:rgba(0,0,0,.1);--teff-kbd:rgba(0,0,0,.04);--teff-shadow:0 12px 32px -16px rgba(15,23,42,.18),0 1px 2px rgba(15,23,42,.06);--teff-thumb:#ffffff;--teff-thumb-ring:rgba(0,0,0,.12);--teff-tick:rgba(15,23,42,.3);--teff-tick-on:rgba(255,255,255,.9);--teff-menu-surface:#f5f6f8;--teff-glass:rgba(245,246,248,.78);--teff-menu-pinned:rgba(246,247,249,.985);--teff-menu-shadow:0 14px 34px -14px rgba(15,23,42,.22),0 2px 8px rgba(15,23,42,.06);--teff-scroll:rgba(15,23,42,.2);--teff-scroll-hover:rgba(15,23,42,.38)}',

    '.teff-card[data-visual="whale"]{--teff-surface:#eefaff;--teff-border:rgba(86,178,225,.45);--teff-text:#0b3a56;--teff-text-2:#356a84;--teff-text-3:#6a93aa;--teff-hover:rgba(58,158,220,.1);--teff-hover-strong:rgba(58,158,220,.16);--teff-divider:rgba(58,158,220,.16);--teff-track:#d8f3ff;--teff-power:#1f7db5;--teff-kbd-border:rgba(58,158,220,.2);--teff-kbd:rgba(58,158,220,.08);--teff-scroll:rgba(31,125,181,.32);--teff-scroll-hover:rgba(31,125,181,.52);--teff-label-bg:#eefaff;--teff-shadow:0 18px 40px -18px rgba(20,90,130,.38),0 1px 2px rgba(20,90,130,.12);--teff-thumb:#ffffff;--teff-thumb-ring:rgba(20,90,130,.16);--teff-tick:rgba(31,125,181,.34);--teff-tick-on:rgba(255,255,255,.92);overflow:visible;background-color:var(--teff-surface);background-image:linear-gradient(180deg,rgba(250,254,255,.90),rgba(216,244,255,.82)),var(--teff-hero);background-size:cover;background-position:center}',
    '.teff-card[data-visual="whale"][data-tone="dark"]{--teff-surface:#062033;--teff-border:rgba(125,211,252,.38);--teff-text:#eefbff;--teff-text-2:#b7e2f2;--teff-text-3:#7fb3c9;--teff-hover:rgba(125,211,252,.1);--teff-hover-strong:rgba(125,211,252,.16);--teff-divider:rgba(125,211,252,.16);--teff-track:#0d3047;--teff-power:#7dd3fc;--teff-kbd-border:rgba(125,211,252,.2);--teff-kbd:rgba(125,211,252,.08);--teff-scroll:rgba(125,211,252,.3);--teff-scroll-hover:rgba(125,211,252,.5);--teff-label-bg:#062033;--teff-shadow:0 26px 60px -22px rgba(0,0,0,.8);--teff-tick:rgba(125,211,252,.4);--teff-tick-on:rgba(255,255,255,.94);background-image:linear-gradient(180deg,rgba(5,20,32,.72),rgba(4,16,26,.92)),var(--teff-hero);overflow:visible}',
    '.teff-card[data-visual="liang"]{--teff-surface:#160e08;--teff-border:rgba(225,183,105,.55);--teff-text:#ffe9bd;--teff-text-2:#d8b884;--teff-text-3:#ad8a58;--teff-hover:rgba(255,216,140,.1);--teff-hover-strong:rgba(255,216,140,.18);--teff-divider:rgba(255,216,140,.16);--teff-track:#2b1b10;--teff-power:#f0c35a;--teff-kbd-border:rgba(255,216,140,.2);--teff-kbd:rgba(255,216,140,.08);--teff-scroll:rgba(240,195,90,.34);--teff-scroll-hover:rgba(240,195,90,.54);--teff-label-bg:#160e08;--teff-shadow:0 24px 54px -18px rgba(0,0,0,.8),0 2px 8px rgba(0,0,0,.4);--teff-thumb:#ffe9bd;--teff-thumb-ring:rgba(225,183,105,.5);--teff-tick:rgba(255,216,140,.32);--teff-tick-on:#fff3d2;overflow:visible;background-color:var(--teff-surface);background-image:linear-gradient(180deg,rgba(12,8,5,.22),rgba(12,8,5,.88)),var(--teff-hero);background-size:cover;background-position:center;background-repeat:no-repeat;color:var(--teff-text)}',

    // 不透明（93%）材质：官方那套是「低透明度 + backdrop blur(40px)」，
    // 放到这里每次 hover 重绘都要重算整块背景模糊，指针划过就是一顿一顿的。
    // 圆角与内缩要同心：12 - 1(border) = 11，11 - 5(padding) = 6，正好等于行圆角。
    // 描边也统一回基础卡的 1px border，effort / model 两个 pane 来回切不再跳粗细。
    '.teff-card.teff-card[data-pane="model"]{display:flex;flex-direction:column;box-sizing:border-box;width:min(246px,calc(100vw - 24px));max-height:min(360px,calc(100vh - 96px));padding:5px;border:1px solid var(--teff-border);border-radius:12px;background:var(--teff-menu-surface);box-shadow:var(--teff-menu-shadow);overflow:clip}',
    // 列表吃掉卡片剩余高度（配合下面 .teff-groups 的 flex），窗口再矮也不会切掉半行。
    '.teff-card[data-pane="model"] .teff-modelPane{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}',
    // 除列表外都不参与收缩，否则卡片触到 max-height 时状态行/提示行会被压扁裁字。
    '.teff-card[data-pane="model"] .teff-modelPane>*{flex:none}',
    // 鲸鱼娘 / 梁圣的模型菜单继续用主题背景（上面那条 background 简写会把
    // background-image 清成 none，所以这两个主题必须在这里重新贴回来）。
    '.teff-card[data-visual="whale"][data-pane="model"]{background-color:var(--teff-surface);background-image:linear-gradient(180deg,rgba(250,254,255,.90),rgba(216,244,255,.82)),var(--teff-hero);background-size:cover;background-position:center}',
    '.teff-card[data-visual="whale"][data-tone="dark"][data-pane="model"]{background-image:linear-gradient(180deg,rgba(5,20,32,.72),rgba(4,16,26,.92)),var(--teff-hero)}',
    '.teff-card[data-visual="liang"][data-pane="model"]{background-color:var(--teff-surface);background-image:linear-gradient(180deg,rgba(12,8,5,.72),rgba(12,8,5,.94)),var(--teff-hero);background-size:cover;background-position:center;background-repeat:no-repeat}',
    // 毛玻璃只给四个程序化主题的模型页，鲸鱼娘/梁圣靠 :not() 排除——那两套本身就是照片背景，
    // 再叠一层模糊会把鲸鱼娘的图糊成一团。特异性 (0,4,0) 高于上面重贴照片的 (0,3,0)，
    // 不靠源码顺序取胜，以后谁调行序都不会把照片主题盖成玻璃。
    // 模糊放在整张卡片这一层（固定图层，行滚动时背景不变、模糊结果可复用），
    // 不放在每行上——二十多个独立模糊区必然卡。半径取 22px 而非官方的 40px：
    // 卡片只有 246px 宽，40px 的收益很小、代价翻倍。
    '@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.teff-card[data-pane="model"]:not([data-visual="whale"]):not([data-visual="liang"]){background:var(--teff-glass);-webkit-backdrop-filter:blur(22px) saturate(150%);backdrop-filter:blur(22px) saturate(150%);isolation:isolate}}',
    // 吸顶标签**故意保持实色**，不跟着卡片一起做玻璃。
    // 试过三种写法（不透明 / 只 blur / 只 blur + 底部 mask 渐隐），真机底衬下量像素的结果是：
    // 只有实色标签没有色带。原因有两层：一是标签只要自带任何染色就会叠在卡片已合成的 .78
    // 之上，二项式叠到约 .95，必然比卡片深一条；二是标签自己一透，滚到它底下的行文字
    // 会变成糊字幽灵从标签里透出来，比色带更难看。
    // 所以这里不给 .teff-groupLabel 写任何规则，让它继续走基线的实色底。
    '.teff-card[data-visual="whale"][data-pane="model"] .teff-modelItem,.teff-card[data-visual="liang"][data-pane="model"] .teff-modelItem{color:var(--teff-text)}',
    // 这两套主题的卡片是照片背景，实色吸顶带和照片永远对不上，会变成一条突兀的矩形。
    // 改成「同色系半透明薄纱 + 背景模糊」：仍然吸顶挡住滚上来的行，但透出底下的照片。
    '.teff-card[data-visual="whale"][data-pane="model"] .teff-groupLabel,.teff-card[data-visual="liang"][data-pane="model"] .teff-groupLabel{color:var(--teff-power);-webkit-backdrop-filter:blur(10px) saturate(140%);backdrop-filter:blur(10px) saturate(140%)}',
    '.teff-card[data-visual="whale"][data-pane="model"] .teff-groupLabel{background:linear-gradient(180deg,rgba(238,250,255,.52) 0,rgba(238,250,255,.52) calc(100% - 9px),rgba(238,250,255,0) 100%)}',
    '.teff-card[data-visual="whale"][data-tone="dark"][data-pane="model"] .teff-groupLabel{background:linear-gradient(180deg,rgba(6,32,51,.48) 0,rgba(6,32,51,.48) calc(100% - 9px),rgba(6,32,51,0) 100%)}',
    '.teff-card[data-visual="liang"][data-pane="model"] .teff-groupLabel{background:linear-gradient(180deg,rgba(22,14,8,.4) 0,rgba(22,14,8,.4) calc(100% - 9px),rgba(22,14,8,0) 100%)}',
    '.teff-card[data-visual="whale"][data-pane="model"] .teff-modelItem--active,.teff-card[data-visual="liang"][data-pane="model"] .teff-modelItem--active{background:var(--teff-hover-strong)}',
    '.teff-card[data-visual="whale"][data-pane="model"] .teff-itemCheck,.teff-card[data-visual="liang"][data-pane="model"] .teff-itemCheck{color:var(--teff-text)}',
    '.teff-card[data-visual="whale"][data-pane="model"] .teff-searchInput,.teff-card[data-visual="liang"][data-pane="model"] .teff-searchInput{color:var(--teff-text)}',
    '.teff-card[data-visual="whale"][data-pane="model"] .teff-searchInput::placeholder,.teff-card[data-visual="liang"][data-pane="model"] .teff-searchInput::placeholder{color:var(--teff-text-3)}',
    '.teff-card[data-pane="model"] .teff-paneHead{display:none}',
    '.teff-card[data-pane="model"] .teff-menuRow{display:flex;align-items:center;flex:none;gap:6px;box-sizing:border-box;width:100%;height:34px;margin-bottom:1px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--teff-text);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
    '.teff-card[data-pane="model"] .teff-menuRow:hover:not(:disabled){background:var(--teff-hover)}',
    '.teff-card[data-pane="model"] .teff-menuRow:disabled{color:var(--teff-text-3);cursor:default}',
    '.teff-card[data-pane="model"] .teff-menuRowLabel{flex:none;white-space:nowrap}',
    '.teff-card[data-pane="model"] .teff-menuRowValue{flex:auto;min-width:0;text-align:right;color:var(--teff-text-3);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.teff-card[data-pane="model"] .teff-menuRowChevron{flex:none;width:12px;height:12px;color:var(--teff-text-3);transform:rotate(-90deg)}',
    '.teff-card[data-pane="model"] .teff-searchRow{position:relative;flex:none;margin:2px 0 3px}',
    '.teff-card[data-pane="model"] .teff-searchInput{box-sizing:border-box;width:100%;height:30px;padding:5px 24px 5px 7px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--teff-text);font:inherit;font-size:12px;line-height:18px;outline:none;box-shadow:none}',
    '.teff-card[data-pane="model"] .teff-searchInput:focus{border:0;outline:none;box-shadow:none}',
    '.teff-card[data-pane="model"] .teff-searchInput::placeholder{color:var(--teff-text-3)}',
    '.teff-card[data-pane="model"] .teff-searchClear{position:absolute;top:50%;right:2px;display:grid;place-items:center;width:24px;height:24px;padding:0;transform:translateY(-50%);border:0;corner-shape:round;border-radius:50%;background:transparent;color:var(--teff-text-3);cursor:pointer}',
    '.teff-card[data-pane="model"] .teff-searchClear:hover{background:var(--teff-hover);color:var(--teff-text-2)}',
    '.teff-card[data-pane="model"] .teff-searchClear svg{width:12px;height:12px}',
    // 高度不再写死 336px：由卡片 max-height 决定，列表自己吃掉剩余空间并滚动，
    // 底部留 4px 让最后一行和卡片圆角之间有呼吸位。
    '.teff-card[data-pane="model"] .teff-groups{flex:1 1 auto;min-height:0;max-height:none;padding:0 0 4px;overflow:auto;overflow-x:hidden;overscroll-behavior:contain}',
    // 滚动条：不要系统默认那条（浅色主题/带背景的主题上尤其丑）。
    // 只用 ::-webkit-scrollbar，别设 scrollbar-width —— 一旦设了标准属性，
    // Chromium 会忽略下面这些伪元素规则，退回系统滚动条。
    '.teff-card[data-pane="model"] .teff-groups::-webkit-scrollbar{width:8px;height:8px}',
    '.teff-card[data-pane="model"] .teff-groups::-webkit-scrollbar-track{background:transparent}',
    '.teff-card[data-pane="model"] .teff-groups::-webkit-scrollbar-thumb{min-height:28px;border:2px solid transparent;corner-shape:round;border-radius:999px;background-color:var(--teff-scroll,rgba(127,127,127,.32));background-clip:content-box}',
    '.teff-card[data-pane="model"] .teff-groups::-webkit-scrollbar-thumb:hover{background-color:var(--teff-scroll-hover,rgba(127,127,127,.55))}',
    '.teff-card[data-pane="model"] .teff-groups::-webkit-scrollbar-corner{background:transparent}',
    '.teff-card[data-pane="model"] .teff-groupLabel{position:sticky;top:0;z-index:2;padding:6px 7px 4px;background:var(--teff-label-bg,var(--teff-menu-surface));font-size:11px;line-height:16px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--dsw-alias-label-tertiary,var(--teff-text-3));pointer-events:none}',
    '.teff-card[data-pane="model"] .teff-modelItem{position:relative;min-height:34px;height:auto;padding:5px 7px;border-radius:var(--dsw-radius-sm,6px);gap:6px;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary,var(--teff-text))}',
    // 当前模型要有「状态在这里」的实感：淡底 + 左侧主题色竖条，别只剩右边一个勾。
    '.teff-card[data-pane="model"] .teff-modelItem--selected{background:var(--teff-hover)}',
    // 竖条：3px 宽、14px 高、垂直居中、两端 2px 圆角，贴左边缘但只占中间一小段。
    // 不能用 inset box-shadow —— 那条会顺着行圆角弯下去，看着像给整行描了包边。
    '.teff-card[data-pane="model"] .teff-modelItem--selected::before{content:"";position:absolute;left:0;top:50%;width:3px;height:14px;transform:translateY(-50%);border-radius:2px;background:var(--dsw-alias-state-business-primary,#3964fe)}',
    // 鲸鱼娘 / 梁圣换回各自的强调色（水蓝 / 金），和照片背景同源，比宿主蓝融合。
    '.teff-card[data-visual="whale"][data-pane="model"] .teff-modelItem--selected::before,.teff-card[data-visual="liang"][data-pane="model"] .teff-modelItem--selected::before{background:var(--teff-power)}',
    '.teff-card[data-pane="model"] .teff-modelItem--active{background:var(--dsw-alias-interactive-bg-hover,var(--teff-hover))}',
    '.teff-card[data-pane="model"] .teff-modelItem:hover,.teff-card[data-pane="model"] .teff-modelItem--selected:hover{background:var(--dsw-alias-interactive-bg-hover,var(--teff-hover))}',
    '.teff-card[data-pane="model"] .teff-modelItem,.teff-card[data-pane="model"] .teff-modelItem *{transition:none}',
    '.teff-card[data-pane="model"] .teff-modelItem:disabled{opacity:.5;cursor:default}',
    '.teff-card[data-pane="model"] .teff-modelItem:active:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--teff-hover))}',
    '.teff-card[data-pane="model"] .teff-modelItem:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe))}',
    '.teff-card[data-pane="model"] .teff-modelItemName{font-weight:400}',
    '.teff-card[data-pane="model"] .teff-itemCheck{display:grid;place-items:center;width:14px;height:14px;color:var(--teff-text);flex:none}',
    '.teff-card[data-pane="model"] .teff-itemCheck svg{width:14px;height:14px}',
    '.teff-card[data-pane="model"] .teff-status{padding:6px 7px;color:var(--teff-text-3);font-size:12px;line-height:18px}',
    '.teff-card[data-pane="model"] .teff-empty{padding:10px 7px;text-align:left;font-size:12px;line-height:18px;color:var(--teff-text-3)}',
    '.teff-card[data-pane="model"] .teff-alert{display:flex;align-items:flex-start;gap:8px;margin:2px 0;padding:5px 7px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(239,68,68,.08));color:var(--dsw-alias-state-error-primary,#dc2626);font-size:11.5px;line-height:16px}',
    '.teff-card[data-pane="model"] .teff-alertText{flex:1;min-width:0}',
    '.teff-card[data-pane="model"] .teff-alertRetry{padding:0;border:0;background:none;color:inherit;font:inherit;font-size:11.5px;font-weight:600;text-decoration:underline;cursor:pointer;flex:none}',
    // 左右两列跟着按钮一起放大到 32px；上内距 12→10 抵掉增高，标题基线不动。
    '.teff-head{display:grid;grid-template-columns:32px minmax(0,1fr) 32px;align-items:start;gap:6px;padding:10px 8px 0}',
    '.teff-headSide{display:flex;align-items:center;width:32px;height:32px}',
    '.teff-headSide--right{justify-content:flex-end}',
    '.teff-iconBtn{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--teff-text-3);cursor:pointer;transition:background .15s,color .15s}',
    '.teff-iconBtn:hover{background:var(--teff-hover);color:var(--teff-text-2)}',
    '.teff-iconBtn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe));outline-offset:-2px}',
    '.teff-iconBtn:disabled{opacity:.38;cursor:default;background:transparent}',
    '.teff-iconBtn[data-on="true"]{color:var(--teff-power)}',
    '.teff-iconBtn svg{width:18px;height:18px}',
    '.teff-reset svg{width:17px;height:17px;transition:transform .35s cubic-bezier(.2,.8,.2,1)}',
    '.teff-reset[data-spin="true"] svg{transform:rotate(360deg)}',
    '.teff-headCenter{display:flex;flex-direction:column;align-items:center;min-width:0}',
    '.teff-levelName{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:23px;line-height:27px;font-weight:650;letter-spacing:.01em;transition:color .18s}',
    // 档位大字切换：新旧两层叠在同一个 grid 格子里，宽度由两层里宽的那个决定，
    // 换字过程中标题不会左右跳。旧字往模糊里退、新字从模糊里聚，240ms 一趟。
    '.teff-levelSwap{display:inline-grid;grid-template-areas:"lvl";justify-items:center;max-width:100%;min-width:0}',
    '.teff-levelSwap>*{grid-area:lvl;min-width:0;max-width:100%}',
    '.teff-levelName--out{animation:teff-label-out .24s cubic-bezier(.22,.85,.24,1) both;pointer-events:none}',
    '.teff-levelName--in{animation:teff-label-in .24s cubic-bezier(.22,.85,.24,1) both}',
    '.teff-modelLine{display:inline-flex;align-items:center;gap:2px;max-width:100%;margin-top:3px;padding:1px 4px;border:0;border-radius:5px;background:transparent;color:var(--teff-text-2);font:inherit;font-size:13px;line-height:18px;cursor:pointer;white-space:nowrap}',
    '.teff-modelLine:hover{background:var(--teff-hover);color:var(--teff-text)}',
    '.teff-modelLine:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe));outline-offset:-2px}',
    '.teff-modelLine--static{cursor:default;color:var(--teff-text-2);padding-left:0;padding-right:0}',
    '.teff-modelLine--static:hover{background:transparent;color:var(--teff-text-2)}',
    '.teff-modelName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.teff-modelChevron{width:12px;height:12px;flex:none;opacity:.75}',

    '.teff-effort{position:relative;padding:8px 12px 9px}',
    '.teff-sliderWrap{position:relative}',
    '.teff-slider{position:relative;height:30px;touch-action:none;cursor:pointer;outline:none;--teff-fill:17px}',
    '.teff-slider:focus-visible .teff-track{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe))}',
    '.teff-slider[aria-disabled="true"]{opacity:.45;cursor:default}',
    '.teff-track{position:absolute;inset:0;corner-shape:round;border-radius:999px;background:var(--teff-track);overflow:hidden}',
    '.teff-clip{position:absolute;inset:0;corner-shape:round;border-radius:999px;-webkit-mask-image:linear-gradient(90deg,#000 0,#000 var(--teff-fill),transparent var(--teff-fill),transparent 100%);mask-image:linear-gradient(90deg,#000 0,#000 var(--teff-fill),transparent var(--teff-fill),transparent 100%)}',
    '.teff-gradient{position:absolute;inset:0;corner-shape:round;border-radius:999px}',
    // 档位分隔线：竖直居中、上下留白（8px 高落在 30px 轨道里），不占满整条轨道。
    // 已到达的档位用亮色，未到达的用暗色——正好对应「压在渐变上 / 压在灰轨上」两种底色。
    // 形态保持 3px 圆角胶囊（4px 直角实测太粗太丑）。粗细靠位置对齐解决，见 tickLeftOf。
  '.teff-tick{position:absolute;top:50%;width:3px;height:8px;margin:-4px 0 0 -1.5px;corner-shape:round;border-radius:1.5px;background:var(--teff-tick);pointer-events:none;z-index:1;transition:background-color .18s ease,opacity .18s ease}',
    // 越往右拉，滑块左侧（已到达）那几条一起淡下去，最右端降到 15%，只剩一层极淡的痕；
    // 右侧未到达的不变——它们还压在灰轨上，需要保持清晰才有「分界」的意义。
    '.teff-tick[data-on="true"]{background:var(--teff-tick-on);opacity:calc(1 - var(--teff-glow,0) * .85)}',
    // 星云：填充段里的一团辉光，不透明度跟着档位走，Off 时完全不可见。
    // 底色会缓慢横向漂移（不是一张静止的渐变），上面再叠一道斜向扫光，
    // 所以就算档位不动，填充段看上去也是「在流」的。
    '.teff-nebula{position:absolute;inset:0;pointer-events:none;opacity:calc(var(--teff-glow,0) * .9);background:radial-gradient(140% 180% at 6% 50%,var(--teff-glow-color),transparent 64%);background-size:220% 100%;background-repeat:no-repeat;animation:teff-nebula-drift var(--teff-energy-dur,2.4s) ease-in-out infinite alternate}',
    '.teff-nebula::after{content:"";position:absolute;inset:-40% -20%;background:linear-gradient(100deg,transparent 36%,rgba(255,255,255,.5) 50%,transparent 64%);mix-blend-mode:screen;animation:teff-nebula-sweep calc(var(--teff-energy-dur,2.4s) * 1.4) linear infinite}',
    '.teff-stars{position:absolute;inset:0;overflow:hidden;pointer-events:none}',
    '.teff-star{position:absolute;left:0;right:0;display:block;height:0;animation-name:teff-star-sweep;animation-timing-function:linear;animation-iteration-count:infinite;will-change:transform}',
    '.teff-star i{position:absolute;left:100%;top:0;display:block;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;corner-shape:round;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(255,255,255,.85)}',
    '.teff-card[data-tone="dark"] .teff-star i{background:#f5f3ff;box-shadow:0 0 5px rgba(216,180,254,.95)}',
    '.teff-energyCanvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}',
    '.teff-warpCanvas,.teff-quantumCanvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}',
    '.teff-slider[data-visual="warp"] .teff-gradient,.teff-slider[data-visual="quantum"] .teff-gradient{opacity:.32}',
    '.teff-void{position:absolute;inset:0;corner-shape:round;border-radius:999px}',
    '.teff-quantumBase{position:absolute;inset:0;background-image:linear-gradient(rgba(120,200,255,.13) 1px,transparent 1px),linear-gradient(90deg,rgba(120,200,255,.13) 1px,transparent 1px);background-size:12px 12px;opacity:.55}',
    '.teff-thumb{position:absolute;top:50%;left:var(--teff-fill);box-sizing:border-box;width:34px;height:34px;corner-shape:round;border-radius:50%;background:var(--teff-thumb);border:1px solid var(--teff-thumb-ring);box-shadow:0 1px 2px rgba(0,0,0,.12);transform:translate(-50%,-50%);pointer-events:none;z-index:2}',
    '.teff-slider[data-visual="whale"],.teff-slider[data-visual="liang"]{height:30px}',
    '.teff-mascot{position:absolute;left:var(--teff-fill);bottom:6px;width:120px;height:120px;transform:translateX(-50%);background-size:contain;background-position:center bottom;background-repeat:no-repeat;z-index:6;pointer-events:auto;cursor:grab;touch-action:none;user-select:none;filter:drop-shadow(0 10px 16px rgba(0,0,0,.35))}',
    '.teff-mascot::before{content:"";position:absolute;inset:-16px;corner-shape:round;border-radius:50%;z-index:-1;pointer-events:none;filter:blur(9px);animation:teff-aura-pulse 3s ease-in-out infinite}',
    '.teff-slider[data-visual="whale"] .teff-mascot::before{background:radial-gradient(circle,rgba(80,200,255,.75),transparent 70%)}',
    '.teff-slider[data-visual="liang"] .teff-mascot::before{background:radial-gradient(circle,rgba(255,216,140,.78),transparent 70%)}',
    '.teff-slider[data-visual="liang"] .teff-mascot{animation:teff-liang-float 3.8s ease-in-out infinite}',
    '.teff-slider[data-dragging="true"] .teff-mascot{cursor:grabbing}',
    '.teff-mascot--liang{width:120px;height:120px;border-radius:6px;background-size:contain;background-position:center;box-shadow:0 0 0 1px rgba(255,216,140,.8),0 10px 22px rgba(0,0,0,.45)}',
    '.teff-artKnob{position:absolute;left:var(--teff-fill);bottom:11px;width:9px;height:9px;transform:translate(-50%,50%) rotate(45deg);border-radius:1.5px;background:var(--teff-thumb);box-shadow:0 0 8px var(--teff-glow-color);z-index:2;pointer-events:none}',
    '.teff-slider[data-visual="whale"] .teff-track{background:radial-gradient(circle at 20% 30%,rgba(255,255,255,.9) 0 1.4px,transparent 2px),radial-gradient(circle at 72% 64%,rgba(255,255,255,.6) 0 1.1px,transparent 1.8px),linear-gradient(180deg,#f2fcff,#c9ecff);background-size:22px 22px,33px 33px,cover;border:1px solid rgba(86,178,225,.25)}',
    '.teff-slider[data-visual="whale"] .teff-track::after{content:"";position:absolute;inset:0;background-image:radial-gradient(circle at 20% 70%,rgba(255,255,255,.95) 0 1.5px,transparent 2px),radial-gradient(circle at 75% 25%,rgba(255,255,255,.7) 0 1.2px,transparent 1.8px);background-size:36px 36px,52px 52px;animation:teff-bubble-rise 5s linear infinite;opacity:.5;mix-blend-mode:screen;pointer-events:none}',
    '.teff-slider[data-visual="whale"] .teff-gradient{animation:teff-water-glow 4s ease-in-out infinite}',
    '.teff-slider[data-visual="liang"] .teff-track{background:repeating-linear-gradient(115deg,rgba(255,216,140,.08) 0 2px,transparent 2px 12px),linear-gradient(180deg,rgba(255,210,130,.15),rgba(70,40,15,.5));border:1px solid rgba(255,216,140,.2)}',
    '.teff-slider[data-visual="liang"] .teff-track::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,231,170,.55) 50%,transparent 70%);background-size:220% 100%;animation:teff-gold-sweep 2.8s linear infinite;opacity:.8;mix-blend-mode:screen;pointer-events:none}',
    '.teff-slider[data-visual="liang"] .teff-gradient{animation:teff-gold-glow 3.4s ease-in-out infinite}',
    '.teff-slider[data-visual="whale"] .teff-labels,.teff-slider[data-visual="liang"] .teff-labels{margin-top:4px}',
    '.teff-card[data-visual="whale"] .teff-levelName,.teff-card[data-visual="whale"] .teff-label{text-shadow:0 1px 0 rgba(255,255,255,.65)}',
    '.teff-labels{position:relative;height:16px;margin-top:5px;font-size:10.5px;line-height:16px}',
    '.teff-label{position:absolute;top:0;max-width:16%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.74;transform:translateX(-50%);transition:opacity .15s,background-color .15s;border:0;background:none;padding:1px 2px;border-radius:4px;font:inherit;font-size:10.5px;font-weight:500;line-height:15px;cursor:pointer;font-family:inherit}',
    '.teff-slider[data-visual="whale"] .teff-label,.teff-slider[data-visual="liang"] .teff-label{font-size:10.5px;padding:1px 2px}',
    '.teff-label--active{opacity:1;font-weight:700}',
    '.teff-label:hover{opacity:1;background:var(--teff-hover)}',
    '.teff-label:focus-visible{outline:none;box-shadow:0 0 0 2px var(--teff-level)}',

    '.teff-paneHead{display:flex;align-items:center;gap:6px;height:44px;padding:0 10px;border-bottom:1px solid var(--teff-divider)}',
    '.teff-backBtn{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--teff-text-2);cursor:pointer}',
    '.teff-backBtn:hover{background:var(--teff-hover)}',
    '.teff-backBtn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe));outline-offset:-2px}',
    '.teff-backBtn svg{width:14px;height:14px}',
    '.teff-paneTitle{font-size:12px;font-weight:500;color:var(--teff-text-2);letter-spacing:.02em}',
    '.teff-paneCount{margin-left:auto;font-size:10.5px;color:var(--teff-text-3);font-variant-numeric:tabular-nums}',
    '.teff-search{padding:8px 10px 2px}',
    '.teff-searchInput{width:100%;height:30px;padding:0 9px;border:1px solid var(--teff-border);border-radius:7px;background:var(--teff-hover);color:var(--teff-text);font:inherit;font-size:12px;outline:none}',
    '.teff-searchInput::placeholder{color:var(--teff-text-3)}',
    '.teff-searchInput:focus{border-color:var(--dsw-alias-state-business-primary,#3964fe)}',
    '.teff-groups{max-height:min(320px,48vh);overflow:auto;padding:4px 6px 8px;overscroll-behavior:contain}',
    '.teff-groupLabel{padding:9px 7px 4px;font-size:10px;line-height:14px;letter-spacing:.08em;color:var(--teff-text-3);text-transform:uppercase}',
    '.teff-modelItem{display:flex;align-items:center;gap:8px;width:100%;height:34px;padding:0 8px;border:0;border-radius:7px;background:transparent;color:var(--teff-text);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}',
    '.teff-modelItem:hover,.teff-modelItem--active{background:var(--teff-hover)}',
    '.teff-modelItem:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe));outline-offset:-2px}',
    '.teff-modelItemName{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.teff-modelItemMeta{font-size:10px;color:var(--teff-text-3);flex:none}',
    '.teff-itemCheck{width:14px;height:14px;color:var(--teff-text-2);flex:none}',
    '.teff-empty{padding:22px 12px;text-align:center;font-size:12px;color:var(--teff-text-3)}',

    '.teff-foot{display:flex;align-items:center;gap:6px;padding:7px 12px;border-top:1px solid var(--teff-divider);font-size:10.5px;line-height:16px;color:var(--teff-text-3);flex-wrap:wrap}',
    '.teff-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border:1px solid var(--teff-kbd-border);border-radius:4px;background:var(--teff-kbd);font-family:inherit;font-size:10px;color:var(--teff-text-2)}',
    '.teff-footSpacer{flex:1}',
    '.teff-error{margin:0 14px 8px;padding:6px 8px;border-radius:6px;background:rgba(239,68,68,.1);color:#ef4444;font-size:11px;line-height:15px}',

    '@keyframes teff-card-in{from{opacity:0;transform:translateY(4px) scale(.985)}to{opacity:1;transform:none}}',
    // 档位大字切换的"渐变模糊"：只动 filter/opacity/transform，不触发布局，
    // 也不参与拖拽的 60fps 路径（挂 commit 之后，一次一趟）。
    '@keyframes teff-label-out{from{filter:blur(0);opacity:1;transform:translateY(0)}to{filter:blur(6px);opacity:0;transform:translateY(-3px)}}',
    '@keyframes teff-label-in{from{filter:blur(6px);opacity:0;transform:translateY(3px)}to{filter:blur(0);opacity:1;transform:translateY(0)}}',
    // 底部触发器字号 12~13px、地方窄，幅度减半，不然看着像在抖。
    '@keyframes teff-effort-in{from{filter:blur(4px);opacity:0;transform:translateY(2px)}to{filter:blur(0);opacity:1;transform:translateY(0)}}',
    '@keyframes teff-pulse{0%,100%{opacity:1;box-shadow:0 0 8px 0 var(--teff-level)}50%{opacity:.65;box-shadow:0 0 14px 1px var(--teff-level)}}',
    '@keyframes teff-sheen{0%{background-position:180% 0}100%{background-position:-80% 0}}',
    '@keyframes teff-flow{0%{background-position:0 0}100%{background-position:-200% 0}}',
    // 星云的"流动"由两个便宜的动画拼出来：底色横向漂移 + 一道斜光扫过。
    // 都只动 transform/background-position，不碰布局，拖拽时也不掉帧。
    '@keyframes teff-nebula-drift{0%{background-position:0% 50%}100%{background-position:100% 50%}}',
    '@keyframes teff-nebula-sweep{0%{transform:translate3d(-60%,0,0)}100%{transform:translate3d(60%,0,0)}}',
    '@keyframes teff-bubbles{0%{background-position:0 0,13px 21px}100%{background-position:0 -26px,13px -22px}}',
    '@keyframes teff-charge{0%{transform:translate(-50%,-50%) scale(.55);opacity:.6}70%{opacity:.18}100%{transform:translate(-50%,-50%) scale(1.4);opacity:0}}',
    '@keyframes teff-spin{to{transform:rotate(360deg)}}',
    '.teff-slider[data-visual="whale"] .teff-mascot{transform-origin:50% 55%;animation:whale-idle 3.4s ease-in-out infinite}',
    '.teff-slider[data-visual="whale"][data-level="0"] .teff-mascot{animation:whale-sleep 4.4s ease-in-out infinite}',
    '.teff-slider[data-visual="whale"][data-level="1"] .teff-mascot{animation:whale-chew .9s ease-in-out infinite}',
    '.teff-slider[data-visual="whale"][data-level="2"] .teff-mascot{animation:whale-tremble .28s linear infinite}',
    '.teff-slider[data-visual="whale"][data-level="3"] .teff-mascot{animation:whale-think 2.5s ease-in-out infinite}',
    '.teff-slider[data-visual="whale"][data-level="4"] .teff-mascot{animation:whale-bounce 1.5s ease-in-out infinite}',
    '.teff-slider[data-visual="whale"][data-level="5"] .teff-mascot{animation:whale-shake .3s linear infinite}',
    '.teff-slider[data-visual="whale"][data-level="6"] .teff-mascot{animation:whale-halo 2.2s ease-in-out infinite}',
    '@keyframes whale-idle{0%,100%{transform:translate(-50%,0) rotate(0)}50%{transform:translate(-50%,-1.5px) rotate(-1deg)}}',
    '@keyframes whale-sleep{0%,100%{transform:translate(-50%,1px) scale(1)}50%{transform:translate(-50%,2px) scale(1.015)}}',
    '@keyframes whale-chew{0%,100%{transform:translate(-50%,0) scale(1)}50%{transform:translate(-50%,0) scale(1.03,.96)}}',
    '@keyframes whale-tremble{0%,100%{transform:translate(calc(-50% - 1px),0)}50%{transform:translate(calc(-50% + 1px),0)}}',
    '@keyframes whale-think{0%,100%{transform:translate(-50%,0) rotate(-2deg)}50%{transform:translate(-50%,0) rotate(2deg)}}',
    '@keyframes whale-bounce{0%,100%{transform:translate(-50%,0)}40%{transform:translate(-50%,-2.5px)}}',
    '@keyframes whale-shake{0%,100%{transform:translate(-50%,0) rotate(-3deg)}50%{transform:translate(-50%,0) rotate(3deg)}}',
    '@keyframes whale-halo{0%,100%{transform:translate(-50%,0) scale(1)}50%{transform:translate(-50%,0) scale(1.05)}}',
    '@keyframes teff-bubble-rise{0%{background-position:0 0,13px 21px}100%{background-position:36px -72px,65px -31px}}',
    '@keyframes teff-water-glow{0%,100%{filter:brightness(1) saturate(1)}50%{filter:brightness(1.16) saturate(1.18)}}',
    '@keyframes teff-gold-sweep{0%{background-position:220% 0}100%{background-position:-220% 0}}',
    '@keyframes teff-gold-glow{0%,100%{filter:brightness(1) saturate(1)}50%{filter:brightness(1.22) saturate(1.12)}}',
    '@keyframes teff-aura-pulse{0%,100%{opacity:.42;transform:scale(.92)}50%{opacity:.85;transform:scale(1.08)}}',
    '@keyframes teff-liang-float{0%,100%{transform:translate(-50%,0)}50%{transform:translate(-50%,-3px)}}',
    // 星尘横扫：容器从右往左走一整屏，星点挂在 left:100% 上，于是星点看起来是向右漂的。
    // 头尾各留 6% 淡入淡出，避免星点凭空出现/消失。
    '@keyframes teff-star-sweep{0%{transform:translate3d(0,0,0);opacity:0}6%{opacity:1}94%{opacity:1}100%{transform:translate3d(-100%,0,0);opacity:0}}',
    // 插件管理页把图标画在 48px 的框里、图片本身按 36px 渲染，四周就露出一圈框底色。
    // 这里只针对本插件的卡片/详情，把那张图放大到铺满（选择器限定在 data-plugin-* 上，不波及别的插件）。
    '[data-plugin-package^="dsh-thinking-bar"] img[class*="packageImage"],' +
      '[data-plugin-detail^="dsh-thinking-bar"] img[class*="packageImage"],' +
      '[data-plugin-row-detail^="dsh-thinking-bar"] img[class*="packageImage"]{' +
      'width:100%!important;height:100%!important;object-fit:cover!important;border-radius:inherit}',
    '@media (prefers-reduced-motion:reduce){.teff-card{animation:none}.teff-thumb,.teff-triggerChevron{transition:none}.teff-mascot,.teff-mascot::before,.teff-track::after,.teff-gradient,.teff-spin{animation:none!important}.teff-energySheen,.teff-energyFlow,.teff-energyBubbles,.teff-energyPulse{animation:none}.teff-star{animation:none}.teff-stars{display:none}.teff-nebula,.teff-nebula::after{animation:none}.teff-levelName--out,.teff-levelName--in,.teff-triggerEffort[data-fx="true"],.teff-triggerLabel[data-fx="true"],.teff-modelName[data-fx="true"]{animation:none!important}.teff-levelName--out{opacity:0}}'
  ].join('\n')

  function injectStyles(doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null)
    if (!d) return
    // 这里以前遇到已存在的 <style> 就直接 return，热更新后 CSS 永远是旧的
    // （改样式看起来"没生效"就是这个原因）。现在整块替换。
    var existing = d.getElementById('teff-ui-styles')
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
    var style = d.createElement('style')
    style.id = 'teff-ui-styles'
    style.textContent = CSS
    d.head.appendChild(style)
  }

  /* ------------------------------------------------------------------ */
  /* React factory                                                       */
  /* ------------------------------------------------------------------ */

  function createThinkingUI(React) {
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef
    var useMemo = React.useMemo
    var useCallback = React.useCallback

    function IconData(props) {
      var size = props && props.size ? props.size : 16
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false'
        },
        h('ellipse', { cx: 8, cy: 3.4, rx: 5.2, ry: 2.1 }),
        h('path', { d: 'M2.8 3.4v4.2c0 1.16 2.33 2.1 5.2 2.1s5.2-.94 5.2-2.1V3.4' }),
        h('path', { d: 'M2.8 7.6v4.2c0 1.16 2.33 2.1 5.2 2.1s5.2-.94 5.2-2.1V7.6' })
      )
    }

    function IconChevronDown(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 12 12',
          width: 12,
          height: 12,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className: props && props.className,
          'aria-hidden': 'true'
        },
        h('path', { d: 'M3 4.5 6 7.5 9 4.5' })
      )
    }

    function IconChevronRight(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 12 12',
          width: 12,
          height: 12,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className: props && props.className,
          'aria-hidden': 'true'
        },
        h('path', { d: 'M4.5 3 7.5 6 4.5 9' })
      )
    }

    function IconCheck(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 14 14',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className: props && props.className,
          'aria-hidden': 'true'
        },
        h('path', { d: 'M2.6 7.2 5.5 10.1 11.4 4.2' })
      )
    }

    function IconClose(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 14 14',
          width: 12,
          height: 12,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          className: props && props.className,
          'aria-hidden': 'true'
        },
        h('path', { d: 'M3.4 3.4 10.6 10.6M10.6 3.4 3.4 10.6' })
      )
    }

    function IconBack(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 14 14',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className: props && props.className,
          'aria-hidden': 'true'
        },
        h('path', { d: 'M8.5 2.8 4 7l4.5 4.2' })
      )
    }

    function IconBolt(props) {
      var filled = props && props.filled
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 18,
          height: 18,
          fill: filled ? 'currentColor' : 'none',
          stroke: 'currentColor',
          // 等比放大时别动 strokeWidth：它按 viewBox 单位算，尺寸涨了线自然跟着涨，
          // 再手动加粗就不是"同一支图标变大"，是"换了一支更黑的图标"。
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true'
        },
        h('path', { d: 'M9.2 1.7 3.5 9.1h3.2l-.7 5.2 5.6-7.4H8.4l.8-5.2Z' })
      )
    }

    function IconReset(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 17,
          height: 17,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true'
        },
        h('path', { d: 'M12.7 8a4.7 4.7 0 1 1-1.4-3.3' }),
        h('path', { d: 'M12.9 2.6v2.7h-2.7' })
      )
    }

    /* 加载圈用 SVG 画，不用 CSS border：border 圆在 12px 这种尺寸下，
     * 1.5px 边框落在小数像素上会被抗锯齿抹成发毛的一圈，而
     * border-right-color:transparent 是硬切口，缺口两端不像圆弧那样收细。
     * SVG 的 stroke 是矢量描边，永远是正圆，圆头端帽还能让缺口自然收尾。 */
    function IconSpinner(props) {
      var size = props && props.size ? props.size : 12
      /* viewBox 16 固定，实际按 size 缩放。r=6.8 + 描边一半 1 = 7.8，
       * 距中线 8 留 0.2px，不会被视口切平。
       * 这组数值（r6.8 / 描边 2 / 弧 72%）是拿旧 CSS 圈逐像素比对出来的：
       * 着墨量 31.9 vs 29.8、外径 11.09 vs 11.0、角覆盖 84% vs 84%，
       * 视觉分量一致，但圆度从 83.1% 提到 85.2%。 */
      var radius = 6.8
      var circumference = 2 * Math.PI * radius
      /* 72% 弧 + 圆头端点：缺口两端的收口是圆弧，不是 CSS 边框那种硬切。 */
      var arc = circumference * 0.72
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          'aria-hidden': 'true',
          focusable: 'false',
          className: 'teff-spin'
        },
        h('circle', {
          cx: 8,
          cy: 8,
          r: radius,
          strokeWidth: 2,
          opacity: 0.16
        }),
        h('circle', {
          cx: 8,
          cy: 8,
          r: radius,
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeDasharray: arc.toFixed(2) + ' ' + (circumference - arc).toFixed(2)
        })
      )
    }

    /* 星尘：纯 CSS 动画，不用 canvas。
     * 三个要点，缺一个就会丑：
     * 1) 相位用黄金比，初始位置天然均匀；时长/延迟必须内联写在元素上，
     *    写成 CSS 变量在真宿主里负相位不生效，会「一开面板全挤在起点」。
     * 2) 高度槽位与相位解耦（按哈希重排），否则星星会排成一条斜线。
     * 3) 用确定性哈希而不是 Math.random，重渲染不跳变，也能离线断言。 */
    var GOLDEN_RATIO = 0.6180339887498949
    /* 星尘总数。22 颗是参考实现的口径，但那条轨道只有 28px 高、且填充满宽才算热闹；
     * 这里的轨道更长、还盖着一层星云，22 颗会被吃掉大半，所以直接翻倍到 72。 */
    var STAR_TOTAL = 72

    function starHash01(index, salt) {
      var value = (((index + 1) * salt * 2654435761) % 4294967296) >>> 0
      return ((value >>> 8) % 1000) / 1000
    }

    var STAR_DUST = (function () {
      var out = []
      var i
      for (i = 0; i < STAR_TOTAL; i++) {
        out.push({
          phase: ((i + 1) * GOLDEN_RATIO) % 1,
          brightness: 0.55 + 0.45 * starHash01(i, 61),
          spread: 1 - 0.08 + 0.16 * starHash01(i, 29),
          y: 0
        })
      }
      var order = []
      for (i = 0; i < out.length; i++) order.push(i)
      order.sort(function (a, b) {
        return out[a].phase - out[b].phase
      })
      var slots = order.slice()
      slots.sort(function (a, b) {
        return starHash01(a, 71) - starHash01(b, 71)
      })
      for (i = 0; i < order.length; i++) {
        out[order[i]].y = 10 + (slots[i] / (STAR_TOTAL - 1)) * 80
      }
      return out
    })()

    function ParticleLayer(props) {
      var pos = clamp(props.pos || 0, 0, 1)
      /* 起点从 1/3 降到 0.08：低档也要有几颗星，否则「前半截什么都没有」，
       * 看起来像滑杆坏了。密度曲线仍是「越往上越热闹」，只是不再等到中段才起床。 */
      var energy = clamp((pos - 0.08) / (1 - 0.08), 0, 1)
      /* 上限从 3 提到 4.6：拉到最右时星星几乎是在「刷」过去。
       * 曲线也换成 3.6*pos-1，中段就开始明显加速，而不是最后几个像素才提起来。 */
      var speed = clamp(3.6 * pos - 1, 0.4, 4.6)
      var shown = Math.round(energy * STAR_TOTAL)
      /* 星尘整体不透明度别跟星云一起压：星云最浓的时候正好压暗星点，
       * 所以这里反而随档位往上走，最高档最亮。 */
      var alpha = 0.7 + 0.3 * energy
      var nodes = []
      for (var i = 0; i < shown; i++) {
        var s = STAR_DUST[i]
        var dur = ((1.5 * 2) / speed) * s.spread
        var delay = -((s.phase + starHash01(i, 53) * 0.03) % 1) * dur
        nodes.push(
          h(
            'span',
            {
              key: 'star-' + i,
              className: 'teff-star',
              style: {
                top: s.y.toFixed(2) + '%',
                animationDuration: dur.toFixed(2) + 's',
                animationDelay: delay.toFixed(2) + 's'
              }
            },
            h('i', {
              style: {
                opacity: s.brightness.toFixed(2),
                transform: 'scale(' + s.brightness.toFixed(2) + ')'
              }
            })
          )
        )
      }
      return h(
        'div',
        {
          className: 'teff-stars',
          'aria-hidden': 'true',
          style: { opacity: alpha.toFixed(2) }
        },
        nodes
      )
    }

    function EnergyLayer(props) {
      var canvasRef = useRef(null)
      var liveRef = useRef({ color: props.color, pos: props.pos || 0, tone: props.tone || 'dark' })
      liveRef.current.color = props.color
      liveRef.current.pos = props.pos || 0
      liveRef.current.tone = props.tone || 'dark'

      useEffect(
        function () {
          if (!props.active) return
          var canvas = canvasRef.current
          if (!canvas || !canvas.parentNode) return
          var ctx = canvas.getContext('2d')
          if (!ctx) return

          var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
          var raf = 0
          var W = 1
          var H = 1
          var cellW = 4
          var cellH = 5
          var cells = []
          var last = 0
          var reduced =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches

          function hash(a, b) {
            var value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
            return value - Math.floor(value)
          }

          function measure() {
            var rect = canvas.parentNode.getBoundingClientRect()
            W = Math.max(1, Math.round(rect.width))
            H = Math.max(1, Math.round(rect.height))
            canvas.width = Math.round(W * dpr)
            canvas.height = Math.round(H * dpr)
            canvas.style.width = W + 'px'
            canvas.style.height = H + 'px'
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            cellW = 5
            cellH = Math.max(5, H / 4)
            var columns = Math.max(1, Math.round(W / cellW))
            var rows = Math.max(1, Math.round(H / cellH))
            cells = []
            for (var row = 0; row < rows; row++) {
              for (var column = 0; column < columns; column++) {
                cells.push({ column: column, row: row, random: hash(column + 1, row + 1), level: 0 })
              }
            }
          }

          function draw(now) {
            raf = 0
            var live = liveRef.current
            var energy = clamp(live.pos, 0, 1)
            var tint = hexToRgb(live.color)
            var dark = live.tone !== 'light'
            var limit = 17 + energy * Math.max(1, W - 34)
            var retention = reduced ? 0.92 : 0.18 + energy * 0.72
            var pulse = 0.84 + Math.sin(now / 227) * 0.16
            var frameIndex = Math.floor(now / 125)
            var tail = Math.max(12, W * (0.18 + 0.52 * energy))
            last = now

            ctx.clearRect(0, 0, W, H)
            if (energy > 0.02) {
            for (var i = 0; i < cells.length; i++) {
              var cell = cells[i]
              var x = cell.column * cellW + cellW / 2
              var y = cell.row * cellH + cellH / 2
              var target = 0
              if (x <= limit + 0.5) {
                var distance = Math.max(limit - x, 0)
                var aura = Math.exp(-Math.pow(distance / tail, 1.35))
                var core = Math.exp(
                  -Math.pow((x - (limit - H * 0.14)) / Math.max(3, H * 0.16), 2)
                )
                var glitter =
                  hash(cell.column + frameIndex * 13, cell.row + frameIndex * 29) >
                  0.62 - energy * 0.32
                    ? 1
                    : 0
                var settled =
                  Math.max(core, aura * glitter * 0.72) * (0.58 + cell.random * 0.42) * pulse
                target = Math.max(target, settled * (0.72 + energy * 0.95))
              }
              cell.level = Math.max(target, cell.level * retention)
              if (cell.level <= 0.02) continue
              var heat = dark
                ? Math.max(0, Math.min(1, (energy - 0.7) / 0.3)) *
                  Math.min(1, cell.level * 1.3) *
                  0.5
                : 0
              var contrast = dark ? 1.15 : 1.55
              var r = Math.round(tint.r + (255 - tint.r) * heat)
              var g = Math.round(tint.g + (255 - tint.g) * heat)
              var b = Math.round(tint.b + (255 - tint.b) * heat)
              ctx.fillStyle =
                'rgba(' +
                r +
                ',' +
                g +
                ',' +
                b +
                ',' +
                Math.min(1, cell.level * contrast * 1.35).toFixed(3) +
                ')'
              ctx.fillRect(x - cellW * 0.4, y - cellH * 0.4, cellW * 0.8, cellH * 0.8)
            }
            }
            if (!reduced) raf = requestAnimationFrame(draw)
          }

          measure()
          if (reduced) {
            draw(0)
          } else {
            raf = requestAnimationFrame(function (now) {
              draw(now || 0)
            })
          }

          var ro = null
          if (typeof ResizeObserver === 'function') {
            ro = new ResizeObserver(function () {
              measure()
              draw(performance.now())
            })
            ro.observe(canvas.parentNode)
          }
          return function () {
            cancelAnimationFrame(raf)
            if (ro) ro.disconnect()
          }
        },
        [props.active]
      )
      return h('canvas', { ref: canvasRef, className: 'teff-energyCanvas', 'aria-hidden': 'true' })
    }

    function WarpLayer(props) {
      var canvasRef = useRef(null)
      var liveRef = useRef({
        color: props.color,
        pos: props.pos || 0,
        count: props.count || 0,
        speed: props.speed || 1
      })
      liveRef.current.color = props.color
      liveRef.current.pos = props.pos || 0
      liveRef.current.count = props.count || 0
      liveRef.current.speed = props.speed || 1

      useEffect(
        function () {
          if (!props.active) return
          var canvas = canvasRef.current
          if (!canvas || !canvas.parentNode) return
          var ctx = canvas.getContext('2d')
          if (!ctx) return

          var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
          var raf = 0
          var W = 1
          var H = 1
          var stars = []
          var reduced =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches

          function resize() {
            var rect = canvas.parentNode.getBoundingClientRect()
            W = Math.max(1, Math.round(rect.width))
            H = Math.max(1, Math.round(rect.height))
            canvas.width = Math.round(W * dpr)
            canvas.height = Math.round(H * dpr)
            canvas.style.width = W + 'px'
            canvas.style.height = H + 'px'
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          }

          function spawn(atLeft) {
            return {
              x: atLeft ? -14 : Math.random() * W,
              y: Math.random() * H,
              z: 0.25 + Math.random() * 0.75,
              a: 0.3 + Math.random() * 0.7
            }
          }

          function sync() {
            var target = Math.max(0, Math.min(230, liveRef.current.count))
            while (stars.length < target) stars.push(spawn(false))
            while (stars.length > target) stars.pop()
          }

          function draw() {
            var live = liveRef.current
            var energy = clamp(live.pos, 0, 1)
            var tint = hexToRgb(live.color)
            var limit = 17 + energy * Math.max(1, W - 34)
            ctx.clearRect(0, 0, W, H)
            if (energy > 0.01) {
              var glow = ctx.createRadialGradient(
                limit,
                H / 2,
                0,
                limit,
                H / 2,
                Math.max(28, H * 1.15)
              )
              glow.addColorStop(0, 'rgba(255,255,255,.5)')
              glow.addColorStop(0.32, 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',.28)')
              glow.addColorStop(1, 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',0)')
              ctx.fillStyle = glow
              ctx.fillRect(0, 0, W, H)
              ctx.globalCompositeOperation = 'lighter'
              for (var j = 0; j < stars.length; j++) {
                var star = stars[j]
                star.x += (0.45 + star.z) * live.speed
                if (star.x > W + 14) star.x = -14
                var len = (2 + star.z * 11) * (0.35 + energy * 1.4)
                var trail = ctx.createLinearGradient(star.x - len, star.y, star.x, star.y)
                trail.addColorStop(0, 'rgba(255,255,255,0)')
                trail.addColorStop(0.55, 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',' + (star.a * 0.5).toFixed(3) + ')')
                trail.addColorStop(1, 'rgba(255,255,255,' + star.a.toFixed(3) + ')')
                ctx.strokeStyle = trail
                ctx.lineWidth = 0.6 + star.z * 1.3
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(star.x - len, star.y)
                ctx.lineTo(star.x, star.y)
                ctx.stroke()
                if (star.a > 0.74) {
                  ctx.fillStyle = 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',' + star.a.toFixed(3) + ')'
                  ctx.beginPath()
                  ctx.arc(star.x, star.y, 0.7 + star.z * 1.1, 0, Math.PI * 2)
                  ctx.fill()
                }
              }
              ctx.globalCompositeOperation = 'source-over'
            }
            if (!reduced) raf = requestAnimationFrame(draw)
          }

          resize()
          sync()
          if (reduced) draw()
          else raf = requestAnimationFrame(draw)

          var ro = null
          if (typeof ResizeObserver === 'function') {
            ro = new ResizeObserver(function () {
              resize()
              draw()
            })
            ro.observe(canvas.parentNode)
          }
          return function () {
            cancelAnimationFrame(raf)
            if (ro) ro.disconnect()
          }
        },
        [props.active]
      )
      return h('canvas', { ref: canvasRef, className: 'teff-warpCanvas', 'aria-hidden': 'true' })
    }

    function QuantumLayer(props) {
      var canvasRef = useRef(null)
      var liveRef = useRef({ color: props.color, pos: props.pos || 0 })
      liveRef.current.color = props.color
      liveRef.current.pos = props.pos || 0

      useEffect(
        function () {
          if (!props.active) return
          var canvas = canvasRef.current
          if (!canvas || !canvas.parentNode) return
          var ctx = canvas.getContext('2d')
          if (!ctx) return

          var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
          var raf = 0
          var W = 1
          var H = 1
          var reduced =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches

          function resize() {
            var rect = canvas.parentNode.getBoundingClientRect()
            W = Math.max(1, Math.round(rect.width))
            H = Math.max(1, Math.round(rect.height))
            canvas.width = Math.round(W * dpr)
            canvas.height = Math.round(H * dpr)
            canvas.style.width = W + 'px'
            canvas.style.height = H + 'px'
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          }

          function draw(now) {
            raf = 0
            var live = liveRef.current
            var energy = clamp(live.pos, 0, 1)
            var tint = hexToRgb(live.color)
            var limit = 17 + energy * Math.max(1, W - 34)
            var time = (now || 0) / 1000
            var amp = H * (0.1 + energy * 0.24)
            /* 速度与频率都比原来快，且「越往上加得越狠」：
             * 低档只快一点点（不至于晃眼），拉到最右相位推进与波形密度都翻倍，
             * 看上去才是真的在剧烈振荡，而不是慢慢挪。 */
            var freq = 1.4 + energy * 3.6
            var speed = 1.05 + energy * 4.2
            ctx.clearRect(0, 0, W, H)
            if (energy > 0.02) {
              ctx.globalCompositeOperation = 'lighter'

              var maxR = Math.max(20, H * 1.2)
              var ring = (time * maxR * 1.25) % maxR
              ctx.beginPath()
              ctx.strokeStyle = 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',' + (0.45 * (1 - ring / maxR)).toFixed(3) + ')'
              ctx.lineWidth = 1
              ctx.arc(limit, H / 2, ring, 0, Math.PI * 2)
              ctx.stroke()

              for (var wave = 0; wave < 2; wave++) {
                ctx.beginPath()
                for (var x = 0; x <= W; x += 2) {
                  var phase = (x / W) * Math.PI * 2 * freq + time * speed + wave * (Math.PI / 2)
                  var y = H / 2 + Math.sin(phase) * amp * (wave ? 0.78 : 1)
                  if (x === 0) ctx.moveTo(x, y)
                  else ctx.lineTo(x, y)
                }
                ctx.strokeStyle =
                  wave === 0
                    ? 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',.95)'
                    : 'rgba(255,255,255,.78)'
                ctx.shadowColor = wave === 0 ? 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',.8)' : 'rgba(255,255,255,.8)'
                ctx.shadowBlur = 8
                ctx.lineWidth = wave === 0 ? 1.35 : 1
                ctx.stroke()
              }
              ctx.shadowBlur = 0

              var nodes = Math.max(3, Math.round(freq * 2))
              for (var node = 0; node <= nodes; node++) {
                var nx = (node / nodes) * W
                var ny = H / 2 + Math.sin((nx / W) * Math.PI * 2 * freq + time * speed) * amp
                ctx.beginPath()
                ctx.fillStyle = 'rgba(255,255,255,.8)'
                ctx.arc(nx, ny, 1.2, 0, Math.PI * 2)
                ctx.fill()
              }
              ctx.globalCompositeOperation = 'source-over'
            }
            if (!reduced) raf = requestAnimationFrame(draw)
          }

          resize()
          if (reduced) draw(0)
          else raf = requestAnimationFrame(draw)

          var ro = null
          if (typeof ResizeObserver === 'function') {
            ro = new ResizeObserver(function () {
              resize()
              draw(performance.now())
            })
            ro.observe(canvas.parentNode)
          }
          return function () {
            cancelAnimationFrame(raf)
            if (ro) ro.disconnect()
          }
        },
        [props.active]
      )
      return h('canvas', { ref: canvasRef, className: 'teff-quantumCanvas', 'aria-hidden': 'true' })
    }

    function EffortSlider(props) {
      var levels = props.levels || []
      var n = levels.length
      var colors = props.colors || []
      var fillColors = props.fillColors && props.fillColors.length ? props.fillColors : colors
      var visual = props.visual || 'codex'
      var isWhale = visual === 'whale'
      var isLiang = visual === 'liang'
      var artTheme = isWhale || isLiang
      var thumbHalf = artTheme ? 10 : 17
      var assetBase = props.assetBase != null ? props.assetBase : 'assets/'
      var sliderTone = props.tone || 'light'
      if (artTheme) {
        colors = themeColors(visual, sliderTone)
        fillColors = themeColors(visual, sliderTone)
      }
      var currentIndex = indexOfLevel(levels, props.current)
      var initial = currentIndex >= 0 ? currentIndex : 0
      var initialRatio = n <= 1 ? 1 : initial / (n - 1)
      var draftState = useState(initial)
      var draft = draftState[0]
      var setDraft = draftState[1]
      var posState = useState(initialRatio)
      var pos = posState[0]
      var setPos = posState[1]
      var dragState = useState(false)
      var dragging = dragState[0]
      var setDragging = dragState[1]
      var rootRef = useRef(null)
      var draggingRef = useRef(false)
      var draftRef = useRef(initial)
      var posRef = useRef(initialRatio)
      var lastX = useRef(0)
      var cleanupRef = useRef(null)
      var rectRef = useRef(null)
      var rafRef = useRef(0)
      var pendingX = useRef(0)
      var timerRef = useRef(0)
      var animRef = useRef(0)

      function cancelAnim() {
        if (animRef.current) {
          cancelAnimationFrame(animRef.current)
          animRef.current = 0
        }
      }

      function animateTo(target) {
        cancelAnim()
        var start = posRef.current
        if (Math.abs(start - target) < 0.001) {
          posRef.current = target
          paintFill(target)
          setPos(target)
          return
        }
        var started = 0
        function step(now) {
          if (!started) started = now
          var t = Math.min(1, (now - started) / 220)
          var eased = 1 - Math.pow(1 - t, 3)
          var next = start + (target - start) * eased
          posRef.current = next
          paintFill(next)
          setPos(next)
          if (t < 1) {
            animRef.current = requestAnimationFrame(step)
          } else {
            animRef.current = 0
            posRef.current = target
            paintFill(target)
            setPos(target)
          }
        }
        animRef.current = requestAnimationFrame(step)
      }

      useEffect(
        function () {
          if (draggingRef.current) return
          var next = currentIndex >= 0 ? currentIndex : 0
          draftRef.current = next
          setDraft(next)
          var snap = n <= 1 ? 1 : next / (n - 1)
          animateTo(snap)
        },
        [props.current, n]
      )

      useEffect(function () {
        return function () {
          if (timerRef.current) clearTimeout(timerRef.current)
          if (rafRef.current) cancelAnimationFrame(rafRef.current)
          if (animRef.current) cancelAnimationFrame(animRef.current)
          if (cleanupRef.current) cleanupRef.current()
        }
      }, [])

      /* 分隔线的横向位置对像素栅格对齐。
       * 只用 CSS 百分比定位时，每条线的 left 会算出带小数的坐标；落在半像素上的那条
       * （7 档时正好在轨道正中的 Medium）左右两边各被抗锯齿吃掉半个像素，看着就比别的细。
       * 所以量出轨道实际宽度后，把每条线的圆心吸附到整设备像素上——
       * 六条线落在同一套栅格上，边缘覆盖完全一致，粗细自然一模一样。
       * 宽度/档位数变化时重算；取不到 DOM（如 SSR）就退回原来的 calc 方案。 */
      var tickXState = useState(null)
      var tickXs = tickXState[0]
      var setTickXs = tickXState[1]

      useEffect(
        function () {
          var root = rootRef.current
          if (!root || n <= 2) {
            setTickXs(null)
            return
          }
          var dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
          var snap = function (v) {
            return Math.round(v * dpr) / dpr
          }
          var measure = function () {
            var w = root.getBoundingClientRect().width
            if (!w) return
            var travel = w - thumbHalf * 2
            var next = []
            for (var i = 0; i < n; i++) {
              next.push(snap(thumbHalf + (n <= 1 ? 1 : i / (n - 1)) * travel))
            }
            setTickXs(next)
          }
          measure()
          if (typeof ResizeObserver !== 'function') return
          var ro = new ResizeObserver(measure)
          ro.observe(root)
          return function () {
            ro.disconnect()
          }
        },
        [n, thumbHalf]
      )

      var idx = clamp(draft, 0, Math.max(0, n - 1))
      var level = levels[idx]
      var color = colorAt(levels, idx, fillColors)

      function pctOf(i) {
        return n <= 1 ? 100 : (i / (n - 1)) * 100
      }

      function snapOf(i) {
        return n <= 1 ? 1 : clamp(i, 0, n - 1) / (n - 1)
      }

      function ratioAt(clientX) {
        var root = rootRef.current
        if (!root) return posRef.current
        var rect = rectRef.current || root.getBoundingClientRect()
        var travel = Math.max(1, rect.width - thumbHalf * 2)
        return clamp((clientX - rect.left - thumbHalf) / travel, 0, 1)
      }

      function idxAtRatio(ratio) {
        return clamp(Math.round(ratio * Math.max(0, n - 1)), 0, Math.max(0, n - 1))
      }

      function applyDraft(i) {
        if (i === draftRef.current) return
        draftRef.current = i
        setDraft(i)
        var lv = levels[i]
        if (lv && props.onLevelChange) props.onLevelChange(lv.id)
      }

      function paintFill(ratio) {
        var root = rootRef.current
        if (root) root.style.setProperty('--teff-fill', positionForRatio(ratio))
      }

      function applyPosition(ratio) {
        posRef.current = ratio
        paintFill(ratio)
        setPos(ratio)
        applyDraft(idxAtRatio(ratio))
      }

      function indexAt(clientX) {
        return idxAtRatio(ratioAt(clientX))
      }

      function commit(i) {
        if (props.disabled) return
        var next = levels[clamp(i, 0, n - 1)]
        if (next) props.onCommit(next.id)
      }

      function scheduleCommit(i) {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(function () {
          commit(i)
        }, 200)
      }

      function stopListening() {
        if (cleanupRef.current) {
          cleanupRef.current()
          cleanupRef.current = null
        }
      }

      function cancelFrame() {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = 0
        }
      }

      function onPointerDown(e) {
        if (props.disabled) return
        if (e.button !== undefined && e.button !== 0) return
        if (e.cancelable) e.preventDefault()
        cancelAnim()
        stopListening()
        var root = rootRef.current
        if (root) rectRef.current = root.getBoundingClientRect()
        draggingRef.current = true
        setDragging(true)
        lastX.current = e.clientX
        applyPosition(ratioAt(e.clientX))

        function onMove(ev) {
          if (!draggingRef.current) return
          lastX.current = ev.clientX
          pendingX.current = ev.clientX
          if (rafRef.current) return
          rafRef.current = requestAnimationFrame(function () {
            rafRef.current = 0
            if (!draggingRef.current) return
            applyPosition(ratioAt(pendingX.current))
          })
        }

        function onUp(ev) {
          if (!draggingRef.current) return
          var x = typeof ev.clientX === 'number' ? ev.clientX : lastX.current
          lastX.current = x
          stopListening()
          cancelFrame()
          draggingRef.current = false
          setDragging(false)
          var i = idxAtRatio(ratioAt(x))
          var snap = snapOf(i)
          applyDraft(i)
          commit(i)
          animateTo(snap)
        }

        function onCancel() {
          if (!draggingRef.current) return
          stopListening()
          cancelFrame()
          draggingRef.current = false
          setDragging(false)
          var snap = snapOf(draftRef.current)
          animateTo(snap)
          if (props.onLevelChange) props.onLevelChange(props.current)
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onCancel)
        cleanupRef.current = function () {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onCancel)
        }
      }

      function onKeyDown(e) {
        if (props.disabled) return
        var next = idx
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = clamp(idx + 1, 0, n - 1)
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = clamp(idx - 1, 0, n - 1)
        else if (e.key === 'Home') next = 0
        else if (e.key === 'End') next = n - 1
        else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          commit(idx)
          return
        } else return
        e.preventDefault()
        var snap = snapOf(next)
        animateTo(snap)
        applyDraft(next)
        scheduleCommit(next)
      }

      function positionForRatio(r) {
        var pct = r * 100
        var trim = ((thumbHalf * 2) / 100) * pct
        return 'calc(' + thumbHalf + 'px + ' + pct.toFixed(3) + '% - ' + trim.toFixed(2) + 'px)'
      }

      function positionOf(i) {
        return positionForRatio(n <= 1 ? 1 : i / (n - 1))
      }

      function labelPositionOf(i) {
        var r = n <= 1 ? 1 : i / (n - 1)
        var pct = r * 100
        var half = thumbHalf
        var trim = ((half * 2) / 100) * pct
        return 'calc(' + half + 'px + ' + pct.toFixed(3) + '% - ' + trim.toFixed(2) + 'px)'
      }

      var fillCss = positionForRatio(pos)
      var ariaNow = Math.round(pos * 1000)
      var currentLabel = displayLabelOf(levels, idx, isLiang)
      var isEnergy = visual === 'energy'
      var isWarp = visual === 'warp'
      var isQuantum = visual === 'quantum'
      var ratio = pos
      var warpCount = pos > 0 ? Math.round(40 + pos * 190) : 0
      var warpSpeed = 1.2 + pos * 4.4
      /* 填充渐变：不再是「把 n 个档位色钉死在整条轨道上」，
       * 而是把 0→当前档 的那段色阶拉伸到整个宽度再由遮罩裁掉后半截。
       * 两个差别很直观：
       *  - 左端永远是调色板第一色，右端（旋钮底下）永远是当前档的色，
       *    所以拖到哪，旋钮那圈光晕和脚下颜色就永远对得上；
       *  - 低档时不再只是灰+青那么寡淡，整段色阶都被拉开。
       * 停点只取档位真实色 + 一个收尾点，CSS 自己会在中间插值，不必手写 20 个采样。 */
      var gradient = 'linear-gradient(90deg,#4c6fff,#a82bff)'
      if (fillColors && fillColors.length) {
        var baseColor = colorAt(levels, 0, fillColors)
        if (n <= 1 || pos <= 0.0001) {
          gradient = 'linear-gradient(90deg,' + baseColor + ',' + baseColor + ')'
        } else {
          var gStops = []
          for (var gi = 0; gi < n; gi++) {
            var gPos = gi / (n - 1) / pos
            if (gPos > 1.0001) break
            gStops.push(colorAt(levels, gi, fillColors) + ' ' + (gPos * 100).toFixed(2) + '%')
          }
          gStops.push(color + ' 100%')
          gradient = 'linear-gradient(90deg,' + gStops.join(',') + ')'
        }
      }

      /* 档位分隔线。放在 track 里、clip 之外，所以不管是哪套视觉、填到哪一档，
       * 每条线都在；已到达的线提亮（压在彩条上），未到达的留在灰底上。
       * 横向位置优先用 tickXs（已吸附到整设备像素，六条粗细一致），
       * 还没测到宽度时退回 positionOf，避免首帧闪跳。 */
      var tickNodes =
        n <= 2
          ? null
          : levels.map(function (lv, i) {
              // 两头不画线：首末档贴着轨道端帽，画上去会被圆角裁掉、看着比中间的细，
              // 而且端帽本身就是边界，不需要再标一次。只画中间那几档的分界。
              if (i === 0 || i === n - 1) return null
              return h('span', {
                key: 'tick-' + (lv.id || i),
                className: 'teff-tick',
                'data-on': i <= idx ? 'true' : 'false',
                style: {
                  left: tickXs && tickXs.length === n ? tickXs[i] + 'px' : positionOf(i)
                },
                'aria-hidden': 'true'
              })
            })

      var track = h(
        'div',
        { className: 'teff-track' },
        h(
          'div',
          { key: 'clip', className: 'teff-clip' },
          isEnergy
            ? h(EnergyLayer, {
                key: 'energy',
                active: !props.disabled,
                color: color,
                pos: ratio,
                tone: props.tone || 'dark'
              })
            : h(
                React.Fragment,
                null,
                isWarp || isQuantum
                  ? h('div', {
                      key: 'void',
                      className: 'teff-void',
                      style: {
                        background:
                          'linear-gradient(180deg,' +
                          rgba(color, 0.22) +
                          ' 0%,#060813 55%,#03050c 100%)'
                      }
                    })
                  : null,
                isQuantum
                  ? h('div', { key: 'quantum-base', className: 'teff-quantumBase' })
                  : null,
                h('div', {
                  key: 'gradient',
                  className: 'teff-gradient',
                  style: { background: gradient }
                }),
                artTheme
                  ? null
                  : isWarp
                    ? h(WarpLayer, {
                        key: 'warp',
                        active: !props.disabled,
                        color: color,
                        pos: ratio,
                        count: warpCount,
                        speed: warpSpeed
                      })
                    : isQuantum
                      ? h(QuantumLayer, {
                          key: 'quantum',
                          active: !props.disabled,
                          color: color,
                          pos: ratio
                        })
                      : [
                          /* 星云垫在星尘下面，负责「越往上越像一团发光的云」；
                           * 只用 --teff-glow 一个变量驱动，Off 时自然全透明。 */
                          h('div', { key: 'nebula', className: 'teff-nebula' }),
                          h(ParticleLayer, {
                            key: 'particles',
                            active: !props.disabled,
                            color: color,
                            pos: ratio
                          })
                        ]
              )
        ),
        tickNodes
      )

      var labelNodes = levels.map(function (lv, i) {
        var levelColor = colorAt(levels, i, colors)
        var style = { color: levelColor, '--teff-level': levelColor }
        style.left = labelPositionOf(i)
        var text = displayLabelOf(levels, i, isLiang)
        return h(
          'button',
          {
            key: 'label-' + (lv.id || i),
            type: 'button',
            className: 'teff-label' + (i === idx ? ' teff-label--active' : ''),
            style: style,
            title: '切换到「' + text + '」',
            disabled: props.disabled,
            onClick: function () {
              if (props.disabled) return
              if (props.onPick) props.onPick(lv.id)
              else commit(i)
            }
          },
          text
        )
      })

      return h(
        'div',
        { className: 'teff-sliderWrap' },
        h(
          'div',
          {
            ref: rootRef,
            className: 'teff-slider',
            style: {
              '--teff-fill': fillCss,
              '--teff-glow': ratio.toFixed(3),
              '--teff-glow-color': rgba(color, 0.65),
              '--teff-energy-dur': (2.7 - ratio * 1.6).toFixed(2) + 's',
              '--teff-energy-glow': (0.45 + ratio * 0.55).toFixed(2)
            },
            'data-dragging': dragging ? 'true' : 'false',
            'data-visual': visual,
            'data-level': String(idx),
            role: 'slider',
            tabIndex: props.disabled ? -1 : 0,
            'aria-disabled': props.disabled ? 'true' : undefined,
            'aria-valuemin': 0,
            'aria-valuemax': 1000,
            'aria-valuenow': ariaNow,
            'aria-valuetext': currentLabel,
            'aria-label': '推理强度',
            onPointerDown: onPointerDown,
            onKeyDown: onKeyDown
          },
          artTheme
            ? h('div', {
                key: 'mascot-' + visual + '-' + idx,
                className: 'teff-mascot' + (isLiang ? ' teff-mascot--liang' : ''),
                style: {
                  backgroundImage:
                    'url(' +
                    assetUrl(
                      assetBase,
                      THEME_ASSETS[visual].frames[
                        clamp(idx, 0, THEME_ASSETS[visual].frames.length - 1)
                      ],
                      props.assets
                    ) +
                    ')'
                }
              })
            : null,
          track,
          artTheme
            ? h('span', { className: 'teff-artKnob', 'aria-hidden': 'true' })
            : h('span', { className: 'teff-thumb', style: { '--teff-level': color } })
        ),
        h('div', { className: 'teff-labels' }, labelNodes)
      )
    }

    /* ------------------------------------------------------------------ */
    /* model list — aligned with the official composer menu                */
    /* ------------------------------------------------------------------ */

    var PROVIDER_ORDER = { 'deepseek-account': 0, 'deepseek-official': 1 }

    function providerOrder(id) {
      var rank = PROVIDER_ORDER[id]
      return rank === undefined ? 2 : rank
    }

    // 官方把 DeepSeek 账号排第一、DeepSeek 第二，其余保持目录顺序
    function providerLabel(group) {
      if (!group) return ''
      if (group.id === 'deepseek-account') return 'DeepSeek 账号'
      if (group.id === 'deepseek-official') return 'DeepSeek'
      return group.name || group.id || ''
    }

    function orderProviders(groups) {
      var buckets = [[], [], []]
      for (var i = 0; i < groups.length; i++) buckets[providerOrder(groups[i].id)].push(groups[i])
      return buckets[0].concat(buckets[1], buckets[2])
    }

    // 官方的 rankByName：查询字符按顺序出现即命中（不连续子序列也算），
    // 越靠前、越连续、前缀命中得分越高；同分保持目录顺序。
    function rankScore(text, query) {
      var name = String(text == null ? '' : text).toLowerCase()
      if (!query) return 0
      var qi = 0
      var score = 0
      var last = -2
      var first = -1
      for (var i = 0; i < name.length && qi < query.length; i++) {
        if (name.charAt(i) === query.charAt(qi)) {
          if (first < 0) first = i
          score += last === i - 1 ? 3 : 1
          last = i
          qi++
        }
      }
      if (qi < query.length) return -1
      if (first === 0) score += query.length * 3
      else score -= Math.min(first, 6)
      return score
    }

    function rankModels(models, query) {
      if (!query) return models.slice()
      var hits = []
      for (var i = 0; i < models.length; i++) {
        var score = rankScore(models[i].name || models[i].id, query)
        if (score >= 0) hits.push({ model: models[i], score: score, index: i })
      }
      hits.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score
        return a.index - b.index
      })
      var out = []
      for (var j = 0; j < hits.length; j++) out.push(hits[j].model)
      return out
    }

    function ModelPane(props) {
      var queryState = useState('')
      var query = queryState[0]
      var setQuery = queryState[1]
      // 只有键盘导航进 state：指针悬停的底色完全交给 CSS :hover，不触发任何重渲染。
      // 之前 mousemove 里既改 DOM 类又同步 aria，宿主合成层会被反复标脏，手感就是"划一下卡一下"。
      var kbState = useState(null)
      var kb = kbState[0]
      var setKb = kbState[1]
      var searchRef = useRef(null)
      var groupsRef = useRef(null)
      var rowsRef = useRef({})
      var labelCache = useRef(null)
      var hoverRef = useRef(-1)
      // 打开面板时只定位一次：之后用户自己搜索、滚动都不该被拽回去。
      var didLocateRef = useRef(false)

      var busy = !!props.busy
      var status = props.status || 'ready'
      var failures = props.failures || []
      var source = orderProviders(props.groups || [])

      var total = 0
      for (var ti = 0; ti < source.length; ti++) total += (source[ti].models || []).length
      var showSearch = props.showSearch !== false && total > 4
      var trimmed = showSearch ? String(query).trim().toLowerCase() : ''

      var filtered = []
      for (var gi = 0; gi < source.length; gi++) {
        var models = rankModels(source[gi].models || [], trimmed)
        if (models.length) filtered.push({ id: source[gi].id, name: source[gi].name, models: models })
      }

      var flat = []
      var signature = ''
      for (var fi = 0; fi < filtered.length; fi++) {
        signature += filtered[fi].id + ':' + filtered[fi].models.length + '|'
        for (var fj = 0; fj < filtered[fi].models.length; fj++) {
          flat.push({ group: filtered[fi], model: filtered[fi].models[fj] })
        }
      }

      var currentIndex = -1
      for (var ci = 0; ci < flat.length; ci++) {
        if (flat[ci].group.id === props.currentProvider && flat[ci].model.id === props.currentModel) {
          currentIndex = ci
          break
        }
      }
      var last = Math.max(0, flat.length - 1)
      var highlightIndex = kb === null ? (currentIndex >= 0 ? currentIndex : 0) : Math.min(Math.max(0, kb), last)

      var cacheKey = signature + '|' + props.currentProvider + '|' + props.currentModel
      if (!labelCache.current || labelCache.current.key !== cacheKey) {
        labelCache.current = { key: cacheKey, map: {} }
      }

      function scrollTo(index) {
        var node = rowsRef.current[index]
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
      }

      function move(delta) {
        if (!flat.length) return
        var next = Math.min(last, Math.max(0, highlightIndex + delta))
        setKb(next)
        scrollTo(next)
      }

      function pick(target) {
        if (!target || busy) return
        if (props.onPick) props.onPick(target.group, target.model)
      }

      function onKeyDown(e) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        } else if (e.key === 'Enter') {
          var index = kb === null ? (hoverRef.current >= 0 ? hoverRef.current : highlightIndex) : highlightIndex
          if (!flat.length) return
          e.preventDefault()
          pick(flat[index])
        }
      }

      // preventScroll 必须给：默认 focus 会把滚动容器拽回搜索框，
      // 等于把下面那次「滚到当前模型」当场作废。
      useEffect(
        function () {
          if (showSearch && searchRef.current) searchRef.current.focus({ preventScroll: true })
        },
        [showSearch]
      )

      // 打开面板直接停在当前模型上（而不是列表顶部）。
      // 用 getBoundingClientRect 差值手算 scrollTop，不用 scrollIntoView：
      // .teff-groups 没有 position，offsetParent 会跑到 position:absolute 的卡片上，
      // 而 scrollIntoView 会沿祖先链一路滚，有把宿主聊天内容顶走的风险。
      useEffect(
        function () {
          if (didLocateRef.current) return
          if (!flat.length || currentIndex < 0) return
          var list = groupsRef.current
          var node = rowsRef.current[currentIndex]
          if (!list || !node) return
          didLocateRef.current = true
          var listRect = list.getBoundingClientRect()
          var nodeRect = node.getBoundingClientRect()
          var delta = nodeRect.top - listRect.top - (list.clientHeight - nodeRect.height) / 2
          list.scrollTop = Math.max(0, list.scrollTop + delta)
        },
        [signature, currentIndex]
      )

      function renderName(group, model, selected) {
        if (typeof props.label !== 'function') return model.name
        var cache = labelCache.current
        var key = group.id + '\u0000' + model.id + '\u0000' + (selected ? '1' : '0')
        if (Object.prototype.hasOwnProperty.call(cache.map, key)) return cache.map[key]
        var node
        try {
          node = props.label(group, model, 'option', selected)
        } catch (error) {
          node = undefined
        }
        var out = node === undefined || node === null ? model.name : node
        cache.map[key] = out
        return out
      }

      function alertRow(key, text, retry) {
        return h(
          'div',
          { key: key, className: 'teff-alert', role: 'alert' },
          h('span', { className: 'teff-alertText' }, text),
          typeof retry === 'function'
            ? h('button', { type: 'button', className: 'teff-alertRetry', onClick: retry }, '重新加载')
            : null
        )
      }

      var body = []

      // 官方在根菜单里有一行「推理等级 → 当前档位」，点进去才是档位页。
      // 我们的模型页就是用户点触发器看到的第一个界面，所以把这行放在列表上方，
      // 否则模型有档位但还没选过时，界面上根本看不到"推理等级"入口。
      if (props.onEffort && props.effortName !== undefined) {
        body.push(
          h(
            'button',
            {
              key: 'effortRow',
              type: 'button',
              className: 'teff-menuRow',
              disabled: !!props.busy,
              onClick: function () {
                if (props.busy) return
                props.onEffort()
              }
            },
            h('span', { className: 'teff-menuRowLabel' }, '推理等级'),
            h('span', { className: 'teff-menuRowValue' }, props.effortName),
            h(IconChevronDown, { className: 'teff-menuRowChevron' })
          )
        )
      }

      if (showSearch) {
        body.push(
          h(
            'div',
            { key: 'search', className: 'teff-searchRow' },
            h('input', {
              ref: searchRef,
              className: 'teff-searchInput',
              type: 'text',
              value: query,
              placeholder: '搜索模型…',
              role: 'combobox',
              'aria-expanded': 'true',
              'aria-controls': 'teff-model-list',
              'aria-autocomplete': 'list',
              'aria-activedescendant': kb !== null && flat.length ? 'teff-opt-' + highlightIndex : undefined,
              autoComplete: 'off',
              spellCheck: false,
              onChange: function (e) {
                // 一打字就把高亮放到第一条匹配上：回车直接选中它，不用先按方向键。
                setKb(0)
                hoverRef.current = -1
                setQuery(e.target.value)
              },
              onKeyDown: onKeyDown
            }),
            query
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'teff-searchClear',
                    'aria-label': '清除搜索',
                    onClick: function () {
                      setKb(null)
                      hoverRef.current = -1
                      setQuery('')
                      if (searchRef.current) searchRef.current.focus()
                    }
                  },
                  h(IconClose)
                )
              : null
          )
        )
      }

      if (status === 'loading' && total === 0) {
        body.push(h('div', { key: 'loading', className: 'teff-status', role: 'status' }, '正在刷新模型列表…'))
      }
      if (props.error) body.push(alertRow('error', String(props.error), props.onRetry))
      for (var wi = 0; wi < failures.length; wi++) {
        var failure = failures[wi] || {}
        body.push(
          alertRow(
            'failure-' + (failure.id || wi),
            String(providerLabel(failure) || failure.id || '模型') + ' 加载失败：' + String(failure.message || ''),
            props.onRetry
          )
        )
      }

      if (filtered.length) {
        var rows = []
        var index = -1
        for (var g = 0; g < filtered.length; g++) {
          var group = filtered[g]
          rows.push(
            h(
              'div',
              { key: 'label-' + group.id, className: 'teff-groupLabel', 'aria-hidden': 'true' },
              providerLabel(group)
            )
          )
          for (var m = 0; m < group.models.length; m++) {
            var model = group.models[m]
            var selected = props.currentProvider === group.id && props.currentModel === model.id
            var itemIndex = ++index
            rows.push(
              h(
                'button',
                {
                  key: 'model-' + group.id + '-' + model.id,
                  id: 'teff-opt-' + itemIndex,
                  ref: function (ix) {
                    return function (node) {
                      if (node) rowsRef.current[ix] = node
                      else delete rowsRef.current[ix]
                    }
                  }(itemIndex),
                  type: 'button',
                  role: 'menuitemradio',
                  'aria-checked': selected ? 'true' : 'false',
                  tabIndex: showSearch ? -1 : 0,
                  disabled: busy,
                  title: model.name,
                  'data-teff-index': itemIndex,
                  className:
                    'teff-modelItem' +
                    (selected ? ' teff-modelItem--selected' : '') +
                    (kb !== null && itemIndex === highlightIndex ? ' teff-modelItem--active' : ''),
                  onMouseEnter: function (ix) {
                    return function () {
                      hoverRef.current = ix
                    }
                  }(itemIndex),
                  onClick: function (grp, mdl) {
                    return function () {
                      if (props.onPick) props.onPick(grp, mdl)
                    }
                  }(group, model)
                },
                h('span', { className: 'teff-modelItemName' }, renderName(group, model, selected)),
                h('span', { className: 'teff-itemCheck' }, selected ? h(IconCheck) : null)
              )
            )
          }
        }
        body.push(
          h(
            'div',
            {
              key: 'groups',
              ref: groupsRef,
              id: 'teff-model-list',
              className: 'teff-groups',
              role: 'menu',
              'aria-label': '模型',
              onKeyDown: onKeyDown
            },
            rows
          )
        )
      } else if (status === 'ready') {
        body.push(
          h(
            'div',
            { key: 'empty', className: 'teff-empty', role: 'status' },
            total === 0 ? '暂无可用模型' : '没有匹配的模型。'
          )
        )
      }

      return h('div', { className: 'teff-modelPane' }, body)
    }

    function Popup(props) {
      var pane =
        props.pane === 'model' || props.pane === 'effort'
          ? props.pane
          : props.initialPane === 'model'
            ? 'model'
            : 'effort'
      function setPane(next) {
        if (props.onPaneChange) props.onPaneChange(next)
      }
      var spinState = useState(false)
      var spinning = spinState[0]
      var setSpinning = spinState[1]
      var previewState = useState(props.current)
      var preview = previewState[0]
      var setPreview = previewState[1]
      var levels = props.levels || []
      var colors = props.colors || []
      var visual = props.visual || 'codex'
      var isWhale = visual === 'whale'
      var isLiang = visual === 'liang'
      var artTheme = isWhale || isLiang
      var assetBase = props.assetBase != null ? props.assetBase : 'assets/'
      var tone = props.tone || 'dark'
      if (artTheme) colors = themeColors(visual, tone)
      var currentIndex = indexOfLevel(levels, preview)
      var offIndex = findOffIndex(levels)

      useEffect(
        function () {
          setPreview(props.current)
        },
        [props.current]
      )

      // 主题档位图是 data URI，按需解码会在切换档位时闪一下空白；
      // 先把当前主题的所有帧解码进内存，拖动时就不会白屏。
      useEffect(
        function () {
          if (!artTheme) return
          var names = THEME_ASSETS[visual].frames
          for (var pi = 0; pi < names.length; pi++) {
            var preload = new Image()
            preload.src = assetUrl(assetBase, names[pi], props.assets)
          }
        },
        [visual, artTheme]
      )
      var firstOnIndex = -1
      for (var fi = 0; fi < levels.length; fi++) {
        if (!isOffLevel(levels[fi])) {
          firstOnIndex = fi
          break
        }
      }
      var currentLevel = currentIndex >= 0 ? levels[currentIndex] : null
      var currentColor = currentLevel ? colorAt(levels, currentIndex, colors) : colors[0] || '#8a93a3'
      var hasLevels = levels.length > 0
      var powerOn = !!(currentLevel && !isOffLevel(currentLevel))
      var currentLabel = currentLevel
        ? displayLabelOf(levels, currentIndex, isLiang)
        : props.effortName !== undefined
          ? props.effortName
          : '—'
      // 主题帧按"真实档位"排位取，Default 格不占帧，否则插一格后整个主题错位。
      var themeFrameIndex = clamp(realRankOf(levels, currentIndex), 0, 6)
      var hero = artTheme
        ? Array.isArray(THEME_ASSETS[visual].hero)
          ? THEME_ASSETS[visual].hero[themeFrameIndex]
          : THEME_ASSETS[visual].hero
        : null
      var cardStyle = hero
        ? { '--teff-hero': 'url(' + assetUrl(assetBase, hero, props.assets) + ')' }
        : undefined
      if (props.fixedPos) {
        cardStyle = Object.assign({}, cardStyle || {}, {
          position: 'fixed',
          right: props.fixedPos.right,
          bottom: props.fixedPos.bottom,
          left: 'auto',
          top: 'auto'
        })
      }
      // 写入期间不再冻结档位操作：commitSerial 已经能吸收连点（同档位合并在途、
      // 不同档位排队只留最后一次），再拦一道只会让手感变钝，而且乐观更新之后
      // 界面本来就是即时响应的，没必要锁住。
      var canPower = hasLevels && (powerOn ? offIndex >= 0 : firstOnIndex >= 0)
      var canReset = hasLevels

      // ---- 档位大字切换的"渐变模糊" -------------------------------------
      // 标题显示的是 preview，拖拽跨档时也会变，所以这里不挂 commit，只认"文字变了"。
      // 变化在**渲染期**推导（不是等 effect 补一脚），否则新字会先无动画地刷一帧再重播，
      // 看着像闪一下。React 允许在渲染中同步 setState 自己的 state，它会立刻重渲染而不落屏。
      var seenState = useState({ label: currentLabel, color: currentColor, seq: 0 })
      var seen = seenState[0]
      var setSeen = seenState[1]
      var swapState = useState(null)
      var swap = swapState[0]
      var setSwap = swapState[1]
      if (seen.label !== currentLabel) {
        var swapSeq = seen.seq + 1
        setSeen({ label: currentLabel, color: currentColor, seq: swapSeq })
        setSwap({
          key: swapSeq,
          from: seen.label,
          fromColor: seen.color,
          to: currentLabel,
          toColor: currentColor
        })
      }
      useEffect(
        function () {
          if (!swap) return undefined
          var timer = setTimeout(function () {
            setSwap(null)
          }, 260)
          return function () {
            clearTimeout(timer)
          }
        },
        [swap]
      )

      function renderLevelName() {
        if (!swap) {
          return h(
            'div',
            { className: 'teff-levelName', style: { color: currentColor }, title: currentLabel },
            currentLabel
          )
        }
        // 两层用同一个 key 前缀 + 递增值，强制重挂载，动画才会重新从头播。
        return h(
          'div',
          { key: 'swap' + swap.key, className: 'teff-levelSwap' },
          h(
            'div',
            {
              className: 'teff-levelName teff-levelName--out',
              style: { color: swap.fromColor },
              'aria-hidden': 'true'
            },
            swap.from
          ),
          h(
            'div',
            { className: 'teff-levelName teff-levelName--in', style: { color: swap.toColor } },
            swap.to
          )
        )
      }

      // 标题行下面那行模型名换字时也走一趟模糊淡入：和档位大字、底部触发器同一套节奏。
      // 只在模型名真的变了才播，弹层反复开关不会重播。
      var modelSeenState = useState({ text: props.modelName, key: 0 })
      var modelSeen = modelSeenState[0]
      var setModelSeen = modelSeenState[1]
      if (modelSeen.text !== props.modelName) {
        setModelSeen({ text: props.modelName, key: modelSeen.key + 1 })
      }
      var modelNameFx = modelSeen.key > 0

      function renderModelName() {
        return h(
          'span',
          {
            key: modelNameFx ? 'mf' + modelSeen.key : 'static',
            className: 'teff-modelName',
            'data-fx': modelNameFx ? 'true' : 'false'
          },
          props.modelName
        )
      }

      function switchToModel() {
        if (props.modelLocked) return
        setPane('model')
      }

      function backToEffort() {
        setPane('effort')
      }

      function pickModel(group, model) {
        if (props.onPickModel) props.onPickModel(group, model)
      }

      function togglePower() {
        if (!canPower) return
        // 开 → 最低的有效档位（跳过 off 与 Default）；关 → Default。
        // 关掉不该落到某个具体的 "off" 档上：off 是"强制不思考"，
        // 而 Default 才是"交回 provider 自己决定"，后者才是关掉的意思。
        if (powerOn) {
          var target = offIndex >= 0 ? levels[offIndex] : levels[0]
          if (target) props.onCommit(target.id)
        } else {
          props.onCommit(levels[firstOnIndex].id)
        }
      }

      function resetEffort() {
        if (!canReset) return
        setSpinning(true)
        setTimeout(function () {
          setSpinning(false)
        }, 380)
        var target = offIndex >= 0 ? levels[offIndex] : levels[firstOnIndex >= 0 ? firstOnIndex : 0]
        if (target) props.onCommit(target.id)
      }

      return h(
        'div',
        {
          className: 'teff-card',
          'data-tone': tone,
          'data-visual': visual,
          'data-pane': pane,
          style: cardStyle,
          role: 'menu',
          'aria-label': '模型与推理强度'
        },
        pane === 'model'
          ? h(ModelPane, {
              groups: props.groups || [],
              currentProvider: props.currentProvider,
              currentModel: props.currentModel,
              onBack: backToEffort,
              onPick: pickModel,
              status: props.status,
              failures: props.failures,
              error: props.error,
              busy: props.busy,
              onRetry: props.onRetry,
              label: props.label,
              effortName: props.effortName,
              onEffort: function () {
                setPane('effort')
              }
            })
          : h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'teff-head' },
                h(
                  'div',
                  { className: 'teff-headSide' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'teff-iconBtn teff-power',
                      'data-on': powerOn ? 'true' : 'false',
                      'aria-pressed': powerOn ? 'true' : 'false',
                      'aria-label': powerOn ? '关闭推理（回到 Default）' : '开启推理（最低档）',
                      title: powerOn ? '关闭推理（回到 Default）' : '开启推理（最低档）',
                      disabled: !canPower,
                      onClick: togglePower
                    },
                    h(IconBolt, { filled: powerOn })
                  )
                ),
                h(
                  'div',
                  { className: 'teff-headCenter' },
                  renderLevelName(),
                  props.modelLocked
                    ? h(
                        'span',
                        {
                          className: 'teff-modelLine teff-modelLine--static',
                          title: props.modelName
                        },
                        renderModelName()
                      )
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'teff-modelLine',
                          onClick: switchToModel,
                          title: props.modelName,
                          'aria-haspopup': 'menu'
                        },
                        renderModelName(),
                        h(IconChevronRight, { className: 'teff-modelChevron' })
                      )
                ),
                h(
                  'div',
                  { className: 'teff-headSide teff-headSide--right' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'teff-iconBtn teff-reset',
                      'data-spin': spinning ? 'true' : 'false',
                      'aria-label': '重置为 Default（跟随 provider 默认）',
                      title: '重置为 Default',
                      disabled: !canReset,
                      onClick: resetEffort
                    },
                    h(IconReset)
                  )
                )
              ),
              h(
                'div',
                { className: 'teff-effort' },
                props.error ? h('div', { className: 'teff-error' }, props.error) : null,
                hasLevels
                  ? h(EffortSlider, {
                      levels: levels,
                      colors: colors,
                      fillColors: props.fillColors,
                      tone: tone,
                      assetBase: assetBase,
                      assets: props.assets,
                      current: props.current,
                      visual: visual,
                      onCommit: props.onCommit,
                      onLevelChange: function (id) {
                        setPreview(id)
                        if (props.onPreviewLevel) props.onPreviewLevel(id)
                      },
                      onPick: function (id) {
                        props.onCommit(id)
                        if (props.onClose) props.onClose()
                      }
                    })
                  : h(
                      'div',
                      { className: 'teff-empty' },
                      '该模型没有推理档位，可切换其他模型。'
                    )
              )
            )
      )
    }

    function Trigger(props) {
      var modelAria = '选择模型，当前 ' + props.modelName
      var effortAria = '选择推理等级，当前 ' + (props.effortName || '无')
      var chevron = props.busy
        ? h(IconSpinner, { size: 12 })
        : h(IconChevronDown, { className: 'teff-triggerChevron' })
      // 底部档位文字换字时重播一趟小幅模糊淡入。同样是渲染期推导 + 递增 key 强制重挂载：
      // 只在名字真的变了才播，同一档位反复点不重播，也不会先无动画地闪一帧。
      var fxState = useState({ key: 0, text: props.effortName })
      var fx = fxState[0]
      var setFx = fxState[1]
      if (fx.text !== props.effortName) {
        setFx({ key: fx.key + 1, text: props.effortName })
      }
      var effortFx = fx.key > 0
      // 模型名换字同理。原来是硬切的，切模型时那段文字毫无动静，
      // 和左右的档位名、箭头不在一个节奏上。跟 effort 分开记状态，
      // 两个名字各变各的，互不干扰。
      var modelFxState = useState({ key: 0, text: props.modelName })
      var modelFx = modelFxState[0]
      var setModelFx = modelFxState[1]
      if (modelFx.text !== props.modelName) {
        setModelFx({ key: modelFx.key + 1, text: props.modelName })
      }
      var modelNameFx = modelFx.key > 0
      return h(
        'span',
        { className: 'teff-trigger' },
        h(
          'button',
          {
            type: 'button',
            className: 'teff-triggerModel',
            'aria-haspopup': 'menu',
            'aria-expanded': props.open && props.openPane === 'model' ? 'true' : 'false',
            'aria-label': modelAria,
            title: props.modelName,
            disabled: props.disabled,
            onClick: props.onModelClick,
            onKeyDown: props.onKeyDown
          },
          h('span', { className: 'teff-triggerIcon', 'aria-hidden': 'true' }, h(IconData)),
          h(
            'span',
            {
              key: modelNameFx ? 'mf' + modelFx.key : 'static',
              className: 'teff-triggerLabel',
              'data-fx': modelNameFx ? 'true' : 'false'
            },
            props.modelName
          )
        ),
        props.effortName
          ? h(
              'button',
              {
                type: 'button',
                className: 'teff-triggerEffortBtn',
                'aria-haspopup': 'menu',
                'aria-expanded': props.open && props.openPane === 'effort' ? 'true' : 'false',
                'aria-label': effortAria,
                title: props.modelName + ' · ' + props.effortName,
                disabled: props.disabled,
                onClick: props.onEffortClick,
                onKeyDown: props.onKeyDown
              },
              h(
                'span',
                {
                  key: effortFx ? 'fx' + fx.key : 'static',
                  className: 'teff-triggerEffort',
                  'data-fx': effortFx ? 'true' : 'false',
                  style: { color: props.effortColor }
                },
                props.effortName
              ),
              chevron
            )
          : h(
              'button',
              {
                type: 'button',
                className: 'teff-triggerEffortBtn',
                'aria-haspopup': 'menu',
                'aria-expanded': props.open ? 'true' : 'false',
                'aria-label': modelAria,
                title: props.modelName,
                disabled: props.disabled,
                onClick: props.onModelClick,
                onKeyDown: props.onKeyDown
              },
              chevron
            )
      )
    }

    return {
      Trigger: Trigger,
      Popup: Popup,
      EffortSlider: EffortSlider,
      ModelPane: ModelPane,
      providerLabel: providerLabel,
      injectStyles: injectStyles,
      icons: {
        Data: IconData,
        ChevronDown: IconChevronDown,
        ChevronRight: IconChevronRight,
        Check: IconCheck,
        Back: IconBack,
        Bolt: IconBolt,
        Reset: IconReset,
        Spinner: IconSpinner
      }
    }
  }

  return {
    createThinkingUI: createThinkingUI,
    injectStyles: injectStyles,
    CSS: CSS,
    PALETTES: PALETTES,
    VISUALS: VISUALS,
    CANON: CANON,
    CANON_NAMES: CANON_NAMES,
    ENGLISH_NAMES: ENGLISH_NAMES,
    LIANG_NAMES: LIANG_NAMES,
    DEFAULT_LEVEL_ID: DEFAULT_LEVEL_ID,
    DEFAULT_LEVEL: DEFAULT_LEVEL,
    isDefaultLevel: isDefaultLevel,
    withDefaultLevel: withDefaultLevel,
    realRankOf: realRankOf,
    displayLabelOf: displayLabelOf,
    THEME_COLORS: THEME_COLORS,
    themeColors: themeColors,
    THEME_ASSETS: THEME_ASSETS,
    THEME_VISUALS: THEME_VISUALS,
    DEFAULT_CUSTOM: DEFAULT_CUSTOM,
    resolvePalette: resolvePalette,
    fillPalette: fillPalette,
    colorAt: colorAt,
    indexOfLevel: indexOfLevel,
    isOffLevel: isOffLevel,
    findOffIndex: findOffIndex,
    levelName: levelName,
    levelLabel: levelLabel,
    hexToRgb: hexToRgb,
    relLuminance: relLuminance,
    contrast: contrast,
    ensureContrast: ensureContrast,
    rgba: rgba
  }
})
