#!/usr/bin/env node
// LifeGrid app-data 검증 — push 전 반드시: node lifegrid/scripts/validate.mjs  (실패면 exit 1)
// 앱(Android RemoteData.parseEvents · RemoteDataTest)과 같은 규칙이어야 한다. 여기가 정본.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const errs = [];
const E = (m) => errs.push(m);
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const hex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
const ID = /^[a-z][a-z0-9_]{1,23}$/;
const nameOk = (n) => n && typeof n.ko === 'string' && n.ko.length >= 1 && n.ko.length <= 12;
const daysBetween = (m1, d1, m2, d2) => { const a = Date.UTC(2001, m1 - 1, d1), b0 = Date.UTC(2001, m2 - 1, d2); const b = b0 < a ? Date.UTC(2002, m2 - 1, d2) : b0; return (b - a) / 86400000; };
const TYPES = ['weekday', 'date', 'lunar', 'birthday', 'range'];
const CALENDARS = ['ko', 'zh'];

// events.json — regions · packs · events
try {
  const ev = read('events.json');
  if (ev.schemaVersion !== 1) E('events: schemaVersion != 1');
  // packs
  const packIds = new Set();
  if (!Array.isArray(ev.packs) || ev.packs.length === 0) E('packs: 배열(1개 이상)');
  for (const p of ev.packs || []) {
    if (!ID.test(p.id || '')) E(`packs[${p.id}]: id 형식`);
    if (packIds.has(p.id)) E(`packs[${p.id}]: id 중복`); packIds.add(p.id);
    if (!nameOk(p.name)) E(`packs[${p.id}]: name.ko 1~12자`);
  }
  // regions
  if (!ev.regions || typeof ev.regions !== 'object' || !ev.regions.KR) E('regions: 객체 + KR 필수');
  for (const [code, r] of Object.entries(ev.regions || {})) {
    const tag = `regions[${code}]`;
    if (!/^([A-Z]{2}|\*)$/.test(code)) E(`${tag}: 코드는 대문자 2자 또는 *`);
    if (!nameOk(r.name)) E(`${tag}: name.ko`);
    if (!Array.isArray(r.weekend) || r.weekend.length < 1 || r.weekend.length > 3 || r.weekend.some(d => !Number.isInteger(d) || d < 0 || d > 6)) E(`${tag}: weekend 0~6 1~3개`);
    if (!CALENDARS.includes(r.lunar)) E(`${tag}: lunar ko|zh`);
    if (r.lifetable !== undefined && !/^[a-z0-9_\/-]+\.json$/.test(r.lifetable)) E(`${tag}: lifetable 파일명`);
    if (!Array.isArray(r.packs) || r.packs.length === 0 || r.packs.some(p => !packIds.has(p))) E(`${tag}: packs 는 packs 의 id 만`);
  }
  // events
  if (!Array.isArray(ev.events) || ev.events.length === 0 || ev.events.length > 200) E('events: 1~200개');
  const ids = new Set();
  const mdOk = (m, d) => Number.isInteger(m) && m >= 1 && m <= 12 && Number.isInteger(d) && d >= 1 && d <= 31;
  for (const e of ev.events || []) {
    const tag = `events[${e.id}]`;
    if (!ID.test(e.id || '')) E(`${tag}: id 형식`);
    if (ids.has(e.id)) E(`${tag}: id 중복`); ids.add(e.id);
    if (!nameOk(e.name)) E(`${tag}: name.ko 1~12자`);
    if (!packIds.has(e.pack)) E(`${tag}: pack ${e.pack} 없음`);
    if (!['weekday', 'holiday', 'season', 'anniv'].includes(e.group)) E(`${tag}: group`);
    if (!hex(e.color)) E(`${tag}: color hex`);
    if (typeof e.defaultOn !== 'boolean' || typeof e.enabled !== 'boolean') E(`${tag}: defaultOn/enabled boolean`);
    if (e.calendar !== undefined && (e.type !== 'lunar' || !CALENDARS.includes(e.calendar))) E(`${tag}: calendar 는 lunar 에만, ko|zh`);
    // 커스텀형과 같은 확장 필드(앱 EventDef 와 같은 규칙): N년마다 · 처음 해 · 상한 나이 · 창 여러 개
    if (e.everyYears !== undefined && (!Number.isInteger(e.everyYears) || e.everyYears < 1 || e.everyYears > 10)) E(`${tag}: everyYears 1~10`);
    if (e.anchorYear !== undefined && (!Number.isInteger(e.anchorYear) || e.anchorYear < 1900 || e.anchorYear > 2200)) E(`${tag}: anchorYear 1900~2200`);
    if (e.untilAge !== undefined && (!Number.isInteger(e.untilAge) || e.untilAge < 1 || e.untilAge > 120)) E(`${tag}: untilAge 1~120`);
    if (e.windows !== undefined) {
      if (e.type !== 'range' || !Array.isArray(e.windows) || e.windows.length < 1 || e.windows.length > 3) E(`${tag}: windows 는 range 에만, 1~3개`);
      else for (const w of e.windows) if (!Array.isArray(w) || w.length !== 4 || !mdOk(w[0], w[1]) || !mdOk(w[2], w[3]) || daysBetween(w[0], w[1], w[2], w[3]) > 120) E(`${tag}: windows 항목 [m1,d1,m2,d2] 120일 이하`);
    }
    switch (e.type) {
      case 'weekday': if (!Number.isInteger(e.dow) || e.dow < 0 || e.dow > 6) E(`${tag}: dow 0~6`); break;
      case 'date': if (!mdOk(e.m, e.d)) E(`${tag}: m/d`); break;
      case 'lunar': if (!Number.isInteger(e.lm) || e.lm < 1 || e.lm > 12 || !Number.isInteger(e.ld) || e.ld < 1 || e.ld > 30) E(`${tag}: lm/ld`); break;
      case 'birthday': break;
      case 'range': {
        if (!mdOk(e.m1, e.d1) || !mdOk(e.m2, e.d2)) E(`${tag}: m1/d1/m2/d2`);
        else if (daysBetween(e.m1, e.d1, e.m2, e.d2) > 120) E(`${tag}: 기간 120일 이하`);
        for (const [y, o] of Object.entries(e.years || {})) { if (!/^\d{4}$/.test(y)) E(`${tag}: years 키 ${y}`); if (!mdOk(o.m1, o.d1) || !mdOk(o.m2, o.d2) || daysBetween(o.m1, o.d1, o.m2, o.d2) > 120) E(`${tag}: years[${y}]`); }
        break;
      }
      default: E(`${tag}: type ${e.type}`);
    }
  }
  // 지역마다 보이는 항목은 40개 이하(시트·요약 띠 한도)
  for (const [code, r] of Object.entries(ev.regions || {})) {
    const n = (ev.events || []).filter(e => (r.packs || []).includes(e.pack)).length;
    if (n < 1 || n > 40) E(`regions[${code}]: 보이는 이벤트 ${n}개 — 1~40`);
  }
} catch (x) { E('events.json: ' + x.message); }

