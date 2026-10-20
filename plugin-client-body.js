/* Plugin client body. The build script wraps this together with lib/ui.js and the
 * inlined theme assets into window.__ModuleLoader__.load(...). */

const CORE = globalThis.THINKING_UI_CORE
const UI = CORE.createThinkingUI(React)
// react-dom 不是必需依赖：拿不到就退回"浮层留在原位"的老做法。
let ReactDOM = null
try {
  ReactDOM = require('react-dom')
} catch (error) {
  ReactDOM = null
}
const NS = 'thinking-bar'
const STORE_KEY = 'dsh-thinking-bar.prefs.v1'
const DEFAULT_PREFS = {
  mode: 'codex',
  visual: 'codex',
  palette: 'codex',
  custom: CORE.DEFAULT_CUSTOM.slice()
}

function readPrefs() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return { ...DEFAULT_PREFS, custom: DEFAULT_PREFS.custom.slice() }
    const parsed = JSON.parse(raw)
    const visualIds = CORE.VISUALS.map((item) => item.id)
    const paletteIds = CORE.PALETTES.map((item) => item.id)
    return {
      mode: parsed && parsed.mode === 'codex' ? 'codex' : 'official',
      visual: parsed && visualIds.indexOf(parsed.visual) >= 0 ? parsed.visual : 'codex',
      palette: parsed && paletteIds.indexOf(parsed.palette) >= 0 ? parsed.palette : 'codex',
      custom:
        parsed && Array.isArray(parsed.custom) && parsed.custom.length === 7
          ? parsed.custom.map((c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? c : '#888888'))
          : DEFAULT_PREFS.custom.slice()
    }
  } catch (error) {
    return { ...DEFAULT_PREFS, custom: DEFAULT_PREFS.custom.slice() }
  }
}

let prefs = readPrefs()
const prefsListeners = new Set()

function subscribePrefs(listener) {
  prefsListeners.add(listener)
  return function () {
    prefsListeners.delete(listener)
  }
}

function getPrefs() {
  return prefs
}

function setPrefs(patch) {
  prefs = { ...prefs, ...patch }
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(prefs))
  } catch (error) {
    /* private mode / disabled storage: keep the in-memory preference */
  }
  for (const listener of Array.from(prefsListeners)) listener()
}

// 冷启动时 localStorage 可能还没就绪（读到 null → 回落到默认 official），
// 表现为"重启后又变回官方、但设置里看着还是 codex"。启动后补读一次真实值。
function resyncPrefs() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed) return
    const mode = parsed.mode === 'codex' ? 'codex' : 'official'
    if (mode === prefs.mode) return
    prefs = { ...prefs, mode: mode }
    for (const listener of Array.from(prefsListeners)) listener()
  } catch (error) {
    /* 存储不可用或不合法时保持内存值 */
  }
}

function usePrefs() {
  return React.useSyncExternalStore(subscribePrefs, getPrefs, getPrefs)
}

function currentTone() {
  return document.body && document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
}

function useTone() {
  const [tone, setTone] = React.useState(currentTone)
  React.useEffect(function () {
    const update = function () {
      setTone(currentTone())
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme']
    })
    update()
    return function () {
      observer.disconnect()
    }
  }, [])
  return tone
}

function levelNameFor(visual, levels, index) {
  if (index < 0 || index >= levels.length) return undefined
  // 统一走 CORE.displayLabelOf：Default 格固定显示 Default，梁系命名按真实档位排位
  // 取（Default 不占梁序号），插了 Default 之后设置页预览也不会错位。
  return CORE.displayLabelOf(levels, index, visual === 'liang')
}

/* 文字用色：每一档都顶到 4.5:1，保证标签和大标题在任何背景上都读得清。 */
function colorsFor(visual, palette, custom, tone) {
  if (CORE.THEME_VISUALS.indexOf(visual) >= 0) return CORE.themeColors(visual, tone)
  return CORE.resolvePalette(palette, custom, tone)
}

/* 填充用色：调色板原色。
 * 以前填充直接复用 colorsFor，于是 #38BDF8 这种亮蓝被拉去满足文字对比度、
 * 压成灰蓝，整条滑杆发闷——那是"为文字服务"的色，不该拿来涂色面。
 * 鲸鱼娘/梁圣的主题色本来就是原色，两条路径取到的是同一组。 */
function fillColorsFor(visual, palette, custom, tone) {
  if (CORE.THEME_VISUALS.indexOf(visual) >= 0) return CORE.themeColors(visual, tone)
  return CORE.fillPalette(palette, custom)
}

