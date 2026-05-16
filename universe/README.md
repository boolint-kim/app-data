# universe

Universe 안드로이드 앱(`~/AndroidStudioProjects/UniverseX/`)이 사용하는
한국어/영어 큐레이션 데이터 + 출처 페이지.

배포: Cloudflare Pages 자동 (`https://app-data.pages.dev/universe/...`).
push 즉시 반영.

백엔드: `https://universe-api.boolint-kim.workers.dev` (Cloudflare Worker)가
`curation_index.json` 한 번 fetch → 응답 빌드 시 큐레이션이 있는 ID만 개별 fetch.

---

## 디렉토리

```
universe/
├── README.md                       # 이 파일
├── credits.html                    # 출처 페이지 (앱에서 외부 링크로 열림)
├── curation_index.json             # 어떤 source/ID 큐레이션이 있는지 인덱스
├── curation_ver.txt                # 정수 +1, 워커 캐시 invalidation 트리거
├── docs/CURATION_GUIDE.md          # 큐레이터용 핸즈온 가이드
├── scripts/curate.js               # 큐레이션 자동화 (Node 18+, npm 의존성 0)
└── curation/
    ├── apod/<date>.json            # APOD: date가 자연 키 (예: 2026-05-14.json)
    ├── hubble/<pageId>.json        # ESA Hubble 페이지 ID (예: heic2401a.json)
    ├── jwst/<pageId>.json          # ESA Webb 페이지 ID (예: weic2308a.json)
    ├── eso/<pageId>.json           # ESO 페이지 ID (예: eso2401a.json)
    └── mars_rover/<nasaId>.json    # NASA Image Library nasa_id (예: PIA26638.json)
```

---

## 큐레이션 JSON 스키마

```json
{
  "id": "2026-05-14",
  "source": "apod",
  "ko": {
    "title": "메시에 목록을 동일 배율로",
    "caption": "밤하늘에서 볼 수 있는 가장 흥미로운 천체들은 무엇일까요? ..."
  },
  "en": {
    "title": "Messier Catalog at Uniform Scale",
    "caption": "What are some of the most interesting astronomical objects ..."
  },
  "curatedAt": "2026-05-16T00:00:00Z",
  "curator": "boolint"
}
```

| 필드 | 설명 |
|---|---|
| `id` | 백엔드 응답의 자연 키 (apod=date, hubble/jwst/eso=pageId, mars_rover=nasa_id) |
| `source` | 어댑터 이름 — `apod` / `hubble` / `jwst` / `eso` / `mars_rover` |
| `ko.title`, `ko.caption` | 한국어 큐레이션. caption 80~300자 권장 |
| `en.title`, `en.caption` | 영어 큐레이션. 비어있으면 백엔드가 RSS/API 원문으로 fallback |
| `curatedAt` | ISO 8601 UTC |
| `curator` | 작성자 핸들 |

빈 슬롯 정책:
- `ko`가 비어있으면 → 백엔드가 `en` 큐레이션 → RSS/API 원문 순으로 fallback
- `en`이 비어있으면 → 백엔드가 RSS/API 원문 사용
- **한국어로는 절대 fallback 안 함** (영어 사용자에게 한국어 보내는 게 더 나쁜 UX)

---

## 워크플로우

> 단계별 핸즈온 가이드는 [`docs/CURATION_GUIDE.md`](docs/CURATION_GUIDE.md) 참조.

### 새 큐레이션 추가

1. `curation/<source>/<id>.json` 작성
2. `curation_index.json`의 `items.<source>` 배열에 `<id>` 추가
3. `curation_ver.txt`의 정수 +1
4. commit & push → Cloudflare Pages 자동 배포 → 워커가 다음 인덱스 fetch에서 인식

### 기존 큐레이션 수정

1. `curation/<source>/<id>.json` 수정
2. `curation_ver.txt`의 정수 +1
3. commit & push

`curation_index.json`은 그대로 (id 변동 없음).

### 큐레이션 제거

1. `curation/<source>/<id>.json` 삭제
2. `curation_index.json`의 배열에서 `<id>` 제거
3. `curation_ver.txt` +1
4. commit & push

---

## 백엔드 fetch 동작

- 워커가 `https://app-data.pages.dev/universe/curation_index.json` fetch
- `items.<source>`에 응답의 자연 키(`id`)가 포함되면
  `https://app-data.pages.dev/universe/curation/<source>/<id>.json` fetch
- 응답 빌드 시 lang에 맞춰 `ko` 또는 `en` 슬롯 선택,
  비어있으면 RSS/API 원문 fallback

---

## 관련 코드

- 응답 스키마: `~/server/universe-api/src/adapters/apod.ts` (cardFor()),
  `hubble.ts`, `jwst.ts`, `eso.ts`, `mars_rover.ts`
- lang 분기 헬퍼: `~/server/universe-api/src/i18n.ts`
  (`pickLang`, `pickLocalized`)
- B3 hook 자리: 각 어댑터 핸들러의 `// B3 hook:` 주석 위치
- 설계 문서: `~/Documents/Claude/Projects/Universe/docs/v2_global.md` §2
