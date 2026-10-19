# infographic — 부동산 앱의 인포그래픽 메뉴 (노출 스위치 + 앱별 카드 구성)

> 2026-10-19 trade-infographic 세션에서 결정하고 이 폴더를 만들었다. 같은 날 설계 확정 — **정본 `hub.json` 하나 + 생성물 `<앱>/infographic.json`**(C 방식, 사용자 결정).
> `hub.json`·`scripts/build.js`·생성물 11개 **push 완료(2026-10-19, 라이브 200 확인)**. Android 라이브러리 `~/AndroidStudioProjects/InfographicHub` 생성(같은 날, mavenLocal 배포됨). **게이트를 읽는 출시 앱은 아직 0개.**

## ★ 다음 세션 시작점
세션은 **레포 루트(`~/server/app-data`)에서** 연다.
1. ~~push~~ 완료(2026-10-19 `93586f9`). 앱 쪽은 **라이브러리로 결정**(사용자, 같은 날) → Android `~/AndroidStudioProjects/InfographicHub`(`com.boolint:infographic-hub:1.0.0-SNAPSHOT`, mavenLocal) 완성. 사용법은 그 레포 README, 함정은 CLAUDE.md
2. ~~AptTradeChart 에 붙이기~~ **완료**(2026-10-19 코드 + 에뮬 확인: 첫 실행 응답 즉시 메뉴 생성 → 허브 6장 → 웹·공유 정상, 크래시 0). 남은 것: **7.1(71) 출시**(버전 올리기·릴리즈 노트는 사용자)
3. ~~형제 OfficeTradeChart·AptRentChart~~ **완료**(2026-10-19 로컬 커밋 + 에뮬 확인: 게이트 즉시 반영·허브 4장/6장·웹·공유 정상, 크래시 0). 나머지 Android 8개(세금 5 · 재개발 2 · 전월세) — AptTradeChart 의 `App.java`·`MainActivity` 를 본보기로. SelfBanner 를 안 쓰는 앱은 AptRentChart 처럼 웹 화면 광고 null + 테마 오버라이드 불필요. 대상 앱 표의 "적용 버전" 열을 채운다
4. **iOS 라이브러리** `~/XcodeProjects/InfographicHub`(SelfBanner iOS 로컬 pod 방식) — 같은 계약, 첫 실행 즉시 표시는 iOS 필수
5. 카드 구성(문구·순서·앱별 조합)은 **출발점**이다 — 사용자가 `hub.json` 에서 조정

## 구조
```
infographic/hub.json              정본 — 사람이 고치는 유일한 파일
infographic/scripts/build.js      검증 + 생성. 외부 패키지 없음
<앱>/infographic.json             생성물 11개 — 앱이 읽는 파일. 직접 고치지 말 것
```
```bash
node infographic/scripts/build.js                  # 검증 + 생성(바뀐 파일만 쓴다)
node infographic/scripts/build.js --check          # push 전 — 생성물이 정본과 같은지(쓰지 않음, 어긋나면 종료코드 1)
node infographic/scripts/build.js --preview seoullife
```
- 앱이 받는 주소: `https://app-data.pages.dev/<앱>/infographic.json` — remote-config 스킬의 경로 관례(`<appid>/<파일>.json`) 그대로
- **왜 정본 하나인가**: 전체 철수가 push 한 번, 카드 문구가 한 곳. **왜 생성물을 나누나**: 앱은 자기 폴더만 읽고 앱 키 판정이 필요 없다. SelfBanner 의 `v2.json → tools/build.py → banners.json` 과 같은 구조
- GitHub Actions(03:10 KST)는 `seoullife/public`·`busanlife/maintain_step*` 만 `git add` 한다 — 이 폴더와 생성물은 건드리지 않는다(2026-10-19 워크플로 확인)

