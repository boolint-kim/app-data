#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// MySalary 요율/간이세액표 변환기
//
// 사용법 (app-data 레포 루트에서):
//   node mysalary/scripts/convert.js
//
// 동작:
//   1. mysalary/source/*.xlsx (국세청 근로소득 간이세액표 원본) 파싱
//   2. 본표 646행 + "10,000천원" 정확값 행 + 고소득 산식 6구간 추출
//   3. 아래 연도별 상수(4대보험 요율·최저시급)와 합쳐 mysalary/rates.json 생성
//
// 매년 개정 시:
//   - mysalary/source/ 의 엑셀을 새 파일로 교체
//   - 아래 "연도별 상수" 블록을 MySalary/docs/data/rates-<연도>.md 값으로 갱신
//   - 검증 앵커(ANCHORS)도 새 표 실측값으로 갱신
//   - 재실행 → 검증 통과 시에만 rates.json 이 새로 써진다
//
// 검증 실패 시 exit 1 이며 rates.json 을 건드리지 않는다.
// 의존성: xlsx (mysalary/scripts/package.json → npm install)
// ──────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

// ── 연도별 상수 ───────────────────────────────────────────────────────────────
// 출처: ~/AndroidStudioProjects/MySalary/docs/data/rates-2026.md
// (기억이나 추정으로 채우지 말 것 — 유일한 출처는 위 문서와 원본 엑셀)
const SCHEMA_VERSION = 1;
const YEAR = 2026;

const PENSION = {
  employeeRate: 0.0475,      // 근로자 4.75% (총 9.5%)
  upperBase: 6590000,        // 기준소득월액 상한
  lowerBase: 410000,         // 기준소득월액 하한
  baseAppliedFrom: "2026-07-01", // 상·하한 적용 시작 (매년 7월 갱신)
};
const HEALTH = { employeeRate: 0.03595 };          // 근로자 3.595% (총 7.19%)
// 장기요양 = 건강보험료 × (장기요양보험료율 0.9448% ÷ 건강보험료율 7.19%).
// 공단(4insure.or.kr)이 비율식을 그대로 쓰므로 0.1314 로 반올림하면 경계 월급여에서
// 10원 어긋난다(예: 월급여 2,004,729원 → 공단 9,470 vs 반올림값 9,460). 나눗셈 유지할 것.
const CARE = { rateOfHealthPremium: 0.9448 / 7.19 };
const EMPLOYMENT = { employeeRate: 0.009 };        // 고용보험(실업급여) 0.9%
const LOCAL_INCOME_TAX_RATE = 0.1;                 // 지방소득세 = 소득세 × 10%
const MIN_WAGE = 10320;                            // 2026 최저시급

const INCOME_TAX_EFFECTIVE_FROM = "2026-03-01";    // 2026.2.27 개정, 2026.3.1 시행
const UNIT = 1000;                                 // 월급여액 구간 단위: 천원

// 엑셀 산식 텍스트에서 파싱한 값과 대조할 기대값 (rates-2026.md 표)
// 세액 = exactTop.tax[가족수] + add + (초과분 × mul) × rate
const EXPECTED_HIGH_INCOME = [
  { over: 10000, upTo: 14000, add: 25000,    mul: 0.98, rate: 0.35 },
  { over: 14000, upTo: 28000, add: 1397000,  mul: 0.98, rate: 0.38 },
  { over: 28000, upTo: 30000, add: 6610600,  mul: 0.98, rate: 0.4 },
  { over: 30000, upTo: 45000, add: 7394600,  mul: 1,    rate: 0.4 },
  { over: 45000, upTo: 87000, add: 13394600, mul: 1,    rate: 0.42 },
  { over: 87000, upTo: null,  add: 31034600, mul: 1,    rate: 0.45 },
];

// 자녀(8세~20세) 공제 기대값 — 엑셀 '소득령 별표2' 주기에서 파싱해 대조
const EXPECTED_CHILD_DEDUCTION = { one: 20830, two: 45830, perExtraOver2: 33330 };

