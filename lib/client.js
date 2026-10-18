/**
 * lib/client.js —— dsh-thinking-effort 浏览器半侧（设置页 + UI 挂载点）
 *
 * 无构建步骤：以 dsh.client bundle 形态装载，factory 内部手写 createElement。
 *
 * 通道（DESIGN.md §7A，2026-10-15 实机验收结论）：
 *   - Module Loader 包通道**没有** host.call、**没有** styles.insert；
 *     asar:732350 描述的符号面属于 cordis-client-runner 闭包通道，勿混淆。
 *   - Host 通信一律走同源 fetch：GET/POST '/dsh-thinking-effort/api'（契约见 §7C）。
 *   - 样式注入走 document.head.appendChild(style)；styles.insert 只留兼容探测，非主路径。
 *
 * 范围内（本卡片）：
 *   - 向 settings.section 槽注册一节「思考强度」设置页：
 *       总开关 / 接管模式（自动补写 · 仅浮层）/ 上游探测开关 / 立即扫描
 *       per-provider → per-model 档位编辑器（勾选档位、每档 wire 值、默认档只读展示）
 *       知识库规则只读展示 + 当前接管计划
 *   - 所有读写经 fetch 打到自己的 Host 半侧（lib/index.js 的 webServer 路由）
 *
 * 范围外（后续卡片）：
 *   - composer 触发器 chip、Codex 弹层、最大档星空动画
 *   - 本文件在下方保留 slots.inject('conversation.input.model') 的空挂载点与说明
 *
 * 约束（DESIGN.md §3/§4）：
 *   - 浏览器半拿不到 fetch / setTimeout / document 之外的浏览器全局（asar:732350）；
 *     定时器用 ctx.timeout / ctx.interval。
 *   - 样式只用 DSH 官方 token（--dsw-alias-*），零自定义外框。
 *   - defaultEffort 不是模型条目的可写字段（§7B R8：schema 只有 reasoningEfforts），
 *     写入一律只提交 { efforts }，defaultEffort 仅作解析后的只读派生值展示。
 */
