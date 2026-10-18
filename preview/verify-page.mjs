/* 预览页内联脚本语法与接线自检（不需要浏览器） */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8')

const m = html.match(/<script>([\s\S]*?)<\/script>/)
if (!m) {
  console.log('FAIL 未找到内联 <script>')
  process.exit(1)
}
try {
  new Function(m[1])
  console.log('PASS 内联脚本语法正确（' + m[1].length + ' 字符）')
} catch (e) {
  console.log('FAIL 内联脚本语法错误：' + e.message)
  process.exit(1)
}

const ids = ['pv-open', 'pv-close', 'pv-check', 'pv-level', 'pv-checks', 'pv-summary2', 'pv-log',
  'pv-slot-model', 'pv-slot-settings', 'pv-dark', 'pv-narrow', 'pv-summary']
const missing = ids.filter((id) => !html.includes('id="' + id + '"'))
console.log(missing.length ? 'FAIL 缺少元素 id: ' + missing.join(', ') : 'PASS 全部必需元素 id 存在')

const handlers = ['pv-open', 'pv-close', 'pv-check', 'pv-level', 'pv-dark', 'pv-narrow']
const unbound = handlers.filter((id) => !new RegExp("getElementById\\('" + id + "'\\)\\.addEventListener").test(html))
console.log(unbound.length ? 'FAIL 未绑定事件: ' + unbound.join(', ') : 'PASS 全部诊断按钮已绑定事件')

const must = [
  ['加载真实插件文件', /s\.src\s*=\s*'\.\.\/lib\/client\.js'/],
  ['安装 __ModuleLoader__', /window\.__ModuleLoader__\s*=/],
  ['注入真 React', /window\.React\s*=\s*window\.__previewRequire\('react'\)/],
  ['拦截 fetch 走插件 API', /'\/dsh-thinking-effort\/api'/],
  ['渲染 chip 到 composer 槽', /createRoot\(document\.getElementById\('pv-slot-model'\)\)/],
  ['渲染设置页', /createRoot\(document\.getElementById\('pv-slot-settings'\)\)/],
  ['窄容器降级开关', /--dsh-composer-model-text-display/],
  ['深色主题开关', /data-ds-dark-theme/],
  ['不写真实配置（内存副本）', /hostState\.config\.enabled\s*=\s*!!args\.enabled/]
]
let bad = 0
for (const [name, re] of must) {
  const ok = re.test(html)
  if (!ok) bad++
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
}

/* 层级约束：预览脚手架顶栏必须低于产品弹层，否则 sticky 顶栏会盖住向上弹出的菜单
   （用户 m04522「预览有东西会遮挡」）。产品弹层的 z-index 从真实源码读，不写死常量 —— 
   两边都改（比如产品提到 2000、脚手架保持 900）时这条必须失败。 */
const pvTopZ = html.match(/\.pv-top\s*\{[^}]*?z-index\s*:\s*(\d+)/)
const menuZ = fs
  .readFileSync(path.join(HERE, '..', 'lib', 'client.js'), 'utf8')
  .match(/\.teff-menu\{[^}]*?z-index\s*:\s*(\d+)/)
if (!pvTopZ || !menuZ) {
  bad++
  console.log('FAIL 无法读到 .pv-top / .teff-menu 的 z-index（层级回归断言失去依据）')
} else if (Number(pvTopZ[1]) >= Number(menuZ[1])) {
  bad++
  console.log(
    'FAIL 预览顶栏 z-index(' + pvTopZ[1] + ') 必须低于产品弹层 .teff-menu(' + menuZ[1] + ') —— 否则顶栏盖住弹层（m04522）'
  )
} else {
  console.log('PASS 预览顶栏层级(' + pvTopZ[1] + ') 低于产品弹层(' + menuZ[1] + ')')
}

if (bad) process.exit(1)
console.log('preview page ok — 预览页接线自检全部通过')
