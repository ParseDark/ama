# 网络抓包开发计划（Story 4–5）

> 接续已有 Story 1–3，不重新定义或改写前三条。本文件仅规划实现，不表示功能已经完成。
> 当前仓库未找到原始 v1 Story 文档，因此沿用需求中的「用户故事 + AC」格式，并补充 agent 执行步骤、交付物和验证方式。

## 开发顺序与依赖

```text
S1 → S2 → S3 ───────┐
                    ├──→ S5
S4（可独立并行开发）─┘
```

- 默认顺序：S1 → S2 → S3 → S4 → S5。
- S4 不依赖前三条；可以独立实现采集、状态和手动控制，并通过 mock 测试。
- S5 必须等 S3 的 `run_js` 和 S4 的采集服务都可用后再集成。
- 不在本计划内实现 HAR 导出、历史流量回放、请求修改、自动刷新、跨标签页抓包、WebSocket 消息或绕过浏览器权限。

## Agent 开工检查

- [ ] 阅读 `wxt.config.ts`、`src/entrypoints/background.ts`、`src/entrypoints/sidepanel/App.tsx` 及其引用的聊天组件，确认后台入口与控制栏位置。
- [ ] 阅读 `src/lib/local-chat-transport.ts`、`src/lib/code-tools.ts`、`src/lib/data/{types,actions,store}.ts` 和 `src/lib/sessions.ts`，确认工具注册、审批、会话生命周期和数据容量约束。
- [ ] 阅读 `docs/ai-code-sandbox.md`、`docs/ai-data-store.md`，保留现有 `run_js` 两种输入模式，不破坏互斥校验。
- [ ] 参考现有 Vitest 与 `tests/e2e/` 的扩展测试设施；先记录 `git status`，不得覆盖已有用户修改。
- [ ] 依赖已存在时不重新安装；新增文件路径可随实际组件组织调整，但必须保留职责分离。

---

# Story 4：抓取当前标签页的网络请求

**作为** 用户，**我想要** 扩展抓取当前标签页的网络请求，包括响应内容，**以便** AI 能帮我分析页面调用了哪些接口、返回了什么数据。

## AC

- [ ] 构建生成的 `manifest.json` 的 `permissions` 包含 `"debugger"`；实际修改入口是 `wxt.config.ts`，不手改 `.output/`。
- [ ] 能开始和停止抓包：开始时用 `chrome.debugger.attach({ tabId }, "1.3")` 挂到当前标签页并调用 `Network.enable`，停止时调用 `detach`。
- [ ] 每条请求记录 `method`、`url`、`status`、请求头和响应头、请求体、响应内容；按 `requestId` 合并相关事件，而不是每个事件新增一条。
- [ ] 默认只保留 `XHR` 和 `Fetch` 类型的请求，图片、CSS、字体等静态资源不记录，也不读取其响应体。
- [ ] 单条响应内容超过 100KB 时截断，总共最多保留 200 条。
- [ ] 用户关闭标签页，或者点掉顶部的调试提示条后，状态自动变成「已停止」；监听 `chrome.debugger.onDetach`，UI 无须再次手动操作。

## 实现约定

### 数据与容量

- `100KB` 明确为 **100 × 1024 UTF-8 字节**；文本按 Unicode 边界截断，不产生半个字符。
- 每轮最多保留最先接纳的 200 条 XHR/Fetch；达到上限后不再接纳新请求，但继续补全已接纳请求。返回 `limitReached`、`droppedCount`，不静默覆盖旧记录。
- 过滤以 CDP `type` 为准，不靠 URL 后缀猜测。若类型在后续事件才确定，应先用有界临时状态关联，确定不符合后立即释放。
- 请求头、响应头、URL、请求体以及临时事件缓存同样设置明确容量上限；建议每条非响应体数据总量最多 64KiB。超限保留截断标记，不能仅限制响应体却留下无限缓存。
- 「完整数据」指采集规则允许保留的数据，即每条响应最多 100KiB、最多 200 条；不得另存一个无上限的原始副本。

建议记录模型（字段可扩充，但不可丢失 AC 字段）：

