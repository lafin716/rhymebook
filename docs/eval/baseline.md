# RAG 검색 평가: baseline

- 생성: 2026-11-06T03:42:07.353Z · Node v24.16.0 · HEAD 2aec63de8d14ef5f4ee3c95f50d29b49863249ed
- 실제 코퍼스 고정 리비전: 2aec63d (git archive: docs, packages/core/src)
- 검색 설정: topK 10, minScore 0, maxContextChars 무제한 (순위 지표용). 무결과 오탐은 기본 minScore 0.15 / 0.5 기준. 지연은 질의당 워밍업 1회 후 3회 측정.
- OpenAI 설정 실행: 아니오 (EVAL_OPENAI=1 과 OPENAI_API_KEY 필요)

## 데이터셋

| 소스 | 질의 수 | 유형별 | 코퍼스 파일 수 | 코퍼스 바이트 |
|---|---|---|---|---|
| synthetic | 68 | technical-term 12, ko-en-mixed 10, semantic 10, code-symbol 8, filename 6, multi-doc 6, follow-up 8, no-result 8 | 39 | 31645 |
| real | 43 | code-symbol 12, technical-term 9, ko-en-mixed 7, semantic 9, no-result 6 | 300 | 2897133 |

## 설정

- `local-hash`: local-hash 기본 설정 (키워드 + 해시 벡터 + 경량 리랭커)
- `fts-symbol`: local-hash, 벡터 가중치 0 (키워드·심볼 중심 근사, HEAD에서는 벡터도 계산되므로 순수 FTS가 아님)
- `none`: provider none (벡터 없음, ADR-121) — **건너뜀**: synthetic: provider none 미지원 (색인 모델 local-hash); real: provider none 미지원 (색인 모델 local-hash)
- `openai`: OpenAI text-embedding-3-small — **건너뜀**: EVAL_OPENAI=1 과 OPENAI_API_KEY가 모두 필요 (문서가 OpenAI로 전송됨)

## 색인

| 설정 | 소스 | 상태 | 색인 시간(ms) | 문서 | 청크 | 색인 바이트 | 원본 바이트 | 실패 문서 | 정답 문서 색인률 |
|---|---|---|---|---|---|---|---|---|---|
| local-hash | synthetic | ready | 70 | 39 | 286 | 974848 | 31645 | 0 | 100.0% |
| local-hash | real | ready | 1035 | 295 | 3767 | 21061632 | 2210299 | 0 | 100.0% |
| none | synthetic | ready (provider none 미지원 (색인 모델 local-hash)) | 54 | 39 | 286 | 974848 | 31645 | 0 | 100.0% |
| none | real | ready (provider none 미지원 (색인 모델 local-hash)) | 961 | 295 | 3767 | 21061632 | 2210299 | 0 | 100.0% |

## 검색 품질 (정답이 있는 질의, 소스별)

| 설정 | 소스 | N | R@5 | R@10 | hit@5 | MRR | nDCG@10 | span@5 (N) |
|---|---|---|---|---|---|---|---|---|
| local-hash | synthetic | 60 | 0.942 | 0.942 | 0.950 | 0.890 | 0.899 | 0.750 (8) |
| local-hash | real | 37 | 0.649 | 0.811 | 0.676 | 0.437 | 0.517 | 0.480 (25) |
| local-hash | all | 97 | 0.830 | 0.892 | 0.845 | 0.717 | 0.753 | 0.545 (33) |
| fts-symbol | synthetic | 60 | 0.983 | 0.983 | 0.983 | 0.922 | 0.936 | 1.000 (8) |
| fts-symbol | real | 37 | 0.757 | 0.811 | 0.784 | 0.521 | 0.582 | 0.600 (25) |
| fts-symbol | all | 97 | 0.897 | 0.918 | 0.907 | 0.769 | 0.801 | 0.697 (33) |

## 유형별 (소스 합산)

