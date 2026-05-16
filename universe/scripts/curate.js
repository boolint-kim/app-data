#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
// Universe 큐레이션 자동화
//
// 사용법 (app-data 레포 루트에서):
//   node universe/scripts/curate.js <source> [<id>]
//
//   node universe/scripts/curate.js apod                # 오늘 APOD 자동
//   node universe/scripts/curate.js apod 2026-05-14     # 특정 날짜 (수동 작성)
//   node universe/scripts/curate.js hubble              # 미큐레이션 후보 목록 출력
//   node universe/scripts/curate.js hubble heic2608b    # 특정 id
//   node universe/scripts/curate.js jwst                # 동일
//   node universe/scripts/curate.js eso                 # 동일
//   node universe/scripts/curate.js mars_rover          # 동일
//
// 동작:
//   1. universe-api 라이브 fetch → 영어 원문 추출
//   2. curation_index.json 비교 → 이미 큐레이션된 id 자동 제외
//   3. 스켈레톤 JSON 생성 (en 자동 채움, ko 빈 채로)
//   4. curation_index.json items 갱신, curation_ver.txt +1
//   5. 사용자에게 한국어 작성 안내 (commit/push는 별도)
//
// 의존성: Node 18+ (내장 fetch). 외부 npm 의존성 0.
// ──────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

const API_BASE = process.env.UNIVERSE_API ?? "https://universe-api.boolint-kim.workers.dev";
const REPO_ROOT = path.resolve(__dirname, "../..");
const UNIV_ROOT = path.join(REPO_ROOT, "universe");
const INDEX_PATH = path.join(UNIV_ROOT, "curation_index.json");
const VER_PATH = path.join(UNIV_ROOT, "curation_ver.txt");
const CURATOR = process.env.CURATOR ?? "boolint";

const SOURCES = {
  apod: {
    api: "/v1/apod/latest?lang=en",
    single: true,
    pickId: (d) => d.date,
    pickTitle: (d) => d.title,
    pickCaption: (d) => d.caption,
  },
  hubble: {
    api: "/v1/hubble/recent?lang=en",
    listKey: "items",
    pickId: (it) => it.id,
    pickTitle: (it) => it.title,
    pickCaption: (it) => it.description,
  },
  jwst: {
    api: "/v1/jwst/recent?lang=en",
    listKey: "items",
    pickId: (it) => it.id,
    pickTitle: (it) => it.title,
    pickCaption: (it) => it.description,
  },
  eso: {
    api: "/v1/eso/recent?lang=en",
    listKey: "items",
    pickId: (it) => it.id,
    pickTitle: (it) => it.title,
    pickCaption: (it) => it.description,
  },
  mars_rover: {
    api: "/v1/mars/recent?lang=en",
    listKey: "photos",
    pickId: (p) => p.id,
    pickTitle: (p) => p.title,
    pickCaption: (p) => p.description,
  },
};