```ts
interface NetworkRecord {
  requestId: string;
  method: string;
  url: string;
  resourceType: "XHR" | "Fetch";
  status: number | null;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: string | null;
  responseBody: string | null;
  bodyEncoding: "utf8" | "base64";
  responseBodyTruncated: boolean;
  metadataTruncated: boolean;
  bodyError?: string;
  errorText?: string;
  startedAt: number;
  finishedAt?: number;
}
```

- 尚未收到 HTTP 响应的失败请求使用 `status: null`，不伪造为 0、200 或 500。
- CDP 返回 `base64Encoded: true` 时，文本响应正确解码后截断；非文本保留有界 base64 并声明编码，不直接当 JSON 解析。二进制按解码后的字节数控制 100KiB 上限。
- `getResponseBody` 失败、缓存响应无可读 body、204/304、网络失败均不丢弃请求；区别空响应与「无法读取」，记录原因。
- `getResponseBody` 可能先返回整个 body，再由扩展截断；100KiB 是保留上限，不宣称是浏览器读取时的硬内存上限。

### 生命周期

```text
stopped → starting → capturing → stopping → stopped
             └─失败清理───────────────→ stopped + error
                         外部 detach → stopped + reason
```

- 服务由 background 持有，侧栏通过类型化 runtime 消息调用。侧栏重挂载或聊天 rerender 不重复注册 debugger 监听器。
- 每轮绑定 `captureId + tabId`；S5 再绑定 `sessionId`。开始时确定当前窗口的当前标签页，之后切换标签页不迁移采集目标。
- v1 每个扩展实例只允许一轮采集。同一所有者重复 start 返回原轮次，不清空数据；另一个目标或会话 start 返回明确冲突。
- start 只有在 attach 和 `Network.enable` 都成功后才返回成功。enable 失败必须清理已建立的 attachment。
- stop 开始后不接纳新请求；已发出的 body 读取最多等待 2 秒，再冻结快照、detach。用 captureId/generation 隔离迟到事件，不能修改已返回快照或下一轮数据。
- 显式 stop 与 `onDetach` 共用幂等清理逻辑；显式 detach 触发的事件不能提前删除结果。意外 detach 后仍能取得已采集快照。
- `tabs.onRemoved` 可作为关闭标签页的补充兜底；关闭后停止原因、pending body 错误、UI 状态必须一致。
- 只允许普通 HTTP(S) 标签页；`chrome://`、扩展页、无有效 tabId、已有调试器占用等情况返回可读错误，不自动断开别人的调试器。
- 正常页面刷新/导航仍绑定原 tabId；若 Chrome 主动断开则按停止处理，不偷偷重新 attach。
- 不为本功能新增永久原始流量存储或配置同步。验证目标 Chrome 的 MV3 debugger 会话生命周期，不用无意义定时器伪造保活。

## Agent 执行步骤

### S4.1：权限、类型和采集服务

- [ ] 在 `wxt.config.ts` 增加 `debugger` 权限。
- [ ] 新建 `src/lib/network/types.ts`，定义记录、状态、停止原因、消息请求与响应。
- [ ] 新建 `src/lib/network/capture.ts`，封装可注入 debugger adapter 的采集服务，便于单测。
- [ ] 在 `src/entrypoints/background.ts` 初始化服务，顶层同步注册 `onEvent`、`onDetach` 和消息监听器，避免异步初始化漏接事件。
- [ ] 内部接口至少提供 `start`、`stop`、`getStatus`；校验消息来源及参数，不对 content script 或网页暴露原始流量接口。

### S4.2：合并 CDP 事件

