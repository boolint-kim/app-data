# 부산 정비 단계변동 크롤러 (maintain step)

부산 정비사업 API에서 `(aCode → step)` 스냅샷을 받아
`busanlife/maintain_step.json` + `maintain_step_ver.txt` 로 저장한다.
BusanLife(부산 재개발) 앱은 이 파일을 폴링해 **관심(★) 등록한 구역의 단계 변동**을
감지하고 로컬 알림을 띄운다. (FCM 없음, WorkManager 하루 1회 폴링)

## 산출물 (Cloudflare Pages 서빙)
- `https://app-data.pages.dev/busanlife/maintain_step.json` — `{generated,version,count,items:[{aCode,name,step}]}`
- `https://app-data.pages.dev/busanlife/maintain_step_ver.txt` — 정수 버전(단계 변동 시에만 +1)

## 설계
- 서버는 **현재 스냅샷만** 발행하고, "무엇이 바뀌었는지" 판정은 **앱이 로컬**에서 한다
  (각 사용자의 관심 구역 · 마지막으로 본 step 기준). 서버는 상태를 덜 가진다.
- 테스트 레코드(`교리테스트` 등: areaName 이 `test`/`테스트` 포함, `3333`, `-`)는 제거 —
  앱 `BusanMaintainOpenApiHelper.java`의 필터와 동일. 안 거르면 알림이 오염됨.
- `해제`/`조합해산` 은 앱이 "종료" 문구로 별도 처리(순서값 판단 금지).

## 실행 — GitHub Actions (2026-07-16 부터. NCP 크론은 폐지)
- `.github/workflows/crawl-app-data.yml` 이 **매일 03:10 KST** 서울 크롤 3종과 함께 이 크롤러를 돌리고,
  `busanlife/maintain_step.json`·`maintain_step_ver.txt` 만 골라 `git add` → 변경이 있을 때만 커밋·push 한다(커밋 메시지 `auto: app-data crawl (Actions)`).
- 수동 실행은 GitHub Actions 탭의 **Run workflow**.
- ⚠️ **NCP 크론탭에 다시 등록하지 말 것** — 마지막 NCP 자동 커밋은 2026-07-13, 그 뒤로 Actions 가 쓴다. 두 곳이 쓰면 push 경합이 난다.
- 코드 수정은 맥북에서 하고 push 하면 다음 실행부터 반영된다. 의존성 없음(순수 Node `http`/`fs`). 서비스키는 앱 APK 에 든 공개 공공데이터 키라 하드코딩.
  (이 레포는 Cloudflare Pages 가 통째로 서빙하므로 이 스크립트도 공개 URL 로 나간다 — 비밀을 넣지 말 것)

## 수동 실행 (맥북)
```
node ~/server/app-data/busanlife/crawler/crawl_maintain_step.js
```
`run.sh` 는 경로 독립적(`$(dirname "$0")/../..` 로 repo 루트 계산).
