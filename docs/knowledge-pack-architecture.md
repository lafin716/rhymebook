# Knowledge Pack 아키텍처 (계획 문서 — 미구현)

> 상태: **설계만 한다.** 이번 릴리스에는 빌더, 다운로드 매니저, 배포 서버 중 아무것도 없다. 설치 파일에 지식팩을 넣지 않는다.
> 관련: ADR-113(로컬 색인·RAG), `packages/core/src/rag/types.ts`, `packages/bridge/src/rag/`.

## 1. 목적과 범위

Kubernetes, Linux 같은 공식 문서를 앱 밖의 CI에서 미리 수집·청킹·임베딩해 **지식팩(Knowledge Pack)**으로 묶는다. Object Storage(S3 또는 Cloudflare R2)에 올리면, OctoBooks가 사용자가 고른 팩만 내려받아 로컬 지식베이스로 설치한다.

- 사용자는 큰 문서 저장소를 클론하거나 색인하는 비용(시간, CPU, 임베딩 API 요금)을 들이지 않는다.
- 설치한 팩은 로컬 KB와 똑같이 세션과 가지에 연결되고 Hybrid RAG로 검색된다. 검색은 끝까지 로컬에서 하며 중앙 검색 서버는 없다.
- 서버 측 구성 요소는 정적 파일 호스팅(catalog/manifest/archive)뿐이다. 앱이 동작하는 데 서버 API는 필요 없다.

## 2. 전체 구성

```
 ┌──────────── GitHub Actions (packs repo) ─────────────┐        ┌──── S3 / R2 (정적) ─────┐
 │ sources/*.yaml ─▶ collect ─▶ parse/chunk ─▶ embed     │        │ catalog.json (서명)      │
 │   (git SHA 고정)          (@branch/core rag 동일 코드)  ├──────▶ │ packs/<id>/<ver>/        │
 │ ─▶ build index.sqlite ─▶ package(.obpack) ─▶ sign      │ upload │   manifest.json(서명)     │
 └───────────────────────────────────────────────────────┘        │   pack.obpack (zstd tar)  │
                                                                   └──────────┬──────────────┘
                                                                              │ HTTPS GET only
                                        ┌─────────────── OctoBooks (desktop main) ─┴────────────┐
                                        │ PackCatalog → 다운로드(재개·용량 확인) → 검증(sha256+서명) │
                                        │ → 임시 디렉터리 해제 → 스키마/모델 호환 확인 → 원자적 설치  │
                                        │ → <userData>/knowledge/<kbId>/ (readOnly, source=pack)   │
                                        └──────────────────────────────────────────────────────────┘
```

## 3. Knowledge Pack Builder

별도 저장소(예: `octobooks-packs`)에 둔다. 앱 저장소와 같은 `@branch/core` 버전의 `rag` 모듈(파서·청커·토크나이저·임베더)을 **그대로** 쓴다. 이렇게 해야 앱이 직접 색인한 결과와 청크 경계, 토큰, 벡터가 같다.

- 입력: `sources/<pack-id>.yaml`

  ```yaml
  id: kubernetes-docs-en
  title: Kubernetes Documentation (EN)
  license: CC-BY-4.0
  attribution: "© The Kubernetes Authors"
  source:
    type: github
    repo: kubernetes/website
    ref: main          # 빌드 시 SHA로 고정해 manifest에 기록
    include: ["content/en/docs/**/*.md"]
    exclude: ["**/_print/**"]
  embedding: [ { provider: local-hash, model: hash-v1, dim: 384 },
               { provider: openai, model: text-embedding-3-small, dim: 1536 } ]
  ```
