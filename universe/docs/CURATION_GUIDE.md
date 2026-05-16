# 큐레이션 추가 가이드

Universe 앱의 한국어 큐레이션을 추가/수정하는 큐레이터용 핸즈온 문서.
스키마 정의는 `../README.md` 참조.

---

## 실제 구조 — 3개 저장소, 하나의 출입구

```
┌─────────────────────────────────────────────────────┐
│  저장소 A — R2 (universe-media)                     │
│  ▶ 영어 원문                                         │
│  ▶ cron이 매일 자동으로 채움 (사람 손 안 댐)          │
│  ▶ APOD: 매일 00:05 NASA에서 받아 저장              │
│  ▶ Hubble/JWST/ESO: 매일 00:30 RSS에서             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  저장소 B — app-data (GitHub + Cloudflare Pages)    │
│  ▶ 한국어 큐레이션만                                  │
│  ▶ 사람이 수동으로 채움 (PR/commit/push)             │
│  ▶ 모든 항목을 채울 필요 없음 — 골라서                │
└─────────────────────────────────────────────────────┘

       ↓ 워커가 두 저장소를 합쳐서 응답 ↓

┌─────────────────────────────────────────────────────┐
│  universe-api (Cloudflare Workers)                  │
│  ▶ 클라이언트의 유일한 출입구                          │
│  ▶ Accept-Language 보고 ko/en 결정                  │
│  ▶ 두 저장소 fetch + 합쳐서 JSON 응답                │
└─────────────────────────────────────────────────────┘
                        ↑
                        │
                  ┌─────┴─────┐
                  │  Android  │
                  │  UniverseX │
                  └───────────┘
```

### 한 요청의 일생 — APOD 예시

**시나리오 1**: 새 APOD `2026-05-17` 등장, 큐레이터가 아직 ko 안 채움

```
1. 00:05  NASA APOD에 새 사진 발표
2. 00:05  universe-api의 cron이 NASA fetch → R2에 영어 원문 저장
3. (그 사이 한국어 큐레이션은 채워지지 않음)
4. 09:00  한국 사용자 앱 켬, Accept-Language: ko-KR로 요청
5.        워커: "ko 요청이네"
6.        워커: R2에서 영어 원문 읽음 (title, caption 둘 다 영어)
7.        워커: app-data에 ko 큐레이션 있나? → 없음
8.        워커: "ko 없으니 영어 원문 그대로 응답"
9.        앱: 영어 텍스트 표시 (브라우저 번역 가능)
```

**시나리오 2**: 큐레이터가 그날 오후에 ko 채워서 push

```
1. 14:00  큐레이터가 app-data에 universe/curation/apod/2026-05-17.json 추가
          { ko: { title: "...", caption: "..." }, en: { ... } }
2. 14:00  git push → Cloudflare Pages 자동 배포 (1~2분)
3. 14:05  같은 한국 사용자 앱에서 같은 요청
4.        워커: ko 큐레이션 있음 → ko 슬롯 사용
5.        앱: 한국어 텍스트 표시
```

### 흔한 오해 정리

| 흔한 오해 | 실제 |
|---|---|
| 크론이 R2 채움 ✓ | 맞음 (영어 원문만) |
| 크론이 app-data도 채움 ✗ | **app-data는 사람이 수동**. 크론과 무관 |
| 클라이언트가 app-data를 받아감 ✗ | **클라이언트는 워커만 호출**. 워커가 app-data fetch |
| 한국어 있으면 ko, 없으면 영어 ✓ | 맞음. 단, **이 판단은 클라이언트가 아니라 워커가 함** |

**한 줄 요약:** 영어는 크론으로 자동, 한국어는 사람이 골라서 채움, 워커가 둘을 합쳐서 사용자 언어에 맞춰 응답.

---

## 어디에 무엇을 둘지

```
universe/
├── curation_index.json            # 어떤 source/ID 큐레이션이 있는지 인덱스
├── curation_ver.txt               # 정수 +1, 워커 캐시 invalidation 트리거
├── scripts/
│   └── curate.js                  # 큐레이션 자동화 (스켈레톤 생성 + index/ver 갱신)
└── curation/
    ├── apod/<date>.json           # APOD: date가 자연 키 (예: 2026-05-17.json)
    ├── hubble/<pageId>.json       # ESA Hubble (예: heic2401a.json)
    ├── jwst/<pageId>.json         # ESA Webb (예: weic2308a.json)
    ├── eso/<pageId>.json          # ESO (예: eso2401a.json)
    └── mars_rover/<nasaId>.json   # NASA Image Library (예: PIA26638.json)
```

---

## 자동화 — `curate.js` (권장)

