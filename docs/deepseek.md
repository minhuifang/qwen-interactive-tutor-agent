# DeepSeek 文本模型接入

所有文本调用统一使用 DeepSeek：流式直接讲题与追问、可选题意解析、参考代码（含格式修复）、两道示例课件改写。旧两阶段内部流程也复用同一配置。只有 TTS 保留百炼 qwen3-tts-flash，DS 密钥不会发送给 TTS。

在 `apps/web/.env.local` 本地填写，不要把密钥贴到聊天或前端代码：

```dotenv
DEEPSEEK_API_KEY=你的DeepSeek官方密钥
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
# 保留已有百炼密钥，仅供 TTS
DASHSCOPE_API_KEY=你的百炼密钥
DASHSCOPE_TTS_VOICE=Cherry
```

填写后重启本地开发服务。默认模型依据当前官方文档；可修改为账号有权限的官方 DeepSeek 模型。第三方兼容平台的地址不在白名单内，不要直接填入，以免把密钥发送到不受信的目标。仅允许 api.deepseek.com 的 HTTPS 根路径或 /v1；拒绝重定向，不回退到百炼。旧 DASHSCOPE_MODEL / DASHSCOPE_BASE_URL 不再控制文本请求。

请求使用 DeepSeek `thinking: {type: 'disabled'}`，不再发送百炼 `enable_thinking`。保留流式输出、JSON 代码格式、超时/额度和隔离执行保护。来源字段由 qwen 改为 deepseek，页面展示相应更新，内存中的旧响应应刷新清除。

当前本地未填写 DS Key，因此只完成模拟协议与回归验证，不能声称真实鉴权、模型权限或生成质量已验证。

依据：[DeepSeek 官方 Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)。
