# docs/review-notes.md — 设计评审（DESIGN.md v1）+ Codex 最大档动画实现规格

> 负责卡片：设计评审+Codex动画规格（step-5-preview）。事实来源：`DESIGN.md`（86 行，v1 2026-10-15）+ DSH bundle `D:\Apps\Users\wang\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`（行号均指该文件）。
> 评审原则：每条风险都给「DESIGN.md 原文/行号 → asar 实证 → 为什么是坑 → 具体修复」。凡 asar 无实证的推测都显式标注 `[未验证]`。

---

## 第一部分 · 设计评审：风险清单

### 总览（按严重度排序）

| # | 风险 | 严重度 | DESIGN.md 位置 | 一句话结论 |
|---|---|---|---|---|
| R1 | 双写通道竞态（configEditor 走 cordis.patch.yml vs settings.mutate 走 settings.yaml，写同一棵树） | 🔴 阻塞 | L32/L33/L85 | 「冲突重试一次」对 configEditor 路径根本不成立，需单写者队列+写后自检 |
| R2 | 自动接管误伤非推理模型 | 🔴 阻塞 | L34 | 写任何 dict 都会把模型强制变成 `reasoning:true`（859990），`reasoning:false` 模型中枪 |
| R3 | 补写 dict 会「折叠」已有 thinkingLevelMap | 🔴 阻塞 | L39 | 未声明的档位被显式写成 `null`（859983-987），用户现有 medium 档直接消失 |
| R4 | off 键三态语义被 DESIGN.md 简化成两态 | 🟠 高 | L25/L39/L41 | 缺键≠null：UI 仍展示该档，dispatch 多数适配器下发硬编码 `"none"` |
| R5 | YAML off 键陷阱落点写错（不是 cordis.patch.yml） | 🟠 高 | L41 | reasoningEfforts 的持久化落点是 **settings.yaml**；且 `off` 经 JSON mutate 落盘后是否被加引号取决于序列化器 |
| R6 | 自动接管事件回环（自己写→自己收到→再写） | 🟠 高 | L40/L27 | 需回执抑制+去重+防重入，否则无限补写 |
| R7 | 「上游探测」名不副实 | 🟠 高 | L37 | `llm.discoverModels` 回复从不携带 reasoningEfforts（859022/859269），探测不出档位 |
| R8 | defaultEffort 双缺失会把每个请求打翻 | 🟠 高 | L53/L28 | model 无 defaultEffort 且会话无 effort → `effective=undefined` → UNSUPPORTED_REASONING_EFFORT（865868-870） |
| R9 | 「最大档」在大量模型上不存在 | 🟡 中 | L11/L56 | ant-ling/together/google-vertex 等无 `max` 档，动画触发条件需重新定义 |
| R10 | 知识库 ladder 表缺「缺键」这一形态 | 🟡 中 | L36 | 真实目录里 claude 系只有 `{off:null,xhigh:"xhigh",max:"max"}`，low/medium/high 靠缺键兜底 |
| R11 | chip 档位名必须用服务端 `name`，不能硬编码英文 | 🟢 低 | L51-53 | `reasoningInfo` 的 name 来自服务端映射（861133-134），硬编码会与官方不一致 |
| R12 | 主题前车之鉴（ui-theme 事件） | 🟢 低 | §3 全局 | 不得缓存 theme，开弹层时重取 + 订阅 theme-updated |

---

### R1 🔴 数据层竞态：两条写通道、一套「重试一次」

**DESIGN.md 原文**
- L32：「配置树路径（已证实）：`llm-pi-ai.config.providers.<providerId>.models.<modelId>.reasoningEfforts`……与实机 cordis.patch.yml 中已有 provider 的 models[].reasoningEfforts 形状完全吻合」。
- L33：「首选 **configEditor**……写入 profileContext.patchPath（cordis.patch.yml），按 entry.options.id 定位 patch 行，有文件锁/reconcile/回滚保护……`settings.mutate('llm-pi-ai', ops)` 保留为备选/回退」。
- L85（§7.3）：「settings.mutate 与 configEditor 并发写：两条通道写同一棵配置树……缓解：冲突重试一次 + 补写幂等」。

**asar 实证**
- settings namespace 的持久化落盘是 **settings.yaml**，不是 patch.yml：971821/972256/972297/972302 `join(profile.home, "settings.yaml")`；480426/480440 文档「are what settings.yaml carries」；settings 服务 `import { parse } from "yaml"`（eemeli/yaml，971958/972503）。
- `settings.mutate(ns, ops, expectedRevision)` 语义（341018-341028/341567-341569 jsDoc）：「Apply path-addressed edits to one namespace's user section, **resolved against the section as stored rather than against whatever the caller last read**」；`@param expectedRevision - revision the caller read; undefined writes unconditionally`。
- 并发写失败形态：341097/342431 `RemoteError('settings/conflict', ..., { ns, expected, actual })`；479087「concurrent write from another tab or an external cordis.patch.yml edit is refused as settings/conflict」。
- 官方设置页同样在写这个 ns：482083 `const response = await ctx.remote.settings.mutate(ns, ops, expectedRevision);`、482089 有 `settings/conflict` 分支、489353 `mutate(this.spec.namespace, ownedOps, revision)`、438422 General 行 mutate。

**为什么是坑**
1. 「冲突重试一次」假定的是 revision 栅栏语义；而 configEditor 路径是**文件锁/reconcile**语义（L33 自述），两者冲突形态不同，重试策略不能共用。configWriter 与 mutate 同时改一棵树时，后写者会把先写者的改动**整段覆盖**（patch.yml 是 config entry，settings.yaml 是 user 层，两层合并优先级 `[未验证]`——这是本评审最大的未知量）。
2. `expectedRevision` 传 `undefined` = 无条件写（341569）。自动接管批量补写时若为了「避免冲突」而省略 revision，等于关掉了唯一的一致性保护。
3. 官方 Models 设置页随时可能并发 mutate 同一 ns（489353），我们在 `settings/document-updated` 回调里同步补写，等于把冲突窗口拉到最大。

**修复建议（落到代码级）**
- **单写者队列**：Host 半侧所有对 `llm-pi-ai` 的写入串行到一个 `writeQueue`（Promise 链），任一时刻只有一个 in-flight mutate/edit；批量补写按 provider 分片，每片一次 mutate。
- **永远带 revision**：`expectedRevision` 从当次 `settings.describe()`（或上一次 mutate 返回的脱敏视图）实时取，禁止缓存超过一次写周期；480813 官方范式 `useState(() => namespace.revision)`。
- **冲突处理升级为重算-重试**：`settings/conflict` → 重新 describe → 用「已存分区」重放 ops（因为 mutate 本来就按 stored 解析，重点是重算哪些档位还缺）→ 最多重试 3 次，退避 100/300/900ms；仍失败则进设置页「待应用」列表，不静默丢弃。
- **写后自检（DESIGN.md L84 已有萌芽，提升为强制）**：每次写入后重新 `resolveModelInfo(provider, model)`，断言 `efforts` 与 `defaultEffort` 符合预期；不符则告警到设置页，绝不重试写入（防止写坏循环）。
- **二选一，不要双写**：第一版只走 `settings.mutate`（JSON 路径操作，语义最干净、可回滚、错误码明确）；configEditor 留到 §7.2 的 full-replace 不确定性清零后再启用。若两版都要，中间加一个「通道锁」配置项，运行期只允许一条通道活跃。
- **补写幂等**（L85 已提，需具体化）：写前比较 `desired ⊆ existing`，只对差集生成 `set` ops；缺键才写，绝不 `unset` 用户已有键。