- 단계:
  1. **collect**: 얕은 클론(`--depth 1`)을 받아 `git rev-parse HEAD`로 SHA를 고정하고 include/exclude를 적용한다. 앱과 같은 `isIndexablePath` 규칙을 쓴다.
  2. **parse/normalize/chunk**: `parseDocument` → `chunkDocument`(계층형 section/leaf)를 거친다. Hugo shortcode 같은 사이트 전용 문법은 팩별 전처리 플러그인으로 제거한다.
  3. **embed**: 선언한 모델마다 벡터 세트를 따로 만든다. 모델키는 `provider:model:dim`이다. OpenAI 임베딩은 CI 비밀 키로 만들고, 팩 안에는 벡터만 들어간다.
  4. **build index**: 앱과 같은 스키마(`user_version`)의 `index.sqlite`를 모델별로 만든다. docs/chunks/fts/vectors/meta를 넣고, emb_cache와 jobs는 비운다.
  5. **package**: `pack.obpack`를 만든다(zstd로 압축한 tar, 구성은 아래 4절). 그다음 `manifest.json`을 만들고 서명한다.
  6. **publish**: 버전 경로에 업로드한 뒤 `catalog.json`을 다시 만들고 서명해 업로드한다. 업로드 순서는 archive → manifest → catalog이다.

## 4. GitHub Actions 파이프라인

```yaml
on:
  schedule: [{ cron: "0 3 * * 1" }]   # 주 1회 원본 변경 확인
  workflow_dispatch: { inputs: { pack: { required: false } } }
jobs:
  build:
    strategy: { matrix: { pack: ${{ fromJson(needs.plan.outputs.packs) }} } }
    steps:
      - checkout packs repo, setup pnpm/node 24
      - run: pnpm obpack build ${{ matrix.pack }}      # collect→chunk→embed→package
        env: { OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }} }
      - run: pnpm obpack verify dist/${{ matrix.pack }} # 앱과 같은 검색 엔진으로 golden query 회귀
      - run: pnpm obpack sign dist/... (minisign/ed25519, 비밀키는 secrets)
      - run: aws s3 cp / wrangler r2 object put (immutable 경로, Cache-Control: immutable)
  catalog:
    needs: build
    steps: [ regenerate catalog.json, sign, upload (짧은 TTL) ]
```

- 원본 SHA가 이전 버전과 같으면 빌드를 건너뛴다.
- `verify` 단계는 팩마다 둔 golden 질의 세트(예: "Pod IP는 누가 할당하나" → IPAM 문서)의 recall@k가 기준을 넘는지 확인한다. 기준에 못 미치면 게시하지 않는다.

## 5. 저장 경로 (S3 / R2)

```
/catalog.json                     # 짧은 캐시(5분), 서명 포함
/catalog.json.sig
/packs/<packId>/<version>/manifest.json
/packs/<packId>/<version>/manifest.json.sig
/packs/<packId>/<version>/pack-<modelKeySafe>.obpack   # 모델별 아카이브(불변)
```
- 버전 경로는 덮어쓰지 않는다(immutable). 버전을 회수할 때는 catalog에서 빼고 `yanked`로 표시한다.
- R2를 쓰면 커스텀 도메인과 공개 버킷으로 egress 요금을 줄일 수 있다. 앱은 GET만 하고 업로드 권한이 없다.

## 6. 스키마

### catalog.json
```json
{
  "formatVersion": 1,
  "generatedAt": "2027-01-04T03:12:00Z",
  "packs": [
    {
      "id": "kubernetes-docs-en",
      "title": "Kubernetes Documentation (EN)",
      "description": "Concepts, Tasks, Reference",
      "languages": ["en"],
      "tags": ["kubernetes", "cloud-native"],
      "license": { "spdx": "CC-BY-4.0", "attribution": "© The Kubernetes Authors", "url": "https://github.com/kubernetes/website/blob/main/LICENSE" },
      "tier": "free",
      "latest": "2027.01.04-1",
      "versions": [
        {
          "version": "2027.01.04-1",
          "manifest": "packs/kubernetes-docs-en/2027.01.04-1/manifest.json",
          "sourceSha": "9f2c…",
          "minAppVersion": "0.60.0",
          "packFormat": 1,
          "models": ["local-hash:hash-v1:384", "openai:text-embedding-3-small:1536"],
          "sizeBytes": { "local-hash:hash-v1:384": 48211234, "openai:text-embedding-3-small:1536": 131002211 },
          "yanked": false
        }
      ]
    }
  ]
}
```

