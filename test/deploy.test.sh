#!/usr/bin/env bash
set -euo pipefail
real_docker="$(command -v docker)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir "$fixture/bin"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case "$*" in
  info|'compose version'|'compose pull'|'compose up -d --wait --wait-timeout 120') exit 0 ;;
  *) echo "Unexpected Docker command: $*" >&2; exit 1 ;;
esac
MOCK
chmod +x "$fixture/bin/docker"
TSWEB_DIR="$fixture/default" PATH="$fixture/bin:$PATH" bash deploy.sh
"$real_docker" compose --project-directory "$fixture/default" config --format json > "$fixture/default.json"
PATH="$fixture/bin:$PATH" bash deploy.sh --bind 0.0.0.0 --port 18080 --web-password "中文 pa'ss\$word\\tail" --name '朋友的语音网页' --dir "$fixture/site"
"$real_docker" compose --project-directory "$fixture/site" config --format json > "$fixture/config.json"
node test/deploy-config.assert.mjs "$fixture/default.json" "$fixture/config.json"
