// 서울 재개발·재건축(정비사업) 데이터 크롤러
// 서울 열린데이터광장 TbSeoulRedevStatus OpenAPI에서 정비구역 통계를 받아
// public/cleanup_data.json + cleanup_version.txt 로 저장한다.
//
// [출처/라이선스] 데이터셋 OA-22856 "서울특별시 도시정비사업 통계"
//   - 서비스명 TbSeoulRedevStatus, 공공누리 제1유형(출처표시) → 상업적 이용·변경 가능
//   - 호출: http://openapi.seoul.go.kr:8088/{인증키}/json/TbSeoulRedevStatus/{start}/{end}/
//   - 출처표시: "서울특별시 도시정비사업 통계, 서울 열린데이터광장(data.seoul.go.kr)"
//
// 이력: 2026-06-06 정보몽땅 엑셀(공공누리 제4유형, 상업금지)로 수집 중단했으나,
//       2026-07-16 제1유형 OA-22856(상업이용 가능)로 소스 교체·재개.
//       앱 CleanupDataHelper 는 gu_nm/btyp_nm/cafe_nm/reprsnt_jibun/progrs_sttus/x/y 키를
//       그대로 파싱하므로 출력 스키마(7키 + sum_bildng_co)를 유지한다.
//       2026-07-18 관심(즐겨찾기) 고유키용 bsns_pk(원천 CODE, 472건 전부 고유) 추가.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// 설정
const API_KEY = '786e78784a77696e3832525a6c7648'; // 서울 열린데이터 인증키 (앱/건설 크롤러와 동일)
const BASE_API = `http://openapi.seoul.go.kr:8088/${API_KEY}/json/TbSeoulRedevStatus`;
const CHUNK = 1000;          // OpenAPI 1회 최대 행수 (전체 ~472라 단일 청크지만 안전상 루프 유지)
const RETRY = 3;             // 청크별 재시도 횟수

const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_FILE = path.join(PUBLIC_DIR, 'cleanup_data.json');
const VERSION_FILE = path.join(PUBLIC_DIR, 'cleanup_version.txt');
const OVERRIDE_FILE = path.join(__dirname, 'coords_override.json');

// 지번주소 정규화용(앞에 자치구명이 붙는 행 처리)
const SEOUL_GU = ['종로구','중구','용산구','성동구','광진구','동대문구','중랑구','성북구','강북구','도봉구','노원구','은평구','서대문구','마포구','양천구','강서구','구로구','금천구','영등포구','동작구','관악구','서초구','강남구','송파구','강동구'];

// PositionSeoulHelper 좌표 데이터
// 키: "대표지번" (reprsnt_jibun)
const POSITION_SEOUL = JSON.parse(fs.readFileSync(path.join(__dirname, 'position_seoul.json'), 'utf-8'));

// HTTP GET (텍스트) — 타임아웃 포함 (crawl_construct.js 와 동일 패턴)
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

// 지번주소 정규화: 앞에 자치구명이 붙어 있으면 제거(예 "양천구목동903" → "목동903"),
// 앞뒤 공백 정리. (표시용 zone_adres 및 좌표키·지오코딩 주소 조립에 사용)
function normalizeJibun(gu, raw) {
  let s = (raw || '').toString().trim();
  if (gu && s.startsWith(gu)) s = s.slice(gu.length).trim();
  return s;
}

