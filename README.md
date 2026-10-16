# TSWeb

打开网页，自行填写 IP 或域名，加入想去的 TeamSpeak 服务器。一个页面完成频道切换、多人语音和频道文字聊天。

一个应用容器，不需要 ServerQuery 账号、数据库或音乐机器人。支持 Linux amd64 / arm64。

## Docker 部署

准备已启动的 Docker，执行：

```bash
docker run -d --pull always --name tsweb --restart unless-stopped -p 127.0.0.1:8080:8080 -v tsweb-data:/app/data ghcr.io/godluo666/tsweb:latest
```

服务默认监听 `127.0.0.1:8080`。在自己的反向代理中设置：

- 上游地址：`http://127.0.0.1:8080`
- 开启 WebSocket 转发（`/ws`）
- 使用自己准备的 HTTPS 域名和证书

TeamSpeak 已在自定义 Docker 网络中时，在启动命令中加入 `--network 网络名`，网页中的 TS 地址填写 `TS容器名:9987`。反代也运行在 Docker 中时，可将反代加入同一网络，上游填写 `http://tsweb:8080`。容器重启保留网络连接，删除后重建时需保留 `--network` 参数。

打开自己配置的 HTTPS 网页地址，填写要加入的 TS 服务器地址、昵称和可选的服务器密码后连接。每位用户独立选择 TS 服务器，退出后可换一个地址重新连接。镜像地址可替换为自己的镜像加速地址。

本机可直接打开 `http://localhost:8080`。TS 在 Docker 宿主机上时，启动命令加入 `--add-host host.docker.internal:host-gateway`，网页中的 TS 地址填写 `host.docker.internal`。

## 网页设置

首次启动生成管理密码，使用 `docker logs tsweb` 查看。点击网页右上角的齿轮，输入管理密码，即可修改：

- 网页名称
- 网页访问密码，留空可取消
- TS 身份安全等级（8–20，默认 8）

保存后立即生效，身份安全等级用于后续连接。设置和管理密码保存在数据卷中，更新镜像后继续保留；网页保存的设置优先于启动环境变量。部署机器需要能访问目标 TS 服务器的 UDP 语音端口。

## 更新与停止

Docker 部署先执行 `docker pull ghcr.io/godluo666/tsweb:latest`，再停止、删除旧容器，使用原启动命令重建。保留原命令中的端口、网络和 `tsweb-data` 数据卷参数。

Compose 部署在原安装目录执行：

```bash
docker compose pull && docker compose up -d
```

停止：Docker 使用 `docker stop tsweb`，Compose 使用 `docker compose down`。保留数据卷，就能保留网站设置、TS 身份及其服务器权限。

## 使用

- 在连接页填写服务器地址、3–30 个字符的昵称和可选的服务器密码。IP、域名均可，不写端口时使用 9987；自定义端口写为 `203.0.113.10:10000` 或 `ts.example.com:10000`。
- 域名不带端口时支持 TeamSpeak 的 SRV / TSDNS 解析；指定端口时优先使用填写的端口。
- 每位网页用户都是独立的 TS 客户端，占用一个服务器名额。服务器地址从部署机器访问；远程网页中的 `127.0.0.1` 指向网页服务容器自身。
- 点击频道切换，受密码保护的频道会要求输入频道密码。
- 点击频道旁或页面顶部的信息按钮，可查看频道主题、描述、人数上限、音频编码、质量、进入密码要求和发言权限。
- 进入时默认关闭麦克风；点击开启后，浏览器会请求麦克风权限。支持回声消除、浏览器降噪、静音、关闭收听及音量调节。
- 每位其他成员的卡片都有独立音量滑块，范围 0–200%，0% 为本地静音；点击百分比恢复 100%。设置按 TS 地址和成员身份在浏览器中记住，只影响自己的收听。
- 底部显示浏览器到网页服务的往返延迟、网页服务到 TS 的 UDP 往返延迟，以及最近 60 秒的 UDP 探测丢包率，每 5 秒更新。未收到测量数据时显示 `—`。
- 文字消息同步到当前 TS 频道，也能接收服务器消息和来自 TS 客户端的私聊。
- 浏览器自动记住上次成功连接的地址、昵称和收听音量。重新打开网页即可继续使用这些设置，进入时麦克风保持关闭。切换服务器时清空频道和本次消息。
- TS 身份保存在服务端数据卷，浏览器保留对应标识；使用同一浏览器重连可继续使用原身份及各服务器赋予它的权限。

## 已知限制

- 远程使用麦克风必须通过 HTTPS；`http://服务器IP:8080` 无法调用麦克风。本机 `localhost` 可以使用 HTTP。
- 语音支持 Opus Voice / Opus Music 频道；旧的 Speex / CELT 频道应改为 Opus。文字发送遵守 TS 权限与 1024 字节限制。
- 默认身份安全等级为 8；更高要求的服务器可在网页设置中调整为 8–20。服务器容量、权限及同一出口 IP 的防洪限制仍由 TS 管理；多人集中加入时需为网关 IP 调整服务器的连接限制。
- 网页消息只保留在当前会话，最多 200 条。手机浏览器进入后台或锁屏可能暂停音频；断开后可重新连接。
- 麦克风上行使用 48 kHz 单声道 PCM，通过网关编码为 Opus；连续发送时上行约 0.8 Mbps。下行直接传输 TS 的 Opus 数据包。
- 丢包率基于 TS UDP Ping/Pong，5 秒未回应计为丢失；该指标不代表语音数据包的完整丢包率。频道详情遵循 TS 用户的查看权限，描述以文本显示。
- 清除浏览器站点数据或删除服务端数据卷会生成新身份。每个浏览器身份同时允许一个通话标签页。

## 源码与镜像

推送 `main` 后，GitHub Actions 自动测试并发布 `ghcr.io/godluo666/tsweb:latest`。推送 `v1.0.0` 这样的版本标签，会发布对应版本镜像与 Release；不需要配置仓库密钥。

从源码本地构建：`docker build -t tsweb .`。运行时使用上方的 `docker run` 命令，将镜像名改为 `tsweb`。

开发运行：`npm ci && npm run build && npm start`。测试：`npm test`；实际 TS 联调：设置测试用的 `TS_HOST` 后执行 `node --test test/live.integration.js`。

网页播放 AudioWorklet 提取自 [PowerfulTS](https://github.com/Slldyd2077/PowerfulTS)，通话连接使用同一技术路线中的 [TeamSpeak 协议库](https://github.com/HoneyBBQ/teamspeak-js)。许可及来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。MIT License。
