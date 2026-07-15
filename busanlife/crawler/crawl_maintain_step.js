// 부산 정비사업 단계변동 스냅샷 크롤러
// data.go.kr 부산 정비사업 API에서 (aCode → step) 스냅샷을 받아
// busanlife/maintain_step.json + maintain_step_ver.txt 로 저장한다.
// 이전 스냅샷과 다를 때만 버전을 올린다. 앱은 이 파일을 폴링해
// 관심(★) 등록한 구역의 단계 변동을 감지하고 로컬 알림을 띄운다.
//
// [출처/라이선스] data.go.kr 6260000 MaintenanceBusinessStatus1 (부산광역시 정비사업)
//   이용허락범위 "제한 없음"(상업적 이용 가능)
// [배경] 부산 정비 API는 apis.data.go.kr 표준 80포트 → CF Worker도 가능하나,
//   app-data(GitHub→Pages 정적 서빙)와 일관되게 NCP 크론탭에서 실행한다.
//   서비스키는 앱 APK에 포함된 공개 공공데이터 키라 하드코딩(카카오 등 민감키 없음).

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_KEY = 'OKmkdaDeI4G%2BG21VlIasrID4fUewHcXyP32egt%2Fj%2BAtSYzDuCyTXpOBjo0hIm9c18dj%2F1kSt3WrxUTxnsUTtdw%3D%3D';
const API = `http://apis.data.go.kr/6260000/MaintenanceBusinessStatus1/getMaintenanceBusiness1?ServiceKey=${API_KEY}&numOfRows=2000&resultType=json`;

const OUT_DIR = path.join(__dirname, '..');   // busanlife/
const DATA_FILE = path.join(OUT_DIR, 'maintain_step.json');
const VER_FILE = path.join(OUT_DIR, 'maintain_step_ver.txt');

function fetchText(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// 테스트/쓰레기 레코드 (앱 BusanMaintainOpenApiHelper.java:261-262 와 동일 필터)
function isTest(name) {
  if (name == null) return true;
  const n = String(name).trim();
  if (n === '' || n === '3333' || n === '-') return true;
  if (n.includes('test') || n.includes('테스트')) return true;
  return false;
}

function readVer() {
  try {
    const v = parseInt(fs.readFileSync(VER_FILE, 'utf-8').trim(), 10);
    return isNaN(v) ? 0 : v;
  } catch (e) { return 0; }
}

function loadPrev() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch (e) { return null; }
}

// (aCode→step) 맵이 동일한지 비교 (버전업 여부 판정)
function sameSteps(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

async function main() {
  console.log('=== 부산 정비 단계 스냅샷 크롤링 ===');
  console.log(new Date().toISOString());

  const raw = await fetchText(API);
  if (!raw.trim().startsWith('{')) throw new Error('API 응답이 JSON 아님: ' + raw.slice(0, 200));

  const json = JSON.parse(raw);
  const body = json.response && json.response.body;
  const total = body ? parseInt(body.totalCount || '0', 10) : 0;
  if (!total) { console.log('totalCount 0 → 종료(기존 데이터 유지)'); process.exit(1); }

  const arr = body.items.item;
  const items = [];
  const stepMap = {};
  for (const it of arr) {
    const name = (it.areaName || '').trim();
    if (isTest(name)) continue;                 // 테스트 레코드 제거(알림 오염 방지)
    const aCode = it.aCode;
    const step = (it.step || '').trim();
    if (!aCode || !step) continue;
    items.push({ aCode, name: name || (it.location || '').trim(), step });
    stepMap[aCode] = step;
  }
  console.log(`유효 ${items.length}건 (전체 ${total})`);

  // 수집 누락 방어: 전체의 90% 미만이면 저장 중단(기존 보존)
  if (items.length < total * 0.9) { console.log('수집량 부족(90% 미만) → 저장 중단'); process.exit(1); }

  // 이전 스냅샷과 비교 → 단계 변동 있을 때만 버전업
  const prev = loadPrev();
  const prevSteps = {};
  if (prev && Array.isArray(prev.items)) for (const it of prev.items) prevSteps[it.aCode] = it.step;

  if (sameSteps(stepMap, prevSteps)) {
    console.log('단계 변동 없음 → 저장 건너뜀.');
    return;
  }

  const version = readVer() + 1;
  const payload = { generated: new Date().toISOString(), version, count: items.length, items };
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  fs.writeFileSync(VER_FILE, String(version), 'utf-8');
  console.log(`저장 완료: ${items.length}건, 버전 ${version}`);
}

main().catch(e => { console.error('크롤링 오류:', e); process.exit(1); });