function SettingsSection(props) {
  const prefs = usePrefs()
  const tone = useTone()
  const previewState = React.useState('high')
  const preview = previewState[0]
  const setPreview = previewState[1]
  // 设置页预览用的是一组"像真的"档位：Default 打头，后面接真实的强度档。
  // 不含 off —— 现在的模型多数在目录里没有 off 档，真正需要 Default 的正是这种模型，
  // 预览要照这个情形显示，否则用户在这里看不到自己真正会遇到的样子。
  const levels = [CORE.DEFAULT_LEVEL].concat(
    CORE.CANON.filter(function (id) {
      return id !== 'off'
    }).map(function (id) {
      return { id: id, name: CORE.levelLabel(id, id) }
    })
  )
  const isArt = CORE.THEME_VISUALS.indexOf(prefs.visual) >= 0
  const colors = colorsFor(prefs.visual, prefs.palette, prefs.custom, tone)
  const fillColors = fillColorsFor(prefs.visual, prefs.palette, prefs.custom, tone)
  const showVisual = prefs.mode === 'codex'

  const card =
    prefs.mode === 'official'
      ? React.createElement(OfficialPreview, { tone: tone, levels: levels, current: preview })
      : React.createElement(UI.Popup, {
          tone: tone,
          modelName: 'DeepSeek-V4.1-Flash',
          modelLocked: true,
          levels: levels,
          current: preview,
          colors: colors,
          fillColors: fillColors,
          visual: prefs.visual,
          assetBase: '',
          assets: ASSETS,
          initialPane: 'effort',
          onCommit: setPreview,
          onClose: function () {}
        })

  return React.createElement(
    'div',
    { className: 'tb-page' },
    React.createElement('style', null, PAGE_CSS),
    React.createElement(
      'div',
      { className: 'tb-ack' },
      React.createElement(
        'p',
        { className: 'tb-ackLine' },
        React.createElement('span', { className: 'tb-ackLabel' }, '致谢：'),
        '本插件的“梁圣”视觉概念与人物图片素材源自 ',
        React.createElement(
          'span',
          { className: 'tb-nowrap' },
          React.createElement(
            'a',
            {
              className: 'tb-ackLink',
              href: 'https://github.com/Lichtspektrum/liang-intensity-calibrator',
              target: '_blank',
              rel: 'noreferrer noopener'
            },
            'Lichtspektrum/liang-intensity-calibrator'
          ),
          '。'
        )
      ),
      React.createElement('p', { className: 'tb-ackLine tb-ackLead' }, '感谢以下项目提供的灵感来源：'),
      React.createElement(
        'ul',
        { className: 'tb-ackList' },
        React.createElement(
          'li',
          null,
          React.createElement(
            'a',
            {
              className: 'tb-ackLink',
              href: 'https://github.com/MuFeng262/dsh-thinking-slider',
              target: '_blank',
              rel: 'noreferrer noopener'
            },
            'MuFeng262/dsh-thinking-slider'
          )
        ),
        React.createElement(
          'li',
          null,
          React.createElement(
            'a',
            {
              className: 'tb-ackLink',
              href: 'https://github.com/Lichtspektrum/liang-intensity-calibrator',
              target: '_blank',
              rel: 'noreferrer noopener'
            },
            'Lichtspektrum/liang-intensity-calibrator'
          )
        )
      )
    ),
    React.createElement(
      'p',
      { className: 'tb-intro' },
      '本插件只提供界面外观；推理等级由 DSH 系统提供，读取系统模型目录，不写入配置。'
    ),
    React.createElement(
      'p',
      { className: 'tb-intro tb-compat' },
      '兼容 ',
      React.createElement('span', { className: 'tb-nowrap' }, 'DeepSeek Harness 0.2.1-rc.2'),
      ' 及以上。'
    ),
    React.createElement('div', { className: 'tb-stage' }, card),
    field(
      '形态',
      segmented(
        [
          { id: 'official', name: '官方' },
          { id: 'codex', name: 'Codex 滑杆' }
        ],
        prefs.mode,
        function (mode) {
          setPrefs({ mode: mode })
        },
        2
      )
    ),
    showVisual
      ? field(
          '滑杆视觉',
          segmented(
            CORE.VISUALS.map(function (item) {
              return { id: item.id, name: item.name }
            }),
            prefs.visual,
            function (visual) {
              setPrefs({ visual: visual })
            },
            3
          )
        )
      : null,
    showVisual && !isArt
      ? field('档位配色', paletteSelector(prefs, tone))
      : null,
    React.createElement(
      'div',
      { className: 'tb-actions' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'tb-reset',
          onClick: function () {
            setPrefs({ ...DEFAULT_PREFS, custom: DEFAULT_PREFS.custom.slice() })
            setPreview('high')
          }
        },
        '恢复默认'
      )
    )
  )

  function field(label, content) {
    return React.createElement(
      'div',
      { className: 'tb-field' },
      React.createElement('div', { className: 'tb-label' }, label),
      content
    )
  }

  function segmented(options, value, onChange, columns) {
    return React.createElement(
      'div',
      { className: 'tb-seg', style: { '--tb-cols': String(columns) } },
      options.map(function (option) {
        return React.createElement(
          'button',
          {
            key: option.id,
            type: 'button',
            className: 'tb-opt',
            'data-active': value === option.id ? 'true' : 'false',
            onClick: function () {
              onChange(option.id)
            }
          },
          option.name
        )
      })
    )
  }

  function paletteSelector(prefs, tone) {
    return React.createElement(
      'div',
      { className: 'tb-palettes' },
      CORE.PALETTES.map(function (entry) {
        const swatches = CORE.fillPalette(entry.id, prefs.custom)
        return React.createElement(
          'button',
          {
            key: entry.id,
            type: 'button',
            className: 'tb-palette',
            'data-active': prefs.palette === entry.id ? 'true' : 'false',
            onClick: function () {
              setPrefs({ palette: entry.id })
            }
          },
          React.createElement('span', { className: 'tb-paletteName' }, entry.name),
          React.createElement(
            'span',
            { className: 'tb-swatches' },
            swatches.map(function (color, index) {
              return React.createElement('i', { key: index, style: { background: color } })
            })
          )
        )
      })
    )
  }
}