---

### R2 🔴 自动接管误伤：任何 dict 都会把模型变成推理模型

**DESIGN.md 原文**
- L34：「扫描：读 llm-pi-ai user 层全部 `providers.<route>.models.*`，找出 `reasoning:true`（或未声明但疑似推理）且缺 `reasoningEfforts` 的模型。」

**asar 实证**
- 859972 `if (efforts === void 0) return { reasoning: base?.reasoning ?? false };`（**不写 = 保持已安装目录能力**）；
- 859990-991 成功路径产出 `{ reasoning: true, thinkingLevelMap: map }`——**只要 dict 存在，reasoning 就被钉成 true**。
- 真实目录里 `reasoning:false` 的模型一大把：groq `llama-3.1-8b-instant`/`llama-3.3-70b-versatile`（1105027）、ant-ling Ling-2.6 全系（1105015）、azure 全系（1105017）、together Qwen2.5-7B（1105046）。
- 反向误伤：vercel-ai-gateway 全部模型 `reasoning:true` 但**完全没有 thinkingLevelMap**（1105047）；together MiniMax-M3 `{minimal:null,low:null,medium:null}`（1105046，无 off/max）。

**为什么是坑**
1. 「或未声明但疑似推理」是一个猜测开关：对 `reasoning:false` 模型补 dict → 859990 强制 `reasoning:true` → 官方选择器突然多出档位、请求体突然多带 thinking 参数 → 非推理模型被我们改造成推理模型，用户账单和错误率一起炸。
2. 对 vercel-ai-gateway 这类「有 reasoning 无 map」的模型补 `{off:null,low,high,max}` → 860161 规则下 `max` 必须显式非 null，我们一写就等于**替厂商宣布支持 max**，上游 400 时用户只会骂插件。
3. together MiniMax 的 map 把 off/minimal/low/medium 全设 null，我们若按「默认保守档位」补 low/high/max，等于推翻厂商声明。

**修复建议**
- 准入条件收紧为**三条同时满足**：`reasoning === true` **且** 已存在 `thinkingLevelMap` **且** 目标档位在现有 map 中非 null。删掉「未声明但疑似推理」这条猜测分支（L34）。
- 内置知识库只允许**补充缺失键**，不允许**改写/新增已有键的值**（`existing[k] !== undefined` 才写 `k`）。
- 对 `reasoning:true` 但无 map 的 provider（vercel-ai-gateway 等）单独列为「需用户显式开启」白名单，不进自动接管。
- 设置页接管模式（L61）默认「仅浮层显示不改配置」，自动补写需用户二次确认；每个补写动作在设置页留审计行（provider/model/档位/时间/来源：知识库|用户）。
- 补写前本地跑一遍 Host 同款校验（865819-870 的规则）：efforts 非空、defaultEffort ∈ efforts、metadata 无重复——不一致就不写。

---

### R3 🔴 默认保守档位会「折叠」用户/目录已有 map

**DESIGN.md 原文**
- L39：「**默认保守档位**（知识库无匹配时）：`off:null, low:"low", high:"high", max:"max"`（跳过 medium/minimal，避免后端不支持报错）。」

**asar 实证**
- 859983-859987（resolveModelReasoning）：
  `const map = {}; for (const level of THINKING_LEVELS) { const wire = efforts[level]; if (wire === void 0) map[level] = null; else if (wire !== null) map[level] = wire; }`
  ——**任何被声明的 dict 都会展开成 7 档全量 map，未声明的档位显式写 null**。
- 860160 `if (mapped === null) return false;` → null 档在 UI 里直接消失。
- 反例：xai grok-4.3 `{off:"none",minimal:null,low:"low",medium:"medium",high:"high",xhigh:null,max:null}`（1105048）——它有 medium；cerebras gpt-oss-120b 同样有 low/medium/high（1105019）。

**为什么是坑**
「跳过 medium/minimal」在 dict 语义下不是「不加这几个键」，而是「把这几个键设为 null=不支持」。对本来有 medium 的模型（grok-4.3、gpt-oss-120b、google-vertex gemini-3-flash-preview 1105025），我们一补写，medium 就从官方选择器里消失了——这是功能性回退，且用户完全看不出是插件干的。

**修复建议**
- 补写算法改为 **merge，不是 replace**：
  ```
  next = { ...existingMap }            // 保留一切已有键（含 null）
  for (k of knowledgeBaseKeys) if (next[k] === undefined) next[k] = kbValue
  if (next.defaultEffort === undefined && existing.defaultEffort) next.defaultEffort = existing.defaultEffort
  ```
- 只有「整个 map 不存在」时才允许用 L39 的四键保守档位；并且此时必须先过 R2 的准入检查。
- 设置页的 per-model 编辑器要能**显示当前生效 map 的 7 档全貌**（含 null/缺键），让用户看见「缺键」和「null」的区别——这正是 R4 的用户可见面。

---

### R4 🟠 off 档三态：null / 缺键 / 字符串，行为完全不同

**DESIGN.md 原文**
- L25：「off 仅当 `thinkingLevelMap.off !== null` 时下发（1096866-6961）。」
- L39：默认档位写 `off:null`。
- L41：YAML 陷阱只提了引号问题。

**asar 实证（三态）**

| off 键状态 | UI 是否展示 off 档（860158-861161） | dispatch 行为 |
|---|---|---|
| `null` | 否（860160 直接 return false） | 各适配器 `else if (model.thinkingLevelMap?.off !== null)` 守卫跳过（1096914/1096930/1096952/1095367-5368/1098543-8545） |
| **缺键（undefined）** | **是**（undefined !== null，标准档仅 null 才剔除） | 守卫 `undefined !== null` 为真 → 多数适配器下发硬编码 `"none"`：1096914/1096930/1096952 `... = model.thinkingLevelMap?.off ?? "none"`；Google 走另一支 1095356-5359 三元判断 |
| 字符串（`"none"`/`"off"`） | 是 | 按 wire 值下发（1096903-6904、1096931、1096953、1096961-6963） |

真实目录三种都有：fireworks deepseek `off:"none"`（1105023）；anthropic/github-copilot/opencode/cloudflare-ai-gateway/radius claude 系 `off:null`（1105016/1105020/1105024/1105040/1105045）；**cloudflare-workers-ai 与 opencode-go 的 deepseek 完全无 off 键**（1105021/1105039）；vercel 无 map。

**为什么是坑**
1. L25 的表述会让人以为「不写 off 键 = 不下发 off」。事实相反：**缺键时 UI 照常展示 off 档，用户一选，多数适配器下发硬编码 `"none"`**——一个我们没声明过的 wire 值。
2. L39 给我们自己的补写选了 `off:null`。对**本来缺 off 键**的模型（cloudflare-workers-ai/opencode-go deepseek）补 `off:null`，行为从「下发 none」变成「off 档消失」，属于静默改语义。
3. wire 值不能照抄：radius cheap 的 `max:"xhigh"`（1105045）证明**档位名与 wire 值可以不一致**；我们的 chip 必须显示档位名（level id），下发时用 map 值。