### manifest.json
```json
{
  "packFormat": 1,
  "id": "kubernetes-docs-en",
  "version": "2027.01.04-1",
  "createdAt": "2027-01-04T03:10:00Z",
  "source": { "type": "github", "repo": "kubernetes/website", "ref": "main", "sha": "9f2c…", "include": ["content/en/docs/**/*.md"] },
  "builder": { "name": "obpack", "version": "1.3.0", "coreVersion": "0.60.0" },
  "index": { "schemaVersion": 1, "chunking": { "leafChars": 900, "maxLeafChars": 1600, "maxSectionChars": 6000, "overlapChars": 120 }, "tokenizer": "core-tokenize-v1" },
  "stats": { "docs": 1480, "chunks": 41210 },
  "artifacts": [
    {
      "model": { "provider": "local-hash", "model": "hash-v1", "dim": 384 },
      "file": "pack-local-hash_hash-v1_384.obpack",
      "sizeBytes": 48211234,
      "sha256": "c1d0…",
      "unpackedBytes": 210334112
    }
  ],
  "files": [ { "path": "index.sqlite", "sha256": "…" }, { "path": "docs/…", "sha256": "…" } ],
  "license": { "spdx": "CC-BY-4.0", "attribution": "© The Kubernetes Authors", "notice": "NOTICE.md" }
}
```

### 아카이브 구성 (`.obpack` = tar + zstd)
```
manifest.json            # 위와 동일(자체 검증용 사본)
index.sqlite             # 앱 색인 스키마, 해당 모델 벡터만
docs/…                   # 원문(출처 뷰어·파일 열기용, 라이선스가 허용할 때만)
NOTICE.md / LICENSE      # 저작자 표시
```

## 7. 버전과 원본 Git SHA

- 팩 버전은 `YYYY.MM.DD-N`이다. 원본 SHA는 `source.sha`에 기록하고, 출처 뷰어에서 `https://github.com/<repo>/blob/<sha>/<path>` 링크를 만들 때 쓴다.
- 같은 SHA로 다시 빌드할 때(빌더나 청킹 변경)는 N을 올린다. 앱은 `latest`가 설치된 버전보다 새로우면 업데이트를 제안한다.

## 8. 임베딩 모델 호환성

- 앱의 KB 설정 모델키(`embeddingKey`)와 같은 모델의 아티팩트만 설치한다. 섞지 않는다는 원칙(ADR-113)을 그대로 지킨다.
- `local-hash:hash-v1:384`는 결정적이라 오프라인 사용자에게 기본으로 쓴다. 질의 임베딩도 로컬에서 만든다.
- OpenAI 모델 아티팩트는 질의 임베딩에 사용자 API 키가 필요하다. 설치 화면에 "질문이 OpenAI로 전송됨"을 표시한다.
- 앱의 토크나이저나 청킹 버전(`index.tokenizer`, `index.schemaVersion`)이 다르면 설치를 거부하거나 앱 업데이트를 안내한다. FTS 토큰 불일치를 막기 위해서다.
- 향후 로컬 임베딩 provider(ONNX 등)가 생기면 그 모델키로 된 아티팩트를 추가하기만 하면 된다.

## 9. 다운로드·검증·설치·업데이트·삭제

1. **카탈로그**: `catalog.json`과 `.sig`를 받아 앱에 내장된 공개키(ed25519)로 서명을 검증하고, `minAppVersion`과 `packFormat`으로 거른다.
2. **사전 확인**: `statfs`로 디스크 여유 공간을 본다(압축 크기 + 해제 크기 + 여유분). URL 출처는 앱에 설정된 팩 호스트만 허용한다. 사설망이나 리디렉션 우회는 막는다(기존 SSRF 가드 재사용).
3. **다운로드**: main 프로세스에서 HTTPS로 받는다. Range로 이어받기를 하고, 시간 초과와 취소를 지원하며 진행률을 IPC로 보낸다. 파일은 `<userData>/knowledge/.packs-tmp/<uuid>/`에 둔다.
4. **검증**: manifest 서명을 확인하고, 아티팩트 sha256이 manifest와 같은지, 해제 후 `files[]`의 해시가 맞는지 본다. tar 경로가 탈출하는지(`..`, 절대경로, 심볼릭 링크)도 거부한다.
5. **설치**: 새 `kbId` 디렉터리를 만든다. 그 안에 `meta.json`(`source:{type:'pack', id, version, sha}`, `readOnly:true`, settings.embedding = 아티팩트 모델), `files/`(docs), `index.sqlite`를 둔다. rename으로 원자적으로 옮긴다.
6. **업데이트**: 새 버전을 임시 위치에 설치하고 검증한 다음 KB 디렉터리의 `index.sqlite`와 `files/`를 교체한다(ADR-113의 next-file swap과 같다). 세션 연결(`knowledgeIds`)은 kbId가 그대로라 유지된다. 실패하면 이전 버전이 남는다.
7. **삭제**: 기존 KB 삭제와 같다(`indexer.drop` → 디렉터리 삭제). 임시 디렉터리는 시작할 때 청소한다.