function OfficialPreview(props) {
  const index = props.levels.findIndex(function (level) {
    return level.id === props.current
  })
  const label = levelNameFor('codex', props.levels, index)
  return React.createElement(
    'div',
    { className: 'tb-offCard', 'data-tone': props.tone },
    React.createElement(
      'div',
      { className: 'tb-offRow' },
      React.createElement('span', null, '模型'),
      React.createElement('b', null, 'DeepSeek-V4.1-Flash'),
      React.createElement(UI.icons.ChevronRight, { className: 'tb-offChevron' })
    ),
    React.createElement(
      'div',
      { className: 'tb-offRow' },
      React.createElement('span', null, '推理等级'),
      React.createElement('b', null, label || '—'),
      React.createElement(UI.icons.ChevronRight, { className: 'tb-offChevron' })
    )
  )
}

function ModelSeat(props) {
  const prefs = usePrefs()
  const tone = useTone()
  const state = React.useSyncExternalStore(
    function (listener) {
      return props.directory.subscribe(listener)
    },
    function () {
      return props.directory.getSnapshot()
    },
    function () {
      return props.directory.getSnapshot()
    }
  )
  const openState = React.useState(false)
  const open = openState[0]
  const setOpen = openState[1]
  const paneState = React.useState('effort')
  const pane = paneState[0]
  const setPane = paneState[1]
  const fixedState = React.useState(null)
  const fixedPos = fixedState[0]
  const setFixedPos = fixedState[1]
  const errorState = React.useState(null)
  const localError = errorState[0]
  const setLocalError = errorState[1]
  // 选模型时菜单立刻收起，失败信息用轻提示兜住（否则要等 select 往返，
  // 点击手感就是"点了半天没反应"）。
  const toastState = React.useState(null)
  const toast = toastState[0]
  const setToast = toastState[1]
  React.useEffect(
    function () {
      if (!toast) return undefined
      const timer = setTimeout(function () {
        setToast(null)
      }, 4000)
      return function () {
        clearTimeout(timer)
      }
    },
    [toast]
  )
  const rootRef = React.useRef(null)
  // 浮层的宿主节点（挂到 body 上），用于判断"点到外面了吗"。
  const portalRef = React.useRef(null)

  // 乐观选择：点完就先把名字换过去、菜单收起，真正的 select 在后台跑。
  // 失败再退回原样并弹提示——这样点击永远是"立刻有反应"，不用盯着转圈。
  const optimisticState = React.useState(null)
  const optimistic = optimisticState[0]
  const setOptimistic = optimisticState[1]
  // 乐观值的产生时间：目录迟迟没追上来时用它兜底回退，避免芯片一直显示错名字。
  const optimisticAtState = React.useState(0)
  const setOptimisticAt = optimisticAtState[1]
  const optimisticAt = optimisticAtState[0]
  // 每次打开面板都强制重算一次：官方的推理等级可以在它自己的界面里改，
  // catalog 变了不一定带来目录快照变化，靠这个 tick 保证拿到的是最新档位。
  const tickState = React.useState(0)
  const setTick = tickState[1]
  // 上次主动刷新目录的时间（毫秒），避免每次打开面板都把 provider 探测排一遍。
  const lastLoadRef = React.useRef(0)

  const groups = state.groups || []
  const current = optimistic || state.current
  const group =
    current &&
    groups.find(function (item) {
      return item.id === current.provider
    })
  const model =
    group &&
    group.models.find(function (item) {
      return item.id === current.model
    })
  // 思考等级的**唯一事实来源**是 DSH：座位 face 透传的 props.reasoning 就是
  // 官方 catalog.reasoningFor()。它返回什么就渲染什么，包括 undefined ——
  // undefined 的意思是「这个模型没有推理能力」，例如用户在模型设置里把推理等级
  // 关掉了。只有这个函数压根不可用（不是函数 / 抛错）时才退回快照里的
  // model.reasoning，因为那时的 undefined 是「不知道」，不是「没有」。
  let reasoning
  let authoritative = false
  if (typeof props.reasoning === 'function' && current) {
    try {
      reasoning = props.reasoning(current)
      authoritative = true
    } catch (error) {
      reasoning = undefined
    }
  }
  if (!authoritative) reasoning = model && model.reasoning
  const levels = (reasoning && reasoning.efforts) || []
  // 宿主刷新目录/模型版本更新时，efforts 会有一帧变成空数组（实测 2026-10-17）。
  // 那一帧直接按空数组渲染，滑条会塌掉，所以沿用上一帧——但**只限同一个模型**。
  // 以前这里不区分模型，切到一个没有档位的模型时就把上一个模型的档位顶上来，
  // 于是关掉推理的模型上还能点出一个并不存在的 low，提交后被 Host 拒掉。
  // 另外「DSH 说没有推理能力」（reasoning 为 undefined）不桥接：那是明确答复。
  const modelKey = current ? current.provider + '/' + current.model : ''
  const levelsRef = React.useRef({ key: modelKey, levels: [] })
  if (levels.length) levelsRef.current = { key: modelKey, levels: levels }
  const transientEmpty = authoritative && !!reasoning && levels.length === 0
  const rawLevels =
    levels.length > 0
      ? levels
      : transientEmpty && levelsRef.current.key === modelKey
        ? levelsRef.current.levels
        : []
  const fallbackEffort = reasoning ? reasoning.defaultEffort : undefined
  // 官方只在模型没有 defaultEffort 时才给"provider 默认"那一行空值项
  // （docs/official-ui-notes.md:297-312）；有 defaultEffort 的模型官方不插，
  // 我们也不插，芯片文字直接走 defaultEffort 对应的那个真实档位。
  const canFollowDefault = rawLevels.length > 0 && fallbackEffort === undefined
  const liveLevels = CORE.withDefaultLevel(rawLevels, canFollowDefault)
  const rawEffort = (current && current.reasoningEffort) || fallbackEffort
  // 空档位（没选过，或 provider 明确交回默认）落到 Default 那一格上。
  // 不用空串/null 当哨兵：indexOfLevel 是严格比较，会和"真没有档位"混在一起。
  const effort =
    canFollowDefault && (rawEffort === undefined || rawEffort === null || rawEffort === '')
      ? CORE.DEFAULT_LEVEL_ID
      : rawEffort
  const effortIndex = liveLevels.findIndex(function (level) {
    return level.id === effort
  })
  // 官方触发器在"模型有档位但还没选过"时显示 Default；这里直接给那一格的真实名字，
  // 不再自己发明中文「默认」——两者语义相同，但用户看到的名字要和官方一致。
  const effortName =
    effortIndex >= 0
      ? CORE.displayLabelOf(liveLevels, effortIndex, prefs.visual === 'liang')
      : liveLevels.length
        ? 'Default'
        : undefined
  const colors = colorsFor(prefs.visual, prefs.palette, prefs.custom, tone)
  const fillColors = fillColorsFor(prefs.visual, prefs.palette, prefs.custom, tone)
  const effortColor =
    effortIndex >= 0 ? CORE.colorAt(liveLevels, effortIndex, colors) : undefined
  const modelName = (model && model.name) || (current ? current.model : '模型')
  // 乐观更新期间不转圈：名字已经先切过去了，再转圈只会显得慢。
  // 切档位也走乐观值，所以正常路径上 busy 基本不会为真；
  // 它现在只剩一个用途——目录还没给出任何档位时（liveLevels 为空）避免误操作。
  const busy = state.pending !== null && !optimistic
  const errorText = localError || (state.error && (state.error.message || String(state.error)))

  // 乐观值是否已被目录采纳：切模型比 provider/model；切档位还必须再比 reasoningEffort。
  // 少了后一项，只改档位时 provider/model 本来就相等，会被当成「目录已追上」而立刻撤掉，
  // 显示又跳回旧档位——乐观更新等于没做。
  //
  // Default 这一格要特别处理：提交时不发 reasoningEffort，目录回给我们的就是
  // undefined/空。若还按 === 硬比，Default 的乐观值一设上就立刻被判成"已追上"而撤掉，
  // 芯片会先闪回旧档位再跳 Default，就是"点一下顿一下"。
  // 所以两边都先归一：Default / 空 / null / undefined 一律折算成 null 再比。
  const effortKeyOf = function (value) {
    if (value === CORE.DEFAULT_LEVEL_ID) return null
    if (value === undefined || value === null || value === '') return null
    return value
  }

  const sameAsOptimistic = function (value, target) {
    if (!value || !target) return false
    if (value.provider !== target.provider) return false
    if (value.model !== target.model) return false
    if (target.reasoningEffort === undefined) return true
    return effortKeyOf(value.reasoningEffort) === effortKeyOf(target.reasoningEffort)
  }

  // 官方目录追上来了就撤掉乐观值；追不上也要撤：
  // select 已经落定（pending 为空）却始终没变成新值时，2.5 秒后回退到目录里的真值，
  // 免得触发按钮一直挂着一个错名字。
  React.useEffect(
    function () {
      if (!optimistic) return
      if (sameAsOptimistic(state.current, optimistic)) {
        setOptimistic(null)
        return
      }
      if (state.pending !== null) return
      const wait = Math.max(0, 2500 - (Date.now() - optimisticAt))
      const timer = setTimeout(function () {
        setOptimistic(function (value) {
          return sameAsOptimistic(value, optimistic) ? null : value
        })
      }, wait)
      return function () {
        clearTimeout(timer)
      }
    },
    [
      state.current && state.current.provider,
      state.current && state.current.model,
      state.current && state.current.reasoningEffort,
      state.pending,
      optimistic,
      optimisticAt
    ]
  )


  const place = React.useCallback(function () {
    const node = rootRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    setFixedPos({
      right: Math.max(12, window.innerWidth - rect.right),
      bottom: Math.max(12, window.innerHeight - rect.top + 8)
    })
  }, [])

  React.useEffect(
    function () {
      if (!open) return
      place()
      const closeOutside = function (event) {
        if (rootRef.current && rootRef.current.contains(event.target)) return
        if (portalRef.current && portalRef.current.contains(event.target)) return
        setOpen(false)
      }
      const closeKey = function (event) {
        if (event.key === 'Escape') setOpen(false)
      }
      document.addEventListener('mousedown', closeOutside)
      document.addEventListener('keydown', closeKey)
      window.addEventListener('resize', place)
      window.addEventListener('scroll', place, true)
      return function () {
        document.removeEventListener('mousedown', closeOutside)
        document.removeEventListener('keydown', closeKey)
        window.removeEventListener('resize', place)
        window.removeEventListener('scroll', place, true)
      }
    },
    [open, place]
  )

  if (!props.available) return null


  // 打开面板先算位置、再开、最后静默刷新目录：三者顺序不能换，
  // 反过来会在弹层动画期间同步拉目录，手感变成"点了半天才出来"。
  const openWith = function (nextPane) {
    const now = Date.now()
    // 先把定位算好再打开：浮层现在是 fixed + portal 到 body，
    // 晚一帧算位置会让它先闪一下在页面左下角。
    try {
      place()
    } catch (error) {
      /* 拿不到 rect 就沿用上一次的位置 */
    }
    setPane(nextPane)
    setOpen(true)
    setLocalError(null)
    setTick(function (value) {
      return value + 1
    })
    // 每次打开都向官方目录要一次最新数据。之前按"空列表或 30 秒过期"才拉，
    // 结果是：在设置里刚加完模型/Provider，回来打开菜单看到的还是旧列表
    // （宿主刷新 catalog 后不一定把新快照推给会话目录，得我们自己 load 一次）。
    // load 是静默的：列表非空时不会显示"正在刷新模型列表"，也不会转圈。
    lastLoadRef.current = now
    try {
      props.load()
    } catch (error) {
      /* 拉取失败不影响已经打开的列表，失败信息由目录状态自己带回 */
    }
  }

  // select() 若一直不 resolve，state.pending 会一直非空：写入永远悬着、乐观值
  // 也永远等不到目录追上。给写入加一道超时：超时按失败上报，
  // 让乐观值走回退分支，界面回到真值。
  const COMMIT_TIMEOUT_MS = 10000

  const commit = function (selection, options) {
    const surface = options && options.toast === true
    const report = function (message) {
      setLocalError(message)
      if (surface) setToast(message)
    }
    setLocalError(null)
    let promise
    try {
      promise = props.select(selection)
    } catch (error) {
      report(error && error.message ? error.message : String(error))
      return Promise.resolve(false)
    }
    if (promise && typeof promise.then === 'function') {
      return new Promise(function (resolve) {
        let settled = false
        let timer = null
        const finish = function (ok, message) {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          if (!ok && message) report(message)
          resolve(ok)
        }
        timer = setTimeout(function () {
          finish(false, '切换超时，请重试')
        }, COMMIT_TIMEOUT_MS)
        promise.then(
          function (result) {
            if (result && result.ok === false) {
              finish(
                false,
                result.error && result.error.message
                  ? result.error.message
                  : '切换失败'
              )
              return
            }
            finish(true)
          },
          function (error) {
            finish(false, error && error.message ? error.message : String(error))
          }
        )
      })
    }
    return Promise.resolve(true)
  }

  // 连点去重：同一档位在途时直接复用同一个 promise；不同档位在途时只记
  // 最后一次，等前一次落定后再补发一次，避免多次 select 互相覆盖、
  // 最终落定的档位和用户最后点的不一致。
  const commitQueueRef = React.useRef({ key: null, promise: null, queued: null })

  const commitKeyOf = function (selection) {
    // Default 的 selection 不带 reasoningEffort（见 onCommit），直接 join 会得到
    // 结尾一个空段；显式标成字符串，免得和任何"档位名恰好为空"的情况撞键。
    const effort =
      selection && selection.reasoningEffort ? selection.reasoningEffort : '__default__'
    return [selection && selection.provider, selection && selection.model, effort].join('\u0000')
  }

  const commitSerial = function (selection, options) {
    const slot = commitQueueRef.current
    const key = commitKeyOf(selection)
    if (slot.promise) {
      if (slot.key === key) return slot.promise
      slot.queued = { selection: selection, options: options }
      return slot.promise
    }
    const start = function (nextSelection, nextOptions) {
      const nextKey = commitKeyOf(nextSelection)
      const raw = commit(nextSelection, nextOptions)
      // 存"包装后"的 promise：同档位连点时复用的必须是同一个对象，
      // 调用方 await 到的时序也和队列排空保持一致。
      const wrapped = raw.then(function (ok) {
        const queued = commitQueueRef.current.queued
        commitQueueRef.current = { key: null, promise: null, queued: null }
        if (!queued) return ok
        return start(queued.selection, queued.options).then(function () {
          return ok
        })
      })
      commitQueueRef.current = { key: nextKey, promise: wrapped, queued: null }
      return wrapped
    }
    return start(selection, options)
  }

  // 模型列表里渲染官方 `conversation.input.model.label` 子插槽（官方的 1017 之类的
  // 角标插件就是挂在它上面的）；宿主没给 renderSlot 或插槽渲染失败时回落到模型名。
  const renderModelLabel = function (group, model, placement, selected) {
    if (typeof props.renderSlot !== 'function' || !group) return undefined
    try {
      return props.renderSlot(
        'conversation.input.model.label',
        {
          provider: { id: group.id, name: UI.providerLabel(group) },
          model: model,
          placement: placement,
          selected: !!selected
        },
        { fallback: model.name }
      )
    } catch (error) {
      return undefined
    }
  }

  const trigger = React.createElement(UI.Trigger, {
    open: open,
    openPane: pane,
    modelName: modelName,
    effortName: effortName,
    effortColor: effortColor,
    busy: busy,
    disabled: props.locked,
    onModelClick: function () {
      openWith('model')
    },
    onEffortClick: function () {
      openWith('effort')
    }
  })

  const popupCard = open
    ? React.createElement(UI.Popup, {
        tone: tone,
        modelName: modelName,
        providerName: group ? group.name : undefined,
        modelLocked: false,
        groups: groups,
        currentProvider: current ? current.provider : undefined,
        currentModel: current ? current.model : undefined,
        levels: liveLevels,
        effortName: effortName,
        current: effort,
        colors: colors,
        fillColors: fillColors,
        visual: prefs.visual,
        assetBase: '',
        assets: ASSETS,
        busy: busy,
        error: errorText || undefined,
        status: state.status || 'ready',
        failures: state.failures || [],
        onRetry: function () {
          props.load()
        },
        label: renderModelLabel,
        pane: pane,
        onPaneChange: setPane,
        initialPane: pane,
        fixedPos: fixedPos,
        onCommit: function (id) {
          if (!current) return
          // 档位也和切模型一样乐观：先把档位名切过去，select 在后台跑。
          // 否则 effortName 读的还是旧值，busy 又为真，用户看到的就是
          // "点了 High、字还是 Low、旁边转个圈"。
          //
          // Default 那格要翻译成"省略 reasoningEffort"（官方 chooseEffort 同款，
          // 见 docs/official-ui-source-notes.md:49）：官方把它当成"交回 provider 默认"，
          // 发一个不存在的档位 id 会被 Host 拒掉。
          // 乐观值里显式写 null 而不是省略字段，免得 sameAsOptimistic 认不出这是 Default。
          const knownEffort = rawLevels.some(function (level) {
            return level && level.id === id
          })
          const isDefault = id === CORE.DEFAULT_LEVEL_ID || !knownEffort
          const selection = isDefault
            ? { provider: current.provider, model: current.model }
            : { provider: current.provider, model: current.model, reasoningEffort: id }
          const optimisticValue = {
            provider: current.provider,
            model: current.model,
            reasoningEffort: isDefault ? null : id
          }
          setOptimisticAt(Date.now())
          setOptimistic(optimisticValue)
          commitSerial(selection).then(function (ok) {
            if (ok) return
            // 只撤掉"还停在这次选择上"的乐观值：连点时前一次失败不能把
            // 后一次已经生效的显示一起清掉。
            setOptimistic(function (value) {
              return sameAsOptimistic(value, optimisticValue) ? null : value
            })
          })
        },
        onPickModel: function (group, picked) {
          const defaultEffort =
            picked && picked.reasoning ? picked.reasoning.defaultEffort : undefined
          // 点完立刻：菜单收起 + 触发按钮上换成新模型名（乐观更新），
          // select 在后台跑；失败再退回去并弹提示。
          setOptimisticAt(Date.now())
          setOptimistic({
            provider: group.id,
            model: picked.id,
            ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort })
          })
          setOpen(false)
          commit(
            {
              provider: group.id,
              model: picked.id,
              ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort })
            },
            { toast: true }
          ).then(function (ok) {
            if (ok) return
            setOptimistic(function (value) {
              return value && value.provider === group.id && value.model === picked.id ? null : value
            })
          })
        },
        onClose: function () {
          setOpen(false)
        }
      })
    : null

  // 浮层挂到 document.body：脱离输入框那棵会被宿主频繁重排/合成的子树，
  // 划过列表时只脏浮层自己这一小块。拿不到 react-dom 时退回原位渲染。
  const popup = popupCard
    ? ReactDOM && ReactDOM.createPortal
      ? ReactDOM.createPortal(
          React.createElement('div', { className: 'tb-portal', ref: portalRef }, popupCard),
          document.body
        )
      : popupCard
    : null

  return React.createElement(
    'span',
    { className: 'tb-seat', ref: rootRef },
    trigger,
    popup,
    toast
      ? React.createElement(
          'div',
          { className: 'tb-seatToast', role: 'status', key: 'toast' },
          toast
        )
      : null
  )
}