**修复建议**
- 内部建模用三态枚举，不用布尔：`type OffState = {kind:'null'} | {kind:'absent'} | {kind:'wire', value:string}`；档位可用性判定**逐字复刻** 860158-861161（`mapped === null → 不可用；xhigh/max 必须显式非 null`）。
- 补写时**保留现有 off 状态**：`next.off = existing.off`（缺键就继续缺键），知识库只允许在 `existing.off === undefined && kb.off !== undefined` 时补。
- 若知识库要表达「此模型不该有 off 档」，显式写 `null` 并在设置页标注「已禁用 off」；绝不能用「省略」来表达禁用。
- chip / 弹层的档位列表必须从 `reasoning.efforts`（服务端算好的，861132）取，**不要在客户端用 map 自己算一遍**——两套实现必然漂移。

---

### R5 🟠 YAML off 键陷阱：落点写错，且 mutate 并不能完全「避开」

**DESIGN.md 原文**
- L41：「**YAML 陷阱**：经文件路径操作写 YAML 时 `"off"` 键必须加引号（YAML 1.1 会把裸 off 解析为布尔 false）。settings.mutate 走 JSON 路径操作可避开，但补写落盘到 cordis.patch.yml 的场景要注意。」

**asar 实证**
- 持久化落点是 **settings.yaml**（971821/972256/972297/972302；480426/480440），settings 服务用 eemeli/yaml `parse`（971958/972503）。
- asar 内**同时打包了两套 YAML 库**：js-yaml（271670/287989/288801/356738-739、732033、2292166、2295755、2295853）与 eemeli yaml（732036/748745/892420/909180/2095447）。js-yaml 默认 schema 是 YAML 1.1（`off` → `false`）；eemeli 默认 core 1.2（`off` → 字符串）。**哪个加载器读哪个文件 `[未验证]`**，但用户完全可能用外部工具（PyYAML、某些编辑器插件）按 1.1 打开 settings.yaml。
- zod 键校验：860404 `z.dict(z.union([z.string(), z.const(null)]), z.union(THINKING_LEVELS))`——键必须是 7 个档位名之一；`false` 会直接判定非法 → 865819 `INVALID_MODEL_REASONING`，**整个 reasoningEfforts 被丢**（不是只丢 off 键）。

**为什么是坑**
1. L41 说落盘要注意 cordis.patch.yml——如果第一版按 R1 建议只走 `settings.mutate`，落盘就是 settings.yaml，L41 的警告指错了文件，真正危险的地方没有护栏。
2. 「mutate 走 JSON 路径操作可避开」只对**内存中的写入**成立。mutate 的 value 是 `JsonValue`（341598/1020702 `{op:'set'; path:string[]; value:JsonValue}`），字符串 `"off"` 进内存没问题；但 settings 服务最终 `stringify` 回 settings.yaml 时，**eemeli 的默认 stringify 不会给 core-schema 字符串加引号**（`off` 在 1.2 是合法字符串，无需引号）——于是磁盘上出现裸 `off:`，任何一个 1.1 读者都会把它变成 `false`。
3. 更阴的是：我们自己用 mutate 写进去是好的，用户手工编辑过一次 settings.yaml（1.1 语义）后，Host 重载直接丢档位，且报错发生在 resolveModelReasoning 而非写入点，极难定位。

**修复建议**
- 落盘 YAML 的场景**统一加引号**：若最终走 configEditor/patch 文件，写入前用 `js-yaml.dump(obj, {quotes:true})` 或对 `off` 键单独处理（`"off"`）；若走 settings.mutate，在 mutate 之后读一次 `settings.describe()` 脱敏视图 + 直接读 settings.yaml 原文，断言 `off` 键带引号（自检，L84 精神）。
- 启动自检：插件 apply 时读取 settings.yaml 原文，正则查 `^\s*off:\s*$|off:\s*off`（未加引号的裸 off）；发现即在设置页横幅告警并给一键修复（重写为 `"off"`）。
- 文档层面把 L41 改成：「off 键在任何 YAML 落盘点（settings.yaml / cordis.patch.yml）都必须带引号；mutate 只保证内存正确，不保证落盘字形」。
- 客户端预校验：写入前用同一套 zod 规则（860404）在本地校验 dict，键/值任一不合法就拒绝写入并提示，别等 Host 报 INVALID_MODEL_REASONING。

---

### R6 🟠 事件时序：自己写的自己收，回环风险

**DESIGN.md 原文**
- L27：「刷新链：配置写入 → `llm/adapters-updated`（无 payload，863508）+ `settings/document-updated` → Web 端 ModelCatalogDirectory（435288 ctx.remote.$on）、Models 设置页（479087/483338）、模型选择器自动 refetch，**无需重启**。」
- L40：「**自动接管**：监听 `settings/document-updated`（0.1.7-rc.x 事件名；旧 `settings/updated` 已删）→ 新 provider/模型缺字段时按上述瀑布补写。」

**asar 实证**
- `settings/document-updated` **带载荷**：972389/972415 `this.ownerContext.emit("settings/document-updated", entry.options.id, revision)`；签名 1017934-36 `'settings/document-updated'(ns: SettingsNamespace, revision: number): void`。DESIGN.md L27 说它「无 payload」是错的（无 payload 的是 `llm/adapters-updated`：863508/863686「The llm/adapters-updated event is payload-free by design; consumers re-read the registries」）。
- ModelDirectory 已经在订阅这三类事件并自带代际计数器：434754「Every resident directory refetches directly on forwarded llm/adapters-updated, settings/document-updated, and credential update events」；434869「Directory loads and selections share a generation counter so an older response never overwrites a newer one」。

**为什么是坑**
1. **回环**：我们补写 llm-pi-ai → `settings/document-updated('llm-pi-ai', rev)` → 我们的监听器再次触发扫描 → 发现同一模型还「缺」别的档位 → 再写 → 再触发……即使幂等判断做对，每次都是全量扫描 + 潜在写入，CPU 和日志一起飞。
2. **不要在事件回调里同步写**：回调同步写会在 registry 替换过程中再触发一次 reconcile，官方设置页可能同时在做 mutate（489353），冲突窗口最大化。
3. **`llm/adapters-updated` 无 payload 的代价**：每次都要全量重读 registry/provider 列表；若我们的扫描是全量 models.*，provider 多了以后每次事件都是 O(全部模型)。

**修复建议**
- **回执抑制**：维护 `lastSelfWrite = { ns:'llm-pi-ai', revision, token }`；收到 `settings/document-updated` 时，`ns === 'llm-pi-ai' && revision <= lastSelfWrite.revision` 直接 return（事件带 revision 载荷正好够用，1017934-36）。
- **防重入 + 退避**：事件处理里只置 `dirty` 标志，实际扫描放到 `setTimeout(…, 300)` 合并批处理；扫描进行中再来事件只合并不重入。
- **签名去重**：对每个 provider 计算 `signature = hash(provider 的 models 的 id+reasoning+reasoningEfforts)`，签名不变跳过该 provider，把全量扫描降为增量。
- **UI 侧不要自建 store**：直接用 `ctx.modelDirectories.directoryFor(sessionId)`（DESIGN.md L49 已如此），它的 refetch/代际已经官方实现（434754/434869）；我们只在 `directory.select` 失败时回滚草稿（L50）。
- 监听 `llm/adapters-updated` 时同样做 300ms 去抖；两者（adapters-updated 与 document-updated）可能成对到达，用一个 `pendingRescan` 合并。

