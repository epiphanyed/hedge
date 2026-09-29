#!/usr/bin/env bash
# 设计意图 A+M 集成抽检提示（非自动化；打印跑表顺序）
set -euo pipefail
cat <<'EOF'
Menmen 设计意图 — 集成 / 真机抽检（自动化已通过后可选）

【翻页 v26】验收清单 A+M 重点：#05 多人 OT、#08 连滑 30 张内存、#28 帧率、#52 全链路
  可选：HEDGE_READER_E2E_URL='https://…/a_…' cd plato && npx vitest run readerFlip.live.e2e

【HedgeDoc MySQL】TC-01~13 集成环境跑表（契约见 hedgedocAcceptanceMatrix.contract）
  建议优先：TC-04 Ticket、TC-07 冻结、TC-10 软删、TC-13 内部下载

【Menmen-Issue】HTTP 冒烟（blog:9999 已启动）：
  export ISSUE_SMOKE_USER=… ISSUE_SMOKE_PASSWORD=…
  bash aristotle/scripts/issue_verify_all.sh

【运维】PG 存量 HedgeDoc 笔记库：
  aristotle/docker-compose/mysql/init/README.md

日常自动化：bash scripts/verify-all-design-intent.sh
扩展域（论文+Agent）：bash scripts/verify-extended-design-intent.sh
EOF
