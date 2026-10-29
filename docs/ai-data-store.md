# 会话数据仓库与 `run_js` 数据引用

模型负责生成处理代码和选择数据，**不负责转抄数据**。原始数据由扩展保存在会话隔离的 IndexedDB 中，执行时由扩展直接取出并传给 sandbox Worker。

## 数据流

```text
read_file / capture_network_stop / 上一次 run_js 结果
        ↓ 自动保存原始值（截断、预览之前）
扩展 IndexedDB（ama-data）
        ↓ 模型只看到 dataId、类型、字节数、有界预览
run_js({ code, data: { name: dataId }, params })
        ↓ 扩展加载原始值
Worker: module.default({ data: { name: 原始值 }, params })
        ↓ 结果自动保存
{ dataId, type, bytes, count?, preview, previewTruncated }
```

## 工具约定

- `run_js` 首选 `data: { name: dataId }` + `params`，两者与旧 `input` 互斥。
- 旧的 `input` 仅用于不超过 16 KiB 的小参数；数据集应通过 `data` 引用。
- 成功结果的 `result` 是数据描述符，不含原始大数据；后续脚本用其 `dataId` 继续处理。
- `params` 上限 4 KiB，最多 8 个数据引用。
- `logs` 每条最多 2,000 字符，总计最多 8 KiB / 50 条，返回 `logsTruncated`。
- `read_file` 在返回摘录前保存**完整原文**；`storeOnly=true` 时只返回描述符。存储失败不会让普通读取失败，而是返回 `dataWarning`。
- `list_data` 返回最多 100 条元信息（不含预览）；`inspect_data` 用 `offset`/`limit` 获取有界预览。

## 网络抓包来源

`capture_network_stop` 将当前会话完整保留的请求记录分批保存，返回 `dataRefs` 和有界响应预览。用 `run_js({ data: { network: dataRefs[0].dataId }, code })` 加载原始记录；多批次可传多个命名引用并在脚本中合并。每批最多 8MiB、最多 8 个引用，不改变下面的数据仓库配额。

按用户最新要求，网络认证头不脱敏：Cookie、Authorization、Set-Cookie 原值也会随完整记录保存和传给 sandbox。头、URL、body 可能含敏感数据，脚本输出和显式查看结果可能进入模型上下文。采集最多 200 条、单响应最多 100KiB，不能把“完整保留”理解为无限制抓包。详见 [network-capture.md](./network-capture.md)。

## 存储约束

| 限制 | 默认值 |
|---|---|
| 单条 | 16 MiB |
| 单会话 | 64 MiB / 1,000 条 |
| 全局 | 256 MiB / 10,000 条 |
| 过期 | 7 天 |
| 预览 | UTF-8 JSON ≤ 2 KiB（可分页至 4 KiB） |

- 仅接受严格 JSON 值；拒绝 `undefined`、BigInt、循环引用、非有限数字、访问器、稀疏数组。
- 容量超限返回明确错误，不静默驱逐仍有效的数据。
- 过期数据在保存/列表时惰性物理清理。
- 数据按 `sessionId` 隔离；跨会话、已删除或过期 ID 统一报 “Data not found or unavailable”。
- 删除或清空聊天时先写入会话 tombstone，再进行清理，防止已运行的工具把数据重新写回；tombstone 永久保留（记录很小）。
- 记录不可变：每次保存生成新 ID。
- 数据只在本地 IndexedDB，不会因保存而发送给模型；只有预览和显式 `inspect_data` 结果进入上下文。

## 实现位置

- `src/lib/data/store.ts`：IndexedDB（`ama-data`，metadata/values/tombstones）、容量与过期控制、预览截断。
- `src/lib/data/actions.ts`：会话绑定的 `save/load/inspect/list/remove`。
- `src/lib/data/tools.ts`：`list_data`、`inspect_data`。
- `src/lib/code-tools.ts`：解析数据引用、执行、保存结果、有界日志。
- `src/lib/files/tools.ts`：`read_file` 自动保存完整原文。
- `src/lib/local-chat-transport.ts`：按 `chatId` 创建数据作用域并注册工具。
- `src/lib/sessions.ts`：删除聊天时清理关联数据。

## 验证

```sh
pnpm test
pnpm compile
pnpm build
pnpm test:e2e
```

端到端用例生成 12,000 行数据，验证第二次 `run_js` 只传 `dataId`、模型上下文不含未预览的尾部数据，最终结果仍来自原始数据。