---

### R7 🟠 「上游探测」在当前 API 下探测不到档位

**DESIGN.md 原文**
- L37：「2. 上游探测（默认关闭，设置页开启）：优先同源代理路由取 raw `/models` 读 supported_features……；备选非法 effort 报错解析。」

**asar 实证**
- 859022/859269/861523 + 调用点 479887/479949/482097-098：「The reply is candidate metadata a surface may offer for adoption — **nothing is stored**, and cordis.patch.yml remains the only thing that decides what a route serves」；解析只归一化 id/display name/contextWindow/maxTokens（Anthropic 的 max_input_tokens/max_tokens）——**回复从不携带 reasoningEfforts/thinkingLevelMap**。
- DESIGN.md L37 自己也写了「官方 `llm.discoverModels` 通道会剥离 reasoning 信号」——既然如此，「探测」这一级拿不到任何档位信息。

**为什么是坑**
验收标准 §0.6 有「能力探测开关」，§0.7 的默认档位策略把「上游探测」列为第二级。如果探测通道结构上不可能返回档位，这一级要么是空转（开关是个摆设），要么只能靠「非法 effort 报错解析」这种黑盒探测（每档一次请求，烧钱且慢，还可能被上游当攻击）。

**修复建议**
- 把三级瀑布改名以正视听：**知识库 → 用户覆盖**（探测降级为「连通性/模型存在性探测」，只回答「这个 route 通不通、有哪些模型 id」，不回答档位）。
- 「非法 effort 报错解析」旁路（§7.4 已提）标注为实验性，默认关，单模型每日限流，且只在用户显式点击「探测此模型」时触发，不进自动接管。
- 设置页文案不要把探测结果呈现为「档位+置信度」（L61），改为「模型清单+可达性」。

---

### R8 🟠 defaultEffort 双缺失：每个请求都会 UNSUPPORTED

**DESIGN.md 原文**
- L53：「provider 未声明 defaultEffort 时官方会在选项列表头插入「默认(跟随 provider)」空值项（value:""，i18n `effort.providerDefault` = "Default"）——我们写配置时**总是写 defaultEffort**，避免官方 UI 出现该项。」
- L28：Host 校验 865819-870。

**asar 实证**
- 官方 chip：435479 `const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;`；435481-484 `reasoning.defaultEffort === void 0 ? [{ … label: t("effort.providerDefault") }]`（i18n `"effort.providerDefault": "Default"`，436017/436043）；弹窗同款 281448 `PROVIDER_DEFAULT_REASONING_VALUE = ""`、281642 `{ value: PROVIDER_DEFAULT_REASONING_VALUE, label: t("effort.providerDefault") }`。
- 865830 `if (reasoning.defaultEffort !== void 0 && !seen.has(reasoning.defaultEffort))` → INVALID_MODEL_REASONING（defaultEffort 必须 ∈ efforts）；
- 865868-870 `const effective = requested ?? reasoning.defaultEffort; if (!reasoning.efforts.some((effort) => effort.id === effective))` → UNSUPPORTED_REASONING_EFFORT。
- 861136 `...defaultLevel === void 0 ? {} : { defaultEffort: ReasoningEffortId(defaultLevel) }`——defaultEffort **可以不存在**。

**为什么是坑**
「总是写 defaultEffort」是对的，但它现在是**一句口头约定**，没有代码级保证。一旦某条补写路径漏写（知识库无匹配 + 用户没选默认档），而连接级默认（856947-950 的 defaultEffort 分档）也没配，则 `effective === undefined`，`efforts.some(e => e.id === undefined)` 为 false → **每一次请求都抛 UNSUPPORTED_REASONING_EFFORT**，且报错点在请求期不在写入期。
另外：我们写了自己的 chip（L51-53），若为了「对齐官方」也插一个 value `""` 的「默认」项，`""` 绝不能透传给 `directory.select`（L50）——官方把它当「无 effort」处理，我们的提交层必须把 `""` 归一成 `undefined`。

**修复建议**
- 补写管线终点加**硬断言**：`reasoningEfforts` 落库前必须同时满足 `defaultEffort ∈ offeredLevels` 且 `offeredLevels.length ≥ 1`；不满足就中止该模型补写并进设置页错误列表（不要让半成品进配置）。
- 客户端 chip 复刻官方三态：`reasoning === undefined → 不显示档位`；`effectiveEffort === undefined → 显示 t("effort.providerDefault")/"Default"`；提交时 `""` → `undefined`。
- 补一个回归用例：构造「model 有 efforts 无 defaultEffort」的 provider，验证官方 chip 出现 Default 项、请求不炸（或按产品决策显式补 defaultEffort）。

---

### R9 🟡 「最大档」在大量模型上不存在，动画触发条件要重定义

**DESIGN.md 原文**
- L11：「拉到最大档时有精美动画：滑杆蓝→紫渐变 + 星空粒子 +「更快消耗使用额度」提示。」
- L56：「最大档动画……性能注意：动画只在弹层打开且滑至最大档时运行，弹层关闭即停。」

**asar 实证（无 max 档的真实样本）**
- ant-ling Ring-2.6-1T `{off:null,minimal:null,low:null,medium:null,high:"high",xhigh:"xhigh"}`（1105015，**无 max 键**）；
- together MiniMax-M2.5 `{off:null,minimal:null,low:null,medium:null}`（1105046，无 off/max）；
- xai grok-4.3/4.5 `max:null`（1105048）；cerebras gpt-oss-120b `max:null`（1105019）；google-vertex gemini-3-flash-preview `max:null`（1105025）。

**为什么是坑**
动画条件若写成 `currentLevel === 'max'`，上述模型的滑杆拉到顶（high 或 xhigh）时**什么都不会发生**，而用户感知的「最大档」就是那一格。另外 860161 规定 xhigh/max 必须显式非 null 才可选，所以「最高可选项」在不同模型上分别是 high / xhigh / max。

**修复建议**
- 动画触发条件改为：**`currentLevel === efforts 中按 THINKING_LEVELS 序的最后一个`**（即当前模型的最高可用档），并在文档中把「最大档」定义为「最高可用档」。
- 若产品坚持只有 `max` 才动画，就在设置页给「动画档位」选项（默认=最高可用档）。
- 提示文案按档位泛化：「更快消耗使用额度」在非 max 档位也说得通（xhigh/high 同样更贵），可保持同一文案。

---

### R10 🟡 知识库 ladder 表缺「缺键兜底」这一形态

**DESIGN.md 原文**
- L36：「内置知识库（静态表，按厂商/模型名匹配；含各家 ladder 差异：如 hy3=noThink、minimax-m3=none、mimo/qwen 拒 max、GLM 无 minimal、DeepSeek V4.1 Flash 官方目录 = low/high/max）。」

**asar 实证**
- claude 系（anthropic / github-copilot / opencode / cloudflare-ai-gateway / radius）统一是 `{off:null, xhigh:"xhigh", max:"max"}`——**low/medium/high 三个键干脆不存在**，靠 860160「仅 null 才不可用」的规则在 UI 里照常展示，dispatch 时回落 provider 默认（1094909 Google 回落 `(model.thinkingLevelMap?.[level] ?? "high")`）。
- baseten deepseek-v4-flash-0731 是 7 档全字符串（1105018）；DeepSeek 官方 deepseek-flash 无 off 键（1105014 起样本）。

