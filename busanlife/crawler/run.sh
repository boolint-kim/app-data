#!/bin/sh
# NCP 크론탭용 래퍼: git pull → 크롤 → (변경 시에만) commit + push
# 크롤러가 산출한 maintain_step.json 을 GitHub 에 올려 Cloudflare Pages 가 배포하게 한다.
# app-data 는 모노레포이므로 busanlife/ 경로만 add 한다.
set -e
cd "$(dirname "$0")/../.."   # → app-data/ 루트

git pull -q --ff-only || true
node busanlife/crawler/crawl_maintain_step.js || exit 0   # 오류/변동없음이면 조용히 종료

git add busanlife/maintain_step.json busanlife/maintain_step_ver.txt
git diff --cached --quiet && exit 0                       # 스테이징 변경 없으면 종료
git commit -q -m "maintain step auto update"
git push -q