- [ ] `Network.requestWillBeSent`：记录 method、URL、headers、postData 与开始时间；缺失但标记存在的请求体，可按需调用 `Network.getRequestPostData`，失败显式标记。
- [ ] `Network.responseReceived`：补齐 status、response headers、mime type 与 resource type。
- [ ] `Network.loadingFinished`：仅对接纳的请求调用 `Network.getResponseBody`，解码、截断、完成记录。
- [ ] `Network.loadingFailed`：保留失败记录及 `errorText`，结束 pending 状态。
- [ ] 需要真实 Cookie/Set-Cookie 等头时合并 `requestWillBeSentExtraInfo`、`responseReceivedExtraInfo`；处理其乱序和缺失，不能假设总在主事件后到达。
- [ ] 重定向可能复用 requestId：保持一条最终请求记录，最终字段对应最后一跳，可附有界 `redirects` 保存前序跳转；ExtraInfo 不得错配到另一跳。
- [ ] 所有事件按当前 debuggee tabId 和 captureId 路由；迟到事件、已过滤请求、超过容量的新请求不再触发 body 读取。

### S4.3：手动开始/停止及状态展示

- [ ] 在侧栏增加「开始抓包 / 停止抓包」入口，展示「已停止 / 启动中 / 抓取中 / 停止中」、目标标签页和已记录数量。
- [ ] 开始前展示抓包会读取当前页请求及响应、可能包含敏感数据；不自动刷新页面。
- [ ] 后台推送状态变化，侧栏打开/重连时主动 `getStatus`，不能只依赖组件本地布尔值。
- [ ] 意外断开显示原因；达到 200 条时提示上限；错误不会卡在「抓取中」。

## 验证与交付

- [ ] 新增 `tests/network-capture.test.ts`：attach/enable/detach、失败清理、幂等启动/停止、多目标冲突、tab 关闭与外部 detach。
- [ ] 覆盖三种主事件归并、ExtraInfo 乱序、重定向、请求体补取、XHR/Fetch 过滤、loadingFailed、body 读取失败。
- [ ] 覆盖 100KiB 边界、中文/emoji、base64、200/201 条、临时缓存和元数据上限、stop 与 pending body/下一轮事件的竞态。
- [ ] 使用本地测试页产生 fetch、XHR、图片、CSS、POST、4xx、5xx、重定向和大响应；真实浏览器确认仅前两类入列且记录字段正确。
- [ ] 手工关闭标签页、关闭调试提示条，确认 UI 自动停止；真实提示条交互不以 mock 通过冒充验证通过。
- [ ] 构建后检查 `.output/chrome-mv3/manifest.json` 包含 `debugger` 权限。

📖 [chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger) · [CDP – Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/)

---

# Story 5：注册成 AI 工具 `capture_network`

**作为** AI，**我想要** 用工具控制抓包并拿到结果，**以便** 配合 `run_js` 分析接口数据。

## AC

- [ ] 提供两个工具：`capture_network_start` 和 `capture_network_stop`；stop 返回请求列表，每条包含 `url`、`method`、`status` 和响应内容的前 N 个字符。
- [ ] 用户变更取代原 Story 5 认证头脱敏 AC：在采集快照、数据保存和 `run_js` 输入中保留 `Cookie`、`Authorization`、`Set-Cookie` 原值，受既有容量限制。
- [ ] 抓到的完整数据可以作为 `input` 传给 `run_js`，例如「找出所有返回 4xx 的接口」或「把 `/api/orders` 的返回整理成表格」。
- [ ] 兼容仓库现有数据仓库约定：小数据可走旧 `input`；超过 16KiB 的结果必须使用 `dataId` 引用，由扩展加载为 sandbox 输入，不让模型复制完整抓包数据。

## 工具契约

### `capture_network_start`

- 模型参数为空对象 `{}`，不允许模型任意指定其他标签页或会话。
- 复用已有当前页面/窗口上下文，固定本轮 `tabId`，由可信扩展上下文绑定 `sessionId`；不能使用模型传入的 sessionId 作为授权依据。
- 正常模式下接入现有工具审批：明确告知正在读取当前页网络数据、有限预览会发给所选模型；Danger mode 按项目既有浏览器工具策略执行，但不跳过 Chrome 自身限制。
- 返回 `{ captureId, tabId, state: "capturing", startedAt, limits }`，失败不伪报成功。

### `capture_network_stop`