**为什么是坑**
知识库如果只用「键→wire 值」建模，无法表达「这个厂商的中档靠缺键兜底、dispatch 会回落厂商默认」。照抄成 `{low:"low",medium:"medium",high:"high"}` 就把 claude 的中档 wire 值钉成了字面量，可能与 Anthropic 实际期望值不符（现在回落厂商默认反而更安全）。

**修复建议**
- 知识库条目结构改为：
  ```ts
  interface LadderRule {
    match: { provider?: string; model?: RegExp | string };
    levels: Partial<Record<ThinkingLevel, string | null | 'inherit'>>; // 'inherit' = 缺键兜底
    defaultEffort?: ThinkingLevel | 'inherit';
  }
  ```
  `'inherit'` 显式表达「不要写这个键」。
- claude 系的规则应为 `{ off: null, xhigh: 'xhigh', max: 'max', low: 'inherit', medium: 'inherit', high: 'inherit' }`。

---

### R11 🟢 chip 档位名必须用服务端 name

**DESIGN.md 原文** L51-53 未说明 name 来源。

**asar 实证**：861132-861134 `efforts: getSupportedThinkingLevels(model).map((level) => ({ id: ReasoningEffortId(level), name: … }))`；`LlmReasoningEffortInfo = { id, name, description? }`（866551/1019350）；官方 chip 435480 `reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort`。

**修复建议**：UI 一律渲染 `efforts.find(id)?.name`，只在 name 缺失时回落 id；**不要在客户端维护 off/minimal/low/… 的中英文字典**（会和官方 i18n 打架，也无法覆盖未来新档位名）。

---

### R12 🟢 主题前车之鉴（ui-theme）

- 本项目此前 ui-theme 插件的教训：不得在装载时缓存主题；开弹层前调 `ctx.remote.ui.theme()` 取当前值，并订阅 theme-updated 事件。
- 动画规格（第二部分）的星点/渐变是「自绘 artwork」，不随主题变色也成立；但弹层文字/边框必须走 token（见 §2.7）。

---

### 附：建议直接落到 DESIGN.md 的修订（diff 式）

```diff
- L32  「与实机 cordis.patch.yml 中已有 provider 的 models[].reasoningEfforts 形状完全吻合」
+       「形状吻合，但持久化落点分两层：settings.mutate → settings.yaml（971821/972302）；
+        configEditor → cordis.patch.yml。两层合并优先级 [未验证]，第一版只用 settings.mutate。」

- L34  「找出 reasoning:true（或未声明但疑似推理）且缺 reasoningEfforts 的模型」
+       「准入三条件：reasoning===true 且 thinkingLevelMap 已存在 且 目标档在 map 中非 null。
+        删除「疑似推理」猜测分支——写任何 dict 都会把 reasoning 钉为 true（859990）。」

- L39  「默认保守档位：off:null, low:"low", high:"high", max:"max"」
+       「补写必须是 merge：保留全部已有键；仅当 existing[k]===undefined 时才写 kb 值。
+        整map不存在时才允许使用四键保守档位，且必须先过准入三条件（未声明的档位会被
+        resolveModelReasoning 展开成 null，859983-987，等于宣布不支持）。」

- L40  「监听 settings/document-updated（0.1.7-rc.x 事件名；旧 settings/updated 已删）」
+       「监听 settings/document-updated（本版本已稳定，签名 (ns, revision)，1017934-36；
+        带 revision 载荷正好用于回执抑制）+ llm/adapters-updated（无 payload，863508）。
+        必须做：回执抑制（ns==='llm-pi-ai' && revision<=lastSelfWrite.revision 直接 return）、
+        300ms 去抖合并、provider 签名去重、事件回调内只置 dirty 不同步写。」

- L41  「但补写落盘到 cordis.patch.yml 的场景要注意」
+       「注意点是 settings.yaml 与 cordis.patch.yml 两处；mutate 只保证内存正确（JsonValue），
+        不保证落盘字形——eemeli stringify 不会给 core-schema 字符串加引号，需启动自检
+        （正则查裸 off:）与一键修复。」

- L85  「缓解：冲突重试一次 + 补写幂等」
+       「缓解：单写者队列（同 ns 同时只有一个 in-flight 写）+ 永远带 expectedRevision +
+        conflict 后重算重试（≤3 次退避）+ 写后 resolveModelInfo 自检 + 第一版只走
+        settings.mutate 单通道（configEditor 留到 §7.2 清零后）。」
```

---

## 第二部分 · Codex 风格最大档动画：完整实现规格

> ⚠ **本节为 2026-10 早期设计草案，部分已被后续用户裁决取代，保留作演进记录。** 与现行实现不一致之处以代码与 DESIGN.md 为准，主要有：
> 1. **动画触发条件**：草案写「仅最高可用档触发」（`isMax`），已被用户 m01895 推翻 → **每一档都有粒子动效**，强度随档位连续变化（`effortVisual`）。
> 2. **弹层文字行**：草案是「居中档位名 + 模型名」，已被用户 m02779 定为**读法 A**（大字行 = 模型名，下方小字行 = 当前档位名）。
> 3. **右上刷新按钮**：草案有 `RefreshIcon` + `onReset`（重置为 defaultEffort），已被用户 m05286 **删除**（最左端常驻 `off` 节点即可回到默认）。
> 4. **档位列表**：草案假设固定档位集合，现行按 `reasoning.efforts` 动态渲染，**不假设七档**。

### 2.1 目标与验收（对应 DESIGN.md L11 / §0.4）

拉到最高可用档（见 R9：定义为 `efforts` 中按 `THINKING_LEVELS` 序的最后一个，通常是 `max`）时：
1. 胶囊滑杆的填充轨道由**单色蓝渐变为蓝→紫渐变**（平滑过渡，不跳变）；
2. 轨道内浮现**星空粒子**：细小光点缓慢漂移 + 明暗闪烁；
3. 轨道下方浮现提示 **「更快消耗使用额度」**（带闪电图标，淡入上移）；
4. 关闭弹层 / 离开最大档：动画**立即停止**（CSS `animation-play-state: paused` + 卸载星点层 / canvas `cancelAnimationFrame`）；
5. `prefers-reduced-motion: reduce`：降级为**静态蓝→紫渐变**，无粒子、无位移动画；
6. 弹层未打开时不存在任何动画开销（DOM 不挂载 + 无 rAF）。

### 2.2 DOM 结构（React `createElement` 手写，无构建）