수동 5분 작업을 1~2분으로 줄여주는 Node 스크립트. 라이브 API에서 영어 원문
자동 fetch → 스켈레톤 생성 → index/ver 자동 갱신. 큐레이터는 ko 슬롯만 작성.

### 사용

```bash
cd ~/server/app-data

# 오늘 APOD (자동 fetch)
node universe/scripts/curate.js apod

# 갤러리 source — 미큐레이션 후보 목록 출력
node universe/scripts/curate.js hubble
node universe/scripts/curate.js jwst
node universe/scripts/curate.js eso
node universe/scripts/curate.js mars_rover

# 특정 id 지정
node universe/scripts/curate.js hubble heic2608b
```

### 스크립트가 자동으로 하는 것

- ✅ 라이브 API에서 영어 원문 추출 → `en.title`/`en.caption` 채움
- ✅ 이미 큐레이션된 id 자동 제외 (후보 목록에서)
- ✅ JSON 스켈레톤 생성 (스키마 자동, ISO 시각·curator 자동)
- ✅ `curation_index.json` items 갱신 + `ver` +1
- ✅ `curation_ver.txt` +1

### 큐레이터가 해야 할 것

1. 생성된 스켈레톤 파일 열어서 `ko.title` 작성 (`ko.caption`은 선택)
2. `git add universe/ && git commit -m "..." && git push`

### 의존성

Node 18 이상 (내장 `fetch` 사용). 외부 npm 의존성 없음.

---

## 4단계 — 큐레이션 1개 추가

### ① 새 큐레이션 JSON 파일 생성

예: APOD 2026-05-17

경로: `universe/curation/apod/2026-05-17.json`

```json
{
  "id": "2026-05-17",
  "source": "apod",
  "ko": {
    "title": "한국어 제목",
    "caption": "한국어 설명 ..."
  },
  "en": {
    "title": "NASA 원문 title",
    "caption": "NASA 원문 explanation"
  },
  "curatedAt": "2026-05-17T08:00:00Z",
  "curator": "boolint"
}
```

### ② `curation_index.json`의 items 배열에 id 추가

```json
{
  "ver": 2,
  "updatedAt": "2026-05-17T08:00:00Z",
  "items": {
    "apod": ["2026-05-17", "2026-05-14"],
    "hubble": ["potm2604a"],
    "jwst": [],
    "eso": [],
    "mars_rover": []
  }
}
```

- `ver` 정수 +1 (curation_ver.txt와 일치시킬 필요는 없음)
- `updatedAt` 현재 시각 ISO 8601 UTC
- `items.<source>` 배열에 새 id 추가 (순서 무관, 최신을 앞에 두는 관습)

### ③ `curation_ver.txt` 정수 +1

```
2
```

워커가 이 값을 캐시 invalidation 트리거로 활용. 깜빡 잊으면 최대 5분 캐시 만료 때까지 옛 인덱스가 살아있을 수 있음.

### ④ commit & push

```bash
cd ~/server/app-data
git add universe/
git commit -m "universe: APOD 2026-05-17 ko 큐레이션 추가"
git push
```

→ Cloudflare Pages 자동 배포 (1~2분) → 워커가 최대 5분 후 새 인덱스 인식 → 적용

---

## id 찾는 법

라이브 API 응답에서 자연 키 확인:

| 소스 | id 위치 | 예시 |
|---|---|---|
| apod | 응답의 `date` | `2026-05-17` |
| hubble | items[].id | `heic2401a`, `potm2604a` |
| jwst | items[].id | `weic2401a` |
| eso | items[].id | `eso2401a`, `potw2316a` |
| mars_rover | photos[].id | `PIA26638` |

빠른 확인:

```bash
curl -s https://universe-api.boolint-kim.workers.dev/v1/apod/latest | python3 -m json.tool
curl -s https://universe-api.boolint-kim.workers.dev/v1/hubble/recent | python3 -m json.tool | head -50
```

---

## 자주 묻는 질문

### Q. `en` 슬롯도 채워야 하나?

비워도 OK. 비면 워커가 R2의 RSS/API 원문(영어)을 fallback으로 사용. 스키마 일관성을 위해 채우는 게 좋지만 필수 아님.

### Q. `ko.title`만 채우고 `ko.caption`은 비워도 되나?

가능. caption은 영어 원문이 fallback으로 사용됨. 부분 큐레이션 OK.

### Q. 매일 모든 APOD를 채워야 하나?

아니. 선별적으로 큐레이션 — 특히 유명·재미있는 항목만. 채우지 않은 항목은 사용자에게 영어 원문이 나가고, Android/브라우저 번역으로 알아서 봄.

### Q. 큐레이션 수정/삭제는?

**수정**: 파일 내용 수정 → `curation_ver.txt` +1 → commit/push. index 그대로.

