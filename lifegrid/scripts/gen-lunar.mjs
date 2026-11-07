#!/usr/bin/env node
// LifeGrid 음력 명절 검증 표 — 설날(음 1/1)·부처님오신날(음 4/8)·추석(음 8/15) 1930~2050
// 출처: usingsky/korean-lunar-calendar (KASI 한국천문연구원 기준, MIT). 앱은 같은 저자의 Java 판을 내장해 직접 변환하고,
// 이 표는 그 Java 판의 단위테스트 기준값이자 2051년 이후 보정 자리다.
// 사용법(레포 루트): node lifegrid/scripts/gen-lunar.mjs   → lifegrid/lunar.json (검증 통과 시에만 씀)
import KoreanLunarCalendar from 'korean-lunar-calendar';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'lunar.json');
const FROM = 1930, TO = 2050;
const cal = new KoreanLunarCalendar();
const pad = n => String(n).padStart(2, '0');
function solar(y, m, d) {
  if (!cal.setLunarDate(y, m, d, false)) return null;
  const s = cal.getSolarCalendar();
  return `${s.year}-${pad(s.month)}-${pad(s.day)}`;
}
const years = {};
for (let y = FROM; y <= TO; y++) years[y] = { seol: solar(y, 1, 1), buddha: solar(y, 4, 8), chuseok: solar(y, 8, 15) };

// 알려진 날짜로 검증 (관공서 공휴일 공고 기준)
const KNOWN = {
  2024: { seol: '2024-02-10', chuseok: '2024-09-17', buddha: '2024-05-15' },
  2025: { seol: '2025-01-29', chuseok: '2025-10-06', buddha: '2025-05-05' },
  2026: { seol: '2026-02-17', chuseok: '2026-09-25', buddha: '2026-05-24' },
  2027: { seol: '2027-02-07', chuseok: '2027-09-15', buddha: '2027-05-13' },
  2030: { seol: '2030-02-03', chuseok: '2030-09-12' },
};
let bad = 0;
for (const [y, k] of Object.entries(KNOWN)) for (const [key, v] of Object.entries(k)) if (years[y][key] !== v) { bad++; console.error(`MISMATCH ${y} ${key}: got ${years[y][key]} expected ${v}`); }
for (let y = FROM; y <= TO; y++) for (const k of ['seol', 'buddha', 'chuseok']) if (!/^\d{4}-\d{2}-\d{2}$/.test(years[y][k] || '')) { bad++; console.error(`MISSING ${y} ${k}`); }

// OS 내장 중국력(ICU)과 비교 — 앱이 ICU 를 쓰면 안 되는 근거를 기록한다
const fmt = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' });
function icu(y, lm, ld, m0, d0, span) {
  for (let i = 0; i < span; i++) {
    const d = new Date(Date.UTC(y, m0, d0 + i, 3)); // 정오 KST
    let m = null, dd = null, leap = false;
    for (const x of fmt.formatToParts(d)) { if (x.type === 'month') { const mm = /^(\d+)(.*)$/.exec(x.value); if (mm) { m = +mm[1]; leap = !!mm[2]; } } else if (x.type === 'day') dd = +x.value; }
    if (m === lm && dd === ld && !leap) return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}
const icuMismatch = [];
for (let y = FROM; y <= TO; y++) {
  const i = { seol: icu(y, 1, 1, 0, 20, 35), buddha: icu(y, 4, 8, 3, 25, 45), chuseok: icu(y, 8, 15, 8, 5, 40) };
  for (const k of ['seol', 'buddha', 'chuseok']) if (i[k] !== years[y][k]) icuMismatch.push(`${y} ${k}: KASI ${years[y][k]} / ICU ${i[k]}`);
}
if (bad) { console.error(`검증 실패 ${bad}건 — lunar.json 을 쓰지 않는다`); process.exit(1); }
const json = {
  schemaVersion: 1,
  _comment: 'LifeGrid 음력 명절 검증 표(KASI 기준). 앱은 내장 KoreanLunarCalendar(Java/Swift)로 직접 변환하며 이 표는 그 단위테스트 기준값이다. 2051년 이후 값이 생기면 여기에 더한다(앱은 2051+ 를 OS 중국력으로 계산하고 ±1일 표기). schemaVersion 은 올리지 않는다.',
  source: 'usingsky/korean-lunar-calendar 0.4.0 (MIT, KASI 기준)',
  generated: new Date().toISOString().slice(0, 10),
  range: [FROM, TO],
  icuMismatch,
  years,
};
fs.writeFileSync(out, JSON.stringify(json, null, 1) + '\n');
console.log(`lunar.json 생성: ${TO - FROM + 1}년, ICU 불일치 ${icuMismatch.length}건`);
icuMismatch.forEach(s => console.log('  ' + s));
