# TSWeb

打开网页，加入现有 TeamSpeak 服务器。一个页面完成频道切换、多人语音和频道文字聊天。

一个应用容器，不需要 ServerQuery 账号、数据库或音乐机器人。支持 Linux amd64 / arm64。

## 一键部署

准备已启动的 Docker，将域名解析到部署机器，开放 TCP 80、443。把命令里的域名和 TeamSpeak 地址换成自己的：

```bash
curl -fsSL https://raw.githubusercontent.com/godluo666/tsweb/main/deploy.sh | bash -s -- --domain voice.example.com --ts-host ts.example.com
```

打开 `https://voice.example.com`，填写昵称即可加入。HTTPS 证书由 Caddy 自动申请和续期，所有配置及数据保存在当前目录下的 `tsweb` 项目中。

TS 有服务器密码，或希望给网页设置访问密码时，直接在同一条命令后追加：

```bash
--ts-password 'TS服务器密码' --web-password '网页访问密码'
```

其他可选参数：`--ts-port 9987`、`--name '我的频道'`、`--dir /opt/tsweb`。部署机器需要能访问 TS 服务器的 UDP 语音端口。

## 本机一条命令

```bash
docker run -d --name tsweb --restart unless-stopped -p 127.0.0.1:8080:8080 -e TS_HOST=ts.example.com -v tsweb-data:/app/data ghcr.io/godluo666/tsweb:latest
```

打开 `http://localhost:8080`。公网使用上方的 HTTPS 一键部署。

TS 就在 Docker 宿主机上时，将地址写成 `host.docker.internal`；Linux 的 `docker run` 再加 `--add-host host.docker.internal:host-gateway`。一键脚本已包含该映射。

## 更新与停止

在安装目录执行：

```bash
docker compose pull && docker compose up -d
```

停止：`docker compose down`。保留命名卷，就能保留 TS 身份及其服务器权限。

## 使用

- 输入 3–30 个字符的昵称，连接服务器；每位网页用户都是独立的 TS 客户端，占用一个服务器名额。
- 点击频道切换，受密码保护的频道会要求输入频道密码。
- 进入时默认关闭麦克风；点击开启后，浏览器会请求麦克风权限。支持回声消除、浏览器降噪、静音、关闭收听及音量调节。
- 文字消息同步到当前 TS 频道，也能接收服务器消息和来自 TS 客户端的私聊。
- TS 身份保存在服务端数据卷，浏览器保留对应标识；使用同一浏览器重连可继续使用原身份。

## 已知限制

- 远程使用麦克风必须通过 HTTPS；`http://服务器IP:8080` 无法调用麦克风。本机 `localhost` 可以使用 HTTP。
- 语音支持 Opus Voice / Opus Music 频道；旧的 Speex / CELT 频道应改为 Opus。文字发送遵守 TS 权限与 1024 字节限制。
- 默认身份安全等级为 8；更高要求的服务器可通过 `TS_SECURITY_LEVEL` 设置为 8–20。服务器容量、权限及同一出口 IP 的防洪限制仍由 TS 管理；多人集中加入时需为网关 IP 调整服务器的连接限制。
- 网页消息只保留在当前会话，最多 200 条。手机浏览器进入后台或锁屏可能暂停音频；断开后可重新连接。
- 麦克风上行使用 48 kHz 单声道 PCM，通过网关编码为 Opus；连续发送时上行约 0.8 Mbps。下行直接传输 TS 的 Opus 数据包。
- 清除浏览器站点数据或删除服务端数据卷会生成新身份。每个浏览器身份同时允许一个通话标签页。

## 源码与镜像

推送 `main` 后，GitHub Actions 自动测试并发布 `ghcr.io/godluo666/tsweb:latest`。推送 `v1.0.0` 这样的版本标签，会发布对应版本镜像与 Release；不需要配置仓库密钥。

从源码本地构建：`docker build -t tsweb .`。运行时使用上方的 `docker run` 命令，将镜像名改为 `tsweb`。

开发运行：`npm ci && npm run build && npm start`，通过环境变量提供 `TS_HOST`。测试：`npm test`；实际 TS 联调：设置 `TS_HOST` 后执行 `node --test test/live.integration.js`。

网页播放 AudioWorklet 提取自 [PowerfulTS](https://github.com/Slldyd2077/PowerfulTS)，通话连接使用同一技术路线中的 [TeamSpeak 协议库](https://github.com/HoneyBBQ/teamspeak-js)。许可及来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。MIT License。
