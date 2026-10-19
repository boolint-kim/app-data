# app-data — 앱이 시작할 때 받는 데이터·설정 (Cloudflare Pages, push = 운영 배포)

> ⚠️ 이 레포는 통째로 공개 서빙된다(이 파일도 `https://app-data.pages.dev/CLAUDE.md`). 키·비밀을 적지 말 것.
> 폴더별 사용법은 `README.md`. dev 환경이 없으니 push 전에 JSON 을 검증한다.

## 진행 중인 작업
- **`infographic/`** — 부동산 앱들의 인포그래픽 메뉴 노출 스위치 + 앱별 카드 구성. 정본 `hub.json` → `scripts/build.js` → 생성물 `<앱>/infographic.json` 11개(2026-10-19 설계 확정, **push 전·앱 코드 전**).
  ★ **시작 전에 `infographic/CLAUDE.md` 를 먼저 읽을 것** — 결정 사항·스키마·앱 쪽 계약과 "다음 세션 시작점"이 거기 있다. 생성물은 직접 고치지 말 것