```jsx
div.teff-popup.teff-popup--open                 // 弹层根（open 时挂此类）
  div.teff-popup__bar
    button.teff-popup__iconbtn.teff-popup__iconbtn--flash   // 左上闪电 = 思考开/关（aria-pressed；label「关闭思考」/「开启思考」）
  div.teff-popup__model                          // 大字行：模型名（可点回模型列表）
  div.teff-popup__level                          // 小字行：当前档位名，如「极高」
  div.teff-slider.teff-slider--max               // role="slider" tabindex=0
                                                // aria-valuemin=0 aria-valuemax=1000 aria-valuenow
                                                // aria-valuetext="极高" onKeyDown=…
    div.teff-slider__rail                         // 胶囊轨道（overflow:hidden）
      div.teff-slider__fill                       // style={{width: pct+'%'}}
      div.teff-slider__stars                      // 仅 isMax 时挂载
        span.teff-star.teff-star--a
        span.teff-star.teff-star--b
        span.teff-star.teff-star--c
    div.teff-slider__thumb                        // style={{left: pct+'%'}}
    div.teff-slider__ticks                        // 分档节点
      span.teff-slider__tick  ×N
  div.teff-slider__labels                         // 档位名（用服务端 efforts[].name）
    span  ×N
  div.teff-hint                                   // 仅 isMax 时挂载
    span.teff-hint__icon ⚡
    "更快消耗使用额度"
```

### 2.3 完整 CSS（可直接内联进 client.js 的 `<style>` 或 `insertRule`）

```css
/* ---------- 弹层骨架（token 优先） ---------- */
.teff-popup{
  position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
  z-index:1100;
  min-width:320px; padding:20px 24px 22px;
  box-sizing:border-box;
  background:var(--dsw-alias-bg-layer-2, #1f2026);
  color:var(--dsw-alias-label-primary, #fff);
  border:1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.10));
  border-radius:var(--dsw-radius-xl, 16px);
  box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.32));
  font-family:var(--dsw-font-family, system-ui, sans-serif);
  user-select:none;
}
.teff-popup__bar{display:flex;align-items:center;justify-content:space-between;height:28px}
.teff-popup__iconbtn{
  width:28px;height:28px;display:grid;place-items:center;
  border:none;background:transparent;cursor:pointer;padding:0;
  border-radius:var(--dsw-radius-sm, 6px);
  color:var(--dsw-alias-label-secondary, rgba(255,255,255,.72));
}
.teff-popup__iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08))}
.teff-popup__iconbtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4d7cff)}
.teff-popup__level{margin-top:10px;text-align:center;font-size:28px;font-weight:600;line-height:36px;letter-spacing:.02em}
.teff-popup__model{margin-top:2px;text-align:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-caption, rgba(255,255,255,.56))}

/* ---------- 胶囊滑杆 ---------- */
.teff-slider{position:relative;width:min(420px,72vw);height:44px;margin:20px auto 6px;touch-action:none}
.teff-slider__rail{
  position:absolute;inset:0;border-radius:999px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-3, #2a2c33);
  border:1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.10));
}
/* 颜色插值（Chromium/Electron 支持 @property，渐变可平滑过渡；不支持时回落普通渐变） */
@property --teff-c1{syntax:'<color>';inherits:false;initial-value:#2f6bff}
@property --teff-c2{syntax:'<color>';inherits:false;initial-value:#3f7bff}
@property --teff-c3{syntax:'<color>';inherits:false;initial-value:#2f6bff}
.teff-slider__fill{
  position:absolute;top:0;bottom:0;left:0;border-radius:999px;
  background:linear-gradient(90deg,var(--teff-c1),var(--teff-c2) 55%,var(--teff-c3));
  transition:--teff-c1 .34s ease,--teff-c2 .34s ease,--teff-c3 .34s ease,
             width .16s cubic-bezier(.2,.8,.2,1);
  will-change:width;
}
@supports not (background:linear-gradient(90deg,var(--teff-c1),var(--teff-c2))){
  .teff-slider__fill{background:linear-gradient(90deg,#2f6bff,#3f7bff);transition:width .16s cubic-bezier(.2,.8,.2,1)}
  .teff-slider--max .teff-slider__fill{background:linear-gradient(90deg,#2f6bff,#6a5cff 55%,#a855f7)}
}
.teff-slider--max .teff-slider__fill{--teff-c1:#2f6bff;--teff-c2:#6a5cff;--teff-c3:#a855f7}

/* ---------- 星空粒子（纯 CSS，3 层） ---------- */
/* canvas 备选方案启用时才挂载；与 CSS 星点二选一，不要同开（见 2.5） */
.teff-slider__canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.teff-slider__stars{position:absolute;inset:0;border-radius:999px;overflow:hidden;pointer-events:none;
  opacity:0;transition:opacity .32s ease}
.teff-slider--max .teff-slider__stars{opacity:1}
.teff-star{
  position:absolute;top:0;bottom:0;left:0;width:200%;
  background-repeat:repeat;background-size:50% 100%;   /* tile 宽 = 容器宽 → 平移 -50% 无缝 */
  will-change:transform,opacity;
  animation-timing-function:linear;animation-iteration-count:infinite;
  animation-play-state:paused;                          /* 默认暂停：零开销 */
}
/* 仅「弹层打开 且 最大档」才运行 */
.teff-popup--open .teff-slider--max .teff-star{animation-play-state:running}

/* a 层：1.5px 白色细点，慢速右→左漂移 + 闪烁 */
.teff-star--a{
  background-image:
    radial-gradient(1.5px 1.5px at 8%  22%, rgba(255,255,255,.95), transparent 100%),
    radial-gradient(1.5px 1.5px at 23% 71%, rgba(255,255,255,.80), transparent 100%),
    radial-gradient(1.5px 1.5px at 37% 35%, rgba(255,255,255,.90), transparent 100%),
    radial-gradient(1.5px 1.5px at 52% 84%, rgba(255,255,255,.70), transparent 100%),
    radial-gradient(1.5px 1.5px at 66% 18%, rgba(255,255,255,.85), transparent 100%),
    radial-gradient(1.5px 1.5px at 79% 60%, rgba(255,255,255,.75), transparent 100%),
    radial-gradient(1.5px 1.5px at 92% 40%, rgba(255,255,255,.90), transparent 100%);
  opacity:.95;
  animation-name:teff-drift,teff-twinkle;
  animation-duration:26s,3.4s;
  animation-delay:0s,.4s;
}
/* b 层：3px 紫色柔光点，反向漂移，慢闪 */
.teff-star--b{
  background-image:
    radial-gradient(3px 3px at 14% 48%, rgba(196,181,253,.55), transparent 65%),
    radial-gradient(3px 3px at 41% 14%, rgba(167,139,250,.45), transparent 65%),
    radial-gradient(3px 3px at 58% 78%, rgba(196,181,253,.50), transparent 65%),
    radial-gradient(3px 3px at 83% 30%, rgba(167,139,250,.40), transparent 65%);
  opacity:.85;
  animation-name:teff-drift-rev,teff-twinkle;
  animation-duration:38s,5.2s;
  animation-delay:0s,1.1s;
}
/* c 层：1px 密集暗点，快速漂移制造纵深 */
.teff-star--c{
  background-image:
    radial-gradient(1px 1px at 5%  12%, rgba(255,255,255,.55), transparent 100%),
    radial-gradient(1px 1px at 17% 62%, rgba(255,255,255,.45), transparent 100%),
    radial-gradient(1px 1px at 28% 30%, rgba(255,255,255,.50), transparent 100%),
    radial-gradient(1px 1px at 39% 88%, rgba(255,255,255,.40), transparent 100%),
    radial-gradient(1px 1px at 47% 45%, rgba(255,255,255,.55), transparent 100%),
    radial-gradient(1px 1px at 61% 20%, rgba(255,255,255,.45), transparent 100%),
    radial-gradient(1px 1px at 73% 72%, rgba(255,255,255,.50), transparent 100%),
    radial-gradient(1px 1px at 86% 52%, rgba(255,255,255,.40), transparent 100%),
    radial-gradient(1px 1px at 95% 82%, rgba(255,255,255,.50), transparent 100%);
  opacity:.7;
  animation-name:teff-drift,teff-twinkle;
  animation-duration:16s,2.4s;
  animation-delay:0s,.7s;
}
@keyframes teff-drift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-50%,0,0)}}
@keyframes teff-drift-rev{from{transform:translate3d(-50%,0,0)}to{transform:translate3d(0,0,0)}}
@keyframes teff-twinkle{0%,100%{opacity:.35}50%{opacity:1}}

/* ---------- 滑块 / 节点 / 标签 ---------- */
.teff-slider__thumb{
  position:absolute;top:50%;width:22px;height:22px;border-radius:50%;
  background:var(--dsw-alias-switch-thumb, #fff);
  border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12));
  box-shadow:0 2px 6px rgba(0,0,0,.30);
  transform:translate(-50%,-50%);
  transition:left .16s cubic-bezier(.2,.8,.2,1);
  pointer-events:none;
}
.teff-slider__ticks{position:absolute;left:0;right:0;top:50%;height:0;pointer-events:none}
.teff-slider__tick{position:absolute;top:0;width:2px;height:8px;border-radius:1px;
  background:rgba(255,255,255,.45);transform:translate(-50%,-50%)}
.teff-slider__labels{display:flex;justify-content:space-between;margin-top:8px;
  font-size:12px;line-height:16px;color:var(--dsw-alias-label-caption, rgba(255,255,255,.56))}
.teff-slider__labels span{white-space:nowrap}

/* ---------- 最大档提示 ---------- */
.teff-hint{
  margin-top:12px;display:flex;align-items:center;justify-content:center;gap:6px;
  font-size:12px;line-height:16px;
  color:var(--dsw-alias-state-warn-label, #ffb020);
  opacity:1;
}
.teff-hint__icon{display:inline-grid;place-items:center;width:14px;height:14px}
.teff-popup--open .teff-hint{animation:teff-hint-in .3s cubic-bezier(.2,.8,.2,1) both}
@keyframes teff-hint-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* ---------- 降级：prefers-reduced-motion ---------- */
@media (prefers-reduced-motion:reduce){
  .teff-star,
  .teff-popup--open .teff-slider--max .teff-star{animation:none;opacity:.75}
  .teff-slider__fill{transition:none}
  .teff-slider--max .teff-slider__fill{
    background:linear-gradient(90deg,#2f6bff 0%,#6a5cff 55%,#a855f7 100%); /* 静态渐变 */
  }
  .teff-popup--open .teff-hint{animation:none;opacity:1;transform:none}
  .teff-slider__stars{transition:none}
}
```

