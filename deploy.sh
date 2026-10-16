#!/usr/bin/env bash
set -euo pipefail

bind_address='127.0.0.1'
web_port='8080'
web_password=''
server_name='TSWeb'
image='ghcr.io/godluo666/tsweb:latest'
install_dir="${TSWEB_DIR:-$PWD/tsweb}"

usage() {
  cat <<'HELP'
一键部署 TSWeb（需要已启动的 Docker，HTTPS 由自己的反向代理提供）

  bash deploy.sh

可选：
  --port 8080             HTTP 端口
  --bind 127.0.0.1        监听地址；其他机器或容器访问时使用 0.0.0.0
  --web-password '密码'   网页访问密码
  --name '我的语音网页'   网页名称
  --image 镜像地址        默认 ghcr.io/godluo666/tsweb:latest
  --dir 安装目录          默认当前目录下的 tsweb

更新或重新启动：在安装目录执行 docker compose pull && docker compose up -d
HELP
}

while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --port|--bind|--web-password|--name|--image|--dir)
      (($# >= 2)) || { echo "$1 缺少参数" >&2; exit 1; }
      case "$1" in
        --port) web_port="$2" ;;
        --bind) bind_address="$2" ;;
        --web-password) web_password="$2" ;;
        --name) server_name="$2" ;;
        --image) image="$2" ;;
        --dir) install_dir="$2" ;;
      esac
      shift 2 ;;
    *) echo "未知参数：$1；用 --help 查看用法" >&2; exit 1 ;;
  esac
done

[[ "$web_port" =~ ^[0-9]{1,5}$ ]] && ((10#$web_port >= 1 && 10#$web_port <= 65535)) || { echo '端口必须是 1–65535 之间的整数' >&2; exit 1; }
command -v docker >/dev/null || { echo '请先安装并启动 Docker：https://docs.docker.com/engine/install/' >&2; exit 1; }
docker compose version >/dev/null || { echo '需要 Docker Compose v2（Docker Desktop 已包含）' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Docker 尚未启动，或当前用户没有 Docker 权限' >&2; exit 1; }
mkdir -p -- "$install_dir"
cd -- "$install_dir"

if [[ -f compose.yaml || -f .env ]]; then
  echo "安装目录已有部署文件。更新请执行：cd '$install_dir' && docker compose pull && docker compose up -d" >&2
  echo '新建另一套部署请用 --dir 指定空目录。' >&2
  exit 1
fi

# Compose single-quoted values preserve spaces, dollar signs and passwords.
env_value() {
  local name="$1" value="$2"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || { echo "$name 不能包含换行" >&2; exit 1; }
  value="${value//\'/\\\'}"
  printf "%s='%s'\n" "$name" "$value"
}
umask 077
{
  env_value TSWEB_IMAGE "$image"
  env_value WEB_PASSWORD "$web_password"
  env_value SERVER_NAME "$server_name"
  env_value BIND_ADDRESS "$bind_address"
  env_value WEB_PORT "$web_port"
} > .env

cat > compose.yaml <<'COMPOSE'
services:
  tsweb:
    image: ${TSWEB_IMAGE}
    restart: unless-stopped
    environment:
      WEB_PASSWORD: ${WEB_PASSWORD}
      SERVER_NAME: ${SERVER_NAME}
      TS_SECURITY_LEVEL: ${TS_SECURITY_LEVEL:-8}
    ports:
      - "${BIND_ADDRESS}:${WEB_PORT}:8080"
    volumes:
      - tsweb-data:/app/data
    extra_hosts:
      - host.docker.internal:host-gateway
volumes:
  tsweb-data:
COMPOSE
docker compose pull
docker compose up -d --wait --wait-timeout 120
printf '\nTSWeb 已启动，HTTP 监听：%s:%s\n请用自己的 HTTPS 反向代理转发至此端口，并开启 WebSocket 支持。\n' "$bind_address" "$web_port"
docker compose logs --no-log-prefix tsweb | sed -n '/^管理密码：/p'
printf '点击网页右上角的齿轮，可修改网页名称、访问密码和 TS 身份安全等级。\n'
