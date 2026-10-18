/*
 * 从 app.asar 抽取 DSH 真实主题 CSS，产出 preview/vendor/dsh-theme.css。
 * 目的：离线预览页要忠实还原 DSH 外观，token 不能手抄猜值。
 * 只读 asar（分块扫描，不整文件载入），只写 preview/ 目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASAR =
  'D:\\Apps\\Users\\wang\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'

/* 逐块读 asar，按行号收集区间内的行。 */
function readLines(file, from, to) {
  const fd = fs.openSync(file, 'r')
  const size = fs.fstatSync(fd).size
  const CHUNK = 1 << 22
  const buf = Buffer.alloc(CHUNK)
  let carry = ''
  let lineNo = 0
  const out = []
  let pos = 0
  while (pos < size && lineNo <= to) {
    const n = fs.readSync(fd, buf, 0, CHUNK, pos)
    if (n <= 0) break
    const chunk = carry + buf.toString('utf8', 0, n)
    const lines = chunk.split('\n')
    carry = lines.pop()
    for (const L of lines) {
      lineNo += 1
      if (lineNo >= from && lineNo <= to) out.push([lineNo, L])
    }
    pos += n
  }
  fs.closeSync(fd)
  return out
}

const WINDOW_FROM = 2338840
const WINDOW_TO = 2338860
const lines = readLines(ASAR, WINDOW_FROM, WINDOW_TO)

/* 真实主题 CSS 是 asar 尾部打包的一大行（行首带二进制噪声），
   以 'body{--dsw-static-amber-100: rgb(' 为锚点截取。 */
const blob = lines.find(([, L]) => L.includes('body{--dsw-static-amber-100: rgb('))
if (!blob) throw new Error('未找到主题 CSS blob（asar 结构可能已变）')
const start = blob[1].indexOf('body{--dsw-static-amber-100: rgb(')
const css = blob[1].slice(start)

fs.mkdirSync(path.join(HERE, 'vendor'), { recursive: true })
fs.writeFileSync(
  path.join(HERE, 'vendor', 'dsh-theme.css'),
  '/* 从 app.asar:' + blob[0] + ' 原样抽取的 DSH 主题 CSS（含 --dsw-static-* 与 --dsw-alias-*） */\n' + css + '\n'
)

console.log('theme blob line:', blob[0], 'raw line length:', blob[1].length, 'css length:', css.length)
console.log('alias count:', (css.match(/--dsw-alias-/g) || []).length)
console.log('static count:', (css.match(/--dsw-static-/g) || []).length)
console.log('dark blocks:', (css.match(/data-ds-dark-theme/g) || []).length)
console.log('head:', css.slice(0, 200))
console.log('tail:', css.slice(-200))
