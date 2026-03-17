require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

// 설정
const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_FILE = path.join(PUBLIC_DIR, 'gg_improve_data.json');
const VERSION_FILE = path.join(PUBLIC_DIR, 'gg_improve_version.txt');
const API_KEY = '3815432626c441b5bbc06ae7d1c7040b';
const API_URL = `https://openapi.gg.go.kr/GenrlimprvBizpropls?Key=${API_KEY}&pIndex=1&pSize=1000`;

// API XML 필드 목록 (GgImproveOpenApiHelper.java 기준 55개)
const FIELDS = [
  'SIGUN_NM', 'SIGUN_CD', 'BIZ_TYPE_NM', 'IMPRV_ZONE_NM', 'LOCPLC_ADDR', 'ZONE_AR',
  'EXISTNG_HOUSNG_COMPLTN_PERD', 'EXISTNG_HOUSNG_COPPER_CNT', 'EXISTNG_HOUSNG_HSHLD_CNT',
  'NWCNST_HUSNG_LTUTAR40MUD_DESC', 'NWCNST_HUSNG_LTUTAR4060M_DESC', 'NWCNST_HUSNG_LTUTAR6085M_DESC',
  'NWCNST_HUSNG_LTUTAR85135M_DESC', 'NWCNST_HUSNGLTUTAR135MABV_DESC',
  'NWCONST_HUSNGRENTAR40MUD_DESC', 'NWCONST_HUSNGRENT_AR4060M_DESC', 'NWCONST_HUSNGRENT_AR6085M_DESC',
  'EXISTNG_VOLUMRT_DESC', 'NWCONST_VOLUMRT_DESC',
  'LAND_OWNER_CNT', 'ASOCNTMB_CNT', 'BIZ_IMPLMNTR_NM', 'BIZ_PREARNGE_PERD',
  'IMPRV_PREARNGE_ZONE_NOTIFC_DE', 'IMPRV_ZONE_APPONT_FIRST_DE', 'IMPRV_ZONE_APPONT_CHANGE_DE',
  'PROPLSN_COMMISN_APRV_DE', 'PREPAR_EVALTN_DE', 'SAFE_DIAGNS_DE',
  'ASSOCTN_FOUND_CONFMTN_DE', 'BIZ_IMPLMTN_CONFMTN_DE', 'MANAGE_DISPOSIT_CONFMTN_DE',
  'STRCONTR_DE', 'GENRL_LOTOUT_DE', 'COMPLTN_DE', 'TRANSFR_NOTIFC_DE',
  'NOW_PROPLSN_MATR_DESC', 'CHRGPSN_NM', 'CHRGPSN_TELNO', 'RM',
  'BIZ_PREARNGE_BEGIN_PERD', 'IMPRV_ZONE_APPONT_PREARNGE_DE',
  'NWCONST_RENT_HOUSNG_CNT', 'NWCONST_LOTOUT_HOUSNG_CNT',
  'RENT_HSHLD_CNT', 'GENRL_LOTOUT_HSHLD_CNT', 'ASOCNTMB_LOTOUT_HSHLD_CNT',
  'BIZ_IMPLMTN_HSHLD_CNT_TOTSUM',
  'EXISTNG_HSHLD_CNT_135_DESC', 'EXISTNG_HSHLD_CNT_85_135_DESC',
  'EXISTNG_HSHLD_CNT_60_85_DESC', 'EXISTNG_HSHLD_CNT_40_60_DESC',
  'IMPRV_PLAN_FOUNDNG_DE', 'BIZ_STEP_NM', 'EXISTNG_HSHLD_CNT_40_DESC'
];

// PositionGgHelper.java에서 추출한 좌표 데이터 (541건)
// 키: "시군구명_정비구역명" (namePkey)
const POSITION_GG = JSON.parse(fs.readFileSync(path.join(__dirname, 'position_gg.json'), 'utf-8'));