// ── 검증 앵커 (엑셀 실측값) ───────────────────────────────────────────────────
const EXPECTED_ROW_COUNT = 646;
const EXPECTED_STEPS = { 5: 146, 10: 150, 20: 350 }; // 천원 단위 스텝별 행 수
const ANCHORS = [
  { from: 3500, to: 3520,  family: 1, tax: 127220 },
  { from: 3500, to: 3520,  family: 4, tax: 49340 },
  { from: 1060, to: 1065,  family: 1, tax: 1040 },
  { from: 9980, to: 10000, family: 1, tax: 1503990 },
];
const EXPECTED_EXACT_TOP = { salary: 10000, family1: 1507400, family2: 1431570 };
const FAMILY_COLUMNS = 11; // 공제대상가족 수 1~11

// ── 경로 ──────────────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, "../..");
const MYS_ROOT = path.join(REPO_ROOT, "mysalary");
const SOURCE_DIR = path.join(MYS_ROOT, "source");
const OUT_PATH = path.join(MYS_ROOT, "rates.json");

const SHEET_NOTES = "소득령 별표2";
const SHEET_TABLE = "근로소득간이세액표";

// ── 유틸 ──────────────────────────────────────────────────────────────────────
const errors = [];
const checks = [];

function check(ok, label, detail) {
  checks.push({ ok, label, detail });
  if (!ok) errors.push(detail ? `${label} — ${detail}` : label);
  return ok;
}

function die(msg) {
  console.error(`\n[실패] ${msg}\n`);
  process.exit(1);
}

// "1,234" | 1234 | "-" | null → 숫자 ('-'·빈칸은 0원)
function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (s === "" || s === "-" || s === "－" || s === "–") return 0;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) die(`숫자로 변환할 수 없는 값: ${JSON.stringify(v)}`);
  return n;
}

function findSourceFile() {
  if (!fs.existsSync(SOURCE_DIR)) die(`원본 폴더 없음: ${SOURCE_DIR}`);
  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"));
  if (files.length === 0) die(`${SOURCE_DIR} 에 .xlsx 원본이 없다`);
  if (files.length > 1) {
    die(`${SOURCE_DIR} 에 .xlsx 가 여러 개다 (하나만 두어야 함): ${files.join(", ")}`);
  }
  return path.join(SOURCE_DIR, files[0]);
}

// ── 파싱: 본표 ────────────────────────────────────────────────────────────────
function parseTable(rows) {
  // 헤더에서 "이상 | 미만" 행을 찾아 그 다음 줄부터 데이터
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const a = String(rows[i]?.[0] ?? "").trim();
    const b = String(rows[i]?.[1] ?? "").trim();
    if (a === "이상" && b === "미만") {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) die(`'이상/미만' 헤더 행을 찾지 못했다 (시트 구조 변경?)`);

  const brackets = [];
  let i = headerIdx + 1;
  for (; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (typeof r[0] !== "number" || typeof r[1] !== "number") break;
    const tax = [];
    for (let c = 0; c < FAMILY_COLUMNS; c++) tax.push(toNum(r[2 + c]));
    brackets.push([r[0], r[1], tax]);
  }
  return { brackets, tailStart: i };
}

// ── 파싱: "10,000천원" 정확값 행 ──────────────────────────────────────────────
function parseExactTop(rows, tailStart) {
  for (let i = tailStart; i < rows.length; i++) {
    const c0 = String(rows[i]?.[0] ?? "").trim();
    const m = c0.match(/^([\d,]+)\s*천원$/);
    if (!m) continue;
    const tax = [];
    for (let c = 0; c < FAMILY_COLUMNS; c++) tax.push(toNum(rows[i][2 + c]));
    return { salary: toNum(m[1]), tax };
  }
  die(`"N천원" 정확값 행을 찾지 못했다`);
}