window.__ModuleLoader__.load({
  id: 'dsh-thinking-effort',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement
    var useState = react.useState
    var useEffect = react.useEffect
    var useCallback = react.useCallback
    var useRef = react.useRef

    /* Host 半侧路由（DESIGN.md §7C）：同源相对路径，GET 读 / POST 写。 */
    var API = '/dsh-thinking-effort/api'

    var SET_CONFIG = 'setConfig'
    var SET_OVERRIDES = 'setOverrides'
    var RESCAN = 'rescan'
    var PROBE = 'probe'

    /* ── CSS（只用官方 token）──────────────────────────────────────────────── */
    var CSS = [
      '.__te_root{max-width:680px;display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.__te_group{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:11px}',
      '.__te_groupTitle{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.__te_field{display:flex;flex-direction:column;gap:5px}',
      '.__te_label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.__te_hint{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}',
      '.__te_row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.__te_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:13px;box-sizing:border-box;width:100%;outline:none}',
      '.__te_input:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.__te_inputMono{font-family:ui-monospace,Consolas,monospace;font-size:12px;letter-spacing:.06em}',
      '.__te_select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 8px;font:inherit;font-size:13px;min-width:170px}',
      '.__te_check{display:flex;align-items:flex-start;gap:8px;cursor:pointer}',
      '.__te_check input{margin-top:2px;accent-color:var(--dsw-alias-state-business-primary)}',
      '.__te_checkText{display:flex;flex-direction:column;gap:2px}',
      '.__te_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}',
      '.__te_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}',
      '.__te_btn:disabled{opacity:.5;cursor:default}',
      '.__te_btnPrimary{border-color:var(--dsw-alias-state-business-primary,#3964fe);background:var(--dsw-alias-state-business-primary,#3964fe);color:#fff}',
      '.__te_status{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.__te_err{font-size:12px;color:var(--dsw-alias-label-error-primary,#f85149)}',
      '.__te_planRow{display:flex;align-items:baseline;gap:8px;font-size:12px;flex-wrap:wrap}',
      '.__te_tag{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 6px}',
      '.__te_efforts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '.__te_effort{display:flex;align-items:center;gap:6px}',
      '.__te_effort input[type=text]{width:100%}',
      '.__te_rules{max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:4px}',
      '.__te_rule{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary)}'
    ].join('')

    /**
     * 样式注入：主路径是 document.head.appendChild(style)（§7A 实机验收：包通道没有
     * styles.insert）。styles.insert 仅作兼容分支，且只在 document 不可用时才探一次。
     */
    function injectStyles() {
      try {
        if (typeof document !== 'undefined' && document.head &&
            !document.querySelector('style[data-plugin-css="dsh-thinking-effort"]')) {
          var tag = document.createElement('style')
          tag.setAttribute('data-plugin-css', 'dsh-thinking-effort')
          tag.textContent = CSS
          document.head.appendChild(tag)
          return
        }
      } catch (err) { /* 落到兼容分支 */ }
      try {
        if (typeof styles !== 'undefined' && styles && typeof styles.insert === 'function') {
          styles.insert(CSS)
        }
      } catch (err) { /* 两条路都不通就跳过，页面照样可用 */ }
    }

    /* ── Host 通信：同源 fetch（§7A/§7C）───────────────────────────────────── */

    /** 把任意失败翻成一句能显示给人看的话。 */
    function errText(err) {
      if (!err) return '未知错误'
      if (typeof err === 'string') return err
      if (err.message) return String(err.message)
      return String(err)
    }

    /**
     * POST /dsh-thinking-effort/api，body {method,args}。
     * 契约：200 {ok:true,data} / 400 {ok:false,error}。
     * 网络异常、非 JSON 响应、{ok:false} 一律 reject 成带文案的 Error，
     * 由调用方的错误分支展示，绝不让设置页崩掉。
     */
    function call(method, args) {
      return new Promise(function (resolve, reject) {
        var body = JSON.stringify({ method: method, args: args === undefined ? null : args })
        fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body
        }).then(function (res) {
          return res.json().then(function (payload) { return { res: res, payload: payload } }, function () {
            return { res: res, payload: null }
          })
        }, function (err) {
          // 网络层异常：端点没注册 / 连接被拒 / 被中断
          reject(new Error('无法连接 Host 端点 ' + API + '：' + errText(err)))
        }).then(function (r) {
          if (!r) return
          if (!r.payload || typeof r.payload !== 'object') {
            reject(new Error('Host 响应不是合法 JSON（HTTP ' + r.res.status + '）'))
            return
          }
          if (r.payload.ok === false) {
            reject(new Error(String(r.payload.error || ('Host 拒绝了 ' + method + '（HTTP ' + r.res.status + '）'))))
            return
          }
          // 非 2xx 但带了 ok:true 也当失败处理，避免把错误当数据渲染
          if (r.res.status < 200 || r.res.status >= 300) {
            reject(new Error('Host 返回 HTTP ' + r.res.status))
            return
          }
          resolve(r.payload.data === undefined ? null : r.payload.data)
        })
      })
    }

    /**
     * GET /dsh-thinking-effort/api：契约 200 {ok:true, ...getState()}。
     * 快照字段直接摊在顶层（与 POST 的 {ok:true,data} 形状不同），此处拆掉 ok 壳。
     */
    function fetchState() {
      return new Promise(function (resolve, reject) {
        fetch(API, { method: 'GET' }).then(function (res) {
          return res.json().then(function (payload) { return { res: res, payload: payload } }, function () {
            return { res: res, payload: null }
          })
        }, function (err) {
          reject(new Error('无法连接 Host 端点 ' + API + '：' + errText(err)))
        }).then(function (r) {
          if (!r) return
          if (!r.payload || typeof r.payload !== 'object') {
            reject(new Error('Host 响应不是合法 JSON（HTTP ' + r.res.status + '）'))
            return
          }
          if (r.payload.ok === false) {
            reject(new Error(String(r.payload.error || ('读取状态失败（HTTP ' + r.res.status + '）'))))
            return
          }
          if (r.res.status < 200 || r.res.status >= 300) {
            reject(new Error('Host 返回 HTTP ' + r.res.status))
            return
          }
          var snap = {}
          for (var k in r.payload) {
            if (!Object.prototype.hasOwnProperty.call(r.payload, k)) continue
            if (k === 'ok') continue
            snap[k] = r.payload[k]
          }
          resolve(snap)
        })
      })
    }

    /* ── 档位编辑器（受控草稿：<provider>/<modelId> → efforts）─────────────── */
    function EffortEditor(props) {
      var route = props.route
      var modelId = props.modelId
      var efforts = props.efforts || {}
      var defaultEffort = props.defaultEffort || ''
      var levels = props.levels
      var onChange = props.onChange

      function toggle(level) {
        var next = {}
        for (var i = 0; i < levels.length; i += 1) {
          var k = levels[i]
          if (!(k in efforts)) continue
          next[k] = efforts[k]
        }
        if (level in next) delete next[level]
        else next[level] = level === 'off' ? null : level
        var keys = levels.filter(function (k) { return k in next })
        if (!keys.length) {
          // 至少留一档，否则官方校验直接报错
          next[level] = level === 'off' ? null : level
        }
        // 只提交 efforts：defaultEffort 是解析后派生字段，写进配置无效（§7B R8）
        onChange({ efforts: next })
      }

      function setWire(level, value) {
        var next = {}
        for (var k in efforts) if (Object.prototype.hasOwnProperty.call(efforts, k)) next[k] = efforts[k]
        var trimmed = String(value == null ? '' : value).trim()
        // 空字符串 wire 会触发 PiAiCatalogError；off 档留空即表示 null（不下发）
        next[level] = trimmed ? trimmed : null
        onChange({ efforts: next })
      }

      var active = levels.filter(function (k) { return k in efforts })

      return h('div', { className: '__te_field' },
        h('div', { className: '__te_row' },
          h('span', { className: '__te_label', style: { flex: '0 0 auto' } }, route + '/' + modelId),
          // 「默认档位」只读展示：模型条目 schema 没有 defaultEffort 字段（asar:860404/860411），
          // 它由官方 reasoningInfo() 从 profile.reasoning 推导（asar:861136），不由插件写入。
          h('span', { className: '__te_status' },
            '默认档位：' + (active.indexOf(defaultEffort) >= 0 ? defaultEffort : (active[0] || '—')) + '（由官方推导，只读）'),
          h('button', {
            className: '__te_btn',
            onClick: function () { onChange({ efforts: null }) },
            title: '删除这条覆盖，交回知识库/默认值'
          }, '清除覆盖')
        ),
        h('div', { className: '__te_efforts' }, levels.map(function (level) {
          var on = level in efforts
          var wire = on && efforts[level] !== null ? efforts[level] : ''
          return h('label', { key: level, className: '__te_effort' },
            h('input', {
              type: 'checkbox',
              checked: on,
              onChange: function () { toggle(level) }
            }),
            h('span', { className: '__te_label', style: { flex: '0 0 58px' } }, level),
            h('input', {
              type: 'text',
              className: '__te_input __te_inputMono',
              value: wire,
              placeholder: level === 'off' ? '留空 = 不下发' : 'wire 值',
              disabled: !on,
              onChange: function (e) { setWire(level, e.target.value) }
            })
          )
        })),
        h('div', { className: '__te_hint' },
          '勾选决定支持哪些档位；wire 值是真正发给厂商的字符串。off 档留空表示不下发 effort（强制思考模型默认行为）。')
      )
    }

    /* ── 设置页 ───────────────────────────────────────────────────────────── */
    function ThinkingEffortPanel() {
      // React hooks 直接使用：浏览器半拿到的是完整 React，无需防御式降级
      // （降级写法会破坏 hooks 调用顺序，比缺 React 更糟）。
      var state = useState(null)
      var snapshot = state[0]
      var setSnapshot = state[1]

      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]

      var msgState = useState(null)
      var message = msgState[0]
      var setMessage = msgState[1]

      var refresh = useCallback(function () {
        setBusy(true)
        return fetchState().then(function (data) {
          setSnapshot(data || null)
          setBusy(false)
        }, function (err) {
          setMessage({ kind: 'error', text: errText(err) })
          setBusy(false)
        })
      }, [])

      useEffect(function () {
        void refresh()
      }, [refresh])

      function patchConfig(patch, note) {
        setBusy(true)
        return call(SET_CONFIG, patch).then(function (data) {
          setSnapshot(function (prev) {
            var base = prev || {}
            // Host 返回 {config, overrides} 增量；缺字段时保留原快照
            return Object.assign({}, base, data || {})
          })
          setMessage({ kind: 'ok', text: note || '已保存。' })
          setBusy(false)
        }, function (err) {
          setMessage({ kind: 'error', text: errText(err) })
          setBusy(false)
        })
      }

      /** 覆盖表草稿：直接取快照，避免每次按键都重建对象导致输入框失焦。 */
      var draft = (snapshot && snapshot.overrides) || {}

      /** 待接管模型列表：Host 半侧算好的计划，页面只渲染不改写。 */
      var models = (snapshot && snapshot.planned) || []

      var levels = (snapshot && snapshot.levels) || []
      var config = (snapshot && snapshot.config) || {}

      function writeOverride(key, value) {
        var next = {}
        for (var k in draft) if (Object.prototype.hasOwnProperty.call(draft, k)) next[k] = draft[k]
        if (value === null) delete next[key]
        else next[key] = value
        setBusy(true)
        call(SET_OVERRIDES, { overrides: next }).then(function (data) {
          setSnapshot(function (prev) {
            return Object.assign({}, prev || {}, data || {})
          })
          setMessage({ kind: 'ok', text: value === null ? '已清除该模型的覆盖。' : '已写入覆盖（优先级最高）。' })
          setBusy(false)
          void refresh()
        }, function (err) {
          setMessage({ kind: 'error', text: errText(err) })
          setBusy(false)
        })
      }

      /** 「立即扫描」：让 Host 半侧重跑一轮接管，随后刷新面板。 */
      function rescan() {
        setBusy(true)
        return call(RESCAN, null).then(function (data) {
          setMessage({
            kind: 'ok',
            text: data && data.result && data.result.skipped
              ? '扫描完成（' + data.result.skipped + '）。'
              : '扫描完成。'
          })
          setBusy(false)
          return refresh()
        }, function (err) {
          setMessage({ kind: 'error', text: errText(err) })
          setBusy(false)
        })
      }

      function runProbe() {
        setBusy(true)
        call(PROBE, null).then(function (data) {
          setMessage({ kind: 'ok', text: (data && data.reason) || '探测完成。' })
          setBusy(false)
        }, function (err) {
          setMessage({ kind: 'error', text: errText(err) })
          setBusy(false)
        })
      }

      if (!snapshot) {
        return h('div', { className: '__te_root' },
          h('div', { className: '__te_status' }, busy ? '正在读取配置…' : '暂无数据'),
          message ? h('div', { className: '__te_err' }, message.text) : null)
      }

      return h('div', { className: '__te_root' },
        /* 总开关 / 接管模式 */
        h('section', { className: '__te_group' },
          h('div', { className: '__te_groupTitle' }, '接管'),
          h('label', { className: '__te_check' },
            h('input', {
              type: 'checkbox',
              checked: !!config.enabled,
              disabled: busy,
              onChange: function (e) { void patchConfig({ enabled: e.target.checked }, '总开关已更新。') }
            }),
            h('div', { className: '__te_checkText' },
              h('span', { className: '__te_label' }, '启用思考强度接管'),
              h('span', { className: '__te_hint' }, '关闭后插件不再扫描也不改写任何模型配置。')
            )
          ),
          h('div', { className: '__te_field' },
            h('span', { className: '__te_label' }, '接管模式'),
            h('div', { className: '__te_row' },
              h('select', {
                className: '__te_select',
                value: config.mode === 'overlay' ? 'overlay' : 'auto',
                disabled: busy,
                onChange: function (e) {
                  void patchConfig({ mode: e.target.value }, e.target.value === 'overlay'
                    ? '已切到「仅浮层」：不再改写 settings。'
                    : '已切到「自动补写」。')
                }
              },
              h('option', { value: 'auto' }, '自动补写（写 reasoningEfforts）'),
              h('option', { value: 'overlay' }, '仅浮层（不改配置）')),
              h('button', {
                className: '__te_btn __te_btnPrimary',
                disabled: busy,
                onClick: function () { void rescan() }
              }, '立即扫描'),
              h('button', { className: '__te_btn', disabled: busy, onClick: runProbe }, '探测所选模型')
            ),
            h('div', { className: '__te_hint' },
              '自动补写 = 为缺失档位的推理模型写入 reasoningEfforts，写入后官方模型选择器立即出现档位选择，无需重启。')
          ),
          h('label', { className: '__te_check' },
            h('input', {
              type: 'checkbox',
              checked: !!config.probe,
              disabled: busy,
              onChange: function (e) { void patchConfig({ probe: e.target.checked }, '探测开关已更新。') }
            }),
            h('div', { className: '__te_checkText' },
              h('span', { className: '__te_label' }, '上游探测'),
              h('span', { className: '__te_hint' }, '默认关闭。开启后只做模型清单+可达性探测，不参与档位判定；结果仍低于手动覆盖。')
            )
          ),
          snapshot.available
            ? null
            : h('div', { className: '__te_hint' }, '⚠ 当前 profile 没有可用的 settings 服务，自动接管未启用。')
        ),

        /* per-provider → per-model 档位编辑器 */
        h('section', { className: '__te_group' },
          h('div', { className: '__te_groupTitle' }, '档位编辑'),
          h('div', { className: '__te_hint' },
            '下面列出将要被接管的模型。修改即写入手动覆盖表，优先级高于知识库与探测。'),
          models.length
            ? h('div', { className: '__te_field' }, models.map(function (m) {
                var key = m.route + '/' + m.modelId
                var current = draft[key]
                return h('div', { key: key, className: '__te_field', style: { marginBottom: '10px' } },
                  h('div', { className: '__te_planRow' },
                    h('span', { className: '__te_tag' }, m.source || 'auto'),
                    h('span', { className: '__te_status' },
                      key + ' → ' + Object.keys(m.efforts || {}).join('/') +
                      (m.defaultEffort ? '（默认 ' + m.defaultEffort + '）' : ''))
                  ),
                  h(EffortEditor, {
                    route: m.route,
                    modelId: m.modelId,
                    levels: levels,
                    efforts: current ? current.efforts : m.efforts,
                    // 只读展示：取 Host 解析后的派生值，覆盖表里不再存 defaultEffort
                    defaultEffort: m.defaultEffort || '',
                    onChange: function (next) {
                      if (!next.efforts) {
                        writeOverride(key, null)
                        return
                      }
                      // 只提交 efforts（§7B R8：defaultEffort 不可写进模型条目）
                      writeOverride(key, { efforts: next.efforts })
                    }
                  })
                )
              }))
            : h('div', { className: '__te_status' }, '没有待接管的模型。')
        ),

        /* 知识库规则只读展示 */
        h('section', { className: '__te_group' },
          h('div', { className: '__te_groupTitle' }, '内置知识库'),
          h('div', { className: '__te_hint' }, '按厂商 + 模型名模糊匹配；命中即用，不做网络请求。'),
          h('div', { className: '__te_rules' }, ((snapshot.rules) || []).map(function (r) {
            return h('div', { key: r.id, className: '__te_rule' },
              r.id + ' · ' + Object.keys(r.efforts || {}).map(function (k) {
                return k + '=' + (r.efforts[k] === null ? 'null' : r.efforts[k])
              }).join(' '))
          }))
        ),

        message
          ? h('div', { className: message.kind === 'error' ? '__te_err' : '__te_status' }, message.text)
          : null,
        h('div', { className: '__te_status' }, '配置文件：' + (snapshot.configFile || '~/.dsh/thinking-effort.json'))
      )
    }

    /* ── Codex 风格浮层（顶替官方 conversation.input.model chip）─────────────
     * 逐条复刻官方 ModelSelect.module.css（asar:435342，class 前缀 wq12jW_），
     * 本插件 class 一律加 teff- 前缀；token 引用保持官方原样并带回落值。
     * 禁止 require('@deepseek-ai/dsh-client-ui-primitives')（asar:292610），
     * rankByName / check 图标 / spinner 自实现。
     */
    var OVERLAY_CSS = [
      '.teff-root{min-width:0;position:relative}',
      '.teff-trigger{border-radius:var(--dsw-radius-sm,6px);min-width:0;width:max-content;max-width:min(460px,62cqw);height:28px;color:var(--dsw-alias-label-secondary,#8a8f98);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}',
      '.teff-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
      '.teff-trigger:focus-visible:not([data-selection-focus]){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe))}',
      '.teff-trigger:disabled{color:var(--dsw-alias-label-dimmed,#5a5f68)}',
      '.teff-triggerLabel{white-space:nowrap;text-overflow:ellipsis;overflow:hidden;min-width:0;flex:0 1 auto}',
      // 档位永不省略：flex:none 保证「模型名 · off」里的 off 一定看得见
      '.teff-triggerEffort{white-space:nowrap;color:var(--dsw-alias-label-caption,#9aa0a8);flex:none}',
      '.teff-triggerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}',
      '.teff-triggerLabel,.teff-triggerEffort{display:var(--dsh-composer-model-text-display,block)}',
      // 必须显式给尺寸：svg 无 width/height 时在部分内核里会撑满父级（曾出现「巨大箭头」）
      '.teff-chevron{width:14px;height:14px;color:var(--dsw-alias-label-caption,#9aa0a8);flex:none;transition:transform .12s}',
      '.teff-chevronOpen{transform:rotate(180deg)}',
      '.teff-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-label-caption,#9aa0a8);border-top-color:transparent;flex:none;animation:teff-spin .8s linear infinite}',
      '@keyframes teff-spin{to{transform:rotate(360deg)}}',
      '.teff-menu{z-index:1100;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,rgba(0,0,0,.12));width:max-content;min-width:min(240px,calc(100vw - 32px));max-width:min(420px,calc(100vw - 32px));max-height:min(360px,calc(100vh - 96px));box-shadow:var(--dsw-elevation-prominent,0 8px 32px rgba(0,0,0,.24));--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,rgba(128,128,128,.3));--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,rgba(128,128,128,.5));border:0;flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden;background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-1,#1c1d21));backdrop-filter:var(--dsw-menu-backdrop-filter,none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,none);border-radius:var(--dsw-radius-lg,12px);color:var(--dsw-alias-label-primary,#e8eaed)}',
      '.teff-status,.teff-empty{color:var(--dsw-alias-label-tertiary,#8a8f98);padding:8px;font-size:12px;line-height:18px}',
      '.teff-error{border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(248,81,73,.15));color:var(--dsw-alias-state-error-primary,#f85149);justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px;display:flex}',
      '.teff-warning{background:var(--dsw-alias-bg-module-platform,rgba(247,178,51,.12));color:var(--dsw-alias-state-warn-label,#e3b341)}',
      '.teff-retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}',
      '.teff-searchRow{flex-shrink:0;margin:2px 0 3px;position:relative}',
      '.teff-search{border-radius:var(--dsw-radius-md,10px);background:0 0;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border:0 solid #0000;height:auto;padding:5px 7px;display:flex;outline:none;width:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary,#e8eaed);font-size:12px;line-height:normal}',
      '.teff-searchWithQuery{padding-right:34px}',
      '.teff-search:focus-within{border-color:#0000}',
      '.teff-search::placeholder{color:var(--dsw-alias-label-caption,#9aa0a8)}',
      '.teff-searchClear{width:24px;height:24px;color:var(--dsw-alias-label-secondary,#8a8f98);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;position:absolute;top:50%;right:4px;transform:translateY(-50%);cursor:pointer;background:0 0;border:none;flex:none}',
      // 滚动骨架（用户 m05519「模型选择应该像官方一样可以滑动选择」）：
      // .teff-menu 是 flex column + overflow:hidden 的定型盒；它和滚动区之间必须有一个
      // 链路完整的 flex 子项（官方对应 .scrollable/.viewport），否则中间 div 因 min-height:auto
      // 撑满内容高度、.teff-groups 的 min-height:0 失去参照 → overflow-y:auto 永不激活，
      // 列表被 max-height:min(360px,…) 一刀切且没有滚动条。
      '.teff-viewport{display:flex;flex-direction:column;min-height:0;flex:1 1 auto}',
      '.teff-groups{min-height:0;overflow-y:auto;flex:1 1 auto}',
      // 分组标题吸顶（对齐官方 asar:446157-446193）：CSS 只负责 sticky 定位，
      // 底色由 data-stuck 驱动——原位保持透明，只有被顶住时才铺 94% 不透明的分组标题填充。
      '.teff-group{position:relative}',
      '.teff-groupStart{position:absolute;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none}',
      '.teff-groupLabel{position:sticky;top:0;z-index:1;padding:6px 7px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a8f98);background:0 0}',
      '.teff-groupLabel[data-stuck]{background:var(--dsw-alias-menu-group-header-fill,var(--dsw-alias-bg-layer-1,#1c1d21))}',
      '.teff-option{box-sizing:border-box;border-radius:var(--dsw-radius-md,10px);min-width:100%;min-height:34px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex;font:inherit}',
      '.teff-option:not(.teff-modelOption):hover:not(:disabled),.teff-option:focus-visible,.teff-optionActive:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
      '.teff-selected{background:0 0}',
      '.teff-option:disabled{color:var(--dsw-alias-label-dimmed,#5a5f68);cursor:default}',
      '.teff-optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}',
      '.teff-modelName{white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:13px;font-weight:400;line-height:18px}',
      '.teff-check{color:var(--dsw-alias-label-primary,#e8eaed);flex:0 0 14px;place-items:center;display:grid}',
      '.teff-check svg{width:14px;height:14px}',
      '.teff-checkDot{width:10px;height:10px;border-radius:50%;border:2px solid var(--dsw-alias-label-caption,#9aa0a8);border-top-color:transparent;animation:teff-spin .8s linear infinite}',
      '.teff-cell{box-sizing:border-box;border-radius:var(--dsw-radius-md,10px);height:34px;color:var(--dsw-alias-label-primary,#e8eaed);text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex;width:100%;font-family:inherit}',
      '.teff-cell:hover:not(:disabled),.teff-cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
      '.teff-cellLabel{white-space:nowrap;flex:none}',
      '.teff-cellValue{white-space:nowrap;text-overflow:ellipsis;overflow:hidden;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary,#8a8f98);flex:auto}',
      '.teff-cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon,#8a8f98);flex:none}',
      '.teff-cells{display:flex;flex-direction:column;gap:2px;padding:4px;min-width:min(240px,100vw - 32px)}',
      /* ── Codex 风格档位弹层（居中档位名 + 胶囊滑杆；对齐 DESIGN.md §0.3）──── */
      '.teff-menu--popup{min-width:min(260px,calc(100vw - 24px));max-width:min(340px,calc(100vw - 24px))}',
      '.teff-popup{display:flex;flex-direction:column;padding:8px 12px 10px;box-sizing:border-box;font-family:var(--dsw-font-family,system-ui,sans-serif);user-select:none}',
      '.teff-popup__bar{display:flex;align-items:center;justify-content:space-between;height:24px;flex:none}',
      '.teff-popup__iconbtn{width:24px;height:24px;display:grid;place-items:center;border:none;background:0 0;cursor:pointer;padding:0;border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-secondary,#8a8f98);flex:none;transition:background-color .12s,color .12s}',
      '.teff-popup__iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
      '.teff-popup__iconbtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe));outline-offset:1px}',
      '.teff-popup__iconbtn:disabled{color:var(--dsw-alias-label-dimmed,#5a5f68);cursor:default}',
      '.teff-popup__iconbtn svg{width:18px;height:18px}',
      // 闪电 = 思考开关（用户 m03904）：开启 = 蓝填充 + 淡蓝底（明显是按下的开关）；关闭 = 空心、无底色。
      // 关闭态必须看得见：描边加粗到 1.75px 且用 label-secondary，不再是白底上的灰点。
      '.teff-popup__iconbtn--flash svg{stroke:var(--dsw-alias-label-secondary,#8a8f98);stroke-width:1.75;fill:none}',
      '.teff-popup__iconbtn--flash[aria-pressed="true"]{color:var(--dsw-alias-state-business-primary,#3964fe);background:var(--dsw-alias-interactive-bg-active,rgba(57,100,254,.14))}',
      '.teff-popup__iconbtn--flash[aria-pressed="true"] svg{stroke:currentColor}',
      '.teff-popup__iconbtn--flash[aria-pressed="true"] svg path{fill:currentColor}',
      // 读法 A（用户 m02779 裁决）：大字行 = 模型名（面板最大字但不撑爆面板）；下方小字行 = 当前思考强度
      '.teff-popup__model{margin-top:4px;width:100%;text-align:center;font-size:16px;font-weight:600;line-height:22px;letter-spacing:.01em;color:var(--dsw-alias-label-primary,#e8eaed);background:0 0;border:none;cursor:pointer;font-family:inherit;padding:2px 6px;border-radius:var(--dsw-radius-sm,6px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}',
      '.teff-popup__level{margin-top:1px;text-align:center;font-size:12px;line-height:16px;letter-spacing:.04em;color:var(--dsw-alias-label-caption,#9aa0a8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}',
      '.teff-popup__model:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));color:var(--dsw-alias-label-secondary,#8a8f98)}',
      '.teff-popup__model:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe));outline-offset:1px}',
      '.teff-popup__model:disabled{color:var(--dsw-alias-label-dimmed,#5a5f68);cursor:default}',
      '.teff-slider{position:relative;height:32px;margin:10px 0 2px;touch-action:none;cursor:pointer;flex:none}',
      '.teff-slider:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3964fe));outline-offset:4px;border-radius:999px}',
      '.teff-slider--disabled{cursor:default;opacity:.5}',
      // 轨道与滑块共几何：两侧内缩 SLIDER_INSET(=16px，半个滑块)，滑块直径 = 轨道高 = 32px
      '.teff-slider__rail{position:absolute;left:16px;right:16px;top:0;bottom:0;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-3,#2a2c33);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));box-sizing:border-box}',
      '.teff-slider__fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;background:linear-gradient(90deg,#2f6bff 0%,#6a5cff var(--teff-purple-stop,30%),#a855f7 100%);transition:width .16s cubic-bezier(.2,.8,.2,1);will-change:width}',
      '.teff-slider__fill--lit{box-shadow:0 0 10px rgba(168,85,247,var(--teff-glow,.0))}',
      '.teff-slider__thumb{position:absolute;top:50%;width:32px;height:32px;border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));box-shadow:0 2px 6px rgba(0,0,0,.3);transform:translate(-50%,-50%);transition:left .16s cubic-bezier(.2,.8,.2,1);pointer-events:none}',
      '.teff-slider__ticks{position:absolute;left:0;right:0;top:50%;height:0;pointer-events:none}',
      '.teff-slider__tick{position:absolute;top:0;width:2px;height:6px;border-radius:1px;background:rgba(255,255,255,.5);transform:translate(-50%,-50%)}',
      '.teff-slider__labels{position:relative;height:14px;margin-top:6px;font-size:11px;line-height:14px;color:var(--dsw-alias-label-caption,#9aa0a8);flex:none}',
      // 标签与刻度共用 left 锚点，必须同样左移半宽居中，否则文字中心偏离刻度（用户 m04522「字对不上挡位」）
      '.teff-slider__label{position:absolute;top:0;max-width:44%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform:translateX(-50%)}',
      '.teff-slider__label--active{color:var(--dsw-alias-label-primary,#e8eaed);font-weight:600}',
      // 星空粒子：3 层，档位越高「出现的层越多 + 越亮」（200% 宽 + background-size 50% 100% 保证无缝循环）
      '.teff-slider__stars{position:absolute;inset:0;pointer-events:none}',
      '.teff-star{position:absolute;top:0;bottom:0;left:0;width:200%;background-repeat:repeat;background-size:50% 100%;will-change:transform;animation-play-state:paused}',
      '.teff-star--a{background-image:radial-gradient(1.5px 1.5px at 12% 28%,rgba(255,255,255,.95),transparent),radial-gradient(1px 1px at 44% 72%,rgba(255,255,255,.8),transparent),radial-gradient(1.2px 1.2px at 71% 22%,rgba(255,255,255,.9),transparent),radial-gradient(1px 1px at 88% 64%,rgba(255,255,255,.7),transparent),radial-gradient(1.3px 1.3px at 27% 86%,rgba(255,255,255,.85),transparent),radial-gradient(1px 1px at 59% 48%,rgba(255,255,255,.75),transparent);animation:teff-drift 16s linear infinite}',
      '.teff-star--b{background-image:radial-gradient(2px 2px at 18% 62%,rgba(214,196,255,.95),transparent),radial-gradient(1.4px 1.4px at 37% 18%,rgba(255,255,255,.9),transparent),radial-gradient(1.8px 1.8px at 62% 80%,rgba(200,180,255,.9),transparent),radial-gradient(1.4px 1.4px at 79% 38%,rgba(255,255,255,.85),transparent),radial-gradient(2px 2px at 93% 70%,rgba(214,196,255,.9),transparent),radial-gradient(1.3px 1.3px at 8% 12%,rgba(255,255,255,.8),transparent),radial-gradient(1.6px 1.6px at 51% 33%,rgba(255,255,255,.85),transparent);animation:teff-drift-rev 13s linear infinite}',
      '.teff-star--c{background-image:radial-gradient(2.6px 2.6px at 23% 44%,rgba(216,180,254,1),transparent),radial-gradient(2px 2px at 55% 76%,rgba(255,255,255,.95),transparent),radial-gradient(2.4px 2.4px at 83% 30%,rgba(192,132,252,1),transparent),radial-gradient(2px 2px at 34% 14%,rgba(255,255,255,.9),transparent),radial-gradient(2.2px 2.2px at 68% 58%,rgba(216,180,254,.95),transparent),radial-gradient(2px 2px at 12% 82%,rgba(255,255,255,.9),transparent),radial-gradient(2.4px 2.4px at 91% 88%,rgba(192,132,252,.95),transparent),radial-gradient(1.8px 1.8px at 46% 52%,rgba(255,255,255,.9),transparent);animation:teff-drift 9s linear infinite,teff-twinkle 2.6s ease-in-out infinite}',
      '.teff-popup--open .teff-star{animation-play-state:running}',
      '@keyframes teff-drift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-50%,0,0)}}',
      '@keyframes teff-drift-rev{from{transform:translate3d(-50%,0,0)}to{transform:translate3d(0,0,0)}}',
      '@keyframes teff-twinkle{0%,100%{opacity:.45}50%{opacity:1}}',
      '@keyframes teff-hint-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',
      // 额度提示（仅该模型最高可用档）
      '.teff-hint{display:flex;align-items:center;justify-content:center;gap:5px;margin-top:8px;font-size:11px;line-height:15px;color:var(--dsw-alias-state-warn-label,#f0b429);animation:teff-hint-in .28s ease-out both}',
      '.teff-hint__icon{font-size:12px;line-height:1}',
      // 减弱动态效果：静态渐变，无漂移、无闪烁
      '@media (prefers-reduced-motion:reduce){.teff-star{animation:none!important}.teff-slider__fill{transition:none}.teff-slider__thumb{transition:none}.teff-hint{animation:none}}',
      '.teff-toast{position:fixed;z-index:1200;background:var(--dsw-alias-bg-layer-2,#25272c);color:var(--dsw-alias-label-primary,#e8eaed);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.2));border-radius:var(--dsw-radius-md,10px);box-shadow:var(--dsw-elevation-prominent,0 8px 32px rgba(0,0,0,.24));padding:8px 12px;font-size:12px;line-height:18px;max-width:320px;display:flex;align-items:center;gap:6px}'
    ].join('')

    function injectOverlayStyles() {
      if (typeof document === 'undefined' || !document.head) return null
      if (document.querySelector('style[data-plugin-css="dsh-thinking-effort-overlay"]')) return null
      var tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', 'dsh-thinking-effort-overlay')
      tag.textContent = OVERLAY_CSS
      document.head.appendChild(tag)
      return tag
    }

    /* ── 浮层纯函数（导出给 smoke 测试断言，不碰 DOM）────────────────────────── */

    /** 官方 orderModelProviders（asar:435390-435392）：account → official → 其余保持相对顺序。 */
    function orderModelProviders(groups) {
      return groups.slice().sort(function (l, r) {
        var rank = function (g) { return g.id === 'deepseek-account' ? 0 : g.id === 'deepseek-official' ? 1 : 2 }
        return rank(l) - rank(r)
      })
    }

    /** 名称起点与 -/_ 分隔边界额外加权（官方 boundaryBonus，asar:455621）。 */
    function boundaryBonus(name, index) {
      return index === 0 || name.charAt(index - 1) === '-' || name.charAt(index - 1) === '_' ? 8 : 0
    }

    /**
     * 有序子序列最强对齐打分（官方 alignmentScore，asar:455629）。
     * 边界/相邻命中加权，跳字符与前置字符扣权；query 非子序列时返回 undefined。
     */
    function alignmentScore(name, query) {
      if (query.length > name.length) return undefined
      var noMatch = Number.NEGATIVE_INFINITY
      var previous = []
      for (var p = 0; p < name.length; p += 1) previous.push(noMatch)
      for (var first = 0; first < name.length; first += 1) {
        if (name.charAt(first) === query.charAt(0)) {
          previous[first] = 1 + boundaryBonus(name, first) - first
        }
      }
      for (var qi = 1; qi < query.length; qi += 1) {
        var current = []
        for (var z = 0; z < name.length; z += 1) current.push(noMatch)
        var left = noMatch
        var leftLeft = noMatch
        var bestGapped = noMatch
        for (var index = 0; index < name.length; index += 1) {
          var prior = previous[index]
          if (leftLeft !== noMatch) bestGapped = Math.max(bestGapped, leftLeft + index - 2)
          if (name.charAt(index) === query.charAt(qi)) {
            var bonus = 1 + boundaryBonus(name, index)
            var score = noMatch
            if (left !== noMatch) score = left + bonus + 4
            if (bestGapped !== noMatch) score = Math.max(score, bestGapped + bonus + 1 - index)
            current[index] = score
          }
          leftLeft = left
          left = prior
        }
        previous = current
      }
      var best = noMatch
      for (var s = 0; s < previous.length; s += 1) {
        if (previous[s] > best) best = previous[s]
      }
      return best === noMatch ? undefined : best
    }

    /**
     * 大小写不敏感有序子序列匹配；排序 = 前缀 > 对齐分 > catalog 顺序
     * （逐字照官方 rankByName，asar:455666；label 作为第二检索键）。
     */
    function rankByName(items, rawQuery) {
      var query = String(rawQuery == null ? '' : rawQuery).toLowerCase()
      if (query === '') return items.slice()
      var ranked = []
      for (var i = 0; i < items.length; i += 1) {
        var item = items[i]
        var keys = item.label === undefined ? [item.name] : [item.name, item.label]
        var prefix = false
        // 必须显式赋 undefined：var 是函数作用域，不初始化会沿用上一轮的 score。
        var score = undefined
        for (var k = 0; k < keys.length; k += 1) {
          var key = String(keys[k] == null ? '' : keys[k])
          var lower = key.toLowerCase()
          var keyScore = alignmentScore(lower, query)
          if (keyScore === undefined) continue
          prefix = prefix || lower.indexOf(query) === 0
          score = score === undefined ? keyScore : Math.max(score, keyScore)
        }
        if (score !== undefined) ranked.push({ item: item, index: i, prefix: prefix, score: score })
      }
      ranked.sort(function (l, r) {
        return (Number(r.prefix) - Number(l.prefix)) || (r.score - l.score) || (l.index - r.index)
      })
      return ranked.map(function (m) { return m.item })
    }

    /**
     * 弹层数据计算（逐字照官方 asar:435478-435489 + 用户裁决）。
     * 铁律：不假设七档，完全按 reasoning.efforts 渲染；
     * reasoning === undefined → 档位区不显示（effortChoices=[]）。
     *
     * 用户裁决（m02779）：provider-default 节点**常驻**滑杆最左端，标签由 Default 改名为 off。
     * 语义：选中它 = 不向 selectModel 传 reasoningEffort 键 = 交给 provider 默认值。
     */
    function computeMenuData(currentChoice, current, retainedEffort) {
      var reasoning = currentChoice ? currentChoice.model.reasoning : undefined
      var effectiveEffort = (current && current.reasoningEffort !== undefined)
        ? current.reasoningEffort
        : (reasoning ? reasoning.defaultEffort : undefined)
      var effortLabel
      if (reasoning === undefined) {
        effortLabel = retainedEffort
      } else if (effectiveEffort === undefined || effectiveEffort === 'off') {
        // 关闭思考：官方 off 档与 provider-default 在触发条上统一显示为 off（用户裁决 m02779）
        effortLabel = 'off'
      } else {
        var level = null
        for (var i = 0; i < reasoning.efforts.length; i += 1) {
          if (reasoning.efforts[i].id === effectiveEffort) { level = reasoning.efforts[i]; break }
        }
        effortLabel = (level && level.name) || effectiveEffort
      }
      var effortChoices = []
      if (reasoning !== undefined) {
        // 常驻 off 节点（用户裁决 m02779）：模型自己声明了 off 档就用它；否则最左端补一个
        // provider-default 节点（选中 = 不下发 reasoningEffort）。两者语义等价——asar:1097033
        // 里 reasoningEffort 为 falsy 时取 map.off，而 off 映射为 null 时同样不下发——故不铺两份。
        if (declaredOffEffort(reasoning) === undefined) {
          effortChoices.push({ key: 'provider-default', effort: undefined, label: 'off' })
        }
        for (var j = 0; j < reasoning.efforts.length; j += 1) {
          var e = reasoning.efforts[j]
          // 官方 off 档也统一叫 off：滑杆最左端永远是一个标签为 off 的节点，不出现「关闭/Default」混称
          effortChoices.push({ key: 'effort:' + e.id, effort: e.id, label: e.id === 'off' ? 'off' : e.name })
        }
      }
      return { reasoning: reasoning, effectiveEffort: effectiveEffort, effortLabel: effortLabel, effortChoices: effortChoices }
    }

    /** provider-default 常驻节点选择器：effort === undefined 且 key 固定。 */
    function isProviderDefault(choice) {
      return !!choice && choice.effort === undefined
    }

    /** 模型自己声明的 off 档位（若存在）：闪电关思考时优先提交它，比 provider-default 更明确。 */
    function declaredOffEffort(reasoning) {
      if (!reasoning || !reasoning.efforts) return undefined
      for (var i = 0; i < reasoning.efforts.length; i += 1) {
        if (reasoning.efforts[i].id === 'off') return 'off'
      }
      return undefined
    }

    /** 官方 THINKING_LEVELS 序（asar:859699 / 1104454），用于判定「最高可用档」。 */
    var LEVEL_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

    /**
     * 最高可用档 = efforts 中按 LEVEL_ORDER 序的最后一个（R9）。
     * 很多模型没有 max（如 ant-ling Ring-2.6-1T 到 xhigh、together MiniMax 到 medium），
     * 所以动画触发条件绝不能硬编码 'max'。
     */
    function topLevel(efforts) {
      if (!efforts || !efforts.length) return null
      var top = null
      for (var i = 0; i < LEVEL_ORDER.length; i += 1) {
        for (var j = 0; j < efforts.length; j += 1) {
          if (efforts[j].id === LEVEL_ORDER[i]) { top = LEVEL_ORDER[i]; break }
        }
      }
      return top
    }

    /** 当前档在 efforts 里的下标；未找到时按 off 处理（0），空列表返回 -1。 */
    function effortIndex(efforts, effort) {
      if (!efforts || !efforts.length) return -1
      for (var i = 0; i < efforts.length; i += 1) {
        if (efforts[i].id === effort) return i
      }
      return 0
    }

    /** choices 计算（asar:435453-435461）：选模型时若 catalog 带 defaultEffort 一并提交。 */
    function buildChoices(groups) {
      var choices = []
      for (var g = 0; g < groups.length; g += 1) {
        var group = groups[g]
        var models = group.models || []
        for (var m = 0; m < models.length; m += 1) {
          var model = models[m]
          var selection = { provider: group.id, model: model.id }
          if (model.reasoning && model.reasoning.defaultEffort !== undefined) {
            selection.reasoningEffort = model.reasoning.defaultEffort
          }
          choices.push({ group: group, model: model, selection: selection })
        }
      }
      return choices
    }

    function findCurrentChoice(choices, current) {
      if (!current) return undefined
      for (var i = 0; i < choices.length; i += 1) {
        var c = choices[i].selection
        if (c.provider === current.provider && c.model === current.model) return choices[i]
      }
      return undefined
    }

    /* ── 浮层小组件 ──────────────────────────────────────────────────────── */
    function CheckIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', width: 14, height: 14,
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
      }, h('path', { d: 'M3 8.5L6.5 12L13 4.5' }))
    }
    function ChevronIcon(props) {
      return h('svg', {
        viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', width: 14, height: 14,
        strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, className: props.className
      }, h('path', { d: props.right ? 'M6 3.5L10.5 8L6 12.5' : 'M3.5 6L8 10.5L12.5 6' }))
    }
    function FlashIcon() {
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', width: 16, height: 16, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M8.8 1.8L3.6 9h3.4l-.8 5.2L11.4 7H8z' }))
    }
    function SpinnerDot() { return h('span', { className: 'teff-spinner', 'aria-hidden': true }) }
    function OngoingDot() { return h('span', { className: 'teff-checkDot', 'aria-hidden': true }) }

    /**
     * IconDataOutlineRegular —— 官方 asar:449583-449605 的**逐字复刻**（两条 path 原文照抄）。
     * 窄容器降级时官方隐藏「模型名 + 档位名」两个 span、只显示这个图标（asar:403251 /
     * docs/official-ui-notes.md §1.5）。此前的空 span 在降级后什么都不显示 → 用户第三张图的问题。
     */
    var DATA_ICON_PATHS = [
      'M7.8667 0.349609C8.96906 0.349634 10.0601 0.481272 11.0317 0.735352C11.9973 0.987845 12.8453 1.362 13.4644 1.84766C14.0744 2.32629 14.507 2.95539 14.5161 3.69336H14.5171V8.53516C14.0843 8.32076 13.6108 8.17679 13.1108 8.11816C13.1831 7.96848 13.2162 7.82856 13.2163 7.70312V5.76758C12.6269 6.16618 11.8739 6.47995 11.0317 6.7002C10.0602 6.95423 8.96896 7.08494 7.8667 7.08496C6.76461 7.08493 5.67411 6.95415 4.70264 6.7002C3.85994 6.48006 3.10694 6.1662 2.51709 5.76758V7.70312L2.521 7.78418C2.56374 8.19554 2.93361 8.74414 3.91357 9.23145C4.9281 9.73585 6.35004 10.0371 7.8667 10.0371C8.26373 10.0371 8.6543 10.0141 9.03271 9.97461C8.75596 10.3799 8.54664 10.8349 8.42041 11.3232C8.23666 11.3313 8.0518 11.3369 7.8667 11.3369C6.20108 11.3369 4.57025 11.01 3.33447 10.3955C3.04163 10.2499 2.76658 10.0836 2.51709 9.90039V11.6738C2.51728 12.1379 2.88589 12.7556 3.92236 13.292C4.93457 13.8157 6.35342 14.1289 7.8667 14.1289C8.12318 14.1289 8.37694 14.1161 8.62646 14.0986C8.82021 14.5535 9.08999 14.9682 9.41943 15.3271C8.91285 15.3934 8.39149 15.4287 7.8667 15.4287C6.19761 15.4287 4.56379 15.0869 3.32568 14.4463C2.11244 13.8185 1.21649 12.8562 1.21631 11.6738V3.76367C1.21595 3.74853 1.21438 3.733 1.21436 3.71777C1.21436 2.96917 1.65103 2.33053 2.26807 1.84668C2.88747 1.36112 3.73675 0.987685 4.70264 0.735352C5.67413 0.481376 6.76457 0.349636 7.8667 0.349609ZM7.8667 1.65039C6.86269 1.65042 5.88326 1.77028 5.03076 1.99316C4.17183 2.2176 3.50421 2.52956 3.06982 2.87012C2.65043 3.19909 2.52622 3.48898 2.51709 3.69336V3.74414C2.52719 3.94845 2.65185 4.23772 3.06982 4.56543C3.50425 4.90601 4.17172 5.21795 5.03076 5.44238C5.88326 5.66527 6.8627 5.78513 7.8667 5.78516C8.8707 5.78513 9.85015 5.66525 10.7026 5.44238C11.5611 5.21787 12.2286 4.9049 12.6626 4.56445C13.0982 4.22252 13.2163 3.9231 13.2163 3.71777L13.2104 3.63574C13.1818 3.43623 13.044 3.16941 12.6626 2.87012C12.2286 2.52957 11.5614 2.21773 10.7026 1.99316C9.85009 1.77025 8.8708 1.65041 7.8667 1.65039Z',
      'M12.8936 10.0361L13.2061 10.5566C13.2296 10.5959 13.2651 10.6562 13.3027 10.707C13.3469 10.7666 13.4148 10.8431 13.5195 10.9023C13.6244 10.9617 13.725 10.9801 13.7988 10.9873C13.8619 10.9934 13.9318 10.9932 13.9775 10.9932H14.6162L14.8896 11.4502L14.5947 11.9443C14.5698 11.9859 14.5312 12.0483 14.5029 12.1084C14.4781 12.1611 14.4514 12.2312 14.4395 12.3164L14.4326 12.4072L14.4395 12.4971C14.4514 12.5825 14.4781 12.6532 14.5029 12.7061C14.5312 12.7661 14.5689 12.8287 14.5938 12.8701L14.8896 13.3633L14.6162 13.8213H13.9775C13.9318 13.8213 13.8619 13.821 13.7988 13.8271C13.7433 13.8326 13.6728 13.8442 13.5967 13.875L13.5195 13.9121C13.4148 13.9714 13.3469 14.0478 13.3027 14.1074C13.265 14.1583 13.2296 14.2186 13.2061 14.2578L12.8936 14.7783H12.3115L11.999 14.2578C11.9755 14.2186 11.9401 14.1583 11.9023 14.1074C11.8693 14.0628 11.823 14.0083 11.7578 13.959L11.6855 13.9121L11.6074 13.875C11.5316 13.8445 11.4615 13.8325 11.4062 13.8271C11.3432 13.821 11.2733 13.8213 11.2275 13.8213H10.5889L10.3135 13.3633L10.6104 12.8701C10.6352 12.8287 10.6739 12.7661 10.7021 12.7061C10.7352 12.6357 10.7724 12.534 10.7725 12.4072C10.7724 12.2804 10.7352 12.1788 10.7021 12.1084C10.6739 12.0483 10.6353 11.9859 10.6104 11.9443L10.3135 11.4502L10.5889 10.9932H11.2275C11.2733 10.9932 11.3432 10.9934 11.4062 10.9873C11.4801 10.9801 11.5808 10.9616 11.6855 10.9023C11.7903 10.843 11.8582 10.7666 11.9023 10.707C11.94 10.6562 11.9755 10.5959 11.999 10.5566L12.3115 10.0361H12.8936Z'
    ]
    function DataIcon(props) {
      var size = props && props.size ? props.size : 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true,
        strokeWidth: 1, className: props ? props.className : undefined
      },
      h('path', { d: DATA_ICON_PATHS[0], fill: 'currentColor' }),
      h('path', { d: DATA_ICON_PATHS[1], stroke: 'currentColor', strokeMiterlimit: '10' }))
    }

    /* ── Codex 风格档位弹层：居中档位名 + 胶囊滑杆分档吸附 ─────────────────────
       规格见 docs/review-notes.md 2.2/2.4 与 DESIGN.md §0.3：
       0–1000 草稿值映射 efforts 下标，拖动/键盘吸附到最近档，松手提交。
       滑杆本身不假设档位数——完全按服务端 reasoning.efforts 数组渲染。 */

    var SLIDER_MAX = 1000
    var SLIDER_INSET = 16 // 轨道两端内缩半个滑块宽（滑块 32px），滑块与轨道对齐

    function pctFromIndex(index, count) {
      if (count <= 1) return 100
      return (index / (count - 1)) * 100
    }

    function valueFromIndex(index, count) {
      if (count <= 1) return SLIDER_MAX
      return Math.round((index / (count - 1)) * SLIDER_MAX)
    }

    function indexFromValue(value, count) {
      if (count <= 1) return 0
      var i = Math.round((value / SLIDER_MAX) * (count - 1))
      return Math.max(0, Math.min(count - 1, i))
    }

    /** 节点/标签/滑块共用位置表达式：轨道两端各内缩 SLIDER_INSET。 */
    function sliderOffset(pct) {
      return 'calc(' + SLIDER_INSET + 'px + (100% - ' + SLIDER_INSET * 2 + 'px) * ' + (pct / 100) + ')'
    }

    /**
     * 浮层定位（纯函数，便于断言）：
     * 默认向上弹（真实 DSH 里 chip 在窗口底部）；上方装不下时向下翻转。
     * 若只会上弹，触发按钮贴近视口顶部时会被夹到 MENU_MARGIN，贴住顶边并钻进
     * 顶部 chrome 的领地（用户 m04522「有东西会遮挡」）。
     * 返回 side 供测试断言弹层方向。 */
    function menuPlacement(input) {
      var rect = input.rect
      var lw = input.lw
      var lh = input.lh
      var vw = input.vw
      var vh = input.vh
      var margin = input.margin
      var gap = input.gap
      var spaceAbove = rect.top - margin - gap
      var spaceBelow = vh - rect.bottom - margin - gap
      var side = (spaceAbove >= lh || spaceAbove >= spaceBelow) ? 'up' : 'down'
      var x = rect.right - lw
      var y = side === 'up' ? rect.top - gap - lh : rect.bottom + gap
      x = Math.max(margin, Math.min(x, vw - lw - margin))
      y = Math.max(margin, Math.min(y, vh - lh - margin))
      return { left: x + 'px', top: y + 'px', side: side }
    }

    /**
     * 分组标题吸顶观察器（逐字对齐官方 asar:451945-452023 的 observeStickyMenuGroups）。
     * CSS 负责 sticky 定位，这里只用原生 IntersectionObserver/ResizeObserver 异步维护
     * data-stuck 属性；不同步读取布局、不注册滚动监听。
     * 缺少任一 Observer 时返回空清理函数（官方同款降级：标题保持透明）。
     * 硬约束：分组在 setup 时捕获 → 分组变化（含筛选）必须重建，卸载时必须 disconnect。
     */
    function observeStickyMenuGroups(viewport) {
      if (!viewport || typeof viewport.querySelectorAll !== 'function') return function () {}
      var groups = []
      var sections = viewport.querySelectorAll(':scope > [data-menu-group]')
      for (var si = 0; si < sections.length; si += 1) {
        var section = sections[si]
        var heading = section.querySelector(':scope > [data-menu-group-heading]')
        var start = section.querySelector(':scope > [data-menu-group-start]')
        if (heading === null || start === null) continue
        groups.push({ section: section, heading: heading, start: start, atTop: false, above: false, topTime: -Infinity, aboveTime: -Infinity })
      }
      if (groups.length === 0 || typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') {
        return function () {}
      }
      var sectionMap = new Map()
      var startMap = new Map()
      for (var gi = 0; gi < groups.length; gi += 1) {
        sectionMap.set(groups[gi].section, groups[gi])
        startMap.set(groups[gi].start, groups[gi])
      }
      var disposed = false
      var stripObserver = null
      var viewportHeight
      function render(group) {
        var stuck = group.atTop && group.above
        if (group.heading.hasAttribute('data-stuck') !== stuck) group.heading.toggleAttribute('data-stuck', stuck)
      }
      var startObserver = new IntersectionObserver(function (entries) {
        if (disposed) return
        for (var i = 0; i < entries.length; i += 1) {
          var entry = entries[i]
          var group = startMap.get(entry.target)
          if (!group || entry.rootBounds === null || entry.time < group.aboveTime) continue
          group.above = entry.boundingClientRect.top < entry.rootBounds.top
          group.aboveTime = entry.time
          render(group)
        }
      }, { root: viewport, threshold: [0, 1] })
      for (var oi = 0; oi < groups.length; oi += 1) startObserver.observe(groups[oi].start)
      var sizeObserver = new ResizeObserver(function (entries) {
        if (disposed) return
        for (var i = 0; i < entries.length; i += 1) {
          var entry = entries[i]
          if (entry.target !== viewport || entry.contentRect.height === viewportHeight) continue
          viewportHeight = entry.contentRect.height
          if (stripObserver) stripObserver.disconnect()
          var observer = new IntersectionObserver(function (intersections) {
            if (disposed || stripObserver !== observer) return
            for (var j = 0; j < intersections.length; j += 1) {
              var intersection = intersections[j]
              var group = sectionMap.get(intersection.target)
              if (!group || intersection.rootBounds === null) continue
              var top = intersection.rootBounds.top
              if (intersection.time >= group.topTime) {
                group.atTop = intersection.isIntersecting && intersection.boundingClientRect.bottom > top
                group.topTime = intersection.time
              }
              if (intersection.time >= group.aboveTime) {
                group.above = intersection.boundingClientRect.top < top
                group.aboveTime = intersection.time
              }
              render(group)
            }
          }, { root: viewport, rootMargin: '0px 0px ' + (Math.min(1, viewportHeight) - viewportHeight) + 'px 0px', threshold: 0 })
          stripObserver = observer
          for (var oj = 0; oj < groups.length; oj += 1) observer.observe(groups[oj].section)
        }
      })
      sizeObserver.observe(viewport)
      return function () {
        if (disposed) return
        disposed = true
        startObserver.disconnect()
        if (stripObserver) stripObserver.disconnect()
        sizeObserver.disconnect()
        for (var i = 0; i < groups.length; i += 1) {
          if (groups[i].heading.hasAttribute('data-stuck')) groups[i].heading.removeAttribute('data-stuck')
        }
      }
    }

    /**
     * 档位 → 视觉强度（用户定稿：每一档都有粒子动效，档位越高轨道越紫、粒子越多）。
     * ratio 0（最低档）→ 纯蓝、1 层星、弱光；ratio 1（最高可用档）→ 紫、3 层星、最亮。
     * 轨道渐变的紫色端由 --teff-purple-stop 控制，平滑过渡（GPU 合成层）。 */
    function effortVisual(index, count) {
      var ratio = count <= 1 ? 1 : index / (count - 1)
      return {
        ratio: ratio,
        // 紫端占比：0% → 30%，最高档 → 100%（整条轨道偏紫）
        purpleStop: Math.round(30 + ratio * 70),
        // 星层数：最低档 1 层，之后每升一档多一层，最多 3 层
        starLayers: Math.max(1, Math.min(3, Math.round(1 + ratio * 2))),
        // 星层不透明度：.22 → .85
        starOpacity: Number((0.22 + ratio * 0.63).toFixed(3)),
        // 粒子漂移时长：档位越高越快（20s → 7s）
        driftSeconds: Number((20 - ratio * 13).toFixed(1)),
        // 是否该模型最高可用档（额度提示只在最高档出现）
        isTop: count > 0 && index === count - 1
      }
    }

    /** choices 里按 effort 反查下标；未找到返回 -1（调用方兜底到 0 = 常驻 off 节点）。 */
    function choiceIndex(choices, effort) {
      if (!choices || !choices.length) return -1
      for (var i = 0; i < choices.length; i += 1) {
        if (choices[i].effort === effort) return i
      }
      return -1
    }

    function CodexEffortPopup(props) {
      var choices = props.choices || []
      var count = choices.length
      var initialIndex = choiceIndex(choices, props.current)
      if (initialIndex < 0) initialIndex = 0

      var valueState = useState(valueFromIndex(initialIndex, count))
      var value = valueState[0]
      var setValue = valueState[1]
      var draggingRef = useRef(false)
      var sliderRef = useRef(null)

      // 外部档位变化（提交回执 / 换模型）时把草稿值对齐回去
      useEffect(function () {
        var idx = choiceIndex(choices, props.current)
        setValue(valueFromIndex(idx < 0 ? 0 : idx, count))
      }, [props.current, count])

      var index = indexFromValue(value, count)
      var active = choices[index]
      // 小字行 = 当前思考强度（读法 A：大字行让给模型名）。off 常驻节点自带标签 off。
      var levelName = active ? active.label : ''
      var pct = pctFromIndex(index, count)
      var disabled = !!props.busy || count === 0

      // 闪电 = 思考开关。开启 = 正在使用某个真实思考档（undefined/off 都算关闭）。
      var thinkingOn = props.current !== undefined && props.current !== 'off'
      // 关闭时提交常驻 off 节点的档位值（choices[0] 即最左端常驻 off）。
      var offEffort = choices.length ? choices[0].effort : undefined
      /**
       * 开启思考的目标档（用户裁决 m03904）：**永远**优先 minimal 档，
       * 没有 minimal 才退到最低的非 off 档。不再记忆「上次档位」——旧行为会让
       * 开关每次回到不同位置，用户看到的是「开了但不在 minimal」。
       */
      var onEffort = (function () {
        var hit = null
        for (var i = 0; i < choices.length; i += 1) {
          var ef = choices[i].effort
          if (ef === undefined || ef === 'off') continue
          if (ef === 'minimal') return 'minimal'
          if (hit === null) hit = ef
        }
        return hit
      })()

      function toggleThinking() {
        if (disabled) return
        // 松手不关的同一条铁律：点开关只改档位，面板保持打开（修复「点闪电立即退出」）
        if (thinkingOn) { props.onSelect(offEffort, true); return }
        if (onEffort !== undefined) props.onSelect(onEffort, true)
      }

      // 松手不关：提交成功后面板保持打开（用户裁决 m02593），显式 keepOpen。
      function commit(nextIndex) {
        if (disabled) return
        var choice = choices[nextIndex]
        if (!choice) return
        props.onSelect(choice.effort, true)
      }

      function valueAtClientX(clientX) {
        var el = sliderRef.current
        if (!el || typeof el.getBoundingClientRect !== 'function') return null
        var rect = el.getBoundingClientRect()
        if (!rect || !rect.width) return null
        var ratio = (clientX - rect.left) / rect.width
        return Math.max(0, Math.min(SLIDER_MAX, Math.round(ratio * SLIDER_MAX)))
      }

      function onPointerDown(e) {
        if (disabled) return
        var next = valueAtClientX(e.clientX)
        if (next === null) return
        draggingRef.current = true
        if (e.currentTarget && typeof e.currentTarget.setPointerCapture === 'function' && e.pointerId !== undefined) {
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) { /* 沙箱/旧内核无指针捕获 */ }
        }
        if (sliderRef.current && sliderRef.current.focus) sliderRef.current.focus()
        setValue(next)
      }

      function onPointerMove(e) {
        if (!draggingRef.current || disabled) return
        var next = valueAtClientX(e.clientX)
        if (next !== null) setValue(next)
      }

      function onPointerUp() {
        if (!draggingRef.current) return
        draggingRef.current = false
        commit(indexFromValue(value, count))
      }

      // 键盘两段式（用户裁决 m02593）：方向键/Home/End 只移动草稿档位，Enter/Space 才提交。
      // 提交走 commit(keepOpen)，面板同样不关。
      function onKeyDown(e) {
        if (disabled) return
        var i = indexFromValue(value, count)
        var next = null
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(count - 1, i + 1)
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, i - 1)
        else if (e.key === 'Home') next = 0
        else if (e.key === 'End') next = count - 1
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(i); return }
        if (next === null) return
        e.preventDefault()
        setValue(valueFromIndex(next, count))
      }

      // 进入档位面板时把焦点交给滑杆（官方 drilled pane 聚焦当前档位）
      useEffect(function () {
        if (sliderRef.current && sliderRef.current.focus) sliderRef.current.focus()
      }, [])

      var ticks = []
      var labels = []
      for (var ti = 0; ti < count; ti += 1) {
        var tp = pctFromIndex(ti, count)
        ticks.push(h('span', { key: 'tick-' + ti, className: 'teff-slider__tick', style: { left: sliderOffset(tp) } }))
        labels.push(h('span', {
          key: 'label-' + ti,
          className: 'teff-slider__label' + (ti === index ? ' teff-slider__label--active' : ''),
          style: { left: sliderOffset(tp) }
        }, choices[ti] ? choices[ti].label : ''))
      }

      // 视觉强度随档位连续变化：轨道越紫、星层越多越亮、漂移越快（用户定稿）
      var visual = effortVisual(index, count)
      var starClasses = ['teff-star--a', 'teff-star--b', 'teff-star--c']
      var starNodes = []
      for (var si = 0; si < visual.starLayers; si += 1) {
        starNodes.push(h('span', {
          key: 'star-' + si,
          className: 'teff-star ' + starClasses[si],
          style: { animationDuration: visual.driftSeconds + 's' }
        }))
      }

      var fillStyle = { width: pct + '%', '--teff-purple-stop': visual.purpleStop + '%', '--teff-glow': String(visual.ratio) }

      return h('div', { className: 'teff-popup teff-popup--open' },
        // 顶栏只留左上闪电（思考开关）。右上「重置为默认档」已按用户 m05286 删除：
        // 滑杆最左端常驻 off 节点本身就能回到默认，该按钮是冗余的第二条路径。
        h('div', { className: 'teff-popup__bar' },
          h('button', {
            key: 'flash',
            type: 'button',
            className: 'teff-popup__iconbtn teff-popup__iconbtn--flash',
            'aria-label': thinkingOn ? '关闭思考' : '开启思考',
            'aria-pressed': thinkingOn,
            title: thinkingOn ? '关闭思考' : '开启思考',
            disabled: disabled,
            onClick: toggleThinking
          }, h(FlashIcon))),
        // 读法 A（用户 m02779）：大字行 = 模型名（可点击进 model pane），下方小字行 = 当前思考强度
        h('button', {
          type: 'button',
          className: 'teff-popup__model',
          title: props.modelName,
          disabled: disabled,
          onClick: props.onPickModel
        }, props.modelName),
        h('div', { className: 'teff-popup__level', 'aria-live': 'polite' }, levelName),
        h('div', {
          ref: sliderRef,
          className: 'teff-slider' + (disabled ? ' teff-slider--disabled' : ''),
          role: 'slider',
          tabIndex: 0,
          'aria-valuemin': 0,
          'aria-valuemax': SLIDER_MAX,
          'aria-valuenow': value,
          'aria-valuetext': levelName,
          'aria-disabled': disabled,
          onKeyDown: onKeyDown,
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: onPointerUp,
          onPointerCancel: onPointerUp
        },
        h('div', { className: 'teff-slider__rail' },
          h('div', { className: 'teff-slider__fill teff-slider__fill--lit', style: fillStyle }),
          h('div', {
            className: 'teff-slider__stars',
            style: { opacity: String(visual.starOpacity) }
          }, starNodes)),
        h('div', { className: 'teff-slider__thumb', style: { left: sliderOffset(pct) } }),
        h('div', { className: 'teff-slider__ticks' }, ticks)),
        h('div', { className: 'teff-slider__labels' }, labels),
        visual.isTop
          ? h('div', { className: 'teff-hint' },
              h('span', { className: 'teff-hint__icon' }, '⚡'),
              h('span', { className: 'teff-hint__text' }, '更快消耗使用额度'))
          : null)
    }

    function Toast(props) {
      // 锚定最近 [data-composer-card]；找不到就右上角兜底
      var anchor = props.anchor
      var style = anchor && typeof anchor.getBoundingClientRect === 'function'
        ? (function () {
            var r = anchor.getBoundingClientRect()
            return { position: 'fixed', top: String(Math.max(12, r.top - 44)) + 'px', left: String(r.left) + 'px' }
          })()
        : { position: 'fixed', top: '12px', right: '12px' }
      return h('div', { className: 'teff-toast', style: style, role: 'status' }, props.text)
    }

    /* ── 浮层主组件：模型 + 档位两级菜单 ─────────────────────────────────── */
    var MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 }
    var MENU_MARGIN = 12

    function ModelSelectOverlay(props) {
      var sessionId = props.sessionId
      // ctx 必须由 apply 的注册闭包透传：组件内没有模块级 ctx，宿主也不提供全局 ctx。
      var pluginCtx = props.ctx || null
      var conn = pluginCtx && typeof pluginCtx.get === 'function' ? pluginCtx.get('connection') : null

      // 目录状态：catalog / 代次计数器（旧响应不得覆盖新结果）/ connection/reset 刷新
      // 拿不到 connection 服务时直接进 error 态，否则会永远停在 loading、trigger 一直显示「加载中…」。
      var dirState = useState({
        status: conn ? 'loading' : 'error',
        groups: [],
        failures: [],
        error: conn ? null : 'connection 服务不可用',
        retainedEffort: undefined,
        current: null
      })
      var catalog = dirState[0]
      var setCatalog = dirState[1]

      var current = catalog.current
      var genRef = useRef(0)
      var rootRef = useRef(null)
      var triggerRef = useRef(null)
      var menuRef = useRef(null)
      // groupsRef 单独指向模型列表滚动容器（对齐官方 asar:435788 vs 435890 的双 ref 分工）。
      // 此前 menuRef 被同时挂在 .teff-menu 与 .teff-groups 上，React 先菜单后子元素，
      // 最终指向 .teff-groups → place() 量到的是列表内容高度而非菜单高度（定位误差定时炸弹）。
      var groupsRef = useRef(null)
      var searchRef = useRef(null)
      var itemRefs = useRef([])
      var cellRefs = useRef({})
      var lastActionRef = useRef(null)
      var paneFocusRef = useRef('root')
      var toastSeqRef = useRef(0)

      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var paneState = useState('root')
      var pane = paneState[0]
      var setPane = paneState[1]
      var queryState = useState('')
      var query = queryState[0]
      var setQuery = queryState[1]
      var highlightState = useState(null)
      var highlightedIndex = highlightState[0]
      var setHighlightedIndex = highlightState[1]
      var selectionFocusState = useState(false)
      var selectionFocus = selectionFocusState[0]
      var setSelectionFocus = selectionFocusState[1]
      var posState = useState(null)
      var menuPos = posState[0]
      var setMenuPos = posState[1]
      var pendingState = useState(null)
      var pending = pendingState[0]
      var setPending = pendingState[1]
      var toastState = useState(null)
      var toast = toastState[0]
      var setToast = toastState[1]

      var loadCatalog = useCallback(function () {
        if (!conn || !conn.api || !conn.api.session || typeof conn.api.session.modelCatalog !== 'function') {
          setCatalog(function (prev) { return Object.assign({}, prev, { status: 'error', error: 'connection 服务不可用' }) })
          return
        }
        var gen = genRef.current + 1
        genRef.current = gen
        setCatalog(function (prev) { return Object.assign({}, prev, { status: 'loading' }) })
        Promise.resolve().then(function () { return conn.api.session.modelCatalog() }).then(function (res) {
          if (gen !== genRef.current) return // 代次失效：旧响应不得覆盖新结果
          var value = (res && res.result && res.result.value) || {}
          var groups = Array.isArray(value.groups) ? value.groups : []
          setCatalog(function (prev) {
            return {
              status: 'ready',
              groups: orderModelProviders(groups),
              failures: Array.isArray(value.failures) ? value.failures : [],
              error: null,
              retainedEffort: value.retainedEffort === undefined ? prev.retainedEffort : value.retainedEffort,
              current: value.current === undefined ? prev.current : value.current
            }
          })
        }, function (err) {
          if (gen !== genRef.current) return
          setCatalog(function (prev) {
            return Object.assign({}, prev, { status: 'error', error: errText(err) })
          })
        })
      }, [conn])

      useEffect(function () {
        loadCatalog()
        if (pluginCtx && typeof pluginCtx.on === 'function') {
          var off = pluginCtx.on('connection/reset', function () { loadCatalog() })
          return function () { if (typeof off === 'function') off() }
        }
      }, [loadCatalog])

      var choices = buildChoices(catalog.groups)
      var currentChoice = findCurrentChoice(choices, current)
      var menu = computeMenuData(currentChoice, current, catalog.retainedEffort)
      var busy = pending !== null
      var loading = catalog.status === 'loading'
      var showSearch = choices.length > 4

      // 过滤：provider 组内 rankByName；搜索为空时保持 catalog 顺序
      var filteredGroups = showSearch && query.trim()
        ? (function () {
            var out = []
            for (var i = 0; i < catalog.groups.length; i += 1) {
              var g = catalog.groups[i]
              var models = rankByName(g.models || [], query)
              if (models.length > 0) out.push({ id: g.id, name: g.name, models: models })
            }
            return out
          })()
        : catalog.groups
      var visibleModels = []
      for (var fg = 0; fg < filteredGroups.length; fg += 1) {
        var fgm = filteredGroups[fg].models || []
        for (var fm = 0; fm < fgm.length; fm += 1) {
          visibleModels.push({ provider: filteredGroups[fg].id, model: fgm[fm].id })
        }
      }
      var currentVisibleIndex = -1
      if (current) {
        for (var vm = 0; vm < visibleModels.length; vm += 1) {
          if (visibleModels[vm].provider === current.provider && visibleModels[vm].model === current.model) {
            currentVisibleIndex = vm
            break
          }
        }
      }
      var activeModelIndex = Math.min(
        highlightedIndex !== null ? highlightedIndex : Math.max(0, currentVisibleIndex),
        visibleModels.length - 1
      )

      var modelLabel = (current === null && catalog.status === 'loading')
        ? '加载中…'
        : currentChoice
          ? currentChoice.model.name
          : current
            ? current.provider + '/' + current.model
            : '选择模型'
      var triggerLabel = menu.effortLabel === undefined ? modelLabel : modelLabel + ' · ' + menu.effortLabel

      function place() {
        if (!triggerRef.current || !menuRef.current) return
        var next = menuPlacement({
          rect: triggerRef.current.getBoundingClientRect(),
          lw: menuRef.current.offsetWidth,
          lh: menuRef.current.offsetHeight,
          vw: window.innerWidth,
          vh: window.innerHeight,
          margin: MENU_MARGIN,
          gap: 8
        })
        setMenuPos({ left: next.left, top: next.top })
      }

      function show() {
        setSelectionFocus(false)
        if (triggerRef.current && triggerRef.current.focus) triggerRef.current.focus()
        setQuery('')
        setHighlightedIndex(null)
        paneFocusRef.current = current === null ? 'drill' : 'root'
        setPane(current === null ? 'model' : 'root')
        setOpen(true)
        loadCatalog()
      }

      function close(restoreFocus) {
        setOpen(false)
        setPane('root')
        if (restoreFocus && triggerRef.current && triggerRef.current.focus) {
          Promise.resolve().then(function () { if (triggerRef.current) triggerRef.current.focus() })
        }
      }

      function closeAfterSelection() {
        setSelectionFocus(true)
        close(true)
      }

      function drill(next) {
        setQuery('')
        setHighlightedIndex(null)
        paneFocusRef.current = 'drill'
        setPane(next)
      }

      function back(from) {
        paneFocusRef.current = from
        setPane('root')
      }

      function changeQuery(next) {
        setQuery(next)
        setHighlightedIndex(0)
      }

      function settleSelection(result, keepOpen) {
        if (result === undefined) return
        if (result && result.ok) {
          if (keepOpen) { setSelectionFocus(false); return } // 松手不关：面板留在原地
          closeAfterSelection()
          return
        }
        var error = result && result.error ? result.error : { code: 'unknown', message: '未知错误' }
        toastSeqRef.current += 1
        setToast({
          seq: toastSeqRef.current,
          text: error.code === 'session/writer-held'
            ? '会话正在使用中'
            : error.code + ': ' + error.message
        })
      }

      function submit(selection, keepOpen) {
        if (!conn || !conn.api || !conn.api.session || typeof conn.api.session.selectModel !== 'function') {
          settleSelection({ ok: false, error: { code: 'unavailable', message: 'connection 服务不可用' } }, keepOpen)
          return
        }
        setPending(selection)
        // keepOpen 时焦点留给滑杆，不要把焦点抢回 trigger（否则键盘会掉出面板）
        if (!keepOpen) {
          setSelectionFocus(true)
          if (triggerRef.current && triggerRef.current.focus) triggerRef.current.focus()
        }
        Promise.resolve().then(function () { return conn.api.session.selectModel(Object.assign({ sessionId: sessionId }, selection)) }).then(function () {
          setPending(null)
          // 官方：成功后本地乐观更新（writer-held 等拒绝走 Toast）
          setCatalog(function (prev) {
            // 必须把刚提交的 reasoningEffort 记进 current，否则「松手不关」后弹层仍按
            // defaultEffort 显示旧档位——用户会看到滑块弹回原位（m02593 定住要求）。
            var nextCurrent = { provider: selection.provider, model: selection.model }
            if (selection.reasoningEffort !== undefined) nextCurrent.reasoningEffort = selection.reasoningEffort
            var next = Object.assign({}, prev, { current: nextCurrent })
            if (selection.reasoningEffort !== undefined) next.retainedEffort = undefined
            return next
          })
          settleSelection({ ok: true }, keepOpen)
        }, function (err) {
          setPending(null)
          settleSelection({ ok: false, error: err && err.code ? err : { code: 'error', message: errText(err) } }, keepOpen)
        })
      }

      function choose(selection) {
        if (current && current.provider === selection.provider && current.model === selection.model) {
          closeAfterSelection()
          return
        }
        submit(selection)
      }

      function chooseEffort(effort, keepOpen) {
        if (current === null) return
        if (menu.effectiveEffort === effort) {
          // 拖回原位：不重复提交；keepOpen 时原地不动，否则维持旧的「选中即关」语义
          if (!keepOpen) closeAfterSelection()
          return
        }
        var selection = { provider: current.provider, model: current.model }
        if (effort !== undefined) selection.reasoningEffort = effort
        submit(selection, keepOpen)
      }

      // 打开时定位 + scroll/resize 重定位
      useEffect(function () {
        if (!open || typeof document === 'undefined') return
        place()
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        return function () {
          window.removeEventListener('scroll', place, true)
          window.removeEventListener('resize', place)
        }
      }, [open, pane, query, menuPos === null])

      // 打开时焦点去向：drill 进搜索框，否则当前选中行/第一行
      useEffect(function () {
        if (!open || pane !== 'model' || typeof document === 'undefined') return
        if (paneFocusRef.current !== 'drill') return
        if (showSearch && searchRef.current && searchRef.current.focus) searchRef.current.focus()
      }, [open, pane, showSearch])

      // 外点关闭
      useEffect(function () {
        if (!open || typeof document === 'undefined') return
        function onDown(e) {
          var root = rootRef.current
          var menuEl = menuRef.current
          if (root && root.contains(e.target)) return
          if (menuEl && menuEl.contains(e.target)) return
          setOpen(false)
          setPane('root')
        }
        document.addEventListener('mousedown', onDown)
        return function () { document.removeEventListener('mousedown', onDown) }
      }, [open])

      // 键盘高亮项自动滚入视野（对齐官方 asar:435547-435554）。
      // 官方用 useLayoutEffect，本插件只能用 useEffect——测试替身的假 React 只实现 5 个 hook。
      useEffect(function () {
        if (!open || pane !== 'model') return
        var node = itemRefs.current[activeModelIndex]
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
      }, [open, pane, activeModelIndex])

      // 分组标题吸顶：在滚动容器上装观察器（官方 asar:435537-435546 用 observeStickyMenuGroups）。
      // 依赖列表跟着 filteredGroups 走，保证筛选后重建、卸载时 dispose（官方注释的硬约束）。
      useEffect(function () {
        if (!open || pane !== 'model') return
        if (!groupsRef.current) return
        return observeStickyMenuGroups(groupsRef.current)
      }, [open, pane, filteredGroups])

      if (typeof document === 'undefined') {
        // 沙箱/无 DOM 环境：渲染一个可断言的占位，避免测试炸掉
        return h('div', { className: 'teff-root', 'data-teff-placeholder': 'true' },
          h('span', { className: 'teff-triggerLabel' }, modelLabel),
          menu.effortLabel !== undefined ? h('span', { className: 'teff-triggerEffort' }, menu.effortLabel) : null)
      }

      var rows = []

      function modelRow(index, model, group) {
        var selected = current && current.provider === group.id && current.model === model.id
        var isActive = index === activeModelIndex
        return h('button', {
          key: group.id + '/' + model.id,
          ref: function (node) { if (node) itemRefs.current[index] = node },
          role: 'menuitemradio',
          'aria-checked': selected,
          id: 'teff-model-' + index,
          tabIndex: showSearch ? -1 : 0,
          className: 'teff-option teff-modelOption' + (selected ? ' teff-selected' : '') + (isActive ? ' teff-optionActive' : ''),
          disabled: busy,
          title: model.name,
          onFocus: function () { setHighlightedIndex(index) },
          onMouseMove: busy || isActive ? undefined : (showSearch
            ? function () { setHighlightedIndex(index) }
            : function () { if (itemRefs.current[index] && itemRefs.current[index].focus) itemRefs.current[index].focus() }),
          onClick: function () { choose({ provider: group.id, model: model.id }) }
        },
        h('span', { className: 'teff-optionCopy' }, h('span', { className: 'teff-modelName' }, model.name)),
        h('span', { className: 'teff-check' },
          pending && pending.provider === group.id && pending.model === model.id
            ? h(OngoingDot)
            : selected ? h(CheckIcon) : null))
      }

      // root pane 的焦点集合是两行 cell；model pane 是模型行。
      // 必须按当前 pane 取，否则 root pane 会 focus 到上一个 pane 残留的游离节点。
      function focusableItems() {
        var items = []
        if (pane === 'root') {
          if (cellRefs.current.model) items.push(cellRefs.current.model)
          if (cellRefs.current.effort) items.push(cellRefs.current.effort)
          return items
        }
        for (var i = 0; i < itemRefs.current.length; i += 1) {
          if (itemRefs.current[i]) items.push(itemRefs.current[i])
        }
        return items
      }

      function moveFocus(offset) {
        var items = focusableItems()
        if (!items.length) return
        var active = document.activeElement
        var idx = items.indexOf(active)
        // 焦点不在列表内时：向下从首项起、向上从末项起
        var base = idx < 0 ? (offset > 0 ? -1 : 0) : idx
        var next = items[(((base + offset) % items.length) + items.length) % items.length]
        if (next && next.focus) next.focus()
      }

      function onRootKeyDown(e) {
        if (e.isComposing) return
        if (!open) return
        if (e.key === 'Escape') {
          e.preventDefault()
          if (pane !== 'root' && current !== null) back(pane)
          else close(true)
          return
        }
        if (pane === 'model' && showSearch && (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
            document.activeElement === searchRef.current) {
          e.preventDefault()
          if (!busy && visibleModels.length > 0) {
            var next = (activeModelIndex + (e.key === 'ArrowDown' ? 1 : -1) + visibleModels.length) % visibleModels.length
            setHighlightedIndex(next)
            if (searchRef.current && searchRef.current.focus) searchRef.current.focus()
          }
          return
        }
        if (pane === 'model' && showSearch && document.activeElement === searchRef.current &&
            (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey))) {
          if (e.key === 'Tab' && visibleModels.length === 0) return
          e.preventDefault()
          var pick = visibleModels[activeModelIndex]
          if (!busy && pick) choose(pick)
          return
        }
        if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault()
          if (pane !== 'root' && current !== null) back(pane)
          else close(true)
          return
        }
        if (e.key === 'Tab') return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          moveFocus(e.key === 'ArrowDown' ? 1 : -1)
        }
      }

      var modelPane = null
      var effortPane = null
      if (open) {
        if (pane === 'model') {
          var idx = 0
          var groupEls = []
          for (var gi = 0; gi < filteredGroups.length; gi += 1) {
            var grp = filteredGroups[gi]
            var gLabel = grp.id === 'deepseek-account' ? '账号模型' : (grp.name || grp.id)
            var kids = []
            var gModels = grp.models || []
            for (var mi = 0; mi < gModels.length; mi += 1) {
              kids.push(modelRow(idx, gModels[mi], grp))
              idx += 1
            }
            groupEls.push(h('div', { key: grp.id, className: 'teff-group', role: 'group', 'aria-label': gLabel, 'data-menu-group': '' },
              // start 是 1px 隐形探针，供 IntersectionObserver 判断该组是否已滚到视口上方（官方 asar:451913-451935 同构）。
              h('span', { className: 'teff-groupStart', 'aria-hidden': true, 'data-menu-group-start': '' }),
              h('div', { className: 'teff-groupLabel', 'data-menu-group-heading': '' }, gLabel),
              kids))
          }
          // .teff-viewport 是 menu ↔ groups 之间的 flex 链路（对齐官方 .scrollable/.viewport），
          // 缺它则 .teff-groups 拿不到定高参照、overflow-y:auto 不激活（用户 m05519）。
          modelPane = h('div', { className: 'teff-viewport' },
            showSearch ? h('div', { className: 'teff-searchRow' },
              h('input', {
                ref: searchRef,
                className: 'teff-search' + (query !== '' ? ' teff-searchWithQuery' : ''),
                type: 'text',
                role: 'searchbox',
                'aria-label': '搜索模型',
                placeholder: '搜索模型…',
                value: query,
                readOnly: busy,
                onChange: function (e) { changeQuery(e.target.value) }
              }),
              query !== '' ? h('button', {
                className: 'teff-searchClear',
                'aria-label': '清除搜索',
                disabled: busy,
                onClick: function () { changeQuery(''); if (searchRef.current) searchRef.current.focus() }
              }, '×') : null) : null,
            loading ? h('div', { className: 'teff-status', role: 'status' }, '正在加载模型目录…') : null,
            catalog.status === 'error' ? h('div', { className: 'teff-error', role: 'alert' },
              h('span', null, catalog.error || '目录加载失败'),
              h('button', { className: 'teff-retry', onClick: loadCatalog }, '重试')) : null,
            catalog.failures.map(function (failure) {
              return h('div', { key: failure.id, className: 'teff-error teff-warning' },
                h('span', null, (failure.id === 'deepseek-account' ? '账号模型' : (failure.name || failure.id)) + '：' + failure.message),
                h('button', { className: 'teff-retry', onClick: loadCatalog }, '重试'))
            }),
            h('div', { ref: groupsRef, className: 'teff-groups', role: 'menu', 'aria-label': '模型', hidden: filteredGroups.length === 0 },
              groupEls.length ? groupEls : null),
            catalog.status === 'ready' && filteredGroups.length === 0
              ? h('div', { className: 'teff-empty', role: 'status' }, choices.length === 0 ? '没有可用模型' : '没有匹配的模型') : null)
        } else if (pane === 'effort') {
          // Codex 风格档位面板：大字模型名 + 小字当前档位 + 胶囊滑杆分档吸附。
          // 完全按服务端 effortChoices 渲染（首节点为常驻 off），不假设七档、不假设存在 max。
          var popupChoices = menu.effortChoices || []
          effortPane = h('div', null,
            catalog.status === 'error' ? h('div', { className: 'teff-error', role: 'alert' },
              h('span', null, catalog.error || '目录加载失败'),
              h('button', { className: 'teff-retry', onClick: loadCatalog }, '重载')) : null,
            popupChoices.length === 0
              ? h('div', { className: 'teff-empty', role: 'status' }, '该模型不支持档位选择')
              : h(CodexEffortPopup, {
                  key: 'codex-effort-popup',
                  choices: popupChoices,
                  current: menu.effectiveEffort,
                  modelName: modelLabel,
                  busy: busy,
                  onSelect: function (effort, keepOpen) { chooseEffort(effort, keepOpen) },
                  onPickModel: function () { drill('model') }
                }))
        }
      }

      rows.push(h('button', {
        key: 'cell-model',
        ref: function (node) { cellRefs.current.model = node },
        role: 'menuitem',
        className: 'teff-cell',
        disabled: busy,
        onClick: function () { drill('model') }
      },
      h('span', { className: 'teff-cellLabel' }, '模型'),
      h('span', { className: 'teff-cellValue' }, modelLabel),
      h(ChevronIcon, { className: 'teff-cellChevron', right: true })))

      if (menu.reasoning !== undefined) {
        rows.push(h('button', {
          key: 'cell-effort',
          ref: function (node) { cellRefs.current.effort = node },
          role: 'menuitem',
          className: 'teff-cell',
          disabled: busy,
          onClick: function () { drill('effort') }
        },
        h('span', { className: 'teff-cellLabel' }, '思考强度'),
        h('span', { className: 'teff-cellValue' }, menu.effortLabel),
        h(ChevronIcon, { className: 'teff-cellChevron', right: true })))
      }

      // root pane：两行 cell（点模型名选模型 / 点思考强度选档位）。
      // 必须真正进入渲染树——否则已选中模型后再次打开会渲染成空菜单。
      var rootPane = h('div', { className: 'teff-cells', role: 'menu', 'aria-label': '模型与思考强度' }, rows)

      return h('div', {
        className: 'teff-root',
        ref: rootRef,
        onKeyDown: onRootKeyDown,
        onBlur: function (e) {
          var to = e.relatedTarget
          if (to && rootRef.current && rootRef.current.contains(to)) return
          if (open) close()
        }
      },
      h('button', {
        ref: triggerRef,
        type: 'button',
        className: 'teff-trigger',
        'aria-label': triggerLabel,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        title: triggerLabel,
        'aria-busy': busy,
        'data-selection-focus': selectionFocus ? '' : undefined,
        disabled: current === null && catalog.status === 'error',
        onBlur: function () { setSelectionFocus(false) },
        onClick: function () { if (open) close(true); else show() }
      },
      h(DataIcon, { className: 'teff-triggerIcon', size: 16 }),
      h('span', { className: 'teff-triggerLabel' }, modelLabel),
      menu.effortLabel !== undefined ? h('span', { className: 'teff-triggerEffort' }, menu.effortLabel) : null,
      busy ? h(SpinnerDot) : h(ChevronIcon, { className: 'teff-chevron' + (open ? ' teff-chevronOpen' : '') })),
      open && typeof document !== 'undefined' && document.body
        ? h('div', {
            ref: menuRef,
            className: 'teff-menu' + (pane === 'effort' ? ' teff-menu--popup' : ''),
            style: menuPos || MEASURE_STYLE,
            // 无障碍对齐官方 asar:435792：模型 pane 的外层容器带 role=group
            // （内层 .teff-groups 才是 role=menu 的复合菜单），root/effort pane 用 menu。
            role: pane === 'model' ? 'group' : 'menu',
            'aria-label': '模型与思考强度'
          }, pane === 'root' ? rootPane : (pane === 'model' ? modelPane : effortPane))
        : null,
      toast !== null
        ? h(Toast, {
            key: toast.seq,
            text: toast.text,
            anchor: rootRef.current && rootRef.current.closest
              ? rootRef.current.closest('[data-composer-card]')
              : null
          })
        : null)
    }

    /* ── 插件入口 ─────────────────────────────────────────────────────────── */

    function apply(ctx) {
      injectStyles()

      // 浮层样式：走 ctx.effect 注册，返回清理函数摘掉 style 标签
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () {
          var tag = injectOverlayStyles()
          return function () {
            if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
          }
        })
      } else {
        injectOverlayStyles()
      }

      // 设置页：一节一页，registration 的 id 必须与 loader entry 名一致。
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'dsh-thinking-effort', order: 27, label: '思考强度' },
          function () {
            return h(ThinkingEffortPanel, null)
          }
        )
      })

      // 浮层挂载点：conversation.input.model 是 single 槽（scope:'session'，
      // asar:421867-421870），第二 entry 会 shadow 官方；动态注册的 entry 优先级
      // 更低反而成为 winner（asar:736916）——整体顶替官方模型 chip。不需要 id/order。
      ctx.slots.inject('conversation.input.model', function () {
        return ctx.slots.register(
          {
            name: 'conversation.input.model',
            inject: function (sessionId) {
              return { sessionId: sessionId }
            }
          },
          // ctx 通过渲染闭包透传：组件内拿不到模块级 ctx，宿主也不给全局 ctx。
          function (props) { return h(ModelSelectOverlay, { sessionId: props.sessionId, ctx: ctx }) }
        )
      })

      return function () {}
    }

    exports.apply = apply
    exports.inject = ['slots', 'connection']
    // 测试/上层可复用的纯函数（不引入官方 primitives，自实现）
    exports.__teff_pure = {
      orderModelProviders: orderModelProviders,
      rankByName: rankByName,
      buildChoices: buildChoices,
      findCurrentChoice: findCurrentChoice,
      computeMenuData: computeMenuData,
      menuPlacement: menuPlacement,
      sliderOffset: sliderOffset,
      effortVisual: effortVisual,
      topLevel: topLevel,
      effortIndex: effortIndex,
      observeStickyMenuGroups: observeStickyMenuGroups
    }
    // 组件级测试用（preview/verify.mjs 用真 React 直接渲染弹层，覆盖读法 A 与开关两态）
    exports.__teff_components = { CodexEffortPopup: CodexEffortPopup }
    return module.exports
  }
})