// 경기도 API XML 호출
function fetchApi() {
  return new Promise((resolve, reject) => {
    https.get(API_URL, { timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`   응답 크기: ${Buffer.byteLength(data)} bytes, 상태: ${res.statusCode}`);
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// XML 파싱 (간단한 정규식 기반, 외부 의존성 없음)
function parseXml(xmlStr) {
  const items = [];
  // <row>...</row> 블록 추출
  const rowRegex = /<row>([\s\S]*?)<\/row>/g;
  let match;

  while ((match = rowRegex.exec(xmlStr)) !== null) {
    const rowXml = match[1];
    const item = { x: 0, y: 0 };

    for (const field of FIELDS) {
      const fieldRegex = new RegExp(`<${field}>([\\s\\S]*?)</${field}>`);
      const fm = fieldRegex.exec(rowXml);
      item[field] = fm ? fm[1].trim() : '';
    }

    if (!item.SIGUN_NM) continue;
    items.push(item);
  }

  return items;
}

// PositionGgHelper 좌표 매칭 + 기존 JSON 이월
function mergeCoords(newItems, existingData) {
  // 기존 JSON에서 namePkey → 좌표 맵 생성
  const existingCoordMap = {};
  if (existingData && existingData.items) {
    for (const item of existingData.items) {
      if (item.x && item.y) {
        const key = item.SIGUN_NM + '_' + item.IMPRV_ZONE_NM;
        existingCoordMap[key] = { x: item.x, y: item.y };
      }
    }
  }

  let positionCount = 0; // PositionGgHelper 매칭
  let existingCount = 0; // 기존 JSON 이월
  let missingCount = 0;

  for (const item of newItems) {
    const namePkey = item.SIGUN_NM + '_' + item.IMPRV_ZONE_NM;

    // 1순위: PositionGgHelper 하드코딩 좌표
    if (POSITION_GG[namePkey]) {
      item.x = POSITION_GG[namePkey][0];
      item.y = POSITION_GG[namePkey][1];
      positionCount++;
    }
    // 2순위: 기존 JSON 이월
    else if (existingCoordMap[namePkey]) {
      item.x = existingCoordMap[namePkey].x;
      item.y = existingCoordMap[namePkey].y;
      existingCount++;
    }
    else {
      missingCount++;
    }
  }

  console.log(`좌표 매칭: PositionGg ${positionCount}, 기존이월 ${existingCount}, 누락 ${missingCount}건`);
}

// 카카오 API GET 요청
function kakaoGet(reqPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'dapi.kakao.com',
      path: reqPath,
      headers: {
        'Authorization': `KakaoAK ${KAKAO_API_KEY}`,
        'X-Requested-With': 'curl'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// 카카오 주소 검색 API
function geocodeByAddress(address) {
  const reqPath = `/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
  return kakaoGet(reqPath);
}

// 카카오 키워드 검색 API (폴백)
function geocodeByKeyword(keyword) {
  const reqPath = `/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}`;
  return kakaoGet(reqPath);
}

// JSON 응답에서 좌표 추출
function extractCoords(json) {
  if (!json.documents || json.documents.length === 0) return null;
  const doc = json.documents[0];
  if (doc.address) {
    return { x: parseFloat(doc.address.y), y: parseFloat(doc.address.x) };
  }
  return { x: parseFloat(doc.y), y: parseFloat(doc.x) };
}

// 좌표 없는 항목에 Geocoding 실행
async function fillMissingCoords(items) {
  const missing = items.filter(item => !item.x || !item.y);
  if (missing.length === 0) {
    console.log('모든 항목에 좌표 있음, Geocoding 불필요');
    return;
  }
  console.log(`좌표 없는 항목: ${missing.length}건, Geocoding 시작...`);

  let addrCount = 0;
  let kwCount = 0;
  let failCount = 0;

  for (const item of missing) {
    const addr = item.LOCPLC_ADDR;
    if (!addr) { failCount++; continue; }

    try {
      // 1차: 주소 검색
      const addrResult = await geocodeByAddress(addr);
      let coords = extractCoords(addrResult);

      if (coords) {
        item.x = coords.x;
        item.y = coords.y;
        addrCount++;
      } else {
        // 2차: 키워드 검색 폴백
        await new Promise(r => setTimeout(r, 100));
        const kwResult = await geocodeByKeyword(addr);
        coords = extractCoords(kwResult);

        if (coords) {
          item.x = coords.x;
          item.y = coords.y;
          kwCount++;
        } else {
          failCount++;
          console.log(`  Geocoding 실패: ${addr}`);
        }
      }
    } catch (e) {
      failCount++;
      console.log(`  Geocoding 오류: ${addr} - ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`Geocoding 완료: 주소검색 ${addrCount}, 키워드폴백 ${kwCount}, 실패 ${failCount}`);
}

// 기존 데이터 로드
function loadExistingData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) {
    console.log('기존 데이터 로드 실패:', e.message);
  }
  return null;
}

// 데이터 변경 확인
function hasChanges(newItems, existingData) {
  if (!existingData || !existingData.items) return true;
  if (newItems.length !== existingData.items.length) return true;

  const existingMap = {};
  for (const item of existingData.items) {
    const key = item.SIGUN_NM + '_' + item.IMPRV_ZONE_NM;
    existingMap[key] = item.BIZ_STEP_NM;
  }

  for (const item of newItems) {
    const key = item.SIGUN_NM + '_' + item.IMPRV_ZONE_NM;
    if (existingMap[key] !== item.BIZ_STEP_NM) return true;
  }

  return false;
}

// 결과 저장
function saveResults(items) {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  const now = new Date();
  const version = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');

  const data = { version, items };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf-8');
  fs.writeFileSync(VERSION_FILE, version, 'utf-8');

  console.log(`저장 완료: ${items.length}건, 버전: ${version}`);
}

// 메인 실행
async function main() {
  console.log('=== 경기도 정비사업 데이터 크롤링 시작 ===');
  console.log(new Date().toISOString());

  try {
    // 1. API 호출
    console.log('\n1. 경기도 API 호출...');
    const xmlStr = await fetchApi();

    // 2. XML 파싱
    console.log('\n2. XML 파싱...');
    const items = parseXml(xmlStr);
    console.log(`   파싱 완료: ${items.length}건`);

    if (items.length === 0) {
      console.log('파싱된 데이터가 없습니다. 종료합니다.');
      return;
    }

    // 3. 좌표 매칭 (PositionGgHelper + 기존 JSON 이월)
    console.log('\n3. 좌표 매칭...');
    const existingData = loadExistingData();
    mergeCoords(items, existingData);

    // 4. 누락 좌표 Geocoding
    if (KAKAO_API_KEY) {
      console.log('\n4. 누락 좌표 Geocoding...');
      await fillMissingCoords(items);
    } else {
      console.log('\n4. KAKAO_REST_API_KEY 미설정, Geocoding 건너뜀');
    }

    // 5. 변경 확인 및 저장
    console.log('\n5. 변경 확인...');
    if (hasChanges(items, existingData)) {
      saveResults(items);
      console.log('   데이터 변경 감지, 저장 완료');
    } else {
      console.log('   변경 없음, 저장 건너뜀');
    }

  } catch (e) {
    console.error('크롤링 오류:', e);
    process.exit(1);
  }

  console.log('\n=== 크롤링 완료 ===');
}

main();
