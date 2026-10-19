#!/usr/bin/env node
// infographic/hub.json(정본) → <앱>/infographic.json(생성물)
//
//   node infographic/scripts/build.js                  검증 + 생성(바뀐 파일만 쓴다)
//   node infographic/scripts/build.js --check          검증 + 생성물이 정본과 같은지 확인 — 쓰지 않는다. push 전에 돌린다(어긋나면 종료코드 1)
//   node infographic/scripts/build.js --preview <앱>   한 앱의 결과를 출력
//
// 규칙은 infographic/CLAUDE.md. 외부 패키지 없음(Node 18+).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HUB = path.join(ROOT, 'infographic', 'hub.json');
const SCHEMA_VERSION = 1;              // 올리지 않는다 — 올리면 구버전 앱 전체가 숨는다
const BASE = 'https://chart.boolint.com/';
const OUT_NAME = 'infographic.json';
const GENERATED_NOTE = 'infographic/hub.json 에서 infographic/scripts/build.js 가 만든 파일 — 직접 고치지 말 것(다음 빌드에 덮인다). 끄려면 hub.json 의 enabled(전체) 또는 apps.<앱>.enabled 를 false 로 하고 다시 빌드. 이 파일을 지우면 안 된다(404 면 앱이 직전 캐시를 유지해 메뉴가 남는다)';

const errors = [];
const fail = (msg) => errors.push(msg);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ── 정본 읽기 ───────────────────────────────────────────────
function loadHub() {
  let text;
  try {
    text = fs.readFileSync(HUB, 'utf8');
  } catch (e) {
    fail(`hub.json 을 읽을 수 없다: ${e.message}`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`hub.json 문법 오류: ${e.message}`);
    return null;
  }
}

// ── 검증 ───────────────────────────────────────────────────
function validate(hub) {
  const TOP = ['schemaVersion', '_comment', 'enabled', 'base', 'cards', 'apps'];
  for (const k of Object.keys(hub)) if (!TOP.includes(k)) fail(`모르는 최상위 키: ${k}`);
  if (hub.schemaVersion !== SCHEMA_VERSION) {
    fail(`schemaVersion 은 ${SCHEMA_VERSION} 고정(올리면 업데이트 안 한 앱 전체가 숨는다): ${hub.schemaVersion}`);
  }
  if (typeof hub.enabled !== 'boolean') fail('enabled 는 true/false 여야 한다');
  if (hub.base !== BASE) fail(`base 는 ${BASE} 고정: ${hub.base}`);

  // 카드 카탈로그
  if (!isPlainObj(hub.cards) || Object.keys(hub.cards).length === 0) {
    fail('cards 가 비었다');
  } else {
    const CARD_KEYS = ['icon', 'title', 'subtitle', 'path'];
    for (const [id, c] of Object.entries(hub.cards)) {
      if (!/^[a-z0-9-]+$/.test(id)) fail(`카드 id 는 소문자·숫자·하이픈만: ${id}`);
      if (!isPlainObj(c)) { fail(`카드 ${id}: 객체여야 한다`); continue; }
      for (const k of Object.keys(c)) if (!CARD_KEYS.includes(k)) fail(`카드 ${id}: 모르는 키 ${k}`);
      for (const k of CARD_KEYS) if (!isStr(c[k])) fail(`카드 ${id}: ${k} 가 비었다`);
      if (!isStr(c.path)) continue;
      const p = c.path;
      if (p.includes('#')) fail(`카드 ${id}: path 에 # 금지 — 앱이 ?sgg= 를 끝에 붙이면 해시 뒤로 들어가 지역 선택이 무시된다: ${p}`);
      if (p.startsWith('/') || p.includes('://')) fail(`카드 ${id}: path 는 base 뒤에 붙는 상대 경로: ${p}`);
      if (/\.html?(\?|$)/.test(p)) fail(`카드 ${id}: 확장자 없이 쓴다(.html 은 308 이 한 번 더 붙는다): ${p}`);
      if (/[?&](sido|sgg)=/.test(p)) fail(`카드 ${id}: sido·sgg 는 path 에 넣지 않는다(sido 는 앱 항목, sgg 는 앱이 붙인다): ${p}`);
      if (/\s/.test(p)) fail(`카드 ${id}: path 에 공백: ${p}`);
    }
  }

  // 앱별 구성
  if (!isPlainObj(hub.apps) || Object.keys(hub.apps).length === 0) {
    fail('apps 가 비었다');
  } else {
    const APP_KEYS = ['cards', 'sido', 'enabled', '_comment'];
    for (const [key, app] of Object.entries(hub.apps)) {
      if (!/^[a-z0-9]+$/.test(key)) fail(`앱 키는 소문자·숫자만(app-data 폴더명 = SelfBanner v2 apps 키): ${key}`);
      if (!isPlainObj(app)) { fail(`앱 ${key}: 객체여야 한다`); continue; }
      for (const k of Object.keys(app)) if (!APP_KEYS.includes(k)) fail(`앱 ${key}: 모르는 키 ${k}`);
      if (!Array.isArray(app.cards) || app.cards.length === 0) {
        fail(`앱 ${key}: cards 는 1장 이상(끄려면 enabled:false)`);
      } else {
        const seen = new Set();
        for (const id of app.cards) {
          if (!isStr(id) || !hub.cards || !hub.cards[id]) fail(`앱 ${key}: 모르는 카드 ${id}`);
          if (seen.has(id)) fail(`앱 ${key}: 카드 중복 ${id}`);
          seen.add(id);
        }
      }
      if (app.sido !== undefined && !/^\d{2}$/.test(String(app.sido))) fail(`앱 ${key}: sido 는 시도 코드 2자리 문자열: ${app.sido}`);
      if (app.enabled !== undefined && typeof app.enabled !== 'boolean') fail(`앱 ${key}: enabled 는 true/false`);
      if (app._comment !== undefined && !isStr(app._comment)) fail(`앱 ${key}: _comment 는 문자열`);
    }
  }
}