// 设置导航图标：一颗大的四角星 + 一颗小的，替代宿主统一给的齿轮。
// 两笔合起来在 24 框里偏右 2.2、偏上 0.3，用 transform 挪回正中。
const NAV_GLYPH =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\'%3E' +
  '%3Cg transform=\'translate(-2.2 .3)\'%3E' +
  '%3Cpath fill=\'%23000\' d=\'M12 2.2c.6 4.6 2.5 6.5 7.1 7.1-4.6.6-6.5 2.5-7.1 7.1-.6-4.6-2.5-6.5-7.1-7.1 4.6-.6 6.5-2.5 7.1-7.1Z\'/%3E' +
  '%3Cpath fill=\'%23000\' d=\'M18.6 15.1c.3 2.2 1.2 3.1 3.4 3.4-2.2.3-3.1 1.2-3.4 3.4-.3-2.2-1.2-3.1-3.4-3.4 2.2-.3 3.1-1.2 3.4-3.4Z\'/%3E' +
  '%3C/g%3E%3C/svg%3E")'

const PAGE_CSS = `
.tb-page{display:flex;flex-direction:column;gap:14px;padding:2px 0 20px;color:var(--dsw-alias-label-primary);font-family:inherit}
.tb-ack{display:flex;flex-direction:column;gap:6px;margin:0;padding-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
.tb-ackLine{margin:0}
.tb-ackLabel{color:var(--dsw-alias-label-primary);font-weight:600}
.tb-ackLead{color:var(--dsw-alias-label-secondary)}
.tb-ackList{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.tb-ackList>li{position:relative;padding-left:14px}
.tb-ackList>li::before{content:'';position:absolute;left:2px;top:9px;width:5px;height:5px;corner-shape:round;border-radius:50%;background:currentColor;opacity:.32}
.tb-ackLink{color:var(--dsw-alias-state-business-primary);text-decoration:none;border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent);padding-bottom:1px;transition:border-color .15s,color .15s}
.tb-ackLink:hover{border-bottom-color:currentColor}
.tb-intro{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.tb-compat{color:var(--dsw-alias-label-tertiary)}
.tb-nowrap{white-space:nowrap}
.tb-stage{position:relative;height:174px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);overflow:visible}
.tb-stage .teff-card{right:auto;left:50%;bottom:8px;margin-left:-178px;animation:none}
.tb-stage .tb-offCard{margin:28px auto 0}
.tb-field{display:flex;flex-direction:column;gap:7px}
.tb-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.tb-seg{display:grid;grid-template-columns:repeat(var(--tb-cols,2),minmax(0,1fr));gap:5px}
.tb-opt{height:29px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-opt:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tb-opt[data-active="true"]{background:var(--dsw-alias-state-business-primary,#2563eb);border-color:transparent;color:#fff}
.tb-palettes{display:flex;flex-direction:column;gap:2px}
.tb-palette{display:flex;align-items:center;justify-content:space-between;height:29px;padding:0 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.tb-palette:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tb-palette[data-active="true"]{border-color:var(--dsw-alias-state-business-primary,#2563eb);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.tb-paletteName{flex:none;margin-right:10px}
.tb-swatches{display:flex;gap:3px;min-width:0}
.tb-swatches i{display:block;width:16px;height:12px;border-radius:3px}
.tb-actions{display:flex;justify-content:flex-end;padding-top:2px}
.tb-reset{height:29px;padding:0 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.tb-reset:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tb-offCard{width:290px;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 8px 24px -16px rgba(0,0,0,.35)}
.tb-offCard[data-tone="dark"]{background:#1c1c1f;border-color:rgba(255,255,255,.09)}
.tb-offRow{display:flex;align-items:center;gap:8px;height:34px;padding:0 8px;border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px}
.tb-offRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tb-offRow>span:first-child{color:var(--dsw-alias-label-secondary)}
.tb-offRow>b{margin-left:auto;font-weight:400;color:var(--dsw-alias-label-primary);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-offChevron{width:12px;height:12px;color:var(--dsw-alias-label-tertiary);flex:none}
@media (prefers-reduced-motion:reduce){.tb-stage .teff-card{animation:none}}
`
return {
  inject: ['locale', 'slots'],
  apply(ctx) {
    UI.injectStyles()


    setTimeout(resyncPrefs, 0)
    setTimeout(resyncPrefs, 1200)
    ctx.effect(
      function () {
        return ctx.locale.register(NS, {
          zh: { 'section.label': '思考等级栏' },
          en: { 'section.label': 'Thinking Bar' }
        })
      },
      'dsh-thinking-bar: locale'
    )
    const t = ctx.locale.bind(NS)

    // 设置左侧导航的图标由宿主按 section id 硬编码（未知 id 一律给齿轮）。
    // 宿主没有开放自定义图标的入口，所以这里只做一件很轻的事：
    // 在本分区那个 nav 按钮上打一个标记，再用 CSS 换掉图标。
    // 观察范围限制在 document.body 的直接子节点变化（设置面板是 portal 到 body 的），
    // 不动聊天区的子树，避免和流式渲染抢活。
    ctx.effect(
      function () {
        if (typeof document === 'undefined') return
        const style = document.createElement('style')
        style.id = 'teff-nav-icon'
        style.textContent =
          '[data-teff-nav]>svg{display:none}' +
          '[data-teff-nav]::before{content:\'\';flex:none;width:16px;height:16px;' +
          'background-color:currentColor;' +
          '-webkit-mask:' + NAV_GLYPH + ' center/16px 16px no-repeat;' +
          'mask:' + NAV_GLYPH + ' center/16px 16px no-repeat}'
        document.head.appendChild(style)

        let queued = false
        const paint = function () {
          queued = false
          try {
            const label = String(t('section.label') || '').trim()
            if (!label) return
            const buttons = document.querySelectorAll('[class*="navList"] button')
            for (let i = 0; i < buttons.length; i++) {
              const marked = buttons[i].hasAttribute('data-teff-nav')
              const hit = String(buttons[i].textContent || '').trim() === label
              if (hit && !marked) buttons[i].setAttribute('data-teff-nav', '')
              else if (!hit && marked) buttons[i].removeAttribute('data-teff-nav')
            }
          } catch (error) {
            /* 宿主 DOM 变了就静默放弃，图标退回齿轮 */
          }
        }
        const schedule = function () {
          if (queued) return
          queued = true
          const raf =
            typeof requestAnimationFrame === 'function'
              ? requestAnimationFrame
              : function (fn) {
                  setTimeout(fn, 16)
                }
          raf(paint)
        }
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true })
        paint()
        setTimeout(paint, 300)

        return function () {
          observer.disconnect()
          try {
            document.head.removeChild(style)
          } catch (error) {
            /* 已经被移除 */
          }
          const marked = document.querySelectorAll('[data-teff-nav]')
          for (let i = 0; i < marked.length; i++) marked[i].removeAttribute('data-teff-nav')
        }
      },
      'dsh-thinking-bar: settings nav glyph'
    )

    // 设置分区只依赖 slots，注册在自己的作用域里。
    // 座位要等 modelDirectories / sessions，一旦它抛错会连带销毁同一个子 ctx 里的
    // 所有注册（历史上就是这样把设置分区一起带走的），所以两者必须分开。
    ctx.effect(
      function () {
        return ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-thinking-bar',
              order: 27,
              label: function () {
                return t('section.label')
              }
            },
            SettingsSection
          )
        })
      },
      'dsh-thinking-bar: settings section'
    )

    ctx.inject(['slots', 'modelDirectories', 'sessions'], function (scope) {
      const models = scope.modelDirectories
      const sessions = scope.sessions
      let disposeSeat = null
      let degraded = false

      function closeSeat() {
        if (disposeSeat !== null) {
          try {
            disposeSeat()
          } catch (error) {
            /* 卸载途中的异常不再向上抛 */
          }
          disposeSeat = null
        }
      }

      function syncSeat(force) {
        if (prefs.mode !== 'codex') {
          closeSeat()
          return
        }
        if (disposeSeat !== null && force !== true) return
        if (force === true) closeSeat()
        try {
          disposeSeat = scope.slots.inject('conversation.input.model', function () {
            const seat = {
              name: 'conversation.input.model',
              inject: function (sessionId) {
                // 关键：DSH 会把抛错的条目判为「弃权」(abdicated) 并永久跳过，
                // 而 modelDirectories.directoryFor() 对未就绪的会话是直接抛错的
                // （session "<id>" resolved no scope / no binding）。切会话和冷启动
                // 的瞬间恰好就是这种状态，所以这里必须吞掉异常、标记降级，
                // 交给下面的自愈定时器在会话就绪后重新注册。
                let directory
                try {
                  directory = models.directoryFor(sessionId)
                } catch (error) {
                  degraded = true
                  return { available: false }
                }
                const store = directory && directory.store
                if (!store) {
                  degraded = true
                  return { available: false }
                }
                let available = false
                try {
                  available = sessions.subagentAddress(sessionId) === undefined
                } catch (error) {
                  available = false
                }
                // 官方选择器读的是目录里的 catalog.reasoningFor(selection)，
                // 快照里的 model.reasoning 并不是每个模型都有；直接复用官方那套，
                // 才能和"官方有这个模型的思考等级"保持一致。
                return {
                  available: available,
                  directory: store,
                  // 关键：catalog 必须每次现取。注册座位的那一刻目录往往还没建好，
                  // 之前把 catalog 捕获成闭包常量，拿到的永远是 null，于是所有模型
                  // 都退回到快照里的 model.reasoning —— 插件新增的模型没有这个字段，
                  // 表现就是"我们这边没有思考等级，切回官方就有了"。
                  reasoning: function (selection) {
                    try {
                      const live = directory.catalog
                      if (!live || typeof live.reasoningFor !== 'function') return undefined
                      return live.reasoningFor(selection)
                    } catch (error) {
                      return undefined
                    }
                  },
                  load: function () {
                    if (!available) return
                    try {
                      const pending = directory.load()
                      if (pending && typeof pending.catch === 'function') {
                        pending.catch(function () {})
                      }
                    } catch (error) {
                      /* 目录尚未就绪时静默 */
                    }
                  },
                  select: function (selection) {
                    if (!available) return Promise.resolve(undefined)
                    try {
                      return Promise.resolve(directory.select(selection))
                    } catch (error) {
                      return Promise.reject(error)
                    }
                  }
                }
              }
            }
            // single 槽位已被内置选择器以 priority 0 占据。DSH 的规则是
            // 「priority 越小越先渲染」—— 运行时提示原文是
            // register at a different priority to shadow it (lowest renders)，
            // 所以用 -1 才能盖过内置那条。
            //
            // 子插槽不能在这里再声明一次：官方选择器（priority 0，仍然在册）
            // 已经把 `conversation.input.model.label` 声明过了，而 slots.register
            // 对「已被别人声明过的子插槽」直接抛 already declared。声明是全局的，
            // 官方那条还在，所以 renderSlot 依然可用，我们在组件里照常调用即可。
            return scope.slots.register({ priority: -1, name: seat.name, inject: seat.inject }, ModelSeat)
          })
          degraded = false
        } catch (error) {
          disposeSeat = null
          console.warn('[dsh-thinking-bar] model seat not registered:', error)
        }
      }

      const unsubscribe = subscribePrefs(function () {
        syncSeat(false)
      })
      syncSeat(false)
      scope.effect(
        function () {
          // 自愈：face 因会话未就绪而降级时，隔一会儿重新注册一次，
          // 否则被弃权的条目会一直显示内置选择器（看起来就像"变回官方默认"）。
          const timer = setInterval(function () {
            if (!degraded) return
            degraded = false
            syncSeat(true)
          }, 700)
          return function () {
            clearInterval(timer)
            unsubscribe()
            closeSeat()
          }
        },
        'dsh-thinking-bar: model seat'
      )
    })
  }
}

/* build 161415 */
