/*
 * 从 app.asar 抽取 DSH 真实主题 CSS，产出 preview/vendor/dsh-theme.css。
 * 目的：离线预览页要忠实还原 DSH 外观，token 不能手抄猜值。
 * 只读 asar（分块扫描，不整文件载入），只写 preview/ 目录。
 *
 * 为什么要抽两段：
 *  1) ui-theme 的主题 token 表（--dsw-static-* / --dsw-alias-* / 组件样式）
 *  2) ui-theme 的 corner-shape.css —— 一条全局规则把所有元素的圆角压成超椭圆，
 *     少了它，预览里的圆是真圆、真机上是圆角矩形，形状类 bug 永远复现不出来。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASAR =
  'D:\\Apps\\Users\\wang\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'

/* ------------------------------------------------------------------ */
/* 分块扫描 asar 找锚点。asar 是个大二进制包，主题 CSS 以一行未转义 CSS */
/* 夹在中间，行号会随打包变化，所以这里只认锚点文本，不认行号。        */
/* ------------------------------------------------------------------ */
function findInAsar(needle, onFound) {
  const fd = fs.openSync(ASAR, 'r')
  const size = fs.fstatSync(fd).size
  const CHUNK = 1 << 22
  const buf = Buffer.alloc(CHUNK)
  let carry = ''
  let pos = 0
  try {
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos)
      if (n <= 0) break
      const chunk = carry + buf.toString('utf8', 0, n)
      const at = chunk.indexOf(needle)
      if (at >= 0) {
        const result = onFound(chunk, at)
        if (result !== undefined && result !== null) return result
      }
      // 留一点重叠，避免锚点正好跨在块边界上
      carry = chunk.slice(-256)
      pos += n
    }
  } finally {
    fs.closeSync(fd)
  }
  return null
}

/* ---- 1. 主题 token 表 -------------------------------------------------
   锚点 'body{--dsw-static-amber-100: rgb(' 是行内 CSS 的开头（这行前面是
   二进制噪声），CSS 到这行末尾的换行结束，换行后面紧接着 React 包。   */
const THEME_ANCHOR = 'body{--dsw-static-amber-100: rgb('

const themeCss = findInAsar(THEME_ANCHOR, (chunk, at) => {
  const nl = chunk.indexOf('\n', at)
  if (nl < 0) return null // 这行比块还长，理论上不会发生；交给下一轮
  return chunk.slice(at, nl)
})
if (!themeCss) throw new Error('未找到主题 CSS 行（asar 结构可能已变）')
if (!themeCss.includes('--dsw-alias-')) {
  throw new Error('抽到的主题 CSS 不含 --dsw-alias-，抽取锚点已失效')
}

/* ---- 2. corner-shape.css ---------------------------------------------
   打包产物里是：var corner_shape_css_default = "@supports (…){…}";
   内部没有双引号，所以取锚点后第一个 '"' 到下一个 '";' 就是原文。      */
const CORNER_ANCHOR = 'corner_shape_css_default'

const cornerShapeCss = findInAsar(CORNER_ANCHOR, (chunk, at) => {
  const quoted = chunk.indexOf('"', at)
  if (quoted < 0) return null
  const end = chunk.indexOf('";', quoted + 1)
  if (end < 0) return null
  return chunk.slice(quoted + 1, end)
})
if (!cornerShapeCss) throw new Error('未找到 corner-shape.css（asar 结构可能已变）')
if (!cornerShapeCss.includes('--dsw-corner-shape')) {
  throw new Error('抽到的 corner-shape.css 不含 --dsw-corner-shape，抽取锚点已失效')
}

fs.mkdirSync(path.join(HERE, 'vendor'), { recursive: true })
fs.writeFileSync(
  path.join(HERE, 'vendor', 'dsh-theme.css'),
  '/* 从 app.asar 原样抽取的 DSH 主题 CSS（含 --dsw-static-* / --dsw-alias-* 与组件样式） */\n' +
    themeCss +
    '\n\n/* 宿主 corner-shape.css：全局超椭圆圆角。预览没有它，圆角就和真机不是一回事 */\n' +
    cornerShapeCss +
    '\n'
)

console.log('theme css length:', themeCss.length)
console.log('  alias count:', (themeCss.match(/--dsw-alias-/g) || []).length)
console.log('  static count:', (themeCss.match(/--dsw-static-/g) || []).length)
console.log('  dark blocks:', (themeCss.match(/data-ds-dark-theme/g) || []).length)
console.log('  head:', themeCss.slice(0, 90))
console.log('  tail:', themeCss.slice(-90))
console.log('corner-shape css:', cornerShapeCss)