// ── 파싱: 고소득 산식 텍스트 ──────────────────────────────────────────────────
// 예) "(10,000천원인 경우의 해당 세액) + (1,397,000원)
//      + (14,000천원을 초과하는 금액에 98%를 곱한 금액의 38% 상당액)"
function parseHighIncome(rows, tailStart) {
  const out = [];
  for (let i = tailStart; i < rows.length; i++) {
    const c0 = String(rows[i]?.[0] ?? "").trim();
    const mOver = c0.match(/^([\d,]+)\s*천원\s*초과$/);
    if (!mOver) continue;

    const text = String(rows[i]?.[2] ?? "").replace(/\s+/g, " ").trim();
    if (!text) die(`${c0} 행에 산식 텍스트가 없다`);

    // 정액 가산분: "(25,000원)" 처럼 '천원'이 아닌 순수 금액 괄호
    const mAdd = text.match(/\(([\d,]+)원\)/);
    // 초과분에 곱하는 비율(98% 등). 없으면 1
    const mMul = text.match(/초과하는\s*금액에\s*([\d.]+)\s*%를\s*곱한/);
    // 최종 세율: "… 35% 상당액"
    const mRate = text.match(/([\d.]+)\s*%\s*상당액/);
    if (!mAdd) die(`${c0} 산식에서 가산액을 파싱하지 못했다: ${text}`);
    if (!mRate) die(`${c0} 산식에서 세율을 파싱하지 못했다: ${text}`);

    // 상한: 바로 다음 비어있지 않은 행이 "N천원 이하" 면 그 값, 아니면 null(최상위 구간)
    let upTo = null;
    for (let j = i + 1; j < rows.length; j++) {
      const n0 = String(rows[j]?.[0] ?? "").trim();
      if (!n0) continue;
      const mUpTo = n0.match(/^([\d,]+)\s*천원\s*이하$/);
      if (mUpTo) upTo = toNum(mUpTo[1]);
      break;
    }

    out.push({
      over: toNum(mOver[1]),
      upTo,
      add: toNum(mAdd[1]),
      mul: mMul ? Number(mMul[1]) / 100 : 1,
      rate: Number(mRate[1]) / 100,
    });
  }
  if (out.length === 0) die(`고소득 산식 행을 찾지 못했다`);
  return out;
}

// ── 파싱: 자녀공제 (주기 시트) ────────────────────────────────────────────────
function parseChildDeduction(noteRows) {
  const text = noteRows
    .map((r) => (r ?? []).filter((c) => c != null).join(" "))
    .join(" ")
    .replace(/\s+/g, " ");

  const m1 = text.match(/자녀가\s*1명인\s*경우\s*[:：]\s*([\d,]+)원/);
  const m2 = text.match(/자녀가\s*2명인\s*경우\s*[:：]\s*([\d,]+)원/);
  const m3 = text.match(
    /자녀가\s*3명\s*이상인\s*경우\s*[:：]\s*([\d,]+)원\s*\+\s*2명\s*초과\s*자녀\s*1명당\s*([\d,]+)원/
  );
  if (!m1 || !m2 || !m3) die(`'소득령 별표2' 주기에서 자녀공제 금액을 파싱하지 못했다`);

  const cd = { one: toNum(m1[1]), two: toNum(m2[1]), perExtraOver2: toNum(m3[2]) };
  check(
    toNum(m3[1]) === cd.two,
    "자녀공제 3명 이상 기준액 == 2명 공제액",
    `${toNum(m3[1])} != ${cd.two}`
  );
  return cd;
}