// 정수 파싱(콤마 등 제거)
function toInt(v) {
  const n = parseInt((v == null ? '' : v).toString().replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// API row → 앱 스키마 항목 (7키 + 세대수). _road 는 지오코딩 폴백용(저장 전 제거)
function mapRow(r) {
  const gu = (r.DISTRICT || '').trim();
  let road = (r.ROAD_ADDR || '').trim();
  if (road === '-') road = '';
  return {
    bsns_pk: (r.CODE || '').trim(),             // 사업코드(원천 CODE) → 앱 관심 고유키. 472건 전부 고유·빈값 0
    gu_nm: gu,
    btyp_nm: (r.BIZ_TYPE || '').trim(),
    cafe_nm: (r.ZONE_NM || '').trim(),          // 구역명 (앱에서 zone_nm=cafe_nm → 리스트 제목)
    reprsnt_jibun: normalizeJibun(gu, r.JIBUN_ADDR),
    progrs_sttus: (r.BIZ_STAGE || '').trim(),    // 단계명(정렬은 앱 AppConst.getProgressStatusIndex 확장)
    sum_bildng_co: toInt(r.TOT_BUILT_HOUSEHOLDS),// 건립세대수 총합 → 앱 세대수 표시/정렬
    x: 0,
    y: 0,
    _road: normalizeJibun(gu, road)
  };
}

// 전체 건수 조회
async function fetchTotalCount() {
  const txt = await fetchText(`${BASE_API}/1/2/`);
  const d = JSON.parse(txt);
  const body = d.TbSeoulRedevStatus || {};
  return body.list_total_count || 0;
}

// 청크 1개 받기 (JSON, 재시도 포함)
async function fetchChunk(start, end) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY; attempt++) {
    try {
      const txt = await fetchText(`${BASE_API}/${start}/${end}/`);
      let d;
      try { d = JSON.parse(txt); } catch (e) { throw new Error('JSON 파싱 실패'); }
      const body = d.TbSeoulRedevStatus;
      const result = (body && body.RESULT) ? body.RESULT : (d.RESULT || null);
      if (result && result.CODE && result.CODE !== 'INFO-000') {
        throw new Error('API 오류: ' + result.CODE + ' ' + (result.MESSAGE || ''));
      }
      const rows = (body && Array.isArray(body.row)) ? body.row : [];
      console.log(`  [${start}-${end}] ${rows.length}건 (시도 ${attempt})`);
      return rows.map(mapRow);
    } catch (e) {
      lastErr = e;
      console.log(`  [${start}-${end}] 실패(시도 ${attempt}): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

// coords_override.json에서 수동 좌표 적용
function applyOverrides(items) {
  try {
    if (!fs.existsSync(OVERRIDE_FILE)) return 0;
    const overrides = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf-8'));
    const seoulOverrides = overrides.seoul || [];
    const overrideMap = {};
    for (const o of seoulOverrides) {
      if (o.x && o.y) overrideMap[o.key] = { x: o.x, y: o.y };
    }
    let count = 0;
    for (const item of items) {
      const coords = overrideMap[item.reprsnt_jibun];
      if (coords) {
        item.x = coords.x;
        item.y = coords.y;
        count++;
      }
    }
    return count;
  } catch (e) {
    console.log('coords_override 로드 실패:', e.message);
    return 0;
  }
}

// PositionSeoul 좌표 매칭 + 기존 JSON 이월
function mergeCoords(newItems, existingData) {
  const existingCoordMap = {};
  if (existingData && existingData.items) {
    for (const item of existingData.items) {
      if (item.reprsnt_jibun) {
        existingCoordMap[item.reprsnt_jibun] = { x: item.x || 0, y: item.y || 0 };
      }
    }
  }

  let positionCount = 0; // PositionSeoul 매칭
  let existingCount = 0; // 기존 JSON 이월 (좌표 있음)
  let skippedCount = 0;  // 기존 JSON 이월 (이전 실패)
  let missingCount = 0;

  for (const item of newItems) {
    // 0순위: coords_override에서 이미 좌표가 적용된 항목은 건너뜀
    if (item.x && item.y) continue;

    // 1순위: PositionSeoul 하드코딩 좌표
    if (POSITION_SEOUL[item.reprsnt_jibun]) {
      item.x = POSITION_SEOUL[item.reprsnt_jibun][0];
      item.y = POSITION_SEOUL[item.reprsnt_jibun][1];
      positionCount++;
    }
    // 2순위: 기존 JSON 이월
    else if (existingCoordMap[item.reprsnt_jibun]) {
      item.x = existingCoordMap[item.reprsnt_jibun].x;
      item.y = existingCoordMap[item.reprsnt_jibun].y;
      if (item.x && item.y) existingCount++;
      else skippedCount++;
      item._geocoded = true; // 이미 처리된 항목 표시
    }
    else {
      missingCount++;
    }
  }

  console.log(`좌표 매칭: PositionSeoul ${positionCount}, 기존이월 ${existingCount}, 이전실패 ${skippedCount}, 신규 ${missingCount}건`);
}

// 카카오 API 공통 GET 요청
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

function geocodeByAddress(address) {
  return kakaoGet(`/v2/local/search/address.json?query=${encodeURIComponent(address)}`);
}

function geocodeByKeyword(address) {
  return kakaoGet(`/v2/local/search/keyword.json?query=${encodeURIComponent(address)}`);
}

// JSON 응답에서 좌표 추출 (x=위도, y=경도)
function extractCoords(json) {
  if (!json || !json.documents || json.documents.length === 0) return null;
  const doc = json.documents[0];
  if (doc.address) {
    return { x: parseFloat(doc.address.y), y: parseFloat(doc.address.x) };
  }
  return { x: parseFloat(doc.y), y: parseFloat(doc.x) };
}

// 한 주소 문자열을 주소검색→키워드검색 순으로 지오코딩
async function geocodeAddress(address) {
  const addrResult = await geocodeByAddress(address);
  let coords = extractCoords(addrResult);
  if (coords) return { coords, via: '주소' };
  await new Promise(r => setTimeout(r, 100));
  const kwResult = await geocodeByKeyword(address);
  coords = extractCoords(kwResult);
  if (coords) return { coords, via: '키워드' };
  return null;
}

// 좌표 없는 신규 항목에만 Geocoding 실행 (이미 시도한 항목 제외)
// 1차: 지번주소, 2차(실패 시): 도로명주소
async function fillMissingCoords(items) {
  const missing = items.filter(item => (!item.x || !item.y) && !item._geocoded);
  const skipped = items.filter(item => (!item.x || !item.y) && item._geocoded).length;
  console.log(`좌표 없는 항목: ${missing.length}건 Geocoding, ${skipped}건 이전실패 건너뜀`);

  let okCount = 0;
  let roadCount = 0;
  let failCount = 0;

  for (const item of missing) {
    const jibun = item.reprsnt_jibun;
    let hit = null;

    if (jibun) {
      const addrJibun = /\d$/.test(jibun) || /\d-\d+$/.test(jibun) ? jibun + '번지' : jibun;
      try {
        hit = await geocodeAddress(`서울특별시 ${item.gu_nm} ${addrJibun}`);
      } catch (e) { /* 다음 폴백 */ }
    }

    // 지번 실패 시 도로명주소 폴백
    if (!hit && item._road) {
      await new Promise(r => setTimeout(r, 100));
      try {
        const rhit = await geocodeAddress(`서울특별시 ${item.gu_nm} ${item._road}`);
        if (rhit) { hit = rhit; hit.via = '도로명'; }
      } catch (e) { /* fall through */ }
    }

    if (hit && hit.coords && isFinite(hit.coords.x) && isFinite(hit.coords.y)) {
      item.x = hit.coords.x;
      item.y = hit.coords.y;
      if (hit.via === '도로명') roadCount++; else okCount++;
    } else {
      failCount++;
      console.log(`  Geocoding 실패: ${item.gu_nm} ${jibun || item._road || '(주소없음)'}`);
    }

    await new Promise(r => setTimeout(r, 150)); // API 호출 간격
  }

  console.log(`Geocoding 완료: 지번/키워드 ${okCount}, 도로명폴백 ${roadCount}, 실패 ${failCount}`);
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

// 데이터 변경 확인 (건수 / 진행단계 / 세대수 변화)
function hasChanges(newItems, existingData) {
  if (!existingData || !existingData.items) return true;
  if (newItems.length !== existingData.items.length) return true;

  // 스키마 마이그레이션: 기존 JSON에 bsns_pk가 없으면 강제 저장(관심 고유키 신규 도입 1회)
  if (existingData.items.length > 0 && !existingData.items[0].bsns_pk) return true;

  const existingMap = {};
  for (const item of existingData.items) {
    existingMap[item.reprsnt_jibun + '|' + item.cafe_nm] = item.progrs_sttus + '|' + (item.sum_bildng_co || 0);
  }
  for (const item of newItems) {
    const key = item.reprsnt_jibun + '|' + item.cafe_nm;
    if (existingMap[key] !== item.progrs_sttus + '|' + (item.sum_bildng_co || 0)) return true;
  }
  return false;
}

// 결과 저장 (버전 +1)
function saveResults(items) {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  let version = 1;
  try {
    if (fs.existsSync(VERSION_FILE)) {
      version = parseInt(fs.readFileSync(VERSION_FILE, 'utf-8').trim(), 10) + 1;
      if (isNaN(version)) version = 1;
    }
  } catch (e) {
    version = 1;
  }

  // 내부 플래그/임시필드 제거 후 저장
  items.forEach(item => { delete item._geocoded; delete item._road; });

  fs.writeFileSync(DATA_FILE, JSON.stringify({ items }, null, 2), 'utf-8');
  fs.writeFileSync(VERSION_FILE, String(version), 'utf-8');

  console.log(`저장 완료: ${items.length}건, 버전: ${version}`);
}

// 메인 실행
async function main() {
  console.log('=== 서울 정비사업(OA-22856 / TbSeoulRedevStatus) 크롤링 시작 ===');
  console.log(new Date().toISOString());

  try {
    // 1. 전체 건수
    console.log('\n1. 전체 건수 조회...');
    const total = await fetchTotalCount();
    console.log(`   전체 건수: ${total}`);
    if (!total) {
      console.log('전체 건수 0. 종료합니다.');
      return;
    }

    // 2. 청크 수집
    console.log('\n2. 데이터 수집...');
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

    // 3. 수동 좌표 오버라이드
    console.log('\n3. 수동 좌표 오버라이드...');
    const overrideCount = applyOverrides(items);
    console.log(`   오버라이드 적용: ${overrideCount}건`);

    // 4. 좌표 매칭 (PositionSeoul + 기존 JSON 이월)
    console.log('\n4. 좌표 매칭...');
    const existingData = loadExistingData();
    mergeCoords(items, existingData);

    // 5. 누락 좌표 Geocoding
    if (KAKAO_API_KEY) {
      console.log('\n5. 누락 좌표 Geocoding...');
      await fillMissingCoords(items);
    } else {
      console.log('\n5. KAKAO_REST_API_KEY 미설정, Geocoding 건너뜀');
    }

    // 6. 변경 확인 및 저장
    console.log('\n6. 변경 확인...');
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