## 결정된 것 (2026-10-19 사용자와 합의, 같은 날 보고서로 3건 수정 — ★ 표시)
- **인포그래픽은 베타다. 언제든 노출을 포기할 수 있고, 그때 앱의 진입 메뉴도 보이지 않아야 한다**
- **세금 계산 앱·재개발 앱 등 부동산 관련 앱 전부**에 노출한다(대상은 아래 표)
- 그래서 **노출 여부와 앱별 카드 구성을 서버에서** 정한다 → 이 폴더가 주관한다
- **앱 키 = app-data 폴더명 = SelfBanner `v2.json` 의 `apps` 키**(소문자 앱명). 두 파일이 같은 앱을 다른 이름으로 부르지 않게
- **전체 철수** = `hub.json` `enabled:false` → 빌드 → push. **한 앱만 끄기** = `apps.<앱>.enabled:false`
  - ⛔ **앱 키·생성 파일을 지우지 말 것.** 파일이 404 가 되면 앱은 "수신 실패" 로 보고 **직전 캐시를 유지해 메뉴가 남는다.** `build.js` 가 키 없는 생성 파일(고아)을 잡아 실패한다
- **기본값은 숨김. 앱에는 카드 목록을 박지 않는다.** 받기 실패 → 직전 캐시, 캐시도 없으면 숨김
  - 이유: 인포그래픽은 어차피 네트워크가 있어야 보인다. 기본값 "보임"이면 철수 뒤 파일이 안 올 때 메뉴가 되살아난다
  - 선례: `junsewolse/links.json` 의 `simpleContractGuide` — 번들값 없이 키가 있을 때만 버튼이 보인다
- ★ **파싱 실패·비정상 응답 → 캐시 유지**(JunseWolse `ContractLinks` 와 같다). 숨김으로 저장하는 건 **유효 JSON 이 "숨겨라" 라고 한 경우뿐**(`enabled:false` 또는 유효 카드 0장)
  - 처음엔 "파싱 실패도 숨김 저장" 이었다. 뒤집은 이유: 파싱 실패는 "서버가 숨기라고 했다" 가 아니라 "무슨 말인지 모르겠다" 다. 깨진 push 를 낸 몇 분 사이 앱을 연 사용자는 고친 뒤에도 두 번 실행해야 메뉴가 돌아온다. "철수 뒤 잘못 고친 JSON" 걱정은 성립하지 않는다 — 철수 push 가 유효하면 캐시는 이미 숨김이고, 그 뒤 깨진 파일이 와도 캐시가 보존되면 여전히 숨김이다. 깨진 push 자체는 `--check` 가 막는다
- ★ **`schemaVersion` 은 올리지 않는다. 필드는 추가만 한다.** 앱은 불일치 → 파일 무시 → 숨김이므로, 올리는 순간 **업데이트 안 한 앱 전체가 숨는다.** 그 용도(구버전 전체 철수)로만 쓴다. `build.js` 가 1 이 아니면 거부한다
- ★ **카드 주소에 `#섹션` 금지.** 앱이 `?sgg=` 를 끝에 붙이면 `apt#yield?sgg=…` 가 되어 쿼리가 프래그먼트로 들어가고 지역 선택이 무시된다. 물건 페이지는 섹션 메뉴가 있어 카드를 섹션으로 쪼갤 이유도 없다(06 §6). `build.js` 가 거부한다
- 앱의 **기존 네이티브 허브 화면은 유지**. 카드 출처만 하드코딩 `buildItems()` → JSON 으로 바뀐다(웹에 `hub.html` 을 만들지 않는다)
- 숨기는 쪽은 다음 실행부터 적용(깜빡임 방지). **캐시가 비어 있을 때 응답이 오면 그 자리에서 보여 준다 — iOS 는 필수**(심사관은 한 번 실행한다. 스크린샷에 허브가 있는데 첫 실행에 메뉴가 없으면 불일치), Android 는 선택
- 진입 게이트가 여러 곳이면(툴바 메뉴·홈 카드·설정 링크) **전부 같은 getter 하나**를 본다

