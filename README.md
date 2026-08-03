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
