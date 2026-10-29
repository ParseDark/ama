# 网络抓包提交验证记录

## 本次通过

- `pnpm compile`：通过。
- `pnpm test`：65 个测试文件，240 项测试通过。
- `pnpm format:check`：通过。
- `pnpm build`：通过，产物 `.output/ama-0.5.1-chrome.zip`；版本未改。
- `pnpm exec playwright test --output=/tmp/ama-network-terra/full-artifacts`：全部 30 项通过。
- `git diff --check`：通过。

真实网络 E2E 使用 unpacked Chromium 扩展与本地 HTTP 服务，不模拟 debugger。覆盖 Fetch POST、XHR 404、请求体和响应内容、Authorization/Cookie 原值、100KiB 大响应截断、图片/CSS 过滤、停止幂等、会话所有权、再次采集、关闭标签页自动停止，以及真实 sandbox Worker 对捕获记录筛选 4xx。

另新增回归用例：后台采集查询延迟时，新建/清空聊天后立即输入不会丢字。

## 用户确认的变更

- 取消原 Story 5 的认证头脱敏要求：Cookie、Authorization、Set-Cookie 原样保留。
- 暂时保留每个扩展实例同一时间一个活动采集；停止后可以再次开始。

## 仍未验证及限制

- 在实际 Chrome 手工点击关闭顶部调试提示条尚未验证；`onDetach` 路径有单测，但不替代手工交互证据。
- 重定向 ExtraInfo 的逐跳完整头恢复不是当前实现保证；重复 requestId 保留最终请求，重定向后不再合并 ExtraInfo，以避免把前一跳认证头错配到后一跳。
- 突然的扩展/浏览器重启不提供活动采集的持久化恢复。
- 对第三方站点、实际模型供应商的调用不在本次本地测试范围内。

本文件是本次提交前的实测结果，不表示 `plan.md` 所有增强边界和手工验收项均已完成。
