# app-data
app init data

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