- 参数：`{ previewChars?: number }`；默认 N=256，允许整数 0–1024。不得让参数绕过 100KiB/200 条保留上限。
- 停止调用属于当前会话的活动轮次，或读取该会话最近一轮已停止但尚可用的结果；start 之后即使用户切到另一标签页，也停止原轮次。
- 每条预览至少有 `url`、`method`、`status`、`responsePreview`、`previewTruncated`，以及关联原记录的序号。文本前 N 个字符按 Unicode code point 计算；base64 明确编码。
- 同时返回 `captureId`、`tabId`、`state`、停止原因、`totalCount`、`limitReached`、`droppedCount`、`dataRefs` 和必要告警。
- 返回预览总量设置 256KiB UTF-8 JSON 预算；必要时缩短预览/URL 展示并标记截断，不把完整响应塞进上下文。最多 200 条的列表仍保留，完整字段通过 dataRefs 访问。
- 同一 capture 重复 stop 幂等，复用已生成快照/数据引用，不能重复生成大量数据；没有采集记录时返回明确 `NO_CAPTURE`，不是一个误导性的成功空列表。
- 他人会话停止/读取返回访问错误，不泄露目标 URL 或数据。

### 完整数据与隐私边界

- 不对认证头脱敏；快照使用深拷贝，避免调用者修改采集内部对象。
- 保留请求/响应内容及所有未超限字段的原值。headers、URL 和 body 均可能包含敏感信息，在 UI、工具说明和文档中如实提示；sandbox 输出也可能暴露这些内容。
- 复用 `DataActions.save/load`，source 使用 `capture_network`，按会话隔离；删除聊天、会话 tombstone、过期及容量错误遵守既有规则。
- 当前数据仓库单条上限 16MiB，而 200 × 100KiB 已可能超过它：按完整记录边界分批保存，每批 JSON 最多 8MiB，最多 8 个 dataId，适配 `run_js` 最多 8 个引用；返回每批 count/顺序/描述符。不要直接把所有响应一次 `save`。
- 分批前按实际 UTF-8 JSON 序列化字节计量，包含 base64、转义和元数据开销；超过单记录/批次/会话额度明确报错，不暗中丢请求。
- 保存失败时采集仍应已停止，返回 `DATA_STORE_FAILED` 和可重试状态；保留有界待保存快照，避免重试 stop 重新采集。部分批次成功必须清理或复用，不能制造孤儿数据。
- 手动采集与 AI 采集共用服务。手动开始时绑定当前会话所有者；尚未绑定会话的手动采集只能由 UI 消费，不能被其他会话工具自动认领。
- 关闭/切换会话时停止它拥有的活动采集；删除会话还须清除后台快照，防止 tombstone 生效后重新写入。

## Agent 执行步骤

### S5.1：工具注册与授权

- [ ] 新建 `src/lib/network/tools.ts`，定义两个 AI SDK 工具及 Zod schema，采用可注入采集客户端和会话 DataActions 的工厂。
- [ ] 在 `src/lib/local-chat-transport.ts` 注册，与 `createCodeTools`、`createDataTools` 共用当前 chatId 的数据作用域，不加入远端 MCP 工具过滤流程。
- [ ] 接入审批、取消信号及运行状态；取消发生在 attach 途中也必须清理。模型回复结束后允许已确认采集继续，直到 stop、会话切换/删除或外部断开。
- [ ] 工具说明强调「先 start → 用户触发页面操作或既有获批浏览器操作 → stop → run_js」，start 不自动等待任意时长，也不暗中触发页面操作。

### S5.2：快照、预览与数据保存

- [ ] 对采集快照深拷贝以隔离内部对象，同时保留原始头。
- [ ] 实现有界预览、完整快照分批保存、结果缓存与保存失败重试。
- [ ] 如实提示原始头可能通过保存数据和 sandbox 输出暴露；避免在错误字符串和调试日志中不必要地输出抓包内容。
- [ ] 完整 body 不内联工具返回，不要求 AI 从预览拼回原始数据。

### S5.3：打通 `run_js`

