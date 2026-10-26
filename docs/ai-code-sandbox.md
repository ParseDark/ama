# AI 代码沙箱执行（v1）

AI 工具 `run_js` 接收 `code` 和 JSON `input`，代码约定为 ES module：

```js
import { sum } from "lodash-es";

export default async function (input) {
  console.log("rows", input.length);
  return { total: sum(input) };
}
```

返回格式：

```json
{ "id": "request-id", "ok": true, "result": { "total": 6 }, "logs": ["rows 3"], "error": null }
```

- 裸包导入（包括作用域包、版本、子路径、re-export、字面量动态导入）通过模块解析器改写为 `https://esm.sh/...`。动态计算的包名不做改写，请使用字面量导入。
- 返回值通过 JSON 序列化后返回；`undefined`、循环引用、`BigInt` 等不可序列化结果会报告错误。
- 网络连接不限制目标域名（`connect-src * data: blob:`），可以使用 `fetch`；仍受浏览器 CORS、混合内容和网络策略限制，不代理请求或绕过 CORS。远端模块脚本仍仅允许 esm.sh，避免与连接权限混淆。
- 每次调用使用独立 Worker。10 秒到期由 sandbox 页面终止 Worker，保留已经收到的日志。
- side panel 的 `runCode(code, input)` 等待 iframe ready 后发送请求，按 ID 匹配并发结果，仅接受该 iframe 的消息。沙箱执行错误通过响应 `ok: false` 返回；iframe 启动或通信失败则拒绝 Promise，由 AI SDK 回传工具错误。
- v1 不支持 Python、页面 DOM、offscreen 或写回页面。

## 实现位置

- `wxt.config.ts`：生成 manifest 的 sandbox 页面与独立 CSP，不改变现有扩展页 CSP。
- `src/entrypoints/sandbox/`：WXT 构建的 `sandbox.html` 入口。
- `src/lib/sandbox-runtime.ts`：import 改写、Worker 调度与 10 秒超时；`src/lib/sandbox-worker.js` 以 raw 源码加载，处理模块执行、日志和 JSON 结果，避免构建器注入 Worker 外部依赖。
- `src/lib/code-runner.ts`：隐藏 iframe、ready 协议及 Promise 调用接口。
- `src/lib/code-tools.ts`：`run_js` 定义；由 `LocalChatTransport` 注册。

WXT 会将 sandbox 脚本打包为带 hash 的 `chunks/sandbox-*.js`，并自动写入 `sandbox.html`，无需手工维护产物中的脚本名。

## 验证

```sh
pnpm test
pnpm compile
pnpm build
pnpm exec playwright test tests/e2e/sandbox.spec.ts
```

端到端测试使用真实 Chromium 扩展、sandbox iframe、Worker 和 module loader；npm CDN 响应在测试中固定，以避免网络影响，但仍检验 esm.sh URL 改写、CSP 以及静态/动态 import 加载。

构建完成后，在 Chrome 扩展管理页重新加载 `.output/chrome-mv3`，然后重新打开 side panel。npm 导入需要能访问 esm.sh。

## 自动发布

- 普通提交 push 到 `main`：Build extension 工作流执行检查并上传 ZIP 到 Actions artifacts（保留 30 天）。
- 更新 `package.json` 版本后 push 到 `main`：Release 工作流检查对应版本标签是否存在；不存在时，在所有发布检查通过后自动创建标签、正式 GitHub Release，并附上 `.output/ama-版本-chrome.zip`。
- 已存在版本标签的普通提交不会覆盖已发布版本。也支持手工推送 `vX.Y.Z` 标签或手动触发 Release 工作流；标签必须与包版本一致。
- 本地 commit 本身不会触发 Actions，必须 push 到 GitHub。