async function main() {
  const [, , source, requestedId] = process.argv;
  if (!source || !SOURCES[source]) {
    usage();
    process.exit(1);
  }
  const cfg = SOURCES[source];

  // 1. 라이브 fetch
  const url = `${API_BASE}${cfg.api}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`✗ API 실패: ${res.status} ${url}`);
    process.exit(2);
  }
  const data = await res.json();

  // 2. 후보 결정
  const candidates = cfg.single ? [data] : (data[cfg.listKey] ?? []);
  if (candidates.length === 0) {
    console.error(`✗ ${source}: 응답에 항목 없음`);
    process.exit(3);
  }

  const index = readIndex();
  const existing = new Set(index.items[source] ?? []);

  let target;
  if (requestedId) {
    target = candidates.find((c) => String(cfg.pickId(c)) === requestedId);
    if (!target) {
      console.error(`✗ ${source} id "${requestedId}" 가 라이브 응답에 없음`);
      console.error(`  최근 응답 id: ${candidates.slice(0, 5).map(cfg.pickId).join(", ")} ...`);
      process.exit(4);
    }
  } else if (cfg.single) {
    target = candidates[0];
  } else {
    // 후보 목록에서 첫 미큐레이션 선택. 없으면 목록 출력 후 종료.
    const fresh = candidates.filter((c) => !existing.has(String(cfg.pickId(c))));
    if (fresh.length === 0) {
      console.log(`✓ ${source}: 모든 후보(${candidates.length}개)가 이미 큐레이션됨`);
      process.exit(0);
    }
    console.log(`\n${source} — 미큐레이션 후보 (전체 ${fresh.length}개 중 상위 10개):\n`);
    fresh.slice(0, 10).forEach((c, i) => {
      const id = String(cfg.pickId(c));
      const title = (cfg.pickTitle(c) ?? "").slice(0, 70);
      console.log(`  ${String(i + 1).padStart(2)}. ${id.padEnd(14)} ${title}`);
    });
    console.log(`\n사용: node scripts/curate.js ${source} <id>`);
    process.exit(0);
  }

  const id = String(cfg.pickId(target));
  const enTitle = cfg.pickTitle(target) ?? "";
  const enCaption = cfg.pickCaption(target) ?? "";

  // 3. 스켈레톤 작성
  const filePath = path.join(UNIV_ROOT, "curation", source, `${id}.json`);
  if (fs.existsSync(filePath)) {
    console.error(`✗ 이미 존재: ${path.relative(REPO_ROOT, filePath)}`);
    console.error(`  수정하려면 직접 편집 + curation_ver.txt +1`);
    process.exit(5);
  }
  const skeleton = {
    id,
    source,
    ko: { title: "", caption: "" },
    en: { title: enTitle, caption: enCaption },
    curatedAt: new Date().toISOString(),
    curator: CURATOR,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(skeleton, null, 2) + "\n");

  // 4. 인덱스 갱신
  if (!index.items[source]) index.items[source] = [];
  if (!index.items[source].includes(id)) {
    index.items[source].unshift(id);
  }
  index.ver += 1;
  index.updatedAt = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");

  // 5. ver.txt +1
  const ver = parseInt(fs.readFileSync(VER_PATH, "utf8").trim(), 10) + 1;
  fs.writeFileSync(VER_PATH, ver + "\n");

  // 6. 안내
  const rel = path.relative(REPO_ROOT, filePath);
  console.log(`✓ 스켈레톤 생성: ${rel}`);
  console.log(`  영어 원문 자동 채움 (title ${enTitle.length}자, caption ${enCaption.length}자)`);
  console.log(`✓ curation_index.json items.${source} 갱신 (ver ${index.ver - 1} → ${index.ver})`);
  console.log(`✓ curation_ver.txt: ${ver - 1} → ${ver}`);
  console.log();
  console.log(`다음 할 일:`);
  console.log(`  1) ${rel} 열어서 ko.title 작성 (caption은 선택)`);
  console.log(`  2) git add universe/ && git commit -m "universe: ${source} ${id} ko 큐레이션 추가" && git push`);
  console.log(`  3) 1~2분 후 라이브 확인:`);
  console.log(`     curl -s "${API_BASE}${cfg.api.split("?")[0]}?lang=ko" | python3 -m json.tool`);
}

function readIndex() {
  const raw = fs.readFileSync(INDEX_PATH, "utf8");
  return JSON.parse(raw);
}

function usage() {
  console.log(`사용: node universe/scripts/curate.js <source> [<id>]`);
  console.log();
  console.log(`source: ${Object.keys(SOURCES).join(" | ")}`);
  console.log();
  console.log(`예:`);
  console.log(`  node universe/scripts/curate.js apod                # 오늘 APOD`);
  console.log(`  node universe/scripts/curate.js hubble              # 미큐레이션 후보 목록`);
  console.log(`  node universe/scripts/curate.js hubble heic2608b    # 특정 id`);
}

main().catch((e) => {
  console.error("✗ 오류:", e.message);
  process.exit(99);
});
