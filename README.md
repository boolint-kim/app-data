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
