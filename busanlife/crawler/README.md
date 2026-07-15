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
- **경로 주의**: 맥북 = `~/server/app-data`, **NCP(root) = `/home/app-data`** (seoullife 크론과 동일 위치).

## NCP 크론탭 등록 — 기존 seoullife 크론과 같은 인라인 방식 (권장, 매일 03:40)
```
40 3 * * * cd /home/app-data/busanlife && git pull && cd crawler && node crawl_maintain_step.js >> /var/log/busan_maintain_step.log 2>&1 && cd /home/app-data && git add busanlife/maintain_step.json busanlife/maintain_step_ver.txt && git commit -m "maintain step auto update" && git push
```
- 변동 없으면 크롤러가 파일을 안 써서 `git commit` 이 "nothing to commit" 으로 실패 → `&&` 체인 중단 → push 안 함(정상, seoullife 크론과 동일 동작).
- 매주(월)로 맞추려면 `40 3 * * 1` — 단, 앱은 매일 폴링하므로 서버도 매일 갱신이 알림 신선도에 유리.

### 대안: 래퍼 스크립트 (변동 없을 때 로그가 더 깔끔)
```
40 3 * * * /bin/sh /home/app-data/busanlife/crawler/run.sh >> /var/log/busan_maintain_step.log 2>&1
```
`run.sh` 는 경로 독립적(`$(dirname "$0")/../..` 로 repo 루트 계산)이라 NCP/맥북 어디서 실행해도 됨.

## 수동 실행
```
node /home/app-data/busanlife/crawler/crawl_maintain_step.js    # NCP
node ~/server/app-data/busanlife/crawler/crawl_maintain_step.js # 맥북
```
