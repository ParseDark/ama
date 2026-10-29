# 网络抓包（Story 4–5）

在聊天侧栏点击 **Start capture**，操作目标页面，再点击 **Stop capture**。AI 可使用 `capture_network_start`、`capture_network_stop` 控制同一后台采集服务；正常模式下 AI 开始采集需要确认，Danger mode 遵循现有工具策略。

## 采集范围

- Chrome debugger/CDP Network 采集当前 HTTP(S) 标签页的 XHR、Fetch，按 requestId 合并请求与响应。
- 记录 URL、method、status、请求/响应头、请求体和响应内容。图片、CSS、字体等不保存。
- 最多保留最先接纳的 200 条请求；单条响应最多 100KiB UTF-8（非文本为有界 base64），截断和读取失败显式标记。
- 当前暂时只允许一个活动采集；停止后可以再次开始。开始后切换标签页不迁移目标，关闭目标或 debugger 外部断开会停止采集。
- 元数据有界；缓存及重定向等复杂场景可能无法获得全部头/响应内容，不视为完整 HAR 或 DevTools 替代品。

## 隐私与数据

**按用户最新要求，不脱敏 Cookie、Authorization、Set-Cookie。** 请求/响应头、URL、body 都可能含敏感信息。开始采集本身不会把完整流量上传给模型；工具返回的响应预览、后续显式查看结果及脚本输出会进入配置的模型上下文。

stop 返回有界请求预览（默认响应前 256 个字符，最多 1024）和 `dataRefs`。完整保留数据按实际 JSON 字节分批存入当前聊天数据仓库；每批最多 8MiB，最多 8 个引用。通过现有 `run_js` 数据引用模式处理，不需模型转抄响应：

```js
// run_js: data: { network: dataRefs[0].dataId, ... }
export default async function ({ data }) {
  return Object.values(data)
    .flat()
    .filter((request) => request.status >= 400 && request.status < 500)
    .map(({ url, method, status }) => ({ url, method, status }));
}
```

“完整保留”仍受采集上限约束。响应截断后 JSON 可能不再合法，应先检查 `responseBodyTruncated`、`bodyEncoding` 和 `bodyError`。数据遵循现有会话隔离、容量、过期与删除规则，不参与配置同步。

## 实现与验证

- `src/lib/network/`：后台服务、运行时客户端、类型和 AI 工具。
- `src/components/network-capture.tsx`：手动控制与状态。
- `tests/network-*.test.ts*`：生命周期、消息来源、容量、工具、数据引用和 UI 测试。
- `tests/e2e/network-capture.spec.ts`：真实 unpacked Chromium 扩展、本地 HTTP 服务、CDP 请求/响应、认证头原值、大响应截断、静态资源过滤、关闭标签页和真实 sandbox 分析。

```sh
pnpm compile
pnpm test
pnpm format:check
pnpm build
pnpm exec playwright test tests/e2e/network-capture.spec.ts
pnpm test:e2e
```

顶部调试提示条的手动关闭交互尚需在实际 Chrome 手工确认，不能用模拟 `onDetach` 的单测替代该项验收。
