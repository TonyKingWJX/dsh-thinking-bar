/*
 * 把磁盘上真实的 React 19.2.3 CJS 构建打成一个浏览器可加载的包：
 * preview/vendor/react-bundle.js
 *
 * 为什么需要它：React 19 不再发 UMD 构建，磁盘上只有 CJS 形态
 * （react/cjs/react.production.js 等），不能直接 <script> 加载。
 * 这里把每个文件包成 define(name, function(module, exports, require){...})，
 * 用一个极小的 CommonJS 注册表在浏览器里还原 require 语义，
 * 于是预览页可以跑**真 React**，而不是替身渲染器。
 *
 * 只读 node_modules（ZCode 项目里那份），只写 preview/。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REACT_ROOT = 'D:\\VibeCoding\\ZCode\\opus55-videos\\projects\\the-day\\node_modules'

/* 依赖图（实测：require 关系干净，仅这 4 个文件） */
const FILES = [
  ['react', 'react/cjs/react.production.js'],
  ['scheduler', 'scheduler/cjs/scheduler.production.js'],
  ['react-dom', 'react-dom/cjs/react-dom.production.js'],
  ['react-dom/client', 'react-dom/cjs/react-dom-client.production.js']
]

const out = []
out.push('/* 自动生成，勿手改：由 preview/build-react.mjs 打包真实 React 19 CJS 构建。 */')
out.push('(function (global) {')
out.push('  var modules = {}')
out.push('  var cache = {}')
out.push('  function define(name, fn) { modules[name] = fn }')
out.push('  function require(name) {')
out.push('    if (cache[name]) return cache[name].exports')
out.push('    var fn = modules[name]')
out.push('    if (!fn) throw new Error("preview: 未注册的模块 " + name)')
out.push('    var mod = { exports: {} }')
out.push('    cache[name] = mod')
out.push('    fn(mod, mod.exports, require)')
out.push('    return mod.exports')
out.push('  }')
/* React 生产构建在错误路径上会读 process.emit 与 process.env，浏览器里没有 process。 */
out.push('  global.process = global.process || { env: { NODE_ENV: "production" }, emit: function () {} }')
out.push('  global.__previewRequire = require')

for (const [name, rel] of FILES) {
  const src = fs.readFileSync(path.join(REACT_ROOT, rel), 'utf8')
  out.push('  /* ---- ' + rel + ' (' + src.length + ' bytes) ---- */')
  out.push('  define(' + JSON.stringify(name) + ', function (module, exports, require) {')
  out.push(src)
  out.push('  })')
}

out.push('})(typeof window !== "undefined" ? window : globalThis)')
out.push('')

fs.mkdirSync(path.join(HERE, 'vendor'), { recursive: true })
const target = path.join(HERE, 'vendor', 'react-bundle.js')
fs.writeFileSync(target, out.join('\n'))

console.log('wrote', target, fs.statSync(target).size, 'bytes')
console.log('modules:', FILES.map(([n]) => n).join(', '))