- [ ] 保持现有 `run_js` schema：旧 `input` 与 `data`/`params` 仍互斥，不新增第二套沙箱或数据仓库。
- [ ] 用真实 dataId 跑通下面两个示例；多个批次由扩展加载，模型只填写引用及代码。
- [ ] 更新 `docs/ai-data-store.md` 的数据来源，补充网络数据生命周期、分批、敏感信息风险和「完整」的容量含义；按需更新 `docs/ai-code-sandbox.md` 与 README。

找出所有返回 4xx 的接口：

```js
// run_js({ data: { network1: dataId1, network2: dataId2 }, code: ... })
export default async function ({ data }) {
  const requests = Object.values(data).flat();
  return requests
    .filter((r) => r.status >= 400 && r.status < 500)
    .map(({ method, url, status }) => ({ method, url, status }));
}
```

整理 `/api/orders` 的 JSON 响应（示例假设接口返回数组或 `{ orders: [] }`，实际按捕获结构调整）：

```js
export default async function ({ data }) {
  const requests = Object.values(data).flat();
  return requests
    .filter((r) => new URL(r.url).pathname === "/api/orders")
    .map((r) => {
      if (r.responseBodyTruncated || r.bodyEncoding !== "utf8" || r.bodyError) {
        return {
          url: r.url,
          error: "Response unavailable, binary or truncated",
        };
      }
      try {
        const body = JSON.parse(r.responseBody ?? "null");
        const rows = Array.isArray(body) ? body : body?.orders;
        return Array.isArray(rows)
          ? { url: r.url, rows }
          : { url: r.url, error: "Unexpected response shape" };
      } catch {
        return { url: r.url, error: "Invalid JSON response" };
      }
    });
}
```

> 不假设 100KiB 截断后的 JSON 仍可解析；错误结果必须让 AI 知道数据不完整。分析结果继续遵守现有 `run_js` 自动保存并返回描述符的机制。

## 验证与交付

- [ ] 新增 `tests/network-tools.test.ts`：注册、参数校验、审批拒绝、取消、会话隔离、重复 start/stop、外部 detach 后取结果、无采集错误。
- [ ] 测试 Cookie/Authorization/Set-Cookie 在快照、保存值和 sandbox 输入中保留原值，且修改快照不会影响采集内部对象。
- [ ] 验证 previewChars 的默认/0/最大值及非法参数，覆盖响应/总预览截断。
- [ ] 数据管线测试覆盖：超 16KiB 走引用、超 16MiB 分批、实际 JSON 字节计量、存储失败重试、部分保存清理、删除会话后无法恢复数据。
- [ ] 集成测试使用未出现在预览中的尾部记录作为断言：`run_js` 仍能找出其 4xx，证明处理的是完整保留数据，不是预览。
- [ ] 新增 `tests/e2e/network-capture.spec.ts`，使用本地服务和真实 unpacked 扩展，执行 start → 页面 fetch/XHR → stop → run_js；不依赖真实 LLM key 或外部业务网站。
- [ ] 自动化环境若 debugger/调试提示条有能力限制，明确记录跳过原因，补充真实 Chrome 手工证据，不将 skip 当作通过。

---

## 最终验收与完成标准

按现有项目命令执行，并记录实际结果：

```sh
pnpm compile
pnpm test
pnpm format:check
pnpm build
pnpm exec playwright test tests/e2e/network-capture.spec.ts
pnpm test:e2e
```

- [ ] S4、S5 的 AC 和新增回归测试均通过；手工浏览器项记录 Chrome 版本、步骤、实际结果及必要截图。
- [ ] 现有页面工具、`run_js`、数据仓库、审批和会话删除流程无回归。
- [ ] 检查生产 manifest 权限与打包内容；没有为此修改现有 sandbox CSP 或扩大沙箱权限。
- [ ] 更新验证文档，区分自动化通过、手工通过、未验证和阻塞；未验证项不勾选。
- [ ] 交付总结列出变更文件、验证命令及结果、已知限制；没有用户要求时不自动提交、推送或发布。
- [ ] 每个大步骤完成和任务结束后，按项目 `AGENTS.md` 发送 Bark 通知；通知不得含捕获流量、认证头或其他敏感内容。
