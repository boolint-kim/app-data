// 서울 건설공사(PMIS) 데이터 크롤러
// 서울 열린데이터광장 pmisPjtList OpenAPI에서 전체 공사 목록을 받아
// public/construct_data.json + construct_version.txt 로 저장한다.
//
// 배경: OpenAPI는 호출당 약 7초 고정 지연(TTFB)이 있어 앱에서 직접 호출 시 느림.
//       서버에서 미리 받아 정적 JSON으로 제공 → 앱은 1회 호출로 즉시 로드.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');

// 설정
const API_KEY = '786e78784a77696e3832525a6c7648'; // 서울 열린데이터 인증키 (앱과 동일)
const BASE_API = `http://openapi.seoul.go.kr:8088/${API_KEY}/xml/pmisPjtList`;
const CHUNK = 1000;          // OpenAPI 1회 최대 행수
const RETRY = 3;             // 청크별 재시도 횟수

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_FILE = path.join(PUBLIC_DIR, 'construct_data.json');
const VERSION_FILE = path.join(PUBLIC_DIR, 'construct_version.txt');

// 앱 ConstructVo가 사용하는 필드 (최상위 row 직속, 소문자 키로 저장)
const FIELDS = [
  'SEQ', 'PJT_CD', 'PJT_NAME', 'FCT_F6', 'FCT_F6_NM',
  'PJT_BGN1_DATE', 'PJT_COMPL_PREARR_DATE', 'TOT_CNTRT_AMT', 'PJT_SCALE',
  'OFFICE_ADDR', 'PJT_FIN_YN', 'PJT_FIN_YN_NM',
  'ORG_1', 'ORG_2', 'ORG_3', 'USER_1', 'USER_2', 'USER_3',
  'TEL_1', 'TEL_2', 'TEL_3', 'LAT', 'LNG'
];

// HTTP GET (텍스트) — 타임아웃/재시도 포함
function fetchText(url, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

// XML <row>...</row> 단위 파싱. AIRVIEW 등 중첩 노드가 있어도
// 각 필드는 row당 1개뿐이라 첫 매칭만 추출하면 안전.
// (<PJT_CD> 정규식은 <PJT_CD_SEQ>를 잡지 않음)
function parseRows(xml) {
  const items = [];
  const rowRe = /<row>([\s\S]*?)<\/row>/g;
  let m;
  while ((m = rowRe.exec(xml)) !== null) {
    const block = m[1];
    const obj = {};
    for (const field of FIELDS) {
      const re = new RegExp(`<${field}>([\\s\\S]*?)</${field}>`);
      const fm = re.exec(block);
      obj[field.toLowerCase()] = fm ? decodeEntities(fm[1].trim()) : '';
    }
    items.push(obj);
  }
  return items;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// 전체 건수 조회
async function fetchTotalCount() {
  const xml = await fetchText(`${BASE_API}/1/2`);
  const m = /<list_total_count>(\d+)<\/list_total_count>/.exec(xml);
  return m ? parseInt(m[1], 10) : 0;
}

// 청크 1개 받기 (재시도 포함)
async function fetchChunk(start, end) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY; attempt++) {
    try {
      const xml = await fetchText(`${BASE_API}/${start}/${end}`);
      // 에러 응답 체크
      if (xml.includes('<CODE>') && !xml.includes('INFO-000')) {
        const cm = /<MESSAGE>([\s\S]*?)<\/MESSAGE>/.exec(xml);
        throw new Error('API 오류: ' + (cm ? cm[1] : 'unknown'));
      }
      const rows = parseRows(xml);
      console.log(`  [${start}-${end}] ${rows.length}건 (시도 ${attempt})`);
      return rows;
    } catch (e) {
      lastErr = e;
      console.log(`  [${start}-${end}] 실패(시도 ${attempt}): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

// 기존 버전 읽기
function readVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      const v = parseInt(fs.readFileSync(VERSION_FILE, 'utf-8').trim(), 10);
      return isNaN(v) ? 0 : v;
    }
  } catch (e) {}
  return 0;
}

// 기존 데이터 로드 (변경 비교용)
function loadExisting() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) {}
  return null;
}

// 변경 감지: 건수 또는 진행상태(pjt_fin_yn)/준공예정일 변동
function hasChanges(newItems, existing) {
  if (!existing || !Array.isArray(existing.items)) return true;
  if (newItems.length !== existing.items.length) return true;

  const map = {};
  for (const it of existing.items) {
    map[it.pjt_cd] = it.pjt_fin_yn + '|' + it.pjt_compl_prearr_date + '|' + it.tot_cntrt_amt;
  }
  for (const it of newItems) {
    const key = it.pjt_fin_yn + '|' + it.pjt_compl_prearr_date + '|' + it.tot_cntrt_amt;
    if (map[it.pjt_cd] !== key) return true;
  }
  return false;
}

async function main() {
  console.log('=== 서울 건설공사 데이터 크롤링 시작 ===');
  console.log(new Date().toISOString());

  // 1. 전체 건수
  console.log('\n1. 전체 건수 조회...');
  const total = await fetchTotalCount();
  console.log(`   전체 ${total}건`);
  if (total === 0) {
    console.log('건수 0, 종료(기존 데이터 유지).');
    process.exit(1);
  }

  // 2. 청크 순차 수집 (서버에서 실행되므로 순차로 안전하게)
  console.log('\n2. 청크 수집...');
  const items = [];
  for (let start = 1; start <= total; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, total);
    const rows = await fetchChunk(start, end);
    items.push(...rows);
  }
  console.log(`   수집 완료: ${items.length}건`);

  // 수집 누락 방어: 전체의 95% 미만이면 중단(기존 데이터 보존)
  if (items.length < total * 0.95) {
    console.log(`   수집량(${items.length})이 전체(${total})의 95% 미만. 저장 중단.`);
    process.exit(1);
  }

  // 3. 변경 확인 및 저장
  console.log('\n3. 변경 확인...');
  const existing = loadExisting();
  if (!hasChanges(items, existing)) {
    console.log('   변경 없음, 저장 건너뜀.');
    console.log('\n=== 완료 ===');
    return;
  }

  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const version = readVersion() + 1;
  fs.writeFileSync(DATA_FILE, JSON.stringify({ items }, null, 2), 'utf-8');
  fs.writeFileSync(VERSION_FILE, String(version), 'utf-8');
  console.log(`   저장 완료: ${items.length}건, 버전 ${version}`);

  console.log('\n=== 완료 ===');
}

main().catch(e => {
  console.error('크롤링 오류:', e);
  process.exit(1);
});
