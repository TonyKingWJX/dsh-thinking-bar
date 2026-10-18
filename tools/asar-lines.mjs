// Print a line range of a large text file (asar) without loading it all.
import fs from 'node:fs'

const [, , file, from, to] = process.argv
const start = Number(from) - 1
const end = Number(to)
const fd = fs.openSync(file, 'r')
const size = fs.fstatSync(fd).size
const CH = 1 << 20
const buf = Buffer.alloc(CH)
let pos = 0
let line = 1
let carry = ''
const out = []
while (pos < size) {
  const n = fs.readSync(fd, buf, 0, CH, pos)
  if (n <= 0) break
  pos += n
  const chunk = carry + buf.subarray(0, n).toString('utf8')
  const parts = chunk.split('\n')
  carry = parts.pop()
  for (const p of parts) {
    if (line >= start && line < end) out.push(String(line) + ': ' + p)
    line++
  }
}
if (line >= start && line < end) out.push(String(line) + ': ' + carry)
fs.closeSync(fd)
process.stdout.write(out.join('\n'))