// lifetable.json
try {
  const lt = read('lifetable.json');
  if (lt.schemaVersion !== 1) E('lifetable: schemaVersion != 1');
  for (const k of ['M', 'F', 'A']) {
    const a = lt[k];
    if (!Array.isArray(a) || a.length !== 101) { E(`lifetable.${k}: 101개`); continue; }
    for (let i = 0; i < 101; i++) { if (typeof a[i] !== 'number' || a[i] <= 0 || a[i] >= 110) E(`lifetable.${k}[${i}] 범위`); if (i && a[i] > a[i - 1]) E(`lifetable.${k}[${i}] 단조감소 아님`); }
  }
  if (typeof lt.provisional !== 'boolean') E('lifetable: provisional boolean');
  if (!nameOk({ ko: lt.sourceName?.ko?.slice(0, 12) }) || lt.sourceName.ko.length > 24) E('lifetable: sourceName.ko 1~24자(문장에 들어간다)');
} catch (x) { E('lifetable.json: ' + x.message); }

// lunar.json
try {
  const lu = read('lunar.json');
  if (lu.schemaVersion !== 1) E('lunar: schemaVersion != 1');
  const [from, to] = lu.range || [];
  for (let y = from; y <= to; y++) { const o = (lu.years || {})[y]; if (!o) { E(`lunar: ${y} 없음`); continue; } for (const k of ['seol', 'buddha', 'chuseok']) if (!isDate(o[k]) || !o[k].startsWith(String(y))) E(`lunar: ${y}.${k}`); }
} catch (x) { E('lunar.json: ' + x.message); }

if (errs.length) { console.error('검증 실패:'); errs.forEach(e => console.error(' - ' + e)); process.exit(1); }
console.log('lifegrid: events.json(regions·packs·events) · lifetable.json · lunar.json 검증 통과');