// ── 생성 ───────────────────────────────────────────────────
function render(hub, key) {
  const app = hub.apps[key];
  const enabled = hub.enabled && app.enabled !== false;
  const cards = app.cards.map((id) => {
    const c = hub.cards[id];
    let url = hub.base + c.path;
    if (app.sido) url += (url.includes('?') ? '&' : '?') + 'sido=' + app.sido;
    return { id, icon: c.icon, title: c.title, subtitle: c.subtitle, url };
  });
  return { schemaVersion: SCHEMA_VERSION, _generated: GENERATED_NOTE, enabled, cards };
}

const toText = (obj) => JSON.stringify(obj, null, 2) + '\n';
const outPath = (key) => path.join(ROOT, key, OUT_NAME);

/** apps 에 없는데 <폴더>/infographic.json 이 있는 폴더 — 키를 지운 흔적. 지우면 404 라 금지 */
function orphans(hub) {
  const list = [];
  for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'infographic') continue;
    if (fs.existsSync(path.join(ROOT, d.name, OUT_NAME)) && !hub.apps[d.name]) list.push(d.name);
  }
  return list;
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

// ── 실행 ───────────────────────────────────────────────────
function main(argv) {
  const check = argv.includes('--check');
  const previewAt = argv.indexOf('--preview');
  const preview = previewAt >= 0 ? argv[previewAt + 1] : null;

  const hub = loadHub();
  if (hub) validate(hub);
  if (hub && !errors.length) for (const o of orphans(hub)) {
    fail(`${o}/${OUT_NAME} 이 있는데 hub.json apps 에 ${o} 가 없다 — 키를 지우지 말고 enabled:false 로(파일이 404 면 메뉴가 남는다)`);
  }
  if (errors.length) {
    for (const e of errors) console.error('✗ ' + e);
    console.error(`\n검증 실패 ${errors.length}건`);
    process.exit(1);
  }

  if (preview) {
    if (!hub.apps[preview]) { console.error(`✗ 모르는 앱: ${preview}`); process.exit(1); }
    process.stdout.write(toText(render(hub, preview)));
    return;
  }

  let changed = 0;
  const drift = [];
  for (const key of Object.keys(hub.apps)) {
    const expected = toText(render(hub, key));
    const p = outPath(key);
    const current = readIfExists(p);
    const state = current === null ? '생성' : current === expected ? '같음' : '갱신';
    const app = hub.apps[key];
    const on = hub.enabled && app.enabled !== false;
    console.log(`${state.padEnd(2)}  ${key.padEnd(17)} ${on ? '노출' : '숨김'}  카드 ${app.cards.length}장${app.sido ? `  sido=${app.sido}` : ''}`);
    if (state === '같음') continue;
    if (check) { drift.push(key); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, expected);
    changed++;
  }

  if (check) {
    if (drift.length) {
      console.error(`\n✗ 생성물이 정본과 다르다(${drift.join(', ')}) — node infographic/scripts/build.js 를 돌린 뒤 push`);
      process.exit(1);
    }
    console.log(`\n✓ 검증 통과, 생성물 ${Object.keys(hub.apps).length}개가 정본과 같다${hub.enabled ? '' : ' (전체 숨김 상태)'}`);
    return;
  }
  console.log(`\n✓ 검증 통과, ${changed}개 파일 씀${hub.enabled ? '' : ' (전체 숨김 상태)'}`);
}

main(process.argv.slice(2));
