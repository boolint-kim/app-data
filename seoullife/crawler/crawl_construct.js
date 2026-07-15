// 서울 건설공사 데이터 크롤러
// 서울 열린데이터광장 pmisPjtList OpenAPI에서 전체 공사 목록을 받아
// public/construct_data.json + construct_version.txt 로 저장한다.
//
// [출처/라이선스] 데이터셋 OA-15585 "서울특별시 건설알림이 사업개요"
//   - 공공누리 제1유형(출처표시) → 상업적 이용·변경 가능
//   - 서비스명 pmisPjtList (OA-2540 "건설공사 추진현황"(제4유형)과 동일 엔드포인트·동일 데이터지만,
//     제1유형으로 개방된 OA-15585 등재를 이용 근거로 삼는다)
//   - 출처표시: "서울특별시 건설알림이 사업개요, 서울 열린데이터광장(data.seoul.go.kr)"
//
// 배경: OpenAPI는 호출당 약 7초 고정 지연(TTFB)이 있어 앱에서 직접 호출 시 느림.
//       서버에서 미리 받아 정적 JSON으로 제공 → 앱은 1회 호출로 즉시 로드.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// 설정
const API_KEY = '786e78784a77696e3832525a6c7648'; // 서울 열린데이터 인증키 (앱과 동일)
const BASE_API = `http://openapi.seoul.go.kr:8088/${API_KEY}/xml/pmisPjtList`;
const CHUNK = 1000;          // OpenAPI 1회 최대 행수
const RETRY = 3;             // 청크별 재시도 횟수

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_FILE = path.join(PUBLIC_DIR, 'construct_data.json');
const VERSION_FILE = path.join(PUBLIC_DIR, 'construct_version.txt');
// 신규 사업장 알림용(지역구독형) — 앱이 폴링하는 작은 파일
const NEW_FILE = path.join(PUBLIC_DIR, 'construct_new.json');
const NEW_VERSION_FILE = path.join(PUBLIC_DIR, 'construct_new_version.txt');
const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY;
const GEOCODE_DELAY_MS = 60;   // 카카오 역지오코딩 호출 간 간격(쿼터/예의)
const SEOUL_GU = new Set(['종로구','중구','용산구','성동구','광진구','동대문구','중랑구','성북구','강북구','도봉구','노원구','은평구','서대문구','마포구','양천구','강서구','구로구','금천구','영등포구','동작구','관악구','서초구','강남구','송파구','강동구']);

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

// construct_new 버전 읽기
function readNewVersion() {
  try {
    if (fs.existsSync(NEW_VERSION_FILE)) {
      const v = parseInt(fs.readFileSync(NEW_VERSION_FILE, 'utf-8').trim(), 10);
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

// ── 카카오 역지오코딩 (좌표 → 서울 자치구) ──
function kakaoGet(reqPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'dapi.kakao.com',
      path: reqPath,
      headers: { 'Authorization': `KakaoAK ${KAKAO_API_KEY}`, 'X-Requested-With': 'curl' }
    };
    https.get(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 좌표(lng=x, lat=y) → 서울 자치구명. 실패/서울밖이면 ''
async function guByCoord(lng, lat) {
  try {
    const res = await kakaoGet(`/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`);
    const docs = res && res.documents;
    if (!docs || !docs.length) return '';
    for (const d of docs) {                       // region_2depth_name = 시군구
      const gu = (d.region_2depth_name || '').trim();
      if (SEOUL_GU.has(gu)) return gu;
    }
    return '';
  } catch (e) {
    return '';
  }
}

// 자치구 부여: 이전 construct_data.json의 gu를 캐시로 재사용,
// 신규 pjt_cd만 역지오코딩(쿼터·시간 절약).
async function enrichGu(items, prevGu) {
  let cached = 0, geocoded = 0, failed = 0, skipped = 0;
  for (const it of items) {
    const prev = prevGu[it.pjt_cd];
    if (prev) { it.gu = prev; cached++; continue; }
    const lng = parseFloat(it.lng), lat = parseFloat(it.lat);
    if (!KAKAO_API_KEY || !isFinite(lng) || !isFinite(lat) || (lng === 0 && lat === 0)) {
      it.gu = ''; skipped++; continue;
    }
    it.gu = await guByCoord(lng, lat);
    if (it.gu) geocoded++; else failed++;
    await sleep(GEOCODE_DELAY_MS);
  }
  console.log(`   자치구 부여: 캐시 ${cached}, 신규지오코딩 ${geocoded}, 실패 ${failed}, 좌표없음 ${skipped}`);
}

// construct_new.json 용 축약 항목
function slimNew(it) {
  return {
    pjt_cd: it.pjt_cd,
    gu: it.gu || '',
    name: it.pjt_name || '',
    type: it.fct_f6_nm || '',
    amt: it.tot_cntrt_amt || '',
    bgn: it.pjt_bgn1_date || ''
  };
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

  // 3. 자치구 부여 + 신규 감지 + 저장
  console.log('\n3. 자치구 부여 및 신규 감지...');
  const existing = loadExisting();
  const prevItems = (existing && Array.isArray(existing.items)) ? existing.items : [];
  const prevGu = {};
  const prevSet = new Set();
  let existingHasGu = false;
  for (const it of prevItems) {
    prevSet.add(it.pjt_cd);
    if (it.gu !== undefined) { existingHasGu = true; if (it.gu) prevGu[it.pjt_cd] = it.gu; }
  }
  const bootstrap = prevItems.length === 0;   // 최초 실행이면 전체를 신규로 보지 않음(시드)

  // 자치구 부여 (이전 gu 캐시 재사용, 신규 pjt_cd만 역지오코딩)
  await enrichGu(items, prevGu);

  // 신규 사업장 = 이전 스냅샷에 없던 pjt_cd
  const newItems = bootstrap ? [] : items.filter(it => it.pjt_cd && !prevSet.has(it.pjt_cd));
  console.log(`   신규 사업장: ${newItems.length}건${bootstrap ? ' (최초 시드 → 알림 없음)' : ''}`);

  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  // construct_data 저장: 데이터 변경 or gu 최초 부여 시
  const needSaveData = hasChanges(items, existing) || !existingHasGu;
  if (needSaveData) {
    const version = readVersion() + 1;
    fs.writeFileSync(DATA_FILE, JSON.stringify({ items }, null, 2), 'utf-8');
    fs.writeFileSync(VERSION_FILE, String(version), 'utf-8');
    console.log(`   construct_data 저장: ${items.length}건, 버전 ${version}`);
  } else {
    console.log('   construct_data 변경 없음, 저장 건너뜀.');
  }

  // construct_new 갱신: 신규가 있을 때만 (앱 폴링용, 자치구별 요약 포함)
  if (newItems.length > 0) {
    const byGu = {};
    for (const it of newItems) { const g = it.gu || '기타'; byGu[g] = (byGu[g] || 0) + 1; }
    const newVersion = readNewVersion() + 1;
    const payload = {
      generated: new Date().toISOString(),
      version: newVersion,
      count: newItems.length,
      by_gu: byGu,
      items: newItems.map(slimNew)
    };
    fs.writeFileSync(NEW_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    fs.writeFileSync(NEW_VERSION_FILE, String(newVersion), 'utf-8');
    console.log(`   construct_new 저장: 신규 ${newItems.length}건, 버전 ${newVersion}`);
    console.log('   자치구별 신규:', JSON.stringify(byGu));
  } else {
    console.log('   신규 없음, construct_new 갱신 안 함.');
  }

  console.log('\n=== 완료 ===');
}

main().catch(e => {
  console.error('크롤링 오류:', e);
  process.exit(1);
});
