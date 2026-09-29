#!/usr/bin/env bash
# 对齐 hedge/doc 下 HedgeDoc 权限 + 移动端翻页 v26 设计 — 本地自动化回归
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo "==> menmen design intent verify (root: $ROOT)"

echo "==> hedge menmen unit tests"
cd "$ROOT/hedge"
NODE_ENV=test CMD_DB_URL="sqlite::memory:" npx mocha --exit test/menmen/*.test.js

echo "==> plato vitest (full)"
cd "$ROOT/plato"
npm run test

echo "==> plato reader-flip e2e (skip if SKIP_PLAYWRIGHT=1 or no chromium)"
npm run test:reader-flip-e2e

echo "==> blog deep-read unit test"
cd "$ROOT/aristotle/blog"
mvn -q test -Dtest=ArticleViewServiceImplDeepReadTest

echo "OK: automated design-intent checks passed."
echo "Manual (flip A+M 抽检): #05 多人 OT、#28 帧率、#52 全链路 — hedge/doc/验收清单_移动端翻页效果与分页渲染.md"
echo "Manual (HD §8 TC): TC-01~13 集成跑表 — hedge/doc/设计意图闭合说明_HedgeDocMySQL登录与权限.md"
echo "CI: .github/workflows/design-intent-verify.yml (optional secret HEDGE_READER_E2E_URL)"
echo "A+M spotcheck: bash hedge/scripts/integration-spotcheck.sh"
echo "Ops (if PG legacy): aristotle/docker-compose/mysql/init/README.md"