**삭제**: 파일 삭제 → `curation_index.json` items 배열에서 id 제거 → `curation_ver.txt` +1 → commit/push.

### Q. 자동 번역(GPT/DeepL)을 ko 슬롯에 채울까?

**채택 안 함** (STATUS.md 폐기 항목). Android/브라우저 번역으로 대체. 큐레이션은 "특히 의미 있는 콘텐츠를 직접 다듬은 한국어"라는 정체성 유지.

### Q. 잘못된 JSON을 push하면 어떻게 되나?

워커는 fetch 실패 시 null 반환 → 해당 id만 영어 원문 fallback. 다른 큐레이션과 다른 항목은 영향 없음. 다음 push로 수정.

### Q. 한 번에 여러 항목 추가 가능?

가능. 한 commit에 여러 JSON + index 갱신 + ver +1.

---

## 출시 후 확인

push 후 ~3~7분 뒤 라이브에서 확인:

```bash
# 한국어 큐레이션 적용 확인
curl -s "https://universe-api.boolint-kim.workers.dev/v1/apod/latest?lang=ko" | python3 -m json.tool

# 영어 원문 (큐레이션 en 슬롯 또는 RSS 원문)
curl -s "https://universe-api.boolint-kim.workers.dev/v1/apod/latest?lang=en" | python3 -m json.tool
```

`title`/`caption` 필드가 작성한 한국어로 나오면 성공.

---

## 관련 문서

- 스키마/필드 정의 — `../README.md`
- 백엔드 fetch 동작 — `~/server/universe-api/src/curation.ts`
- 설계 — `~/Documents/Claude/Projects/Universe/docs/v2_global.md` §2, §8 B3

---

## 매일 운영 루틴 (검증된 흐름)

2026-05-16 APOD `2026-05-15` 큐레이션으로 end-to-end 검증 완료
(commit `5f9a1bf`, 라이브 즉시 반영).

### 5분 루틴 — 매일 APOD 1개

```bash
# 0. 작업 위치 이동
cd ~/server/app-data

# 1. 오늘 APOD 스켈레톤 생성 + index/ver 자동 갱신 (1초)
node universe/scripts/curate.js apod

# → 출력:
#    ✓ 스켈레톤 생성: universe/curation/apod/<오늘 날짜>.json
#    영어 원문 자동 채움 (title NN자, caption NNN자)
#    ✓ curation_index.json items.apod 갱신 (ver X → X+1)
#    ✓ curation_ver.txt: X → X+1

# 2. 생성된 파일 열어서 ko.title / ko.caption 작성 (1~2분)
#    경로는 ① 출력 메시지에 표시됨
$EDITOR universe/curation/apod/<오늘 날짜>.json
#   또는: code universe/curation/apod/<오늘 날짜>.json

# 3. commit + push (30초)
git add universe/
git commit -m "universe: APOD <날짜> ko 큐레이션"
git push

# 4. 라이브 확인 (선택, 즉시~5분)
curl -s "https://universe-api.boolint-kim.workers.dev/v1/apod/latest?lang=ko" \
  | python3 -m json.tool
```

### 갤러리 source — 골라서 큐레이션

```bash
# 미큐레이션 후보 목록 출력 (탭하면 ReaderActivity 노출되니 흥미로운 것만)
node universe/scripts/curate.js hubble
# → 상위 10개 출력. id와 영문 title 보고 선택

# 선택한 id 큐레이션
node universe/scripts/curate.js hubble heic2608b

# 이하 2~4단계는 APOD와 동일 (파일 열기 → commit → push)
```

다른 source (`jwst`, `eso`, `mars_rover`)도 동일 패턴.

### 작성 가이드

| 필드 | 갤러리 카드 노출 | Reader 진입 시 노출 | 작성 권장도 |
|---|---|---|---|
| `ko.title` | ✓ 보임 | ✓ 보임 | **필수** |
| `ko.caption` | ✗ 안 보임 | ✓ 보임 | 오늘 APOD는 필수, 갤러리는 선택 |

- **APOD (오늘 화면)**: title + caption 둘 다 — 메인 노출
- **Hubble/JWST/ESO/Mars (갤러리)**: title만으로도 충분, caption은 인기 항목만

### 자주 쓰는 점검 명령

```bash
# 현재 큐레이션된 항목 목록 (인덱스)
cat universe/curation_index.json | python3 -m json.tool

# 라이브 인덱스 (Pages 배포본)
curl -s https://app-data.pages.dev/universe/curation_index.json | python3 -m json.tool

# 라이브 ko 응답
curl -s "https://universe-api.boolint-kim.workers.dev/v1/hubble/recent?lang=ko" \
  | python3 -m json.tool | head -40
```
