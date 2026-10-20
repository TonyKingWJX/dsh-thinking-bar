/**
 * tools/shoot-preview.mjs —— 用无头 Edge + CDP 生成 README 预览图。
 *
 * 为什么不用 --screenshot：那个只能整页截，卡片是 fixed 定位的小弹层，
 * 整页截完还得按像素猜裁剪框，弹层一改尺寸就要重猜。
 * 这里走 CDP：先渲染，再用 Runtime.evaluate 量出卡片（含溢出的立绘）的真实
 * 包围盒，最后按这个盒子 clip 截图——卡片尺寸怎么变都不用改脚本。
 *
 * 用法：
 *   node tools/shoot-preview.mjs            # 全部重拍，写入 docs/screenshots/
 *   node tools/shoot-preview.mjs --only popup-model-dark
 *   node tools/shoot-preview.mjs --out .tmp/probe   # 换输出目录
 */

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

/* ------------------------------------------------------------------ 清单 */

/** margin: 卡片四周留白（CSS px）。立绘会溢出卡片，靠包围盒自然撑开。 */
const SHOTS = [
  { name: 'popup-codex-dark', qs: 'visual=codex&pane=effort&effort=high&dark=1', margin: 16 },
  { name: 'popup-codex-light', qs: 'visual=codex&pane=effort&effort=high', margin: 16 },
  { name: 'popup-energy-dark', qs: 'visual=energy&pane=effort&effort=high&dark=1', margin: 16 },
  { name: 'popup-warp-dark', qs: 'visual=warp&pane=effort&effort=high&dark=1', margin: 16 },
  { name: 'popup-quantum-dark', qs: 'visual=quantum&pane=effort&effort=high&dark=1', margin: 16 },
  { name: 'popup-whale-dark', qs: 'visual=whale&pane=effort&effort=high&dark=1', margin: 16 },
  { name: 'popup-liang-dark', qs: 'visual=liang&pane=effort&effort=high&dark=1', margin: 16 },
  { name: 'popup-model-dark', qs: 'visual=codex&pane=model&dark=1', margin: 16 },
  { name: 'popup-model-light', qs: 'visual=codex&pane=model', margin: 16 },
  { name: 'popup-liang-model', qs: 'visual=liang&pane=model&dark=1', margin: 16 }
]

/* ------------------------------------------------------------------- args */

function argOf(flag) {
  const i = process.argv.indexOf(flag)
  return i > 0 ? process.argv[i + 1] : null
}
const ONLY = argOf('--only')
const OUT_DIR = path.resolve(ROOT, argOf('--out') || 'docs/screenshots')
const SCALE = Number(argOf('--scale') || 2)
const PAGE_W = 1280
const PAGE_H = 940

let shots = SHOTS
if (ONLY) {
  const wanted = ONLY.split(',')
  shots = SHOTS.filter((s) => wanted.includes(s.name))
  if (!shots.length) {
    console.error(`unknown shot: ${ONLY}\navailable: ${SHOTS.map((s) => s.name).join(', ')}`)
    process.exit(1)
  }
}

/* -------------------------------------------------------------------- cdp */

const PORT = 9411
const userDataDir = mkdtempSync(path.join(tmpdir(), 'teff-shoot-'))

function launch() {
  const child = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      `--user-data-dir=${userDataDir}`,
      `--window-size=${PAGE_W},${PAGE_H}`,
      `--remote-debugging-port=${PORT}`,
      'about:blank'
    ],
    { stdio: 'ignore', detached: false }
  )
  return child
}

