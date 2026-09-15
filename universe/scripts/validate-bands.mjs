#!/usr/bin/env node
// 탐험 탭 띠 데이터 검증 — bands.json + band-*.json 전수.
// 사용: node universe/scripts/validate-bands.mjs [--scenes <assets/bands 디렉토리>]
//   --scenes 를 주면 그 디렉토리의 scene-*.html 로 씬 목록을 만들고, 없으면 아래 하드코딩 목록을 쓴다.
// 위반을 전부 나열하고 0건이면 exit 0, 있으면 exit 1. 의존성 0 (Node 18+).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BANDS_DIR = join(HERE, '..', 'bands');
const LANGS = ['en', 'ja', 'es', 'de', 'zh-TW', 'pt-BR'];
const TYPES = new Set(['object', 'diagram', 'process']);
const IMAGE_KEYS = ['image', 'imageCredit', 'imageLicense', 'imageSourceUrl'];

// 앱에 번들된 씬 (Android app/src/main/assets/bands · iOS web/bands, 2026-09-15 기준 30개)
// scene-black-hole 은 Android 1.4.3 · iOS 2.5 부터 번들 — 그 이전 버전은 빈 화면(에셋 가드도 없음)
const KNOWN_SCENES = [
  'scene-agn', 'scene-binary-transfer', 'scene-black-hole', 'scene-cluster-cmd', 'scene-density-wave', 'scene-earth-birth',
  'scene-electromagnetism', 'scene-four-forces', 'scene-galaxy-collision', 'scene-gw-replay', 'scene-hr-diagram',
  'scene-hubble-fork', 'scene-interior', 'scene-ism-cycle', 'scene-ism', 'scene-kilonova', 'scene-large-scale',
  'scene-life-origin', 'scene-lookback', 'scene-neutrino-race', 'scene-nucleus', 'scene-periodic',
  'scene-protoplanetary', 'scene-remnants', 'scene-rotation-curve', 'scene-scale-dive', 'scene-spacetime',
  'scene-stars', 'scene-stellar-life', 'scene-supernova',
];

function sceneSet() {
  const i = process.argv.indexOf('--scenes');
  if (i < 0) return new Set(KNOWN_SCENES);
  const dir = process.argv[i + 1];
  return new Set(readdirSync(dir).filter((f) => /^scene-.*\.html$/.test(f)).map((f) => f.slice(0, -5)));
}

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

function checkI18n(where, base, map, field) {
  if (!isStr(base)) err(where, `${field} 비어 있음`);
  if (!map || typeof map !== 'object') { err(where, `${field}I18n 없음`); return; }
  for (const l of LANGS) if (!isStr(map[l])) err(where, `${field}I18n.${l} 누락/빈값`);
}

const scenes = sceneSet();
const bandsJson = JSON.parse(readFileSync(join(BANDS_DIR, 'bands.json'), 'utf8'));
const orders = new Map();
const summary = [];

// relatedCross 대상 해석용 — 원격 띠 id → (항목 id → type). 파일을 먼저 전부 읽는다.
const itemsByBand = new Map();
for (const band of bandsJson.bands) {
  if (band.source === 'native') continue;
  const p = join(BANDS_DIR, band.source);
  if (existsSync(p)) {
    itemsByBand.set(band.id, new Map(JSON.parse(readFileSync(p, 'utf8')).items.map((it) => [it.id, it.type])));
  }
}

for (const band of bandsJson.bands) {
  const where = `bands.json[${band.id}]`;
  if (orders.has(band.order)) err(where, `order ${band.order} 중복 (${orders.get(band.order)})`);
  orders.set(band.order, band.id);
  checkI18n(where, band.name, band.nameI18n, 'name');
  if (band.source === 'native') continue;

  const path = join(BANDS_DIR, band.source);
  if (!existsSync(path)) { err(where, `source 파일 없음: ${band.source}`); continue; }
  const file = JSON.parse(readFileSync(path, 'utf8'));
  const fw = band.source;
  if (file.bandId !== band.id) err(fw, `bandId "${file.bandId}" ≠ bands.json id "${band.id}"`);

  const ids = new Set();
  for (const it of file.items) {
    if (ids.has(it.id)) err(fw, `id 중복: ${it.id}`);
    ids.add(it.id);
  }

  let objects = 0, featured = 0;
  for (const it of file.items) {
    const w = `${fw}#${it.id}`;
    if (!TYPES.has(it.type)) err(w, `type "${it.type}" 알 수 없음`);
    // featured 카드는 bandId 를 생략해도 된다(라우팅이 현재 띠로 폴백). 있으면 일치해야 한다.
    if (it.bandId !== undefined && it.bandId !== file.bandId) err(w, `bandId "${it.bandId}" ≠ 파일 "${file.bandId}"`);
    checkI18n(w, it.name, it.nameI18n, 'name');
    checkI18n(w, it.summary, it.summaryI18n, 'summary');
    if (it.scene !== undefined && !scenes.has(it.scene)) err(w, `scene "${it.scene}" 이 번들 씬 목록에 없음`);
    if (it.note !== undefined) checkI18n(w, it.note, it.noteI18n, 'note');

    // relatedCross {band, id} — 탭하면 그 띠의 object 백과로 간다. featured 는 씬 직행이라 렌더되지 않는다.
    if (it.relatedCross !== undefined && it.type !== 'object') err(w, 'relatedCross 는 object 백과에서만 렌더됨 (featured 는 씬 직행)');
    for (const ref of it.relatedCross ?? []) {
      const target = itemsByBand.get(ref?.band);
      if (!target) err(w, `relatedCross band "${ref?.band}" 가 원격 띠 목록에 없음`);
      else if (ref.band === file.bandId) err(w, `relatedCross "${ref.id}" 는 같은 띠 — related 로 쓸 것`);
      else if (!target.has(ref.id)) err(w, `relatedCross "${ref.band}/${ref.id}" 대상 항목 없음`);
      else if (target.get(ref.id) !== 'object') err(w, `relatedCross "${ref.band}/${ref.id}" 가 object 가 아님`);
    }

    if (it.facts) {
      for (const l of LANGS) {
        const rows = it.factsI18n?.[l];
        if (!rows) err(w, `factsI18n.${l} 누락`);
        else if (rows.length !== it.facts.length) err(w, `factsI18n.${l} ${rows.length}행 ≠ facts ${it.facts.length}행`);
      }
    }

    if (it.type === 'object') {
      objects++;
      if (it.bandId === undefined) err(w, 'object 인데 bandId 없음 (탭 라우팅이 item.bandId 를 쓴다)');
      for (const rid of it.related ?? []) {
        if (!ids.has(rid)) err(w, `related "${rid}" 가 같은 파일 안에 없음 (조용히 사라짐)`);
      }
      const has = IMAGE_KEYS.filter((k) => it[k] !== undefined);
      if (has.length !== 0 && has.length !== IMAGE_KEYS.length) err(w, `image 4필드 불완전: ${has.join(',')}`);
      if (!isStr(it.wiki?.en)) err(w, 'wiki.en 없음');
    } else if (it.featured) {
      featured++;
    }
  }
  summary.push(`${band.id.padEnd(12)} v${String(file.version).padEnd(3)} featured ${featured} · object ${objects}`);
}

console.log(summary.join('\n'));
if (errors.length) {
  console.error(`\n위반 ${errors.length}건:`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`\n위반 0건 (씬 목록 ${scenes.size}개 기준)`);