// ── 검증 ──────────────────────────────────────────────────────────────────────
function verify(brackets, exactTop, highIncome, childDeduction) {
  // 1. 행 수 + 스텝 분포
  check(
    brackets.length === EXPECTED_ROW_COUNT,
    `본표 행 수 == ${EXPECTED_ROW_COUNT}`,
    `실제 ${brackets.length}행`
  );

  const steps = {};
  for (const [from, to] of brackets) {
    const s = to - from;
    steps[s] = (steps[s] ?? 0) + 1;
  }
  const stepsOk =
    Object.keys(steps).length === Object.keys(EXPECTED_STEPS).length &&
    Object.entries(EXPECTED_STEPS).every(([s, n]) => steps[s] === n);
  check(stepsOk, "스텝 분포 == {5천원:146, 10천원:150, 20천원:350}", JSON.stringify(steps));

  // 2. 구간 연속성
  let gapAt = -1;
  for (let i = 0; i < brackets.length - 1; i++) {
    if (brackets[i][1] !== brackets[i + 1][0]) {
      gapAt = i;
      break;
    }
  }
  check(
    gapAt < 0,
    "구간 연속성 (각 행의 '미만' == 다음 행의 '이상')",
    gapAt < 0 ? "" : `${brackets[gapAt][1]} != ${brackets[gapAt + 1][0]} (행 ${gapAt + 1})`
  );

  // 열 수 일관성
  const badCols = brackets.findIndex((b) => b[2].length !== FAMILY_COLUMNS);
  check(badCols < 0, `모든 행의 가족수 열 == ${FAMILY_COLUMNS}`, badCols < 0 ? "" : `행 ${badCols}`);

  // 3~5. 앵커
  const find = (from, to) => brackets.find((b) => b[0] === from && b[1] === to);
  for (const a of ANCHORS) {
    const row = find(a.from, a.to);
    const got = row ? row[2][a.family - 1] : null;
    check(
      got === a.tax,
      `앵커 ${a.from}~${a.to}천원 가족${a.family} == ${a.tax.toLocaleString()}`,
      row ? `실제 ${got}` : "해당 구간 행 없음"
    );
  }

  // 1,060~1,065 직전 행(1,055~1,060)은 0
  const idx1060 = brackets.findIndex((b) => b[0] === 1060 && b[1] === 1065);
  const prev = idx1060 > 0 ? brackets[idx1060 - 1] : null;
  check(
    prev !== null && prev[2][0] === 0,
    "앵커 1,060~1,065 직전 행 가족1 == 0",
    prev ? `실제 ${prev[2][0]} (${prev[0]}~${prev[1]})` : "직전 행 없음"
  );

  // exactTop
  check(
    exactTop.salary === EXPECTED_EXACT_TOP.salary,
    `exactTop.salary == ${EXPECTED_EXACT_TOP.salary}`,
    `실제 ${exactTop.salary}`
  );
  check(
    exactTop.tax.length === FAMILY_COLUMNS,
    `exactTop.tax 길이 == ${FAMILY_COLUMNS}`,
    `실제 ${exactTop.tax.length}`
  );
  check(
    exactTop.tax[0] === EXPECTED_EXACT_TOP.family1,
    `앵커 exactTop 가족1 == ${EXPECTED_EXACT_TOP.family1.toLocaleString()}`,
    `실제 ${exactTop.tax[0]}`
  );
  check(
    exactTop.tax[1] === EXPECTED_EXACT_TOP.family2,
    `앵커 exactTop 가족2 == ${EXPECTED_EXACT_TOP.family2.toLocaleString()}`,
    `실제 ${exactTop.tax[1]}`
  );
  // 본표 마지막 행의 '미만' 과 exactTop 급여가 이어지는지
  const last = brackets[brackets.length - 1];
  check(
    last[1] === exactTop.salary,
    "본표 마지막 구간의 '미만' == exactTop.salary",
    `${last[1]} != ${exactTop.salary}`
  );

  // 6. 고소득 산식: 엑셀 파싱값 vs rates-2026.md 기대값 대조
  const same = (a, b) =>
    a.over === b.over &&
    a.upTo === b.upTo &&
    a.add === b.add &&
    Math.abs(a.mul - b.mul) < 1e-9 &&
    Math.abs(a.rate - b.rate) < 1e-9;
  check(
    highIncome.length === EXPECTED_HIGH_INCOME.length,
    `고소득 구간 수 == ${EXPECTED_HIGH_INCOME.length}`,
    `실제 ${highIncome.length}`
  );
  for (let i = 0; i < EXPECTED_HIGH_INCOME.length; i++) {
    const exp = EXPECTED_HIGH_INCOME[i];
    const got = highIncome[i];
    check(
      got !== undefined && same(got, exp),
      `고소득 구간 ${exp.over.toLocaleString()}천원 초과 산식 일치`,
      got ? `엑셀 ${JSON.stringify(got)} != 문서 ${JSON.stringify(exp)}` : "구간 없음"
    );
  }
  // 고소득 첫 구간은 본표 상단과 이어져야 함
  check(
    highIncome[0].over === exactTop.salary,
    "고소득 첫 구간 over == exactTop.salary",
    `${highIncome[0].over} != ${exactTop.salary}`
  );

  // 7. 자녀공제: 엑셀 주기 파싱값 vs 문서 기대값
  const cdOk =
    childDeduction.one === EXPECTED_CHILD_DEDUCTION.one &&
    childDeduction.two === EXPECTED_CHILD_DEDUCTION.two &&
    childDeduction.perExtraOver2 === EXPECTED_CHILD_DEDUCTION.perExtraOver2;
  check(
    cdOk,
    "자녀공제 엑셀 파싱값 == 문서 기대값",
    `엑셀 ${JSON.stringify(childDeduction)} != 문서 ${JSON.stringify(EXPECTED_CHILD_DEDUCTION)}`
  );
}

