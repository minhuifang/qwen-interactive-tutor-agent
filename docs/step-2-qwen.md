# 第二步：一个可观察、可拒绝错误结果的模型工作流

## 本阶段学什么

模型调用不是整个 Agent。输入边界、提示词、返回协议、校验、编译、错误处理与消耗控制，共同构成这一步的工作流。当前用普通 TypeScript 显式串联节点；等需要动态分支、人工审批、断点恢复时，再引入 LangGraph。

| 节点 | 输入 → 输出 | 实现位置 |
| --- | --- | --- |
| 请求校验 | 题目 ID + beginner/interview → 受限输入 | `apps/web/lib/teaching-plan.ts` |
| 状态加载 | 题目 ID → 已验证参考代码、六个状态帧 | `apps/web/lib/lessons.ts` |
| 教学设计 | 可信状态 + 风格 → Qwen JSON | `apps/web/lib/server/generate-lesson.ts` |
| 校验与编译 | 提纲 + 六步讲解 → Lesson | `compileTeachingPlan` |
| 展示与回退 | Lesson → 原播放器；失败保留当前课件 | `apps/web/components/generation-panel.tsx` |

模型只返回 `objective` 与 `steps[{id,title,narration}]`。Zod 拒绝额外字段、空文本、超长文本、错误步骤数量；编译器核对步骤 ID 和顺序，再装配固定状态。这确保模型不能更换代码、答案、URL 或动画索引，不等于证明讲解内容完全正确。

## 接口

- `GET /api/lessons/generate`：只返回是否配置、模型名和安全提示，不检查密钥是否真的有效，不返回密钥。
- `POST /api/lessons/generate`：JSON `{ "lessonId": "two-sum", "style": "beginner" }`。只允许本机、同来源、JSON 请求，正文上限 1024 字节。
- 成功：课件、教学目标、model、source、cached、usage、已完成的 stages。阶段列表是完成后的记录，不是假装实时进度。
- 失败：`error.code` 和可操作提示。常见码：NOT_CONFIGURED、MODEL_AUTH、MODEL_LIMIT、TIMEOUT、INVALID_OUTPUT、BUSY、BUDGET_LIMIT。
- 不向页面返回原始上游错误、提示词、堆栈和密钥；不允许请求传入自定义模型、URL 或任意 Prompt。

## 一次真实验收

先在已忽略的 `apps/web/.env.local` 配置北京地域密钥、支持 JSON 输出的模型和匹配地址，重启本地服务。确保控制台额度和用完即停设置符合预算。

1. 选择“两数之和”和“初学者讲解”，生成一次。确认页面标注 Qwen、讲解替换、代码和答案不变。
2. 同题同风格再次生成，确认命中缓存、不新增模型请求。刷新页面不会清除服务端进程缓存。
3. 选择“面试复习”，确认这是另一个缓存键，会再次调用模型。
4. 切换到“无重复字符的最长子串”，生成后检查最后一个 a 的讲解仍强调 left 不回退。
5. 手动复核讲解与状态、公式是否一致；点击恢复固定课件，检查播放和判题仍可用。

没有密钥时，界面禁用生成并提示配置位置。可用 `pnpm test` 完成无费用的模拟验证。当前自动测试覆盖协议、缓存、超时、并发、预算、上游失败、跨域、大小上限、参考算法和 Worker 重定向兼容性。

## 真实验收记录（2026-09-11）

- 发现根因：Worker 的 fetch 只接受 follow/manual，不接受 error。此前统一 NETWORK 错误掩盖了参数异常；无密钥探测证明相同地址在 manual 下可达。
- 修复：两条模型请求均使用 manual；所有 3xx 被显式拒绝，不跟随 Location，不转发 Authorization。临时无密钥诊断路由已移除。
- 一次真实调用：two-sum / beginner / qwen3.7-plus；六步课件校验通过。输入 967、输出 890、合计 1857 Token。人工检查了先查后存、Map 状态与最终下标 [1,2] 的一致性。
- 页面验收：真实接口 cached:true；显示生成的首步讲解；切换步骤；输入 [2,4] 得到数值/下标混淆反馈并跳转补讲；模拟 502 后保留当前课件；恢复固定课件；没有页面运行时异常。
- 测试脚本 `tests/live-ui-check.mjs` 使用 Playwright 无界面 Chromium，保留用户原预览标签页。自动点击前等待 React 配置加载完成，避免对尚未 hydration 的 SSR 按钮点击失效。
- 范围：第二阶段的一个完整代表链路通过，不代表所有模型/风格/题目均已真实验证，也不代表新题解题已实现。

浏览器脚本不纳入默认单元测试，运行需要显式授权模型用量，并配置 `PLAYWRIGHT_PACKAGE_ROOT`（包含 playwright 的 node_modules）及可选 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。它会进行一次实际页面 POST 并断言缓存命中；若缓存超过 10 分钟已失效，此 POST 仍可能调用模型，必须注意额度。

## 为什么暂不发布

当前服务面向单机学习，Origin/Host 检查不是用户身份认证，进程缓存/限流也不是多实例配额系统。上线必须另加认证和服务端授权、持久化预算、密钥注入、请求日志脱敏及内容评测。禁止把模型调用接口直接开放给公网。

## 参考依据

- [百炼结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)：使用 JSON Object 模式，并在 Prompt 中明确要求 JSON；应用层仍独立校验结构。
- [百炼 Base URL](https://help.aliyun.com/zh/model-studio/base-url)：北京地域共享域名及业务空间专属域名，密钥和地址须匹配。
- [Cloudflare 本地环境变量](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)：服务端通过 Worker env 读取本地 `.env.local`，不把秘密编译到前端。
