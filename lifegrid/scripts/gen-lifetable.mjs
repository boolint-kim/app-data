#!/usr/bin/env node
// LifeGrid 생명표 — 연령별 기대여명(남 M · 여 F · 전체 A, 0~100세) → lifegrid/lifetable.json
// 출처: 국가데이터처 2024년 생명표(2025-12-03 공표), KOSIS 완전생명표 orgId=101 tblId=DT_1B42
// 사용법(레포 루트):
//   node lifegrid/scripts/gen-lifetable.mjs --provisional     10세 간격 공표값을 선형 보간한 임시표(provisional:true). 출시 전 교체 대상
//   KOSIS_API_KEY=... node lifegrid/scripts/gen-lifetable.mjs --meta     KOSIS 항목·분류 ID 를 출력(아래 ITM/OBJ 상수를 채우는 용도)
//   KOSIS_API_KEY=... node lifegrid/scripts/gen-lifetable.mjs            KOSIS 원표에서 생성(provisional:false). ITM/OBJ 상수가 비어 있으면 중단
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'lifetable.json');
const YEAR = 2024;
// 공표값(정책브리핑 2024년 생명표 + 2차 정리). 0·40·60·80세는 보도자료 직접 확인, 그 외는 2차 출처 — 원표 대조 전엔 임시값
const ANCHORS = {
  M: [[0, 80.8], [10, 71.1], [20, 61.2], [30, 51.5], [40, 41.9], [50, 32.5], [60, 23.7], [70, 15.5], [80, 8.5], [90, 4.0], [100, 2.2]],
  F: [[0, 86.6], [10, 76.8], [20, 66.9], [30, 57.1], [40, 47.4], [50, 37.8], [60, 28.4], [70, 19.2], [80, 10.9], [90, 5.1], [100, 2.6]],
};
// KOSIS 메타에서 채운다(--meta). 비어 있으면 원표 생성은 중단한다
const ITM = '';            // 기대여명 항목 ID
const OBJ_SEX = '';        // 성별 분류 ID (남/여/전체 코드)

const args = new Set(process.argv.slice(2));
const key = process.env.KOSIS_API_KEY || '';

function interp(anchors, age) {
  if (age <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) if (age <= anchors[i][0]) { const [a0, v0] = anchors[i - 1], [a1, v1] = anchors[i]; return v0 + (v1 - v0) * (age - a0) / (a1 - a0); }
  return anchors[anchors.length - 1][1];
}
function write(M, F, A, provisional, source) {
  const ages = Array.from({ length: 101 }, (_, i) => i);
  const json = {
    schemaVersion: 1,
    _comment: 'LifeGrid 연령별 기대여명(년). 앱은 현재 나이(소수)로 선형 보간해 끝 날짜를 정한다 — "기대수명−나이" 근사 금지. provisional:true 면 10세 간격 공표값을 보간한 임시표이고 출시 전 KOSIS 원표로 교체한다. 앱 계약: schemaVersion==1 && 배열 101개 && 단조감소 && 0<값<110 이면 캐시, 아니면 캐시 유지. schemaVersion 은 올리지 않는다.',
    source, asOf: String(YEAR), provisional,
    ages, M: M.map(v => +v.toFixed(2)), F: F.map(v => +v.toFixed(2)), A: A.map(v => +v.toFixed(2)),
  };
  fs.writeFileSync(out, JSON.stringify(json, null, 1) + '\n');
  console.log(`lifetable.json 생성 (provisional=${provisional})`);
}

if (args.has('--provisional')) {
  const M = [], F = [], A = [];
  for (let a = 0; a <= 100; a++) { const m = interp(ANCHORS.M, a), f = interp(ANCHORS.F, a); M.push(m); F.push(f); A.push((m + f) / 2); }
  write(M, F, A, true, `국가데이터처 ${YEAR}년 생명표 공표값(10세 간격) 선형 보간 — 임시. 전체(A)는 남녀 평균`);
  process.exit(0);
}
if (!key) { console.error('KOSIS_API_KEY 가 없다. 임시표는 --provisional'); process.exit(1); }
const base = 'https://kosis.kr/openapi/Param/statisticsParameterData.do';
if (args.has('--meta')) {
  for (const type of ['ITM', 'OBJ']) {
    const u = `${base}?method=getMeta&type=${type}&orgId=101&tblId=DT_1B42&format=json&apiKey=${key}`;
    const r = await fetch(u); console.log(`--- ${type} ---`); console.log(await r.text());
  }
  process.exit(0);
}
if (!ITM || !OBJ_SEX) { console.error('ITM / OBJ_SEX 상수를 --meta 결과로 먼저 채울 것'); process.exit(1); }
const u = `${base}?method=getList&apiKey=${key}&format=json&jsonVD=Y&orgId=101&tblId=DT_1B42&prdSe=Y&startPrdDe=${YEAR}&endPrdDe=${YEAR}&itmId=${ITM}&objL1=ALL&objL2=ALL`;
const rows = await (await fetch(u)).json();
// TODO(원표 확보 뒤): rows 에서 성별(objL?)·연령(objL?) 코드를 M/F/A × 0~100 으로 매핑해 write(M,F,A,false,'KOSIS DT_1B42 …')
console.log(`받은 행 ${rows.length}건 — 매핑 코드를 채우기 전이라 파일을 쓰지 않는다`);
