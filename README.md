# app-data
앱이 시작할 때 받는 데이터·설정. Cloudflare Pages 가 레포를 **통째로** 서빙한다(`https://app-data.pages.dev/<경로>`) — **push 가 곧 운영 배포**, dev 환경 없음.
GitHub Actions(매일 03:10 KST)가 크롤 결과(`seoullife/public`, `busanlife/maintain_step*`)만 자동 커밋한다. 그 밖은 사람이 고친다.

## 폴더 인덱스 (2026-10-20 실물 대조)
| 폴더 | 읽는 쪽 | 고치는 법 | 상태 |
|---|---|---|---|
| `seoullife/public` | SeoulLife Android·iOS | **Actions 자동**(`seoullife/crawler/*.js`). 손으로 고치지 말 것 | 운영 |
| `busanlife` | BusanLife Android·iOS | `maintain_lookup.json` 은 사람(아래) · `maintain_step*` 는 Actions 자동(`busanlife/crawler/README.md`) | 운영 |
| `junsewolse` | JunseWolse Android·iOS | `rates.json`·`links.json` 사람(아래) | 운영 |
| `mysalary` | MySalary Android·iOS | `rates.json` 생성 스크립트(아래) | 운영 |
| `universe` | UniverseX Android·iOS + universe-api 워커 | `universe/README.md` | 운영 (레포 파일 수의 대부분) |
| `infographic` + `<앱>/infographic.json` 11개 | 부동산 앱 11개(Android·iOS) | `infographic/hub.json` → `build.js`(아래) | 운영 |
| `jpdramaeng` | JpDramaEng Android | `jpdramaeng.json` + `_ver.txt` +1 | 운영 |
| `thatsong` | ThatSong Android | `songs.json` + `_ver.txt` +1 | **레거시** — 앱 출시정지(사용자 자발 철수). 구버전 설치자가 읽을 수 있어 삭제 금지 |
| `parkinglot` | (현재 앱 코드 참조 없음 — ParkingLot 은 parking-collector·ev-charger JSON 으로 이전) | 고치지 말 것 | **레거시** — 구버전 설치자용. 삭제 금지 |

⚠️ 레포 전체가 공개 URL 로 나간다(`README.md`·`.github/`·크롤러 소스 포함). 키·비밀을 넣지 말 것.

## busanlife
busanlife/maintain_lookup.json 수정
busanlife/maintain_lookup_ver.txt 숫자 +1
자동 배포 → 앱 재실행 시 반영

## mysalary
mysalary/rates.json — 4대보험 요율 + 근로소득 간이세액표 (MySalary 앱)
매년 개정 시: mysalary/source/ 엑셀 교체 + mysalary/scripts/convert.js 상수 갱신
→ `node mysalary/scripts/convert.js` (검증 통과 시에만 생성) → 자동 배포

## junsewolse
junsewolse/rates.json — 전월세 전환율 법정 비율 (전월세 임대계산기 Android·iOS)
금통위에서 기준금리가 바뀌면 `baseRate` + `asOf`(결정일) 를 함께 수정 → push → 앱 다음 실행부터 반영
범위 밖 값·schemaVersion 불일치는 앱이 버리고 번들값을 쓴다 (dev 환경 없음 — push 전 확인)

junsewolse/links.json — 외부 링크(표준계약서·인터넷등기소·임대차 신고·법령 조문) + 주택임대차 신고 기준 (2026-10-06~, 앱 1.2.3 / iOS 1.4 부터 읽음)
정부 사이트 주소가 바뀌면 해당 url 만 수정 → push. https + *.go.kr 만 허용(아니면 앱이 그 항목을 버린다)
신고 기준(depositOver 6000 · rentOver 30, 만원 '초과')은 부동산거래신고법 시행령 제4조의3 이 바뀔 때만

## infographic
infographic/hub.json — 부동산 앱 인포그래픽 메뉴 노출 스위치 + 앱별 카드 구성(정본, 2026-10-19~). 앱은 이 파일이 아니라 생성물 `<앱>/infographic.json`(11개)을 받는다
고치면 `node infographic/scripts/build.js`(검증 + 생성) → push 전 `--check` → push. **생성물은 직접 고치지 말 것**(다음 빌드에 덮인다)
전체 철수 `enabled: false`, 한 앱만 `apps.<앱>.enabled: false`. ⛔ 앱 키·생성 파일 삭제 금지(404 면 앱이 직전 캐시를 유지해 메뉴가 남는다). 규칙·앱 쪽 계약은 infographic/CLAUDE.md
