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

## 로컬 개발 → NCP 실행
- **코드 수정은 맥북에서** 하고 `git push`. **NCP 는 크론탭에서 pull/실행만** 담당.
- 의존성 없음(순수 Node `http`/`fs`). 서비스키는 앱 APK에 든 공개 공공데이터 키라 하드코딩.

## NCP 크론탭 등록 (예: 매일 04:00)
```
0 4 * * * /bin/sh ~/server/app-data/busanlife/crawler/run.sh >> /tmp/busan_maintain_step.log 2>&1
```
`run.sh` 는 `git pull → 크롤 → (변동 시에만) git add busanlife/… → commit → push` 를 수행한다.
단계 변동이 없으면 아무것도 커밋하지 않는다.

## 수동 실행
```
node ~/server/app-data/busanlife/crawler/crawl_maintain_step.js
```
