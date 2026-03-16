require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const XLSX = require('xlsx');

// 설정
const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_FILE = path.join(PUBLIC_DIR, 'cleanup_data.json');
const VERSION_FILE = path.join(PUBLIC_DIR, 'cleanup_version.txt');
const EXCEL_URL = 'https://cleanup.seoul.go.kr/cleanup/bsnssttus/lsubBsnsSttusExcel.do';

// 엑셀 다운로드 (POST 요청)
function downloadExcel() {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(__dirname, 'tmp_cleanup.xlsx');

    // POST 폼 데이터 (빈 검색조건 = 전체 데이터)
    const postData = 'orderValue=';

    const url = new URL(EXCEL_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (compatible; SeoulLifeCrawler/1.0)',
        'Referer': 'https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do'
      }
    };

    const protocol = url.protocol === 'https:' ? https : http;

    const req = protocol.request(options, (res) => {
      // 리다이렉트 처리
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, EXCEL_URL);
        const redirectProtocol = redirectUrl.protocol === 'https:' ? https : http;
        redirectProtocol.get(redirectUrl.href, (res2) => {
          const chunks = [];
          res2.on('data', chunk => chunks.push(chunk));
          res2.on('end', () => {
            fs.writeFileSync(tmpFile, Buffer.concat(chunks));
            resolve(tmpFile);
          });
          res2.on('error', reject);
        }).on('error', reject);
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        console.log(`   응답 크기: ${buf.length} bytes, 상태: ${res.statusCode}`);
        fs.writeFileSync(tmpFile, buf);
        resolve(tmpFile);
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 엑셀 파싱
function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  // 첫 행이 빈 행이므로 header를 2번째 행(인덱스 1)으로 지정
  const rows = XLSX.utils.sheet_to_json(sheet, { range: 1 });

  const items = [];
  for (const row of rows) {
    // 엑셀 컬럼명 매핑 (정보몽땅 엑셀 헤더 기준)
    const gu_nm = (row['자치구'] || '').trim();
    const btyp_nm = (row['사업구분'] || '').trim();
    const cafe_nm = (row['사업장명'] || '').trim();
    const reprsnt_jibun = (row['대표지번'] || '').trim();
    const progrs_sttus = (row['진행단계'] || '').trim();

    if (!gu_nm || !cafe_nm) continue;

    items.push({
      gu_nm,
      btyp_nm,
      cafe_nm,
      reprsnt_jibun,
      progrs_sttus,
      x: 0,
      y: 0
    });
  }

  // 임시 파일 삭제
  fs.unlinkSync(filePath);
  return items;
}

