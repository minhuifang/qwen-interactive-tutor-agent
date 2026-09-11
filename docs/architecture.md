# Architecture

## 主链路

```text
题目输入
  -> Problem Parser
  -> Solution Generator
  -> Deterministic Verifier
  -> Teaching Designer
  -> Lesson/Motion Compiler
  -> Lesson Player
  -> Student Answer Evaluator
  -> Misconception Diagnoser
  -> Adaptive Tutor
```

## 模型路由建议

- 图片题目识别：Qwen VL。
- 数学解题：Qwen Math。
- 教学设计和 Motion JSON：Qwen Plus。
- 疑难结果复核：Qwen Max。
- 短答案判断与结构修复：Qwen Flash。
- 最终讲解词配音：Qwen3 TTS Instruct Flash。

## MVP 边界

1. 先定义通用 lesson schema，不让模型重复生成整页 HTML。
2. 实现一个通用 Lesson Player 和一种数学题 Motion 渲染器。
3. 用三道题覆盖正确、计算错误、概念错误三条教学路由。
4. 讲解词确认后再调用 TTS，并缓存已生成资源。
