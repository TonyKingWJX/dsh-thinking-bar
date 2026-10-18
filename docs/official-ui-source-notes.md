# 官方 UI 源码深查笔记（8f124faa 交付，2026-10-15）

> app.asar = D:\Apps\Users\wang\AppData\Local\Programs\DeepSeek Harness\resources\app.asar。全部经 grep 按行号锚定，代码原文逐字。供 UI 层实现卡直接照抄。

## 1) ModelDirectoryResolver / ModelDirectory 接口与 snapshot 形状

架构（L434754 注释原文要点）：`/model` popupSelect（经 ctx.commandUi）与 composer 的 `conversation.input.model` 座位共用同一 per-session `ModelDirectory`；目录经 `session.models` 加载、经 `session.selectModel` 提交；每次 resident directory 都直接在 `llm/adapters-updated`、`settings/document-updated`、credential 更新事件上重拉。

ModelCatalogDirectory（L434995）：
- store = createSnapshotStore({status/value})，value = { default, routableProviders, groups, failures }。
- load()（L435025）幂等缓存（status==="ready" 且 value 非 null 直接返回）；L435034 `ctx.remote.session.modelCatalog()`；L435037 把每个 (groupId, modelId) 的 model.reasoning 存入 `this.reasoning` Map（key=`JSON.stringify([group.id, model.id])`）；generation 计数丢弃旧代响应；失效时 value 置 null 触发 refetch（L435064-065）。
- reasoningFor(selection)（L435009）按 provider/model 查 Map。

ModelDirectory（L435086）snapshot 形状：
```
{ current: ModelSelection|null, pending: ModelSelection|null,
  groups: ModelProviderGroup[], failures: ModelCatalogFailure[],
  retainedEffort?: string, status: "idle"|"loading"|"selecting"|"ready"|"error" }
```
- subscribe/getSnapshot 供 useSyncExternalStore（L435435 用法）。
- load()（L435138-142）= await catalog.load() 后返回 snapshot。
- select(selection)（L435151，§4）。

ModelDirectoryResolver（L435269，Service "modelDirectories"）：构造即预热 catalog（L435283）；directoryFor(sessionId)（L435307）按会话取/建；subagent 会话不可用（L435316 availability 判定）。

modelSelectionProjection（L435230-258）：
- L435233-235 `reasoning = reasoningFor(intended)`；`effort = intended?.reasoningEffort ?? reasoning?.defaultEffort`；
- retainedEffort（L435234）：effort id 在 efforts 里能找到→显示名；找不到→原样保留原始串（catalog 刷新后 effort 已不在列表的保留态）。
- catalog 未 ready → status loading/error，groups/failures 空数组兜底。

## 2) efforts 的 Host 端来源（与 §1 数据层结论一致）

- L866542-866551 `LlmModelReasoningInfo {efforts: LlmReasoningEffortInfo[]; defaultEffort?: ReasoningEffortId}`；`LlmReasoningEffortInfo {id, name, description?}`。
- L860156-159 getSupportedThinkingLevels：THINKING_LEVELS 过滤 thinkingLevelMap[level] 为 null 的档。
- L861129-136 reasoningInfo(model, defaultLevel)：efforts map + defaultEffort 条件展开。
- L861222/231 describableReasoningLevel（profile.reasoning 不在支持列表则不标 default）。
- UI catalog 组装 L326486-505 buildModelCatalog：efforts 逐字段透传；**无 reasoning → 直接省略 reasoning 字段（L326505）**。
- Host 校验 5 份拷贝（L865819/905475/943623/1007048/2329882）：efforts 空 → INVALID_MODEL_REASONING；无 reasoning + 带 effort 请求 → UNSUPPORTED_REASONING_EFFORT（L865866）；effort 不在列表 → 同左。
- 内嵌目录示例 L1105014-1105054：deepseek `thinkingLevelMap:{"minimal":null,"low":"low","medium":null,"high":"high","max":"max"}`。

## 3) ModelSelect 组件（conversation.input.model 槽 occupant）

