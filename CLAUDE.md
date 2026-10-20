# app-data — 앱이 시작할 때 받는 데이터·설정 (Cloudflare Pages, push = 운영 배포)

> ⚠️ 이 레포는 통째로 공개 서빙된다(이 파일도 `https://app-data.pages.dev/CLAUDE.md`). 키·비밀을 적지 말 것.
> 폴더별 사용법은 `README.md`. dev 환경이 없으니 push 전에 JSON 을 검증한다.

## 레포 공통 규칙
- **push = 운영 배포**(Cloudflare Pages, dev 없음). push 전에 JSON 문법·값을 검증한다 — 검증 스크립트가 있는 폴더는 그것부터(`infographic/scripts/build.js --check`, `mysalary/scripts/convert.js`, `universe/scripts/validate-bands.mjs`)
- **GitHub Actions**(`.github/workflows/crawl-app-data.yml`, 매일 03:10 KST)가 `seoullife/public`·`busanlife/maintain_step*` 만 `git add` 한다. 다른 경로는 사람이 고친다. NCP 크론은 2026-07-16 폐지 — 되살리지 말 것
- 원격에 Actions 커밋이 먼저 들어와 push 가 거부되면 `git pull --rebase origin main` 뒤 다시 push(파일이 겹치지 않아 충돌 없음)
- 앱이 읽는 파일·폴더는 **지우지 않는다**(404 면 앱이 실패로 보고 캐시를 유지하거나 번들값으로 간다 — 레거시 폴더도 그대로 둔다). 끄는 스위치가 있는 파일은 스위치로 끈다
- 폴더 인덱스(읽는 앱·고치는 법·상태)는 `README.md`

## 진행 중인 작업
- **`infographic/`** — 부동산 앱들의 인포그래픽 메뉴 노출 스위치 + 앱별 카드 구성. 정본 `hub.json` → `scripts/build.js` → 생성물 `<앱>/infographic.json` 11개(2026-10-19 설계 확정, **push 전·앱 코드 전**).
  ★ **시작 전에 `infographic/CLAUDE.md` 를 먼저 읽을 것** — 결정 사항·스키마·앱 쪽 계약과 "다음 세션 시작점"이 거기 있다. 생성물은 직접 고치지 말 것