// ── 직렬화 (brackets 는 한 행당 한 줄 — diff 가독성) ──────────────────────────
function buildJson(d) {
  const L = [];
  L.push("{");
  L.push(`  "schemaVersion": ${d.schemaVersion},`);
  L.push(`  "year": ${d.year},`);
  L.push(`  "pension": ${JSON.stringify(d.pension)},`);
  L.push(`  "health": ${JSON.stringify(d.health)},`);
  L.push(`  "care": ${JSON.stringify(d.care)},`);
  L.push(`  "employment": ${JSON.stringify(d.employment)},`);
  L.push(`  "localIncomeTaxRate": ${d.localIncomeTaxRate},`);
  L.push(`  "minWage": ${d.minWage},`);
  L.push(`  "incomeTax": {`);
  L.push(`    "effectiveFrom": ${JSON.stringify(d.incomeTax.effectiveFrom)},`);
  L.push(`    "unit": ${d.incomeTax.unit},`);
  L.push(`    "brackets": [`);
  L.push(
    d.incomeTax.brackets
      .map((b) => `      [${b[0]},${b[1]},[${b[2].join(",")}]]`)
      .join(",\n")
  );
  L.push(`    ],`);
  L.push(`    "exactTop": ${JSON.stringify(d.incomeTax.exactTop)},`);
  L.push(`    "highIncome": [`);
  L.push(d.incomeTax.highIncome.map((h) => `      ${JSON.stringify(h)}`).join(",\n"));
  L.push(`    ],`);
  L.push(`    "childDeduction": ${JSON.stringify(d.incomeTax.childDeduction)}`);
  L.push(`  }`);
  L.push("}");
  return L.join("\n") + "\n";
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
function main() {
  const srcPath = findSourceFile();
  console.log(`원본: ${path.relative(REPO_ROOT, srcPath)}`);

  const wb = XLSX.readFile(srcPath);
  for (const name of [SHEET_NOTES, SHEET_TABLE]) {
    if (!wb.SheetNames.includes(name)) {
      die(`시트 '${name}' 없음 (실제: ${wb.SheetNames.join(", ")})`);
    }
  }
  const opts = { header: 1, raw: true, defval: null };
  const tableRows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_TABLE], opts);
  const noteRows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_NOTES], opts);

  const { brackets, tailStart } = parseTable(tableRows);
  const exactTop = parseExactTop(tableRows, tailStart);
  const highIncome = parseHighIncome(tableRows, tailStart);
  const childDeduction = parseChildDeduction(noteRows);

  verify(brackets, exactTop, highIncome, childDeduction);

  console.log("\n── 검증 ──");
  for (const c of checks) {
    console.log(`  ${c.ok ? "OK  " : "FAIL"} ${c.label}${c.ok || !c.detail ? "" : ` (${c.detail})`}`);
  }

  if (errors.length > 0) {
    console.error(`\n검증 ${errors.length}건 실패 — rates.json 을 생성하지 않는다.`);
    process.exit(1);
  }

  const data = {
    schemaVersion: SCHEMA_VERSION,
    year: YEAR,
    pension: PENSION,
    health: HEALTH,
    care: CARE,
    employment: EMPLOYMENT,
    localIncomeTaxRate: LOCAL_INCOME_TAX_RATE,
    minWage: MIN_WAGE,
    incomeTax: {
      effectiveFrom: INCOME_TAX_EFFECTIVE_FROM,
      unit: UNIT,
      brackets,
      exactTop,
      highIncome,
      childDeduction,
    },
  };

  const json = buildJson(data);
  JSON.parse(json); // 직렬화 결과가 유효한 JSON 인지 최종 확인 (실패 시 throw)

  fs.writeFileSync(OUT_PATH, json, "utf8");
  console.log(
    `\n생성: ${path.relative(REPO_ROOT, OUT_PATH)} ` +
      `(${brackets.length}행, ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`
  );
}

main();