- L435434 `function ModelSelect({ locked, available, directory, load, select, t })`。
- choices（L435453-459）：groups.flatMap → 每项 `{selection: {provider, model, ...defaultEffort!==undefined && {reasoningEffort: defaultEffort}}, model, label}`；rankByName 排序（L435465-466）。
- L435477-479：currentChoice.model.reasoning 取 catalog 条目；`effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort`。
- L435480 effortLabel 三分支（原文）：`reasoning===void 0 ? state.retainedEffort : effectiveEffort===void 0 ? t("effort.providerDefault") : reasoning.efforts.find(l=>l.id===effectiveEffort)?.name ?? effectiveEffort`。
- effortChoices（L435481-485）：reasoning undefined → []；defaultEffort undefined → 头部插入 `{label: t("effort.providerDefault"), value:""}` 空值项，再接 efforts。
- effort 面板（L435955-976）：空 → `t("empty.efforts")` div；每项 button `aria-checked: effectiveEffort===level.effort`，onClick chooseEffort；pending 态 StateDot("ongoing")，选中态 IconCheckOutlineRegular。
- chooseEffort（L435715-724）：同模型仅改 effort，重发 `{provider, model, ...effort===void 0 ? {} : {reasoningEffort: effort}}`；settleSelection 回调（L435689/706）。
- i18n（zh L436009-436027 / en L436035-436053）：`effort.providerDefault`="Default"；`empty.efforts`="当前模型未提供推理等级。"/"This model provides no reasoning effort levels."；`trigger.ariaEffort`="选择模型，当前 {model}，推理等级 {effort}"。
- /model popupSelect（L436124-152）：commandUi 注册；L436134 available 排除 subagent；effort 子行逻辑 L436091-097（当前模型 `current?.reasoningEffort ?? defaultEffort`，其他模型直接 defaultEffort，无则省略）；提交 L436149/152 `directory.select(selection)`。
- 槽注册（L436164-436176）：`slots.inject("conversation.input.model", () => slots.register({name, locale: NS, inject: (sessionId)=>({available, load, select})}, ModelSelect))`——registration 参数只有 name+locale（无 priority）；L436174 `if (available) directory.load().catch(()=>{})`；渲染侧 L421078 `renderSlot("conversation.input.model", {locked: modelSeatLocked})`，L420837 `modelSeatLocked = removed||inert||!live`；槽契约 L735728/735757；包名 L292031 '@deepseek-ai/dsh-client-ui-model-selection'。

## 4) select() 提交与失败行为

- selection = `ModelSelection {provider, model, reasoningEffort?}`（L331092/1019518）；远程请求 `SessionSelectModelRequest extends ModelSelection {sessionId}`（L331448），remote id '@deepseek-ai/dsh-api-session-controller#session/selectModel'。
- select()（L435151-168）：previous/previousEffort、nextEffort 计算（L435154-155）；status="selecting"+pending=selection（L435157）；reasoningEffort 缺省时整字段省略（L435166，不发 null）；disposed/旧代提前返回（L435168）；成功/失败都清 pending（L435173-175/195-197）；连接重置 idle+pending=null（L435212-214）。
- Host 侧 L322135/322266：selectModel ack 只落 Session 本地选择；默认 profile 保存后台执行，失败仅告警。

## 5) 「无 efforts」全链路表现（插件要消除的状态）

1. catalog：无 reasoning → 字段整体省略（L326505）。
2. ModelSelect：effortChoices=[] → 显示 empty.efforts；effortLabel 显示 retainedEffort 或整个标签不显示。
3. popup：无 effort 子行。
4. select：reasoningEffort 字段省略；Host 静默放行（L865818）。
5. ACP 校验（L281541-546）：reasoning undefined 只接受 PROVIDER_DEFAULT；providerDefault 仅在无 defaultEffort 时合法。
6. Host 运行时：无 reasoning + 带 effort → UNSUPPORTED_REASONING_EFFORT 硬错误。
7. efforts=[] 非法状态：Host 直接抛 INVALID_MODEL_REASONING——合法数据下不会出现。

【结论】efforts 缺失是 adapter 层（thinkingLevelMap）数据源头问题；插件补写 reasoningEfforts → thinkingLevelMap → efforts 即全线打通，UI 层无需 shim empty.efforts 分支。