## hub.json 스키마 (schemaVersion 1)
| 키 | 값 | 비고 |
|---|---|---|
| `schemaVersion` | `1` 고정 | 올리지 않는다(위) |
| `enabled` | true/false | 전체 스위치. 생성물의 `enabled` = 이것 && 앱의 `enabled` |
| `base` | `https://chart.boolint.com/` 고정 | 생성물 url = base + path (+ sido) |
| `cards.<id>` | `{icon, title, subtitle, path}` | 카드 카탈로그. id 는 `[a-z0-9-]`. `path` 는 base 뒤 상대 경로 — `#`·`.html`·`sido=`·`sgg=`·공백 금지 |
| `apps.<앱>` | `{cards[], sido?, enabled?, _comment?}` | `cards` 는 카탈로그 id 1장 이상·중복 금지. `sido` 는 시도 코드 2자리 문자열(모든 카드 url 에 `?sido=` 로 붙는다). 모르는 키는 거부(오타 방지) |

**생성물 `<앱>/infographic.json`**: `{schemaVersion:1, _generated, enabled, cards:[{id, icon, title, subtitle, url}]}`. 앱은 `_generated`·`id` 를 무시해도 된다.

## 앱 쪽 계약 (Android·iOS 공통 — 라이브러리든 복사든 이대로)
- 수신: `https://app-data.pages.dev/<앱>/infographic.json`, 앱 시작 시 1회, 타임아웃 5초, `Cache-Control: no-cache`. CDN 은 `max-age=0, must-revalidate` 라 스위치가 다음 요청에 반영된다
- **신뢰하는 응답 = HTTP 200 + JSON 파싱 성공 + `schemaVersion == 1`.** 그 밖(네트워크 실패·4xx·5xx·파싱 실패·버전 불일치)은 **캐시를 건드리지 않는다**
  - ⚠️ 버전 불일치는 "캐시 유지" 다. 서버가 2 를 보내면 캐시(1 시절)가 남는다 → 그래서 서버는 버전을 올리지 않는다
- 신뢰한 응답은 그대로 캐시(SharedPreferences / UserDefaults). 반영은 다음 실행(`loadCached`). 캐시가 비어 있으면 받은 자리에서 반영(iOS 필수)
- **보일지 말지(getter) = 캐시 있음 && `enabled == true` && 유효 카드 1장 이상.** 유효 카드 = `url` 이 `https://chart.boolint.com/` 로 시작하고 `icon`·`title` 이 비어 있지 않은 것. 아닌 카드는 **그 카드만** 버린다(`links.json` 의 `*.go.kr` 규칙과 같은 방식)
- 사용자 관심 시군구를 알면 `url + (url.contains("?") ? "&" : "?") + "sgg=" + 코드5자리`(AptTradeChart `withSgg`). `sido` 가 있어도 `sgg` 가 덮는다(06 §3). 카드에 `#` 이 없으므로 끝에 붙여도 안전
- WebView 허용 호스트 `chart.boolint.com`, `window.IS_APP = true` 문서 시작 시점 주입, 단지 클릭 브리지 — 정본은 trade-collector `docs/infographic-redesign/06-app-hub.md` §1·§3·§4
- 파서 단위테스트(dev 환경이 없으므로): 유효 / `enabled:false` / 카드 0장 / 다른 호스트 카드 / 버전 2 / 깨진 JSON 의 6케이스

## 철수 절차
1. **웹(trade-infographic)에 종료 안내 페이지** — 게이트를 모르는 출시본(AptTradeChart·OfficeTradeChart·TransTax A+i 의 현재 버전)이 옛 주소로 계속 들어온다. 사이트를 통째로 내리지 말 것
2. `hub.json` `enabled:false` → `build.js` → `--check` → push. 다음 실행부터 전 앱 숨김
3. iOS 는 **심사 기간에 그 앱이 켜져 있어야 한다**(심사 때 숨겼다가 나중에 켜면 Guideline 2.3.1 숨겨진 기능). 끄는 방향은 문제없다