async function targets() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page && page.webSocketDebuggerUrl) return page
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('CDP 端口没起来，Edge 可能被安全策略挡住')
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let seq = 0
    const listeners = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: no } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) no(new Error(`${msg.method || ''} ${JSON.stringify(msg.error)}`))
        else ok(msg.result)
        return
      }
      if (msg.method && listeners.has(msg.method)) {
        for (const fn of listeners.get(msg.method)) fn(msg.params)
        listeners.delete(msg.method)
      }
    })
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 出错')))
    ws.addEventListener('open', () => {
      const send = (method, params = {}) =>
        new Promise((ok, no) => {
          const id = ++seq
          pending.set(id, { resolve: ok, reject: no })
          ws.send(JSON.stringify({ id, method, params }))
        })
      const once = (method) =>
        new Promise((ok) => {
          if (!listeners.has(method)) listeners.set(method, [])
          listeners.get(method).push(ok)
        })
      resolve({ send, once, close: () => ws.close() })
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ 量尺寸 */

/** 卡片包围盒 = .teff-card 自身 + 所有后代（立绘会溢出到卡片外）。 */
const MEASURE = (margin) => `(() => {
  const card = document.querySelector('.teff-card')
  if (!card) return { error: 'no .teff-card' }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  const eat = (r) => {
    if (!r.width || !r.height) return
    x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top)
    x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom)
  }
  eat(card.getBoundingClientRect())
  for (const el of card.querySelectorAll('*')) eat(el.getBoundingClientRect())
  if (!isFinite(x1)) return { error: 'empty box' }
  const m = ${margin}
  const vw = innerWidth, vh = innerHeight
  const x = Math.max(0, Math.floor(x1 - m))
  const y = Math.max(0, Math.floor(y1 - m))
  const w = Math.min(vw - x, Math.ceil(x2 - x1 + m * 2))
  const h = Math.min(vh - y, Math.ceil(y2 - y1 + m * 2))
  return {
    clip: { x, y, width: w, height: h, scale: 1 },
    box: [Math.round(x1), Math.round(y1), Math.round(x2 - x1), Math.round(y2 - y1)],
    pane: card.getAttribute('data-pane'),
    visual: card.getAttribute('data-visual'),
    tone: card.getAttribute('data-tone')
  }
})()`

/* ------------------------------------------------------------------ 主流程 */

const fileUrl = (qs) =>
  'file:///' +
  path.join(ROOT, 'preview', 'index.html').replace(/\\/g, '/').replace(/ /g, '%20') +
  '?mode=codex&open=1&' +
  qs

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const edge = launch()
  let ctl
  try {
    const target = await targets()
    ctl = await connect(target.webSocketDebuggerUrl)
    await ctl.send('Page.enable')
    await ctl.send('Runtime.enable')
    await ctl.send('Emulation.setDeviceMetricsOverride', {
      width: PAGE_W,
      height: PAGE_H,
      deviceScaleFactor: SCALE,
      mobile: false
    })

    for (const shot of shots) {
      const loaded = ctl.once('Page.loadEventFired')
      await ctl.send('Page.navigate', { url: fileUrl(shot.qs) })
      await loaded
      await sleep(420) // 让 React 挂载 + 字体就位

      const probe = await ctl.send('Runtime.evaluate', {
        expression: MEASURE(shot.margin),
        returnByValue: true
      })
      const info = probe.result && probe.result.value
      if (!info || info.error) throw new Error(`${shot.name}: ${info && info.error}`)

      const png = await ctl.send('Page.captureScreenshot', {
        format: 'png',
        clip: info.clip,
        captureBeyondViewport: true
      })
      const buf = Buffer.from(png.data, 'base64')
      const file = path.join(OUT_DIR, `${shot.name}.png`)
      writeFileSync(file, buf)
      console.log(
        `✓ ${shot.name.padEnd(22)} ${String(Math.round(info.clip.width * SCALE)).padStart(4)}x` +
          `${String(Math.round(info.clip.height * SCALE)).padStart(4)}  ` +
          `${(buf.length / 1024).toFixed(0)}KB  card=${info.box.join('x')} ` +
          `pane=${info.pane} tone=${info.tone} visual=${info.visual}`
      )
    }
  } finally {
    if (ctl) ctl.close()
    edge.kill()
    await sleep(200)
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {}
  }
}

main().catch((err) => {
  console.error('截图失败：', err.message)
  process.exit(1)
})
