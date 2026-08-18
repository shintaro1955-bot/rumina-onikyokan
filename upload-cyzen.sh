#!/bin/bash
# cyzenの書き出し3点セットを本番の鬼教官へ投入する。
#   使い方:  ./upload-cyzen.sh
# owner のユーザー名／パスワードは実行時に聞く（履歴に残さないため引数では渡さない）。
set -u

BASE="${ONIKYOKAN_BASE:-https://rumina-onikyokan-production.up.railway.app}"
DIR="$(cd "$(dirname "$0")" && pwd)/cyzen-data"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

[ -d "$DIR" ] || { echo "✗ $DIR が見つかりません"; exit 1; }

printf 'owner ユーザー名: '; read -r USER
printf 'owner パスワード: '; read -rs PASS; echo

code=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' \
  --data-binary "$(printf '{"username":%s,"password":%s}' \
    "$(printf '%s' "$USER" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$PASS" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")")
unset PASS
[ "$code" = "200" ] || { echo "✗ ログインに失敗しました (HTTP $code)"; exit 1; }
echo "✓ ログイン成功"

put() {  # put <kind> <ファイル> <表示名>
  local kind="$1" file="$2" name="$3"
  [ -f "$file" ] || { echo "  - $name: ファイルなし（スキップ）"; return; }
  local mb; mb=$(du -m "$file" | cut -f1)
  echo -n "  → $name (${mb}MB) ... "
  local c; c=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST \
    "$BASE/api/cyzen/upload?kind=$kind" \
    -H "X-File-Name: $(printf '%s' "$name" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))')" \
    -H 'Content-Type: text/csv' --data-binary "@$file")
  [ "$c" = "200" ] && echo "OK" || echo "失敗 (HTTP $c)"
}

echo "▼ 担当者マスタ"
put user "$DIR/user-master.csv" "user-master.csv"

echo "▼ 報告書"
for f in "$DIR"/report/*.csv; do [ -f "$f" ] && put report "$f" "$(basename "$f")"; done

echo "▼ 行動履歴（大きいので時間がかかります）"
put history "$DIR/action-history.csv" "action-history.csv"

echo "▼ 取り込み結果"
curl -s "$BASE/api/health" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  cyzenReady =",d.get("cyzenReady"))'