| 설정 | 유형 | N | R@5 | R@10 | hit@5 | MRR | nDCG@10 |
|---|---|---|---|---|---|---|---|
| local-hash | code-symbol | 20 | 0.750 | 0.900 | 0.750 | 0.537 | 0.624 |
| local-hash | filename | 6 | 0.667 | 0.667 | 0.667 | 0.556 | 0.583 |
| local-hash | follow-up | 8 | 1.000 | 1.000 | 1.000 | 0.938 | 0.954 |
| local-hash | ko-en-mixed | 17 | 0.912 | 0.912 | 0.941 | 0.838 | 0.842 |
| local-hash | multi-doc | 6 | 0.917 | 0.917 | 1.000 | 1.000 | 0.936 |
| local-hash | no-result | 0 | – | – | – | – | – |
| local-hash | semantic | 19 | 0.684 | 0.789 | 0.684 | 0.538 | 0.598 |
| local-hash | technical-term | 21 | 0.929 | 0.976 | 0.952 | 0.835 | 0.866 |
| fts-symbol | code-symbol | 20 | 0.900 | 0.900 | 0.900 | 0.693 | 0.744 |
| fts-symbol | filename | 6 | 0.833 | 0.833 | 0.833 | 0.611 | 0.667 |
| fts-symbol | follow-up | 8 | 1.000 | 1.000 | 1.000 | 0.917 | 0.938 |
| fts-symbol | ko-en-mixed | 17 | 0.912 | 0.912 | 0.941 | 0.824 | 0.830 |
| fts-symbol | multi-doc | 6 | 1.000 | 1.000 | 1.000 | 1.000 | 0.980 |
| fts-symbol | no-result | 0 | – | – | – | – | – |
| fts-symbol | semantic | 19 | 0.789 | 0.842 | 0.789 | 0.640 | 0.690 |
| fts-symbol | technical-term | 21 | 0.929 | 0.976 | 0.952 | 0.838 | 0.866 |

## 기준(local-hash) 대비 차이 (소스 합산)

| 설정 | ΔR@10 | ΔMRR | ΔnDCG@10 |
|---|---|---|---|
| fts-symbol | +0.026 | +0.052 | +0.047 |

## 지연 시간 (ms, 질의 전체 측정)

| 설정 | 소스 | P50 | P95 | 표본 |
|---|---|---|---|---|
| local-hash | synthetic | 2.6 | 3.4 | 204 |
| local-hash | real | 8.1 | 10.4 | 129 |
| local-hash | all | 3.0 | 9.6 | 333 |
| fts-symbol | synthetic | 2.6 | 3.2 | 204 |
| fts-symbol | real | 8.8 | 10.9 | 129 |
| fts-symbol | all | 3.1 | 10.3 | 333 |

## 무결과 질의 오탐 (정답 없음이어야 함)

| 설정 | 소스 | N | 오탐 @0.15 | 오탐 @0.5 |
|---|---|---|---|---|
| local-hash | synthetic | 8 | 8/8 | 8/8 |
| local-hash | real | 6 | 6/6 | 6/6 |
| fts-symbol | synthetic | 8 | 7/8 | 7/8 |
| fts-symbol | real | 6 | 6/6 | 6/6 |

## 실패 질의 (상위 5개 안에 정답 없음)

- **local-hash 기본 설정 (키워드 + 해시 벡터 + 경량 리랭커)**: 15건 (semantic 6, filename 2, code-symbol 5, technical-term 1, ko-en-mixed 1) — synthetic/syn-sem-01, synthetic/syn-file-01, synthetic/syn-file-05, real/c-04, real/c-07, real/c-08, real/c-11, real/c-12, real/t-01, real/k-07, real/s-01, real/s-03, real/s-04, real/s-05, real/s-06
- **local-hash, 벡터 가중치 0 (키워드·심볼 중심 근사, HEAD에서는 벡터도 계산되므로 순수 FTS가 아님)**: 9건 (filename 1, code-symbol 2, technical-term 1, ko-en-mixed 1, semantic 4) — synthetic/syn-file-05, real/c-04, real/c-11, real/t-01, real/k-07, real/s-01, real/s-04, real/s-05, real/s-06

