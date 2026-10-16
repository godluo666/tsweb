#!/usr/bin/env bash
set -euo pipefail

domain=''
web_password=''
server_name='TSWeb'
image='ghcr.io/godluo666/tsweb:latest'
install_dir="${TSWEB_DIR:-$PWD/tsweb}"

usage() {
  cat <<'HELP'
一键部署 TSWeb（需要已启动的 Docker 和域名指向本机）

  bash deploy.sh --domain voice.example.com

可选：
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
    --domain|--web-password|--name|--image|--dir)
      (($# >= 2)) || { echo "$1 缺少参数" >&2; exit 1; }
      case "$1" in
        --domain) domain="$2" ;;
        --web-password) web_password="$2" ;;
        --name) server_name="$2" ;;
        --image) image="$2" ;;
        --dir) install_dir="$2" ;;
      esac
      shift 2 ;;
    *) echo "未知参数：$1；用 --help 查看用法" >&2; exit 1 ;;
  esac
done

[[ -n "$domain" ]] || { usage; exit 1; }
[[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$domain" == *.* ]] || { echo '请填写域名，例如 voice.example.com，不带 https:// 和路径' >&2; exit 1; }
command -v docker >/dev/null || { echo '请先安装并启动 Docker：https://docs.docker.com/engine/install/' >&2; exit 1; }
docker compose version >/dev/null || { echo '需要 Docker Compose v2（Docker Desktop 已包含）' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Docker 尚未启动，或当前用户没有 Docker 权限' >&2; exit 1; }
mkdir -p -- "$install_dir"
cd -- "$install_dir"

if [[ -f compose.yaml || -f Caddyfile || -f .env ]]; then
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
    volumes:
      - tsweb-data:/app/data
    extra_hosts:
      - host.docker.internal:host-gateway
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - tsweb
volumes:
  tsweb-data:
  caddy-data:
  caddy-config:
COMPOSE
printf '%s {\n  reverse_proxy tsweb:8080\n}\n' "$domain" > Caddyfile
docker compose pull
docker compose up -d --wait --wait-timeout 120
printf '\nTSWeb 已启动：https://%s\n证书首次签发需要片刻，域名须指向本机且 TCP 80/443 可访问。\n' "$domain"