// 기존 JSON에서 좌표 이월
function mergeCoords(newItems, existingData) {
  if (!existingData || !existingData.items) return;

  // 대표지번 → 좌표 맵 생성
  const coordMap = {};
  for (const item of existingData.items) {
    if (item.x && item.y && item.reprsnt_jibun) {
      coordMap[item.reprsnt_jibun] = { x: item.x, y: item.y };
    }
  }

  // 좌표 이월
  let mergedCount = 0;
  for (const item of newItems) {
    const coords = coordMap[item.reprsnt_jibun];
    if (coords) {
      item.x = coords.x;
      item.y = coords.y;
      mergedCount++;
    }
  }

  console.log(`좌표 이월: ${mergedCount}/${newItems.length}건`);
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
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// 카카오 주소 검색 API (BusanLife 방식)
function geocodeByAddress(address) {
  const encodedAddr = encodeURIComponent(address);
  const reqPath = `/v2/local/search/address.json?query=${encodedAddr}`;
  return kakaoGet(reqPath);
}

// 카카오 키워드 검색 API (주소 검색 실패 시 폴백)
function geocodeByKeyword(address) {
  const encodedAddr = encodeURIComponent(address);
  const reqPath = `/v2/local/search/keyword.json?query=${encodedAddr}`;
  return kakaoGet(reqPath);
}

// JSON 응답에서 좌표 추출
function extractCoords(json) {
  if (!json.documents || json.documents.length === 0) return null;
  const doc = json.documents[0];
  // 주소 검색: address 객체에서 추출
  if (doc.address) {
    return {
      x: parseFloat(doc.address.y), // 위도
      y: parseFloat(doc.address.x)  // 경도
    };
  }
  // 키워드 검색 또는 address 없는 경우: 최상위 x,y 사용
  return {
    x: parseFloat(doc.y),
    y: parseFloat(doc.x)
  };
}

// 이중 전략: 주소 검색 → 키워드 검색 폴백
async function geocode(address) {
  // 1차: 주소 검색 API
  const addrResult = await geocodeByAddress(address);
  const coords = extractCoords(addrResult);
  if (coords) return coords;

  // 2차: 키워드 검색 API 폴백
  await new Promise(r => setTimeout(r, 100)); // API 간격
  const kwResult = await geocodeByKeyword(address);
  return extractCoords(kwResult);
}

// 좌표 없는 항목에 Geocoding 실행
async function fillMissingCoords(items) {
  const missing = items.filter(item => !item.x || !item.y);
  console.log(`좌표 없는 항목: ${missing.length}건, Geocoding 시작...`);

  let addrCount = 0;   // 주소 검색 성공
  let kwCount = 0;     // 키워드 폴백 성공
  let failCount = 0;

  for (const item of missing) {
    if (!item.reprsnt_jibun) {
      failCount++;
      continue;
    }

    // 지번 주소에 '번지' 붙이기 (예: "개포동 138" → "개포동 138번지", "역삼동 711-1" → "역삼동 711-1번지")
    const jibun = item.reprsnt_jibun;
    const addrJibun = /\d$/.test(jibun) || /\d-\d+$/.test(jibun) ? jibun + '번지' : jibun;
    const address = `서울특별시 ${item.gu_nm} ${addrJibun}`;
    try {
      // 1차: 주소 검색
      const addrResult = await geocodeByAddress(address);
      let coords = extractCoords(addrResult);

      if (coords) {
        item.x = coords.x;
        item.y = coords.y;
        addrCount++;
      } else {
        // 2차: 키워드 검색 폴백
        await new Promise(r => setTimeout(r, 100));
        const kwResult = await geocodeByKeyword(address);
        coords = extractCoords(kwResult);

        if (coords) {
          item.x = coords.x;
          item.y = coords.y;
          kwCount++;
        } else {
          failCount++;
          console.log(`  Geocoding 실패: ${address}`);
        }
      }
    } catch (e) {
      failCount++;
      console.log(`  Geocoding 오류: ${address} - ${e.message}`);
    }

    // API 호출 간격 (초당 10회 제한)
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

  // 진행단계 변경 등 비교
  const existingMap = {};
  for (const item of existingData.items) {
    existingMap[item.reprsnt_jibun + '|' + item.cafe_nm] = item.progrs_sttus;
  }

  for (const item of newItems) {
    const key = item.reprsnt_jibun + '|' + item.cafe_nm;
    if (existingMap[key] !== item.progrs_sttus) return true;
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

  const data = {
    version,
    items
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  fs.writeFileSync(VERSION_FILE, version, 'utf-8');

  console.log(`저장 완료: ${items.length}건, 버전: ${version}`);
}

// 메인 실행
async function main() {
  console.log('=== 정비사업 데이터 크롤링 시작 ===');
  console.log(new Date().toISOString());

  try {
    // 1. 엑셀 다운로드
    console.log('\n1. 엑셀 다운로드...');
    const excelPath = await downloadExcel();
    console.log(`   다운로드 완료: ${excelPath}`);

    // 2. 엑셀 파싱
    console.log('\n2. 엑셀 파싱...');
    const items = parseExcel(excelPath);
    console.log(`   파싱 완료: ${items.length}건`);

    if (items.length === 0) {
      console.log('파싱된 데이터가 없습니다. 종료합니다.');
      return;
    }

    // 3. 기존 좌표 이월
    console.log('\n3. 기존 좌표 이월...');
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
