# lifegrid — LifeGrid(남은 시간 격자) 앱 데이터

앱: Android `com.boolint.lifegrid`(iOS 패리티 예정). 설계 정본은 맥북 `~/prework/mytime/plan.md`(비공개).
앱은 아래 파일과 **같은 사본을 번들**하고(정본), 서버 파일은 하루 1회 받아 **덮어쓰기**한다.

| 파일 | 내용 | 고치는 법 |
|---|---|---|
| `events.json` | 고정 이벤트 카탈로그(일요일·설·추석·단풍철 …). 연도별 날짜 덮어쓰기 `years` | 손으로 고친다 → `node lifegrid/scripts/validate.mjs` → push. 항목은 지우지 말고 `enabled:false` |
| `lifetable.json` | 연령별 기대여명 남·여·전체 0~100세(2024년 생명표). **`provisional:true` = 임시 보간표** | `node lifegrid/scripts/gen-lifetable.mjs` (KOSIS 키 필요, 아직 임시표). 출시 전 원표 교체 |
| `lunar.json` | 설·부처님오신날·추석 1930~2050 양력 날짜(KASI 기준) — 앱 내장 변환기의 검증 표 | `node lifegrid/scripts/gen-lunar.mjs` (알려진 날짜 검증 통과 시에만 씀) |

## 앱 쪽 계약 (infographic 과 같은 규칙)
- 수신 `https://app-data.pages.dev/lifegrid/<파일>`, 하루 1회, 타임아웃 5초
- **신뢰하는 응답 = HTTP 200 + JSON 파싱 + `schemaVersion == 1` + 검증 통과.** 그 밖(실패·4xx·5xx·버전 불일치·검증 실패)은 캐시를 건드리지 않는다 → 서버는 `schemaVersion` 을 올리지 않는다(필드는 추가만)
- 그리는 순간에는 네트워크를 부르지 않는다. 반영은 다음 실행
- 새로 내려온 고정 이벤트는 **꺼진 채** "새로" 표시만 — 사용자가 켠 적 없는 색이 격자에 갑자기 생기지 않게
- 검증 규칙은 `scripts/validate.mjs` 가 정본(이벤트 40개 이하 · 기간 120일 이하 · 색 hex · 기대여명 101개 단조감소 0~110)

## 음력 — OS 내장 중국력을 쓰지 않는 이유
Android `ChineseCalendar`·iOS `Calendar(.chinese)` 는 베이징 기준이라 한국 음력과 하루(윤달이면 한 달) 어긋난다.
`gen-lunar.mjs` 가 1930~2050 에서 실측한 불일치 14건이 `lunar.json` 의 `icuMismatch` 에 있다(예: 2030년 설 KASI 2/3 vs ICU 2/2, 2012년 부처님오신날은 한 달 차이).
앱은 usingsky KoreanLunarCalendar(Java/Swift, MIT, KASI 기준, ~2050)를 내장해 직접 변환한다.

## 스크립트
`lifegrid/scripts/` — `npm install` 한 번(korean-lunar-calendar). 레포 루트에서 `node lifegrid/scripts/<파일>`.
