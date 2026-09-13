# 本地隔离执行器：镜像下载修复，命令行真实验收通过

2026-09-11 在 Apple Silicon macOS 上安装了 Colima 0.10.3、Docker CLI 29.8.0、Lima 2.2.0。未设置开机自启，未改变默认 Docker context。专用 profile/context 为 `tutor-sandbox` / `colima-tutor-sandbox`。

## 已配置

- Colima VZ 虚拟机：2 CPU、2 GiB 内存、10 GiB 数据盘上限，默认根盘 20 GiB（稀疏分配，并非已占用 30 GiB）。
- `--mount none`，没有宿主目录挂载；关闭 SSH agent 转发、SSH config 写入、默认 context 激活、业务端口自动转发与 binfmt。
- 宿主原有 Docker context 仍为 `default`。Docker socket 只由本地控制器使用，绝不挂载进执行容器。
- 虚拟机原始 `/etc/resolv.conf` 是指向不存在服务的失效链接。已备份到 `/etc/resolv.conf.tutor-original`，通过 guest-resolv.conf 安装专用 VM DNS 配置。没有修改 macOS DNS。
- Docker 和 containerd 的 systemd drop-in `tutor-proxy.conf` **清空显式 HTTP/HTTPS 代理并设置 NO_PROXY=***。此前显式代理 `192.168.5.2:7890` 路径出现 TLS 中断，已取消。源文件为 packages/runner/guest-docker-proxy.conf。没有修改宿主代理设置，且运行容器也显式清空大小写代理环境变量。

## 原因与修复验证

此前有两层问题：虚拟机失效 DNS 链接（已修复），以及显式 HTTP 代理路径的 TLS 不稳定。2026-09-11 进一步对比发现，宿主和 VM 经显式代理访问 Docker 官方端点会出现 SSL_ERROR_SYSCALL/EOF；VM 使用 curl --noproxy '*' 时认证端点返回 200、仓库 /v2/ 返回正常的未认证 401。这里“不走显式代理”不等同于绕过宿主可能存在的系统级/TUN 路由。

清空专用 VM 的 Docker/containerd 大小写代理变量并设置 NO_PROXY=* 后，重启服务，真实 pull 成功，退出码 0；image inspect 确认完整镜像存在且架构为 arm64。修复定位到显式代理路径，但尚未定位代理内部节点/规则为何中断；没有改动用户的全局代理。

固定摘要为 `node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32`，已存入 packages/runner/runtime-config.mjs 作为本地默认值，仍可通过 TUTOR_RUNNER_IMAGE 指定经核对的摘要。运行时不下载镜像。

31 项自动测试通过。真实 `tests/live-runner-check.mjs` 也通过：此前 Qwen 求和代码的普通/空/负数三例正确；错误答案识别 failed；抛异常识别 runtime_error；死循环 8 秒终止；输出洪泛触发 output_limit。实际容器读到 UID 65534、只读文件系统、仅 loopback 网络接口、内存 134217728 字节、32 PID、cpu.max=50000 100000、空 capabilities、no-new-privileges=1；没有宿主 home、Docker socket、模型密钥或非空代理变量。结束后容器列表为空，默认 context 仍为 default。有限样例通过不等于解法完整正确性证明。

Web 页面现已接通本地验证：先生成解法，再人工核对 JSON 用例并勾选确认。生成 API 的状态为 not_run，只有本次独立验证返回全部通过才显示“已通过本次全部样例”。接口仅存在于 localhost:3001 的 Vite 开发服务，无额外端口、不部署服务器、不在 Worker 内执行进程。

本地 HTTP 桥接在 http-middleware.mjs：检查回环地址、Host/Origin、自定义请求头、随机会话令牌；单并发、12 作业/小时、100KB请求限制和5秒读取超时。清理无法确认时停止接受新作业。页面改题/重新生成/改测试/取消确认会撤销旧报告。断连不会启动剩余样例，当前样例受8秒上限约束。

接口阶段34项自动测试通过，新增来源/令牌/非法数据/限额/并发/清理失败保护测试。真实 tests/live-web-runner-check.mjs 通过：正确预期通过、错误预期不符、无令牌和跨来源403、未确认400、死循环超时且跳过后续样例。接口阶段没有调用百炼。后续已完成浏览器点击、桌面/移动端验证面板检查和一次真实模型回归（2886 Token），详见 browser-acceptance.md；不要把模拟503等故障UI检查当成真实关闭虚拟机的恢复测试。

## 执行器设计

`packages/runner/docker-runner.mjs` 只在宿主编排 Docker CLI，模型代码作为 stdin 数据送入容器，在容器内求值；不在宿主 eval/VM 执行。仅使用专用 context，禁止 shell 拼接。每个样例新建容器：禁网、只读根文件系统、无宿主挂载、非 root UID 65534、全部 capabilities 移除、no-new-privileges、0.5 CPU、128 MiB 内存（不额外交换）、32 PID、64 文件描述符、8 秒墙钟超时、32 KiB 输出上限。禁用容器日志驱动；stdout/stderr 在宿主受限读取。完成或超时后清理该随机命名容器，清理不能确认时停止整个作业。

镜像参数必须是 `node@sha256:<64位摘要>` 且使用 `--pull=never`，没有可用已审查镜像就拒绝运行。输入需 `acknowledged: true`，表示操作者已核对代码、输入适配与样例预期；这不是身份验证，CLI 仅供本地单用户使用。每次最多 8 个样例，按精确 JSON 结构在宿主比较 actual 和 expected，expected 不发送到容器。无序输出的题目需人工规范预期或后续专门比较器，当前不能冒充通用判题。

即便将来验收成功，这也只是本地练习用的受限容器，不是可对公网承诺的强安全、多租户沙箱。宿主控制器能访问 Docker daemon；不要直接把它开放成无鉴权 HTTP 服务。有限样例通过也不等于算法正确性证明。

## 本地使用与后续步骤

1. `colima start tutor-sandbox`，确认专用 profile 内 DNS 和服务代理仍生效。
2. 当前完整镜像已在本地，无需再次 pull。更换版本时才下载并复核新摘要。
3. `docker --context colima-tutor-sandbox image inspect node:22-alpine --format '{{json .RepoDigests}}'` 可复核实际摘要。
4. 运行 `node tests/live-runner-check.mjs`，默认读取已固定摘要。此脚本不调用百炼；测试保留此前求和解法逻辑、错误答案、异常、死循环、输出洪泛、非 root/只读/禁网接口/cgroups/无模型密钥等。
5. 启动 `pnpm dev` 后可运行 `node tests/live-web-runner-check.mjs` 验证真实 HTTP 桥接，再检查没有残留 `tutor-case-*` 容器。此脚本需要专用虚拟机已启动，不调用模型。

命令行作业格式：`{"acknowledged":true,"code":"function solve(input) { return input; }","cases":[{"input":1,"expected":1}]}`。保存经人工核对的 JSON 后，以 Node 22+ 执行 `node packages/runner/cli.mjs <job.json>`。

完成工作后可 `colima stop tutor-sandbox` 释放运行内存，保留镜像、配置和数据；不要删除其他 profile。

依据：[Colima 安装](https://colima.run/docs/installation/)、[Docker 运行限制](https://docs.docker.com/engine/containers/run/)、[Docker daemon 代理](https://docs.docker.com/engine/daemon/proxy/)、[Google Docker Hub 缓存](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images)。