## 왜 boolint-notice 가 아니라 app-data 인가 (다시 옮기지 말 것)
remote-config 스킬의 채널 표는 "운영 스위치 = boolint-notice" 라고 한다. 이 건은 사용자 결정으로 **예외**다(스킬 표에 2026-10-19 기재).
- 앱이 보여 줄 **링크 목록**이 본체이고 스위치는 그 부속이다 — `junsewolse/links.json` 과 같은 성격
- 대상 앱 중 SeoulLife·BusanLife·JunseWolse 는 이미 app-data 를 받아 캐시하는 코드가 있다
- 철수할 사이트(trade-infographic)와 운명이 분리된다. 그 레포는 02:00 파이프라인이 `git add -A` + push 하고 dev 도 없다

## app-data 라서 지킬 것
- **dev 환경이 없다** — push = 운영. push 전 `node infographic/scripts/build.js --check`. 검증은 앱 쪽에도(위 "앱 쪽 계약")
- Cloudflare Pages 가 레포를 통째로 서빙한다 → **이 CLAUDE.md 도 push 하면 공개 URL 로 나간다.** 키·비밀은 절대 적지 말 것

## 대상 앱 (2026-10-19 실물 확인) — 카드 구성은 `hub.json` 이 정본, 여기는 현황
| 앱 키 | 앱 | Android | iOS | 허브 코드 현황 | 게이트 적용 버전(A / i) |
|---|---|---|---|---|---|
| `apttradechart` | AptTradeChart | ✓ | — | **라이브러리로 교체 완료**(2026-10-19 로컬 커밋, 미출시. 출시본 7.0 은 옛 주소 하드코딩) | A 7.1(71) 예정 / — |
| `officetradechart` | OfficeTradeChart | ✓ | — | **라이브러리로 교체 + 에뮬 확인 완료**(2026-10-19 로컬 커밋, 미출시. 출시본 3.1 은 옛 주소 하드코딩) | A 3.2(32) 예정 / — |
| `transtax` | TransTax 양도세 | ✓ | ✓ | 출시본 옛 주소 하드코딩(A+i) | 미적용 |
| `acqtax` | AcqTax 취득세 | ✓ | ✓ | 없음 | 미적용 |
| `gifttax` | GiftTax 증여세 | ✓ | ✓ | 없음 | 미적용 |
| `realestatecal` | RealEstateCal 중개보수 | ✓ | ✓ | 없음 | 미적용 |
| `propertytax` | PropertyTax 공시가격 | ✓ | ✓ | 없음 | 미적용 |
| `junsewolse` | JunseWolse 전월세 | ✓ | ✓ | 없음. app-data 수신 본보기 `helper/ContractLinks.java` / iOS `Core/ContractLinks.swift` | 미적용 |
| `seoullife` | SeoulLife 서울 재개발 | ✓ | ✓ | 없음. `sido=11` | 미적용 |
| `busanlife` | BusanLife 부산 재개발 | ✓ | ✓ | 없음. `sido=26` | 미적용 |
| `aptrentchart` | AptRentChart | ✓ | — | **라이브러리 신규 설치 + 에뮬 확인 완료**(2026-10-19 로컬 커밋, 미출시. 웹 화면 광고 없음 — SelfBanner 미사용 앱) | A 2.5(25) 예정 / — |

- "적용 버전" = 그 버전부터 JSON 게이트를 읽는다. **그 미만 버전은 철수해도 메뉴가 남는다** — 철수 절차 1번의 근거
- SelfBanner `v2.json` `apps` 에 11개 키 전부 있음(2026-10-19 확인)

## 관련 문서 (정본 분담)
| 무엇 | 어디 |
|---|---|
| 페이지·섹션·`?sido=&sgg=`·IS_APP·브리지 계약 | trade-infographic `CLAUDE.md`, trade-collector `docs/infographic-redesign/06-app-hub.md` §1~§4 |
| 어느 앱에 무엇을·노출 스위치 | **이 폴더** (`hub.json`) |
| 앱 설치 절차 | 06 §7 — 카드는 하드코딩 대신 이 폴더의 생성물을 받는다(2026-10-19 반영) |
| 채널 예외 | `~/.claude/skills/remote-config/SKILL.md` "어디에 둘까" (2026-10-19 기재) |
| 각 앱 CLAUDE.md | 허브를 넣을 때 "인포그래픽 메뉴 → app-data/infographic" 한 줄 (앱 작업 때) |