**要点说明**
- **无缝漂移**：星层宽 `200%`、`background-size:50% 100%` ⇒ 单个 tile 宽恰好等于容器宽；`translate3d(-50%,0,0)` 平移一个 tile 后图案完全重合，可无限循环且看不出接缝。
- **只动 transform/opacity**：漂移与闪烁都不触发 layout/paint（合成层），`will-change` 仅加在星层上，弹层关闭即随 DOM 卸载。
- **零开销默认态**：`animation-play-state:paused` 是默认值；即使星层被误挂载，暂停的关键帧不消耗 CPU。双重保险：星层和 hint **仅在 `open && isMax` 时创建**（见 2.4）。
- **渐变平滑**：`@property` 注册 `<color>` 自定义属性，使 `linear-gradient` 的颜色可过渡（Electron/Chromium 支持）；`@supports not` 提供静态回落。
- **图标**：闪电/刷新用内联 SVG（`currentColor`），不要引图标库。

### 2.4 React 集成（`createElement`，含门控与清理）

```js
const h = require('react').createElement;
const { useCallback, useEffect, useRef, useState } = require('react');

const LEVEL_ORDER = ['off','minimal','low','medium','high','xhigh','max']; // 861129 同源 THINKING_LEVELS

// 最高可用档：efforts 中按 LEVEL_ORDER 的最后一个（见评审 R9）
function topLevel(efforts){
  let top = null;
  for (const lv of LEVEL_ORDER) if (efforts.some(e => e.id === lv)) top = lv;
  return top;
}

function ThinkingPopup({ open, efforts, current, defaultEffort, modelName, onSelect, onReset, draftToPct }){
  const top = topLevel(efforts);
  const isMax = !!top && current === top;          // 动画唯一触发条件
  const live  = open && isMax;                      // 性能门控
  const pct   = draftToPct(current);                // 0..100

  const popupCls = 'teff-popup' + (open ? ' teff-popup--open' : '');
  const sliderCls = 'teff-slider' + (isMax ? ' teff-slider--max' : '');

  // —— canvas 备选：仅 live 时启动；卸载/条件失效立即取消 ——
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!live || !canvasRef.current) return;        // 不满足条件：不建 rAF
    let raf = 0, stop = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = canvasRef.current;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.round(r.width  * dpr));
      cv.height= Math.max(1, Math.round(r.height * dpr));
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);       // CSS 像素坐标系
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);

    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else tick(); };
    document.addEventListener('visibilitychange', onVis);

    let last = 0;
    const tick = (t = 0) => {
      if (stop) return;
      if (t - last < 33) { raf = requestAnimationFrame(tick); return; } // ≈30fps
      last = t;
      /* drawStars(cv, particles) */                 // 见 2.5
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {                                   // 弹层关闭/离开最大档/卸载
      stop = true; cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
    };
  }, [live]);

  return h('div', { className: popupCls, role: 'dialog', 'aria-modal': true,
                    onKeyDown: escClose /* 官方 Modal 范式：Escape 关闭 + focus 圈闭 */ },
    h('div', { className: 'teff-popup__bar' },
      h('button', { className:'teff-popup__iconbtn teff-popup__iconbtn--flash',
                    'aria-label':'关闭思考', 'aria-pressed':true, onClick:toggleThinking }, FlashIcon())),
    h('button', { className:'teff-popup__model', onClick:onPickModel }, modelName),
    h('div', { className:'teff-popup__level' }, levelLabel(current, efforts)),
    h('div', {
        className: sliderCls, role:'slider', tabIndex:0,
        'aria-valuemin':0, 'aria-valuemax':1000, 'aria-valuenow': pct*10,
        'aria-valuetext': levelLabel(current, efforts),
        onKeyDown: onSliderKeyDown, onPointerDown: onSliderDrag,
      },
      h('div', { className:'teff-slider__rail' },
        h('div', { className:'teff-slider__fill', style:{ width: pct + '%' } }),
        live ? h('div', { className:'teff-slider__stars' },   // 仅 live 挂载
          h('span', { className:'teff-star teff-star--a' }),
          h('span', { className:'teff-star teff-star--b' }),
          h('span', { className:'teff-star teff-star--c' }))
        : null,
        live ? h('canvas', { ref:canvasRef, className:'teff-slider__canvas',
                             'aria-hidden':true }) : null),   // canvas 方案启用时才挂
      h('div', { className:'teff-slider__thumb', style:{ left: pct + '%' } }),
      h('div', { className:'teff-slider__ticks' },
        efforts.map((e,i) => h('span', { key:e.id, className:'teff-slider__tick',
                                         style:{ left: tickPct(i, efforts.length) + '%' } })))),
    h('div', { className:'teff-slider__labels' },
      efforts.map(e => h('span', { key:e.id }, e.name))),     // name 来自服务端（R11）
    isMax ? h('div', { className:'teff-hint', role:'note' },  // 仅最大档挂载
      h('span', { className:'teff-hint__icon', 'aria-hidden':true }, FlashIcon()),
      '更快消耗使用额度') : null);
}
```

