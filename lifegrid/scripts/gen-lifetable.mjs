#!/usr/bin/env node
// LifeGrid 생명표 — 연령별 기대여명(남 M · 여 F · 전체 A, 0~100세) → lifegrid/lifetable.json
// 출처: 국가데이터처 생명표, KOSIS 완전생명표(1세별) orgId=101 tblId=DT_1B42 (항목 '기대여명(전체|남자|여자)', 분류 C1 = 연령)
// 사용법(레포 루트):
//   node lifegrid/scripts/gen-lifetable.mjs                 KOSIS 원표에서 최신 연도 생성(provisional:false). 키는 KOSIS_API_KEY 환경변수 또는 ~/.config/kosis.env
//   node lifegrid/scripts/gen-lifetable.mjs --year 2024     특정 연도
//   node lifegrid/scripts/gen-lifetable.mjs --provisional   10세 간격 공표값을 선형 보간한 임시표(키 없을 때)
// 검증 통과 시에만 파일을 쓴다. 매년 12월 새 생명표가 공표되면 다시 돌리고 validate.mjs → push
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'lifetable.json');
const args = process.argv.slice(2);
const argYear = args.includes('--year') ? args[args.indexOf('--year') + 1] : null;

// 공표값(정책브리핑 2024년 생명표 + 2차 정리) — 임시표 전용
const ANCHORS = {
  M: [[0, 80.8], [10, 71.1], [20, 61.2], [30, 51.5], [40, 41.9], [50, 32.5], [60, 23.7], [70, 15.5], [80, 8.5], [90, 4.0], [100, 2.2]],
  F: [[0, 86.6], [10, 76.8], [20, 66.9], [30, 57.1], [40, 47.4], [50, 37.8], [60, 28.4], [70, 19.2], [80, 10.9], [90, 5.1], [100, 2.6]],
};
function interp(anchors, age) {
  if (age <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) if (age <= anchors[i][0]) { const [a0, v0] = anchors[i - 1], [a1, v1] = anchors[i]; return v0 + (v1 - v0) * (age - a0) / (a1 - a0); }
  return anchors[anchors.length - 1][1];
}
function check(M, F, A) {
  for (const [k, a] of Object.entries({ M, F, A })) {
    if (a.length !== 101) throw new Error(`${k}: 101개 아님(${a.length})`);
    for (let i = 0; i < 101; i++) { if (!(a[i] > 0 && a[i] < 110)) throw new Error(`${k}[${i}] 범위 ${a[i]}`); if (i && a[i] > a[i - 1] + 1e-9) throw new Error(`${k}[${i}] 단조감소 아님`); }
  }
  if (Math.abs(A[0] - (M[0] + F[0]) / 2) > 1.5) throw new Error('전체 기대수명이 남녀 평균과 너무 다르다');
}
function write(M, F, A, provisional, source, asOf) {
  check(M, F, A);
  const json = {
    schemaVersion: 1,
    _comment: 'LifeGrid 연령별 기대여명(년). 앱은 현재 나이(소수)로 선형 보간해 끝 날짜를 정한다 — "기대수명−나이" 근사 금지. provisional:true 면 10세 간격 공표값을 보간한 임시표. 앱 계약: schemaVersion==1 && 배열 101개 && 단조감소 && 0<값<110 이면 캐시, 아니면 캐시 유지. schemaVersion 은 올리지 않는다.',
    source, asOf: String(asOf), provisional,
    ages: Array.from({ length: 101 }, (_, i) => i),
    M: M.map(v => +v.toFixed(2)), F: F.map(v => +v.toFixed(2)), A: A.map(v => +v.toFixed(2)),
  };
  fs.writeFileSync(out, JSON.stringify(json, null, 1) + '\n');
  console.log(`lifetable.json 생성 (provisional=${provisional}, asOf=${asOf}) — 0세 남 ${M[0]} 여 ${F[0]} 전체 ${A[0]}`);
}

if (args.includes('--provisional')) {
  const M = [], F = [], A = [];
  for (let a = 0; a <= 100; a++) { const m = interp(ANCHORS.M, a), f = interp(ANCHORS.F, a); M.push(m); F.push(f); A.push((m + f) / 2); }
  write(M, F, A, true, '국가데이터처 2024년 생명표 공표값(10세 간격) 선형 보간 — 임시. 전체(A)는 남녀 평균', 2024);
  process.exit(0);
}

// 키: 환경변수 → ~/.config/kosis.env (공개 레포라 키 파일은 레포 밖에 둔다)
let key = process.env.KOSIS_API_KEY || '';
if (!key) {
  const f = path.join(os.homedir(), '.config', 'kosis.env');
  if (fs.existsSync(f)) key = (fs.readFileSync(f, 'utf8').match(/^KOSIS_API_KEY=(.+)$/m) || [])[1]?.trim() || '';
}
if (!key) { console.error('KOSIS_API_KEY 가 없다(환경변수 또는 ~/.config/kosis.env). 임시표는 --provisional'); process.exit(1); }

const base = 'https://kosis.kr/openapi/Param/statisticsParameterData.do';
const period = argYear ? `startPrdDe=${argYear}&endPrdDe=${argYear}` : 'newEstPrdCnt=1';
const url = `${base}?method=getList&apiKey=${encodeURIComponent(key)}&format=json&jsonVD=Y&orgId=101&tblId=DT_1B42&prdSe=Y&${period}&itmId=ALL&objL1=ALL`;
const rows = await (await fetch(url)).json();
if (!Array.isArray(rows)) { console.error('KOSIS 응답 오류:', rows); process.exit(1); }
const cols = { A: [], M: [], F: [] };
const NAME = { '기대여명(전체)': 'A', '기대여명(남자)': 'M', '기대여명(여자)': 'F' };
let asOf = null, lastChange = null;
for (const r of rows) {
  const k = NAME[r.ITM_NM]; if (!k) continue;
  const age = parseInt(r.C1_NM, 10);                                   // '0세' … '100세이상'
  if (!Number.isInteger(age) || age < 0 || age > 100) throw new Error('연령 파싱 실패: ' + r.C1_NM);
  cols[k][age] = parseFloat(r.DT);
  asOf = r.PRD_DE; lastChange = r.LST_CHN_DE;
}
write(cols.M, cols.F, cols.A, false, `국가데이터처 ${asOf}년 생명표 — KOSIS 완전생명표(1세별) DT_1B42, 항목 기대여명(전체·남자·여자), 최종 갱신 ${lastChange}`, asOf);
