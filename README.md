# Qwen Interactive Tutor Agent

一个面向数学学习的自适应交互教学 Agent。

## 目标

- 解析文本、图片或文档中的题目。
- 生成经过校验的解题过程和教学脚本。
- 生成前端可执行的 Motion/lesson JSON。
- 支持学生分步答题、错因识别和针对性二次讲解。
- 使用 Qwen 文本、视觉、数学和 TTS 模型完成生成链路。

## 规划的模块

```text
apps/
  web/                 学生端与通用 Lesson Player
  api/                 Agent API 和会话编排
packages/
  lesson-schema/       题目、步骤、Motion 和答题协议
  motion-renderer/     通用 SVG/Motion 渲染器
  qwen-client/         百炼模型调用封装
  evals/               解题正确性与诊断评测
docs/
  architecture.md      系统架构和分阶段计划
```

## 当前状态

仓库已建立，正在定义单题教学协议和 MVP 技术栈。

## 安全

不要将百炼 API Key 提交到 Git。本地开发时从 `.env` 读取，前端不得直接调用百炼 API。
