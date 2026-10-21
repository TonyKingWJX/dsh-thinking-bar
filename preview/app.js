/* Preview app for the thinking-effort UI. Pure front-end mock: no DSH APIs. */
(function () {
  'use strict'

  var React = window.React
  var ReactDOMClient = window.ReactDOMClient
  var CORE = window.THINKING_UI_CORE
  var rootEl = document.getElementById('root')

  if (!React || !ReactDOMClient || !CORE) {
    if (rootEl) rootEl.textContent = '预览资源加载失败：缺少 React 或 UI 内核。'
    return
  }

  var h = React.createElement
  var useState = React.useState
  var useEffect = React.useEffect
  var useMemo = React.useMemo
  var useRef = React.useRef

  var UI = CORE.createThinkingUI(React)
  CORE.injectStyles()

  var PARAMS = new URLSearchParams(window.location.search)
  function param(name, allowed, fallback) {
    var value = PARAMS.get(name)
    if (value === null || value === '') return fallback
    if (allowed && allowed.indexOf(value) < 0) return fallback
    return value
  }
  function paramBool(name, fallback) {
    var value = PARAMS.get(name)
    if (value === null) return fallback
    return value === '1' || value === 'true'
  }

  /* ------------------------------------------------------------------ data */

  var LEVEL_IDS = {
    7: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    6: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
    5: ['off', 'low', 'medium', 'high', 'max'],
    3: ['off', 'low', 'high'],
    0: []
  }

  function makeLevels(ids) {
    return ids.map(function (id) {
      return { id: id, name: CORE.levelName(id) }
    })
  }

  var PROVIDERS = [
    {
      id: 'deepseek-account',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4', name: 'DeepSeek-V4', levelCount: 7, defaultEffort: 'high', tag: '推理' },
        { id: 'deepseek-r1', name: 'DeepSeek-R1', levelCount: 6, defaultEffort: 'medium', tag: '推理' },
        { id: 'deepseek-chat', name: 'DeepSeek-Chat', levelCount: 0, tag: '无推理' }
      ]
    },
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        { id: 'gpt-5.1-codex', name: 'gpt-5.1-codex', levelCount: 5, defaultEffort: 'medium', tag: '推理' },
        { id: 'gpt-5.1', name: 'gpt-5.1', levelCount: 7, defaultEffort: 'high', tag: '推理' }
      ]
    },
    {
      id: 'custom',
      name: '自定义 API',
      models: [
        { id: 'qwen3-32b', name: 'qwen3-32b', levelCount: 3, defaultEffort: 'low', tag: '本地' },
        { id: 'my-reasoner', name: 'my-reasoner-v2', levelCount: 7, defaultEffort: 'max', tag: '自建' }
      ]
    }
  ]

  function levelsOf(model) {
    return makeLevels(LEVEL_IDS[model.levelCount] || [])
  }

  function findInfo(selection) {
    var provider
    var model
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id !== selection.provider) continue
      provider = PROVIDERS[i]
      for (var j = 0; j < provider.models.length; j++) {
        if (provider.models[j].id === selection.model) model = provider.models[j]
      }
    }
    if (!provider) {
      provider = PROVIDERS[0]
      model = provider.models[0]
    }
    if (!model) model = provider.models[0]
    var levels = levelsOf(model)
    var current = selection.effort
    if (CORE.indexOfLevel(levels, current) < 0) current = model.defaultEffort
    if (CORE.indexOfLevel(levels, current) < 0 && levels.length) current = levels[0].id
    return { provider: provider, model: model, levels: levels, current: current }
  }

  function groupsForPicker() {
    return PROVIDERS.map(function (p) {
      return {
        id: p.id,
        name: p.name,
        models: p.models.map(function (m) {
          return { id: m.id, name: m.name, tag: m.tag }
        })
      }
    })
  }

  /* --------------------------------------------------------------- helpers */

  function cx() {
    var out = []
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i])
    return out.join(' ')
  }

  function Seg(props) {
    return h(
      'div',
      { className: cx('pv-seg', props.options.length > 4 && 'pv-seg--wrap') },
      props.options.map(function (opt) {
        return h(
          'button',
          {
            key: opt.id,
            type: 'button',
            'data-active': props.value === opt.id ? 'true' : 'false',
            disabled: props.disabled,
            onClick: function () {
              props.onChange(opt.id)
            }
          },
          opt.name
        )
      })
    )
  }

  function SwitchRow(props) {
    return h(
      'label',
      { className: 'pv-switchRow' },
      h('span', null, props.label),
      h(
        'span',
        { className: 'pv-switch' },
        h('input', {
          type: 'checkbox',
          checked: props.checked,
          onChange: function (e) {
            props.onChange(e.target.checked)
          }
        }),
        h('span')
      )
    )
  }

  /* ------------------------------------------------------- official replica */

  function OfficialTrigger(props) {
    return h(
      'button',
      {
        type: 'button',
        className: 'off-trigger',
        'aria-haspopup': 'menu',
        'aria-expanded': props.open ? 'true' : 'false',
        'aria-label': '选择模型，当前 ' + props.modelName + (props.effortName ? '，推理等级 ' + props.effortName : ''),
        title: props.modelName + (props.effortName ? ' · ' + props.effortName : ''),
        onClick: props.onClick
      },
      h('span', { className: 'off-triggerIcon', 'aria-hidden': 'true' }, h(UI.icons.Data)),
      h('span', { className: 'off-triggerLabel' }, props.modelName),
      props.effortName ? h('span', { className: 'off-triggerEffort' }, props.effortName) : null,
      h('span', { className: 'off-triggerChevron' }, h(UI.icons.ChevronDown))
    )
  }

  function OfficialMenu(props) {
    var initial = props.initialPane === 'model' || props.initialPane === 'effort' ? props.initialPane : 'root'
    var paneState = useState(initial)
    var pane = paneState[0]
    var setPane = paneState[1]
    var queryState = useState('')
    var query = queryState[0]
    var setQuery = queryState[1]
    var searchRef = useRef(null)

    var total = 0
    for (var gi = 0; gi < props.groups.length; gi++) total += props.groups[gi].models.length
    var showSearch = total > 4
    var lowered = query.trim().toLowerCase()
    var filtered = []
    for (var i = 0; i < props.groups.length; i++) {
      var group = props.groups[i]
      var models = []
      for (var j = 0; j < group.models.length; j++) {
        var model = group.models[j]
        if (
          !lowered ||
          String(model.name).toLowerCase().indexOf(lowered) >= 0 ||
          String(model.id).toLowerCase().indexOf(lowered) >= 0
        ) {
          models.push(model)
        }
      }
      if (models.length) filtered.push({ id: group.id, name: group.name, models: models })
    }

    useEffect(
      function () {
        if (pane === 'model' && showSearch && searchRef.current) searchRef.current.focus()
      },
      [pane, showSearch]
    )

    function head(title) {
      return h(
        'div',
        { className: 'off-head' },
        h(
          'button',
          {
            type: 'button',
            className: 'off-back',
            'aria-label': '返回',
            onClick: function () {
              setPane('root')
            }
          },
          h(UI.icons.Back)
        ),
        h('span', { className: 'off-title' }, title)
      )
    }

    if (pane === 'model') {
      var items = []
      for (var g = 0; g < filtered.length; g++) {
        items.push(h('div', { key: 'og-' + filtered[g].id, className: 'off-group' }, filtered[g].name))
        for (var m = 0; m < filtered[g].models.length; m++) {
          var item = filtered[g].models[m]
          var selected = props.currentProvider === filtered[g].id && props.currentModel === item.id
          items.push(
            h(
              'button',
              {
                key: 'om-' + filtered[g].id + '-' + item.id,
                type: 'button',
                className: 'off-item',
                onClick: function (grp, mdl) {
                  return function () {
                    props.onPickModel(grp, mdl)
                  }
                }(filtered[g], item)
              },
              h('span', { className: 'off-itemName' }, item.name),
              selected ? h(UI.icons.Check, { className: 'off-check' }) : null
            )
          )
        }
      }
      return h(
        'div',
        { className: 'off-card', role: 'menu', 'aria-label': '选择模型' },
        head('模型'),
        showSearch
          ? h(
              'div',
              { className: 'off-searchRow' },
              h('input', {
                ref: searchRef,
                className: 'off-search',
                type: 'text',
                value: query,
                placeholder: '搜索模型…',
                onChange: function (e) {
                  setQuery(e.target.value)
                }
              })
            )
          : null,
        h('div', { className: 'off-list' }, items.length ? items : h('div', { className: 'off-empty' }, '没有匹配的模型'))
      )
    }

    if (pane === 'effort') {
      var rows = []
      for (var k = 0; k < props.levels.length; k++) {
        var lv = props.levels[k]
        rows.push(
          h(
            'button',
            {
              key: 'ol-' + lv.id,
              type: 'button',
              className: 'off-item',
              onClick: function (id) {
                return function () {
                  props.onPickEffort(id)
                }
              }(lv.id)
            },
            h('span', { className: 'off-itemName' }, lv.name),
            props.current === lv.id ? h(UI.icons.Check, { className: 'off-check' }) : null
          )
        )
      }
      return h(
        'div',
        { className: 'off-card', role: 'menu', 'aria-label': '推理等级' },
        head('推理等级'),
        h(
          'div',
          { className: 'off-list' },
          rows.length ? rows : h('div', { className: 'off-empty' }, '当前模型未提供推理等级。')
        )
      )
    }

    return h(
      'div',
      { className: 'off-card', role: 'menu', 'aria-label': '模型与推理等级' },
      h(
        'button',
        {
          type: 'button',
          className: 'off-row',
          onClick: function () {
            setPane('model')
          }
        },
        h('span', { className: 'off-rowLabel' }, '模型'),
        h('span', { className: 'off-rowValue' }, props.modelName),
        h(UI.icons.ChevronRight, { className: 'off-rowChevron' })
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'off-row',
          disabled: !props.levels.length,
          onClick: function () {
            if (props.levels.length) setPane('effort')
          }
        },
        h('span', { className: 'off-rowLabel' }, '推理等级'),
        h('span', { className: 'off-rowValue' }, props.levelName || '未提供'),
        h(UI.icons.ChevronRight, { className: 'off-rowChevron' })
      )
    )
  }

  /* ------------------------------------------------------- settings preview */

  /* 设置页预览是纯样式预览：固定模型、独立档位，不读也不写会话状态。 */
  var PREVIEW_MODEL = 'DeepSeek-V4.1-Flash'
  var PREVIEW_LEVELS = [
    { id: 'off', name: '关闭' },
    { id: 'minimal', name: '极简' },
    { id: 'low', name: '低' },
    { id: 'medium', name: '中' },
    { id: 'high', name: '高' },
    { id: 'xhigh', name: '极高' },
    { id: 'max', name: '最高' }
  ]

  function SettingsPreview(props) {
    var currentState = useState(
      param('pvEffort', PREVIEW_LEVELS.map(function (lv) { return lv.id }), 'high')
    )
    var current = currentState[0]
    var setCurrent = currentState[1]
    var paneState = useState(PARAMS.get('pvPane') === 'effort' ? 'effort' : 'root')
    var pane = paneState[0]
    var setPane = paneState[1]

    function currentName() {
      for (var i = 0; i < PREVIEW_LEVELS.length; i++) {
        if (PREVIEW_LEVELS[i].id === current) return PREVIEW_LEVELS[i].name
      }
      return current
    }

    var card
    if (props.mode === 'official') {
      if (pane === 'effort') {
        card = h(
          'div',
          { className: 'off-card', role: 'menu', 'aria-label': '推理等级' },
          h(
            'div',
            { className: 'off-head' },
            h(
              'button',
              {
                type: 'button',
                className: 'off-back',
                'aria-label': '返回',
                onClick: function () {
                  setPane('root')
                }
              },
              h(UI.icons.Back)
            ),
            h('span', { className: 'off-title' }, '推理等级')
          ),
          h(
            'div',
            { className: 'off-list' },
            PREVIEW_LEVELS.map(function (lv) {
              return h(
                'button',
                {
                  key: lv.id,
                  type: 'button',
                  className: 'off-item',
                  onClick: function () {
                    setCurrent(lv.id)
                    setPane('root')
                  }
                },
                h('span', { className: 'off-itemName' }, lv.name),
                current === lv.id ? h(UI.icons.Check, { className: 'off-check' }) : null
              )
            })
          )
        )
      } else {
        card = h(
          'div',
          { className: 'off-card', role: 'menu', 'aria-label': '模型与推理等级' },
          h(
            'div',
            { className: 'off-row off-row--static' },
            h('span', { className: 'off-rowLabel' }, '模型'),
            h('span', { className: 'off-rowValue' }, PREVIEW_MODEL)
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'off-row',
              onClick: function () {
                setPane('effort')
              }
            },
            h('span', { className: 'off-rowLabel' }, '推理等级'),
            h('span', { className: 'off-rowValue' }, currentName()),
            h(UI.icons.ChevronRight, { className: 'off-rowChevron' })
          )
        )
      }
    } else {
      card = h(UI.Popup, {
        tone: props.tone,
        modelName: PREVIEW_MODEL,
        modelLocked: true,
        levels: PREVIEW_LEVELS,
        current: current,
        colors: props.colors,
        fillColors: props.fillColors,
        visual: props.visual,
        onCommit: setCurrent
      })
    }

    return h(
      'div',
      {
        className:
          'pv-previewStage' + (props.visual === 'whale' ? ' pv-previewStage--art' : '')
      },
      h('div', { className: 'pv-previewCardWrap' }, card)
    )
  }

  /* ---------------------------------------------------------------- app */

  function App() {
    var initialMode = param('mode', ['official', 'codex'], 'codex')
    var initialVisual = param(
      'visual',
      ['codex', 'energy', 'warp', 'quantum', 'whale', 'liang'],
      'codex'
    )
    var paletteIds = CORE.PALETTES.map(function (p) {
      return p.id
    })
    var initialPalette = param('palette', paletteIds.concat(['custom']), 'codex')
    var explicitPane = PARAMS.get('pane')
    var initialPane = param('pane', ['effort', 'model'], 'effort')
    var initialSelection = {
      provider: param('provider', null, 'deepseek-account'),
      model: param('model', null, 'deepseek-v4'),
      effort: param('effort', null, 'high')
    }

    var modeState = useState(initialMode)
    var mode = modeState[0]
    var setMode = modeState[1]

    var visualState = useState(initialVisual)
    var visual = visualState[0]
    var setVisual = visualState[1]

    var paletteState = useState(initialPalette)
    var paletteId = paletteState[0]
    var setPaletteId = paletteState[1]

    var customState = useState(CORE.DEFAULT_CUSTOM.slice())
    var custom = customState[0]
    var setCustom = customState[1]

    var darkState = useState(paramBool('dark', false))
    var dark = darkState[0]
    var setDark = darkState[1]

    var narrowState = useState(paramBool('narrow', false))
    var narrow = narrowState[0]
    var setNarrow = narrowState[1]

    var openState = useState(paramBool('open', false))
    var open = openState[0]
    var setOpen = openState[1]

    var paneState = useState(initialPane)
    var pane = paneState[0]
    var setPane = paneState[1]

    var previewEffortState = useState(null)
    var previewEffort = previewEffortState[0]
    var setPreviewEffort = previewEffortState[1]

    var previewResetState = useState(0)
    var previewReset = previewResetState[0]
    var setPreviewReset = previewResetState[1]

    function openWith(nextPane) {
      setPane(nextPane)
      setOpen(true)
      setPreviewEffort(null)
    }

    var selectionState = useState(initialSelection)
    var selection = selectionState[0]
    var setSelection = selectionState[1]

    var info = findInfo(selection)
    var tone = dark ? 'dark' : 'light'
    var customKey = custom.join('|')
    var colors = useMemo(
      function () {
        return CORE.resolvePalette(paletteId, custom, tone)
      },
      [paletteId, customKey, tone]
    )

    // 填充取调色板原色，跟真机走同一个函数（真机是 fillColorsFor → CORE.fillPalette）。
    // 以前这里自己遍历 PALETTES 抄了一遍，真机改了配色后两边就会对不上。
    var fillColors = useMemo(
      function () {
        return CORE.fillPalette(paletteId, custom)
      },
      [paletteId, customKey]
    )

    var shownCurrent =
      previewEffort && CORE.indexOfLevel(info.levels, previewEffort) >= 0 ? previewEffort : info.current
    var levelIndex = CORE.indexOfLevel(info.levels, shownCurrent)
    var effortLevel = info.levels.length ? info.levels[levelIndex >= 0 ? levelIndex : 0] : null
    var effortName = effortLevel ? effortLevel.name : undefined
    var themeColors = CORE.themeColors(visual, tone)
    var effortEnglish = effortLevel
      ? visual === 'liang'
        ? CORE.LIANG_NAMES[CORE.liangSlotOf(info.levels, levelIndex)]
        : CORE.levelLabel(effortLevel.id, effortLevel.name)
      : undefined
    var effortColor = effortLevel
      ? themeColors
        ? themeColors[Math.max(0, Math.min(6, levelIndex))]
        : CORE.colorAt(info.levels, levelIndex >= 0 ? levelIndex : 0, colors)
      : undefined

    useEffect(
      function () {
        if (dark) document.body.setAttribute('data-ds-dark-theme', '')
        else document.body.removeAttribute('data-ds-dark-theme')
      },
      [dark]
    )

    useEffect(
      function () {
        if (!open) setPreviewEffort(null)
      },
      [open]
    )

    useEffect(
      function () {
        if (!open) return
        function onDown(e) {
          var target = e.target
          if (!target || !target.closest) return
          if (target.closest('.pv-slot') || target.closest('.pv-panel')) return
          setOpen(false)
        }
        document.addEventListener('pointerdown', onDown, true)
        return function () {
          document.removeEventListener('pointerdown', onDown, true)
        }
      },
      [open]
    )

    useEffect(
      function () {
        function onKey(e) {
          if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('keydown', onKey)
        return function () {
          document.removeEventListener('keydown', onKey)
        }
      },
      []
    )

    function pickModel(group, model) {
      setPreviewEffort(null)
      setSelection({
        provider: group.id,
        model: model.id,
        effort: model.defaultEffort
      })
      setOpen(false)
    }

    function commitEffort(id) {
      if (!info.levels.length) return
      setPreviewEffort(null)
      setSelection(function (prev) {
        if (prev.effort === id) return prev
        return { provider: prev.provider, model: prev.model, effort: id }
      })
    }

    function reset() {
      setMode('codex')
      setVisual('codex')
      setPaletteId('codex')
      setCustom(CORE.DEFAULT_CUSTOM.slice())
      setDark(false)
      setNarrow(false)
      setPane('effort')
      setPreviewEffort(null)
      setPreviewReset(function (n) {
        return n + 1
      })
      setOpen(true)
      setSelection({ provider: 'deepseek-account', model: 'deepseek-v4', effort: 'high' })
    }

    var composerVars = {
      '--dsh-composer-model-text-display': narrow ? 'none' : 'block',
      '--dsh-composer-model-icon-display': narrow ? 'block' : 'none'
    }

    var pickerGroups = groupsForPicker()

    var trigger =
      mode === 'official'
        ? h(OfficialTrigger, {
            open: open,
            modelName: info.model.name,
            effortName: effortName,
            onClick: function () {
              setOpen(!open)
            }
          })
        : h(UI.Trigger, {
            open: open,
            openPane: pane,
            modelName: info.model.name,
            effortName: effortEnglish,
            effortColor: effortColor,
            onModelClick: function () {
              openWith('model')
            },
            onEffortClick: function () {
              openWith('effort')
            }
          })

    var popup = null
    if (open) {
      popup =
        mode === 'official'
          ? h(OfficialMenu, {
              groups: pickerGroups,
              currentProvider: info.provider.id,
              currentModel: info.model.id,
              levels: info.levels,
              current: info.current,
              modelName: info.model.name,
              levelName: effortName,
              initialPane: explicitPane,
              onPickModel: pickModel,
              onPickEffort: function (id) {
                commitEffort(id)
                setOpen(false)
              }
            })
          : h(UI.Popup, {
              tone: tone,
              modelName: info.model.name,
              providerName: info.provider.name,
              groups: pickerGroups,
              currentProvider: info.provider.id,
              currentModel: info.model.id,
              levels: info.levels,
              current: info.current,
              colors: colors,
              fillColors: fillColors,
              visual: visual,
              initialPane: pane,
              pane: pane,
              onPaneChange: setPane,
              onPreviewLevel: setPreviewEffort,
              onCommit: commitEffort,
              onClose: function () {
                setOpen(false)
              },
              onPickModel: pickModel
            })
    }

    var visualName = 'Codex'
    for (var vi = 0; vi < CORE.VISUALS.length; vi++) {
      if (CORE.VISUALS[vi].id === visual) visualName = CORE.VISUALS[vi].name
    }
    var visualDesc = ''
    for (var vd = 0; vd < CORE.VISUALS.length; vd++) {
      if (CORE.VISUALS[vd].id === visual) visualDesc = CORE.VISUALS[vd].desc
    }

    return h(
      'div',
      { className: 'pv-page' },
      h(
        'div',
        { className: 'pv-stage' },
        h(
          'div',
          { className: 'pv-window', style: composerVars },
          h(
            'div',
            { className: 'pv-titlebar' },
            h(
              'div',
              { className: 'pv-dots' },
              h('span', { className: 'pv-dot pv-dot--r' }),
              h('span', { className: 'pv-dot pv-dot--y' }),
              h('span', { className: 'pv-dot pv-dot--g' })
            ),
            h('span', { className: 'pv-title' }, 'DeepSeek Harness'),
            h('div', { className: 'pv-titlebarRight' }, h('span', { className: 'pv-badge' }, 'UI 预览'))
          ),
          h(
            'div',
            { className: 'pv-main' },
            h(
              'div',
              { className: 'pv-chat' },
              h(
                'div',
                { className: 'pv-msg' },
                h('div', { className: 'pv-avatar' }, 'DS'),
                h(
                  'div',
                  { className: 'pv-bubble' },
                  h(
                    'div',
                    { className: 'pv-msgHead' },
                    h('span', { className: 'pv-msgName' }, 'DeepSeek'),
                    h('span', { className: 'pv-msgTime' }, '刚刚')
                  ),
                  h(
                    'div',
                    { className: 'pv-text' },
                    '预览页已就绪。这里模拟会话底部的模型座位，弹层向上展开；拖动滑杆即可切换推理强度。'
                  ),
                  h(
                    'div',
                    { className: 'pv-toolRow' },
                    h('span', { className: 'pv-dotLive' }),
                    'thinking-effort · preview'
                  )
                )
              ),
              h(
                'div',
                { className: 'pv-msg pv-msg--user' },
                h('div', { className: 'pv-avatar' }, '我'),
                h(
                  'div',
                  { className: 'pv-bubble' },
                  h(
                    'div',
                    { className: 'pv-msgHead' },
                    h('span', { className: 'pv-msgName' }, '你'),
                    h('span', { className: 'pv-msgTime' }, '刚刚')
                  ),
                  h('div', { className: 'pv-text' }, '先做 HTML 预览，看完再动插件。')
                )
              )
            ),
            h(
              'div',
              { className: 'pv-composerWrap' },
              h(
                'div',
                { className: 'pv-composer' },
                h(
                  'div',
                  { className: 'pv-inputRow' },
                  h('span', { className: 'pv-caret' }),
                  h('span', null, '描述你的任务…')
                ),
                h(
                  'div',
                  { className: 'pv-toolbar' },
                  h(
                    'div',
                    { className: 'pv-tools' },
                    h('button', { type: 'button', className: 'pv-toolBtn', tabIndex: -1 }, '+'),
                    h('button', { type: 'button', className: 'pv-toolBtn', tabIndex: -1 }, '@'),
                    h('button', { type: 'button', className: 'pv-toolBtn', tabIndex: -1 }, '/')
                  ),
                  h('div', { className: 'pv-slot' }, trigger, popup),
                  h('button', { type: 'button', className: 'pv-send', tabIndex: -1 }, '↑')
                )
              ),
              h('div', { className: 'pv-under' }, 'Enter 发送 · Shift+Enter 换行')
            )
          )
        )
      ),
      h(
        'aside',
        { className: 'pv-panel' },
        h('h1', { className: 'pv-h1' }, '思考等级 UI · 预览'),
        h(
          'p',
          { className: 'pv-sub' },
          '两种形态：官方原样 / Codex 滑杆。Codex 下可继续切换滑杆视觉与档位配色。'
        ),
        h(
          'div',
          { className: 'pv-banner' },
          '插件默认「官方」；右侧设置预览固定模型 DeepSeek-V4.1-Flash，只用于看样式，模型/等级不与会话联动。'
        ),
        h(
          'div',
          { className: 'pv-previewHead' },
          h('span', null, '实时预览'),
          h('em', null, mode === 'official' ? '官方' : 'Codex')
        ),
        h(SettingsPreview, {
          key: 'preview-' + previewReset,
          mode: mode,
          tone: tone,
          visual: visual,
          colors: colors,
          fillColors: fillColors
        }),
        h(
          'p',
          { className: 'pv-previewHint' },
          '预览模型固定为 DeepSeek-V4.1-Flash，不能换模型；Codex 只调推理强度，官方只选推理等级；不读取也不修改主会话的模型/等级。'
        ),
        h(
          'section',
          { className: 'pv-sec' },
          h(
            'div',
            { className: 'pv-label' },
            h('span', null, '形态'),
            h('em', null, mode === 'official' ? '完全交还 DSH' : '插件接管')
          ),
          h(Seg, {
            value: mode,
            onChange: setMode,
            options: [
              { id: 'official', name: '官方' },
              { id: 'codex', name: 'Codex 滑杆' }
            ]
          }),
          h(
            'p',
            { className: 'pv-hint' },
            mode === 'official'
              ? '官方模式不注册任何座位，模型、推理等级的显示与交互原样保留。'
              : '只替换模型座位：关闭态保留官方排版，展开后是 Codex 卡片。'
          )
        ),
        h(
          'section',
          { className: 'pv-sec' },
          h('div', { className: 'pv-label' }, h('span', null, '滑杆视觉'), h('em', null, visualName)),
          h('div', { className: cx(mode === 'official' && 'pv-disabled') }, [
            h(Seg, {
              key: 'seg',
              value: visual,
              onChange: setVisual,
              options: CORE.VISUALS.map(function (v) {
                return { id: v.id, name: v.name }
              }),
              disabled: mode === 'official'
            }),
            h('p', { key: 'hint', className: 'pv-hint' }, visualDesc)
          ])
        ),
        h(
          'section',
          {
            className: cx(
              'pv-sec',
              mode === 'official' && 'pv-disabled',
              (visual === 'whale' || visual === 'liang') && 'pv-hide'
            )
          },
          h('div', { className: 'pv-label' }, h('span', null, '档位配色'), h('em', null, CORE.PALETTES.length + ' 套 · 7 档')),
          h(
            'div',
            { className: 'pv-palette' },
            CORE.PALETTES.map(function (p) {
              var swatches = CORE.resolvePalette(p.id, custom, tone)
              return h(
                'button',
                {
                  key: p.id,
                  type: 'button',
                  className: 'pv-paletteBtn',
                  'data-active': paletteId === p.id ? 'true' : 'false',
                  onClick: function () {
                    setPaletteId(p.id)
                  }
                },
                h('span', { className: 'pv-paletteName' }, p.name),
                h(
                  'span',
                  { className: 'pv-swatches' },
                  swatches.map(function (c, i) {
                    return h('span', { key: i, className: 'pv-swatch', style: { background: c } })
                  })
                )
              )
            })
          ),
          h(
            'div',
            { className: 'pv-custom' },
            custom.map(function (c, i) {
              return h('input', {
                key: i,
                type: 'color',
                value: c,
                disabled: mode === 'official' || visual === 'whale' || visual === 'liang',
                title: '第 ' + (i + 1) + ' 档颜色',
                onChange: function (e) {
                  var next = custom.slice()
                  next[i] = e.target.value
                  setCustom(next)
                  setPaletteId('custom')
                }
              })
            })
          ),
          h('p', { className: 'pv-hint' }, '点击色块自定义；改动任一颜色即切换到自定义配色。')
        ),
        h(
          'section',
          { className: 'pv-sec' },
          h('div', { className: 'pv-label' }, h('span', null, '界面')),
          h(SwitchRow, {
            label: '深色界面',
            checked: dark,
            onChange: setDark
          }),
          h(SwitchRow, {
            label: '窄容器（长名只显示图标）',
            checked: narrow,
            onChange: setNarrow
          }),
          h(
            'p',
            { className: 'pv-hint' },
            '窄容器沿用官方变量：名字与档位文字隐藏，只保留图标，和官方行为一致。'
          )
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'pv-reset',
            onClick: reset
          },
          '重置预览'
        )
      )
    )
  }

  ReactDOMClient.createRoot(rootEl).render(h(App))
})()