## 10. 포맷 버전과 무결성

- `packFormat`(아카이브 구조)과 `index.schemaVersion`(SQLite 스키마)을 분리한다. 앱은 지원하는 범위를 상수로 가진다.
- 무결성은 두 단계로 본다. ① 서명된 manifest → ② 아티팩트와 파일의 sha256. 설치한 뒤에도 manifest를 보관해서 "검증 다시 하기"로 손상을 감지할 수 있게 한다.
- SQLite는 설치 직후 `PRAGMA integrity_check`(quick)를 돌린다.

## 11. 로컬 검색 엔진과의 통합

- 설치한 팩은 일반 KB다. `KnowledgeRepository`/`KnowledgeSearchEngine` 코드를 그대로 쓴다. 차이는 `readOnly`(파일 추가·재색인 버튼 숨김)와 `source.type='pack'`뿐이다.
- 세션과 가지에 사용자 KB와 함께 연결해 여러 KB를 RRF로 검색할 수 있다. 출처에는 팩 이름, 버전, 원본 URL(SHA 고정)을 표시한다.
- 사용자가 팩 KB의 임베딩 모델을 바꾸면 로컬에서 재색인하지 않는다. 대신 그 모델의 아티팩트를 받도록 안내한다.

## 12. 라이선스와 재배포

- 팩마다 SPDX 라이선스, 저작자 표시, NOTICE를 함께 배포한다. 예를 들어 Kubernetes 문서는 CC BY 4.0이라 출처를 표시하면 재배포할 수 있다.
- 원문 재배포가 허용되지 않는 출처(일부 벤더 문서)는 팩으로 만들지 않거나, 링크와 메타데이터만 담은 "링크 팩"으로 만든다(본문 대신 요약을 넣는 것도 법률 검토가 필요하다).
- 코드 저장소 팩은 해당 라이선스(Apache-2.0, MIT 등)의 고지 의무를 지킨다. GPL 계열 코드는 기본으로 제외한다.
- 상표(“Kubernetes” 등)는 설명 목적으로만 쓰고 공식 제휴처럼 보이지 않게 표기한다.

## 13. 향후 유료 Knowledge Pack

- `catalog.json`의 `tier: "free" | "pro"`. 유료 팩의 아티팩트는 공개 경로가 아니라 **서명된 짧은 수명 URL**(R2/S3 presigned)로 내려준다. 이때만 얇은 라이선스 API(구매 확인 → presigned URL 발급)가 필요하다. 검색과 색인은 여전히 로컬이다.
- 앱은 라이선스 토큰을 OS 보안 저장소(safeStorage)에 둔다. 팩 파일은 일반 KB와 같고, DRM은 하지 않는다(로컬 앱 특성상 실익이 적다).
- 큐레이션(버전별 엄선, 한국어 번역·요약 팩), 기업용 사내 문서 팩 빌더(셀프 호스팅 Actions 템플릿)를 수익 모델 후보로 둔다.

## 14. 이번에 하지 않는 것

- 빌더(`obpack`), GitHub Actions 워크플로, S3/R2 버킷, 카탈로그 서버, 앱 안의 다운로드 매니저와 팩 설치 UI, 설치 파일에 팩 포함.
- 현재 코드에서 미리 맞춰 둔 것: 모델키 기반 색인 분리, `index.sqlite` 스키마 버전(`user_version`), next-file 원자적 교체, KB 메타의 `sources`, 공통 core `rag` 모듈.