门控三保险（对应 DESIGN.md L56 的性能要求）：
1. **DOM 门控**：`teff-slider__stars` / `teff-hint` / canvas 只在 `open && isMax` 时创建，关闭即卸载；
2. **CSS 门控**：`.teff-star` 默认 `animation-play-state:paused`，只有 `.teff-popup--open .teff-slider--max` 后代才 `running`；
3. **rAF 门控**：`useEffect` 依赖 `[live]`，`live` 变 false 的同一帧走 cleanup：`cancelAnimationFrame` + 移除 `visibilitychange` + `ResizeObserver.disconnect`。

提交映射（对齐 DESIGN.md L55）：`0–1000` 草稿值 → `efforts` 下标 → 松手/按键提交最近档；`onSelect({provider, model, reasoningEffort})`，`""`（官方「默认」项）归一为 `undefined`（见 R8）。

### 2.5 canvas 备选方案要点

适用场景：粒子需要更密的分布/碰撞/连线，或目标环境不支持 `@property` 渐变过渡且要更细腻的光晕。

| 项 | 规格 |
|---|---|
| 粒子数 | 48–72 个；按轨道宽度线性缩放 `n = clamp(round(width/6), 48, 96)`；`width > 600px` 时封顶 96 |
| 半径 | `r ∈ [0.4, 1.4]px`，10% 粒子给 `r ∈ [2.2, 3.0]px` 作柔光点（`globalAlpha ≤ .35`） |
| 颜色 | 两桶：白 `rgba(255,255,255,a)`、紫 `rgba(196,181,253,a)`；按桶设一次 `fillStyle` 再批量画，避免逐粒切换状态 |
| 帧率 | **30fps**：rAF 内累加时间，`delta < 33ms` 直接跳过；`document.hidden` 时取消 rAF，`visibilitychange` 恢复 |
| devicePixelRatio | `dpr = min(devicePixelRatio || 1, 2)`；`canvas.width = cssW*dpr`，`canvas.height = cssH*dpr`，`ctx.setTransform(dpr,0,0,dpr,0,0)`；ResizeObserver 重算并重新分布粒子 |
| 运动模型 | 每粒 `{x, y, r, a, base, phase, tw, vx}`；`vx ∈ [-6,-2]px/s`（向左漂移，出界从右侧回绕）；闪烁 `a = base * (0.55 + 0.45*sin(t*tw + phase))`；5% 粒子加纵向 `sin` 微浮 |
| 绘制 | 每帧 `ctx.clearRect(0,0,cssW,cssH)`；`r < 1` 用 `fillRect(x,y,r,r)`（比 arc 便宜），`r ≥ 1` 用 `arc` + 单次 `beginPath`/`fill` 批量 |
| 内存 | 粒子数组复用，帧内零分配；不创建临时对象/数组 |
| 降级 | `prefers-reduced-motion` → 不启动循环，只画一帧静态分布；此时也可直接不挂 canvas，让 CSS 静态渐变兜底 |
| 清理 | `cancelAnimationFrame` + 移除监听 + `ro.disconnect()`（见 2.4 cleanup）；弹层关闭必须同步执行，不能等 GC |

> 结论：**首选纯 CSS 方案**（2.3）。canvas 仅在「粒子要更多更密」或「需要光晕叠色」时启用，且必须与 CSS 方案二选一，不要同开（两层粒子会互相打脸且双倍开销）。

### 2.6 性能预算（写进验收）

| 指标 | 约束 |
|---|---|
| 弹层关闭时动画 CPU | 0（DOM 卸载 + 无 rAF + 关键帧 paused） |
| 打开但非最大档时动画 CPU | 0（星层/hint 不挂载） |
| 最大档运行时 | 仅合成层 transform/opacity；无 layout、无 JS 主线程帧（CSS 方案） |
| 弹层打开→可交互 | < 100ms；星点层不得用 JS 逐个创建 DOM（用 3 个 span + 多层 radial-gradient） |
| 内存 | 关闭后无残留监听器/rAF/ResizeObserver（清理函数必须覆盖三条） |
| 降级 | `prefers-reduced-motion: reduce` 下静态渐变 + 无位移，验收时用系统设置实测 |

### 2.7 DSH token 兼容与插件编写规范

- 结构/文字/边框/阴影全部走官方 token：`--dsw-alias-bg-layer-2/-3`、`--dsw-alias-label-primary/-secondary/-caption`、`--dsw-alias-border-l1/-l2`、`--dsw-alias-radius-sm/-xl`、`--dsw-elevation-prominent`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-switch-thumb`、`--dsw-alias-focus-ring-width/-color`、`--dsw-font-family`。
- **硬编码色值仅限 artwork**：星点白/紫、蓝→紫渐变三色（`#2f6bff / #6a5cff / #a855f7`）。依据插件编写规范（asar 292609-292610 要旨）：「用 Theme 列出的 `--dsw-alias-*` token，literal colors are for artwork only」——星空粒子与渐变正是 artwork，合规。
- 提示文字用 `--dsw-alias-state-warn-label`（带回落值），不用自定义黄。
- 抄官方控件（trigger/menu，435342 的 `wq12jW_*`）时：**class 一律加 `teff-` 前缀重命名**，只保留 `--dsw-alias-*` 引用；保留官方行为契约——Modal 的 focus 圈闭与 Escape 关闭、`role="switch"` + `aria-checked`（设置页开关）、Tooltip 的 placement 行为（asar 292609-292610）。
- 不 `require('@deepseek-ai/dsh-client-ui-primitives')`（规范禁止）。
- 主题：**不得缓存 theme**（ui-theme 前车之鉴）。开弹层前 `ctx.remote.ui.theme()` 取当前值并订阅 theme-updated；星点/渐变不随主题变化（自绘 artwork），弹层文字与边框靠 token 自动适配。

### 2.8 自测清单（交「联调+验收」卡片）

1. 拉到最高档：渐变是否平滑（无跳变）、星点是否无缝循环（盯 30s 看接缝）、提示是否淡入。
2. 从最高档拖到次高档：星点/hint 是否**同一帧**消失，渐变是否平滑回落单色蓝。
3. 关闭弹层：DevTools Performance 录 5s，主线程与合成层应无动画相关火焰图；`getAnimations()` 应为空。
4. 最高档时切后台再回前台：动画应恢复且不叠加速率（visibilitychange 分支）。
5. 系统开「减弱动态效果」：静态渐变、无粒子漂移、提示直接可见。
6. 对无 `max` 档的模型（如 ant-ling Ring-2.6-1T / together MiniMax）拉到顶：动画应照样触发（R9 的「最高可用档」定义）。
7. 高 DPI（150%/200%）：星点不糊、canvas 版本边界清晰（dpr 分支）。
8. 窄窗口（`72vw` < 320px）：滑杆不溢出，标签不换行错位。
