# 관계 도서관 개정 3: 리뷰 반영 (설계 검토 + 학술 검토)

## Context
원본 플랜은 `~/sisyphus/library/docs/relations-plan.md`이다. 개정 2에서 근거 체계와 Norton 판 구현을 설계했다. 이번에 두 에이전트가 그것을 검토했다.
- 설계 검토(Plan 에이전트): 데이터 모델, 승인 비용, 저장소 통합
- 학술 검토(general-purpose 에이전트): 텍스트 편집학·DH 관점, 웹 사실 확인

두 검토는 같은 결론을 냈다. 방향(T0 배제, quote 기계 대조)은 맞다. 그러나 고칠 것이 있다.
- 모델 오류: LRM 수준, certainty가 접촉과 해석을 섞음, cites와 gloss의 이중 저장
- 사실 오류: 행 번호와 문단 번호 혼동, PG 84의 판본 오인
- 범위 문제: B0이 넓고, 승인 비용이 예산을 넘음

이 개정은 그 지적을 반영한다. 기존 결정은 유지한다: 모델 확장 1·2·3·5·7(부정 근거 제외), 대체 테스트 자동화, 화면 17·18·19는 B2, INTRO 설계 노트, 샘플 QC 후 파이프라인.

## 0. 확인된 사실 (출처 포함)
- **문단 번호.** 원문 문단은 빈 줄로 나뉜다(`tools/text.py` `load_paragraphs`). Werther 장면은 49–57행이지만 **para 25–28**이다. 원문은 리뷰 잡이 고치므로 para는 바뀔 수 있다.
- **Frankenstein.** 로컬 원문(PG 84)은 1831 본문 계열이다(169행 "daughter of a Milanese nobleman"). 그러나 PG 레코드에 판본 근거가 없다.
  - PG 41445 = 1818 텍스트(1818 Preface 포함)
  - PG 42324 = 1831 텍스트(Introduction과 Preface 포함)
- **원문 속 인용이 더 있다.** Coleridge "Ancient Mariner"(frankenstein-1), Wordsworth "Tintern Abbey"·P. B. Shelley "Mutability"(frankenstein-2)
- **Dorian Gray.** PG 174 = 1891 텍스트(PREFACE + XX장). Preface는 본문의 일부이므로 따로 context로 넣지 않는다.
- **Werther.** PG 2527 = Boylan 역. 첫 영역본은 1779년 Dodsley 간행이며, 프랑스어 번역에서 옮긴 중역이다. 역자는 Malthus 설이 유력하다. Mary Shelley의 1815년 독서 목록에 "Sorrows of Werter"가 있다(UK RED #13836, Feldman 편 *Journals*). 어느 번역본을 읽었는지는 알 수 없다.
- **확인된 paratext:**
  - Scott 서평: Blackwood's 2(12), pp. 613–20. HathiTrust 스캔과 Wikisource 교정 전사본이 있다.
  - Wells "Limits of Individual Plasticity": Saturday Review 1895-01-19. archive.org에 있다.
  - Mitchell의 Moreau 서평: 1896-04-11, 무서명. Mitchell이라는 귀속은 학계 판단(T3)이다.
  - Stevenson "A Chapter on Dreams": PG 614(*Across the Plains*)
  - Wilde의 1890년 편지: PG 33689(*Art and Morality*)
  - Poe의 Hawthorne 서평: Godey's 1847년 11월, eapoe.org
  - PG 512 = *Mosses*(1854 증보판 계열로 추정)

---

## 1. 결정됨: Frankenstein 읽기 텍스트 (사용자가 1818을 선택함)
결정 내용은 **PG 41445(1818)를 읽기 텍스트로 교체하고, PG 42324(1831)를 대조본 겸 Introduction 출처로 쓰는 것**이다.
- 이유 1: 판본 근거가 없는 PG 84는 텍스트 판정의 기준이 될 수 없다.
- 이유 2: 현대 비평판 다수가 1818을 쓴다.
- 영향: 기존 `frankenstein-1`·`-2`의 slug는 유지하고 원문만 바꾼다. 리뷰를 다시 해야 하고, 사용자의 기존 읽기 진도 위치가 어긋날 수 있다.

## 2. 데이터 모델 (개정 2를 대체)

### 2.1 LRM 4층
| 층 | 우리 노드 | 예 |
|---|---|---|
| Work | `work` | work:frankenstein |
| Expression (개정판·번역) | `text` | text:frankenstein-1818, text:frankenstein-1831, text:werther-boylan, text:werther-en-1779 |
| Manifestation | `edition` (선택) | 1818 Lackington 3권, 1831 Colburn & Bentley |
| Item | PG 파일 / 로컬 slug | `text.items: [{pg:41445, slugs:[frankenstein-1, frankenstein-2]}]` |

- note는 work 사이에 건다. locator와 gloss는 text(우리 slug)를 가리킨다.
- encounter의 `text` 필드는 선택이다. 모르면 비워 둔다.
- 사본 텍스트 판정(`copytext`)은 PG 두 판을 diff해서 probe를 자동으로 뽑아 정한다. Claude의 기억으로 probe를 만들지 않는다.
  - 판정이 안 되면 `unknown`으로 두고 경고만 한다. admitted는 막지 않는다.
  - collate는 로컬에서만 돌리고 결과만 커밋한다(`content/raw`는 gitignore).

### 2.2 locator (W3C Web Annotation 이름)
```json
{"source":"frankenstein-2","exact":"Sorrows of Werter","prefix":"…","suffix":"…","para":27}
```
- `exact`가 원본이다. `para`는 `check`가 `load_paragraphs` 기준(1부터, 헤딩 포함)으로 다시 계산해 갱신한다.
- 0곳에서 찾아지거나 2곳 이상에서 찾아지면 실패로 잡는다.
- 이 대조가 증명하는 것은 "우리 사본에 있다"까지다. 역사적 판본에 그 구절이 있는지는 copytext로 따로 판정한다.

### 2.3 근거: 레코드 단위, 두 축
```json
"ev":[{"src":"src:lcnaf-n79…","for":["name","born","died"],"nature":"secondary","access":"database","status":"machine"}]
```
- `nature`: `primary`·`secondary`
- `access`: `scan`·`transcription`(Wikisource 교정본 포함)·`database`·`citation`
- `status`: `unverified` → `machine` → `human`. 실물을 볼 수 없으면 `cited-unseen`으로 둔다.
- T0(Wikidata, Wikipedia, Claude의 기억)은 `leads`에만 둔다.
- 사실 필드는 평평한 값으로 둔다. 예: `"born":"1797-08-30"`
- `src:pg-*`는 books.json의 `gutenberg`에서 자동 생성한다.
- LC NAF는 id.loc.gov JSON 조회로 machine 상태가 된다.
- PROV-O 대응은 설계 노트에만 적는다.

### 2.4 person
- `work.author`는 person id 하나로 정한다. name heading과 creator index는 삭제한다.
- 필드: lccn, name, born, died, languages
- books.json의 author·year는 그대로 둔다. `first_pub`와 다르면 경고한다.

### 2.5 연결
| 연결 | 원본 데이터 | 근거 |
|---|---|---|
| gloss (각주) | `glosses.jsonl` | locator. allusion이면 target |
| `refers` note (cites에서 바꿈) | **gloss에서 계산**한다. mode는 `quotes`·`alludes`·`diegetic-reading` | gloss의 locator |
| encounter (작가의 독서) | `encounters.jsonl` (B2) | ev |
| `read` note | encounter에서 계산 (B2) | — |
| `rewrites`·`answers`·`shares-form` | edges.jsonl + readings | 양쪽 locator + reading |
| context | edges.jsonl | paratext 전사 + ev |

- 판정 순서의 맨 위가 `refers`가 된다.
- Creature가 책을 읽는 장면은 `diegetic-reading`이다. 작가의 독서와 구분한다.
- gloss는 필수 범위를 정한다. **라이브러리 작품을 가리키는 allusion과 인용만 필수**다. 일반 주석은 선택이다. 큐레이션 단어장 같은 유지 부담을 되풀이하지 않기 위해서다.

### 2.6 certainty를 두 값으로 분리
- **`contact`** (계산): from 작가가 to에 접촉한 근거.
  - 값: `documented`·`probable`·`none`
  - status ≥ machine인 ev만 계산에 쓴다.
  - refers → documented. read: primary → documented, secondary → probable.
- **`case`** (reading에 붙음): 해석 근거의 강도.
  - 값: `strong`·`moderate`·`speculative`
  - alignment 수, 대체 테스트 결과, 학계 거론(T3 src) 여부로 판단해 사람이 정한다.
- 화면: 선 모양은 contact, 굵기는 case로 표시한다.
- `contact=none`이어도 note를 둘 수 있다. 상호텍스트성은 영향 관계와 다르기 때문이다.

---

## 3. Norton 판 구현 (개정 2를 대체)

### 3.1 권별 구성 파일 `content/graph/dossiers/<work>.json`
실제 NCE의 Contexts 하위 제목은 편집자마다 다르다. 그래서 고정 enum 대신 작품별로 구성한다.
```json
{"work":"work:frankenstein","text":"text:frankenstein-1818",
 "note_on_text":"<편집자 메모 1문단>",
 "sections":[
   {"title":"Composition","items":["ctx:shelley-1831-intro","ctx:pbs-1818-preface"]},
   {"title":"The Creature's Reading","items":["gloss:frank-werter","gloss:frank-plutarch","gloss:frank-paradise-lost"]},
   {"title":"Reception, 1818","items":["ctx:scott-blackwoods-1818"]}],
 "bibliography":["src:…"]}
```

### 3.2 목록 카드 `#/record/<work>`의 고정 틀
| 순서 | 절 | 내용 |
|---|---|---|
| 1 | The Text | Read 버튼, 텍스트(Expression), copytext |
| 2 | A Note on the Text | 메모 + 판본 표 + 주요 이문(collate 결과) |
| 3 | Contexts | dossier의 sections 순서대로 표시 |
| 4 | Conversations | note와 reading. NCE의 Criticism 자리 |
| 5 | Chronology | 자동 생성 |
| 6 | Selected Bibliography | dossier의 `bibliography`. 편집자가 고른 더 읽을거리 |
| 7 | Sources cited | 이 카드의 ev가 참조한 src. 자동 생성 |

### 3.3 paratext 입고와 정정 목록
- 원문은 `content/contexts/<id>.txt`에 둔다. 서가에 꽂히지 않게 하기 위해서다. `build.py`는 합성 meta로 `build_book`을 호출해 읽기 화면을 만든다.
- 전사 경로는 우선순위가 있다: Wikisource 교정본 > PG > archive.org OCR 정리.
- OCR 정리는 편집 개입이다. 그래서 고친 내역을 `content/contexts/<id>.emend.jsonl`에 정정 목록으로 남긴다: `{para, from, to, reason}`. 화면에서는 Note on the Text 아래에 표시한다.
- 발췌는 context 엣지의 `excerpt`로 기록하고 화면에 […]로 보여준다.

### 3.4 Frankenstein 자료집 (B1 시범, 모두 PD)
- **Text**: 1818(PG 41445). 1831 이문은 Note on the Text에 둔다.
- **Composition**: 1831 Introduction(PG 42324), 1818 Preface(P. B. Shelley 작)
- **The Creature's Reading / Quotations**: Werter·Plutarch·Paradise Lost(diegetic-reading). Ancient Mariner·Tintern Abbey·Mutability(quotes).
- **Reception, 1818**: Scott, Blackwood's(Wikisource 전사)
- B2 이후 후보(호수와 스캔 미확인): Croker 서평(Quarterly 1818), P. B. Shelley "On Frankenstein"(1832), Peake *Presumption*(1823), *Six Weeks' Tour*(1817)

---

## 4. 승인 비용
- **관계 예산**: note와 reading, 주 20–25개(기존과 같음)
- **사실 예산**: 사람이 확인하는 사실은 작품당 5건 이하
  - LC NAF와 T1 quote는 machine으로 처리한다.
  - secondary 문헌을 볼 수 없으면 `cited-unseen`으로 두고, contact를 한 단계 낮춘다.
- Frankenstein 시범은 예외로 2주를 잡는다.

## 5. 실행 순서
1. **B0 샘플** (축소)
   - 데이터:
     - sources(PG는 자동 생성), person 4명(LC NAF machine)
     - work 4개(Frankenstein, Werther, Moreau, Birth-Mark), text·edition은 Frankenstein·Werther만
     - gloss: Creature의 독서 3개 + 인용 3개 → refers note 자동 계산
     - note 2개: Moreau answers Frankenstein, Birth-Mark answers Frankenstein
     - reading 2개(반론 1개 포함)
     - context 1개: 1831 Introduction
   - 코드: `catalog.py check`·`build`·`substitute`. collate는 Frankenstein 하나만 돌린다.
   - Frankenstein 원문 교체: §1 결정에 따른다.
2. **B1 화면**
   - 목록 카드 고정 틀. Chronology와 Sources cited는 후반에 붙인다.
   - 서류철: contact 선 모양, case 굵기, 반론 탭
   - 본문 각주: 인라인 위첨자 + `card.js` 팝오버
3. **QC1 관문**
   - 의도적 오류 8종이 각각 실패로 잡혀야 한다:
     1. 중복 note
     2. reading 없는 answers
     3. broader 순환
     4. 없는 text 참조
     5. 시간 역행
     6. quote가 0곳 또는 여러 곳에서 찾아짐
     7. unverified 근거만으로 admitted
     8. dossier가 없는 id를 참조
   - 대체 테스트를 수행하고, 사실 예산이 실제로 지켜지는지 측정한다.
   - QC1 직후 INTRO 설계 노트 초안을 쓴다(LRM, Web Annotation, PROV-O 대응 포함).
4. **B3' 파이프라인**: 작품 하나 = Waves 잡 하나.
   - 단계: src 자동 생성 → LC NAF → diff collate → gloss 제안 → note 제안 → substitute
   - 승인은 사람이 한다.
   - verify-ocr, encounters, Reception 확장은 이 단계에서 넣는다.
5. A1 나머지 → S1 → **B2**(encounters, read 계산, horizon, 화면 17·18·19) → A2 이후 → B4

## 6. 저장소 통합 규칙
- `catalog.build()`는 오프라인으로 돈다. admitted만 출력하고, 경고 때문에 CI가 막히지 않게 한다. `build.py`의 `main()` 끝에서 호출한다.
- `content/graph/`와 `content/contexts/`는 `pipeline.py deploy`가 커밋하지 않는다. 따로 커밋한다(B3'에서 deploy에 추가).
- `sw.js`: `SHELL_FILES`에 `catalog.js`·`doc.js`·`doc.css`를 추가하고 `VERSION`을 올린다.

## 7. 파일
- 원본 플랜 갱신: `docs/relations-plan.md`, `~/.claude/plans/norton-anthology-mossy-charm.md`
- 데이터:
  - `content/graph/`: `vocab.json`(enum과 라벨만), `sources.jsonl`, `nodes.jsonl`(person·work·text·edition·heading), `glosses.jsonl`, `edges.jsonl`, `readings.jsonl`, `dossiers/frankenstein.json`
  - `content/contexts/`: `shelley-1831-intro.txt`(+ `.emend.jsonl`)
- 코드:
  - 신규: `tools/catalog.py`(certainty 규칙 포함), `site/js/catalog.js`, `site/js/doc.js`, `site/css/doc.css`
  - 수정: `tools/build.py`, `site/js/app.js`, `site/js/reader.js`, `site/sw.js`
- 스킬: `.claude/skills/admit/SKILL.md`

## 8. 검증
- `python tools/catalog.py check`가 통과한다. 의도적 오류 8종은 각각 실패로 잡히고, 되돌리면 통과한다.
- Werther gloss의 para가 25–28 범위로 다시 계산된다. 원문을 한 줄 고쳐도 quote로 다시 찾아진다.
- Frankenstein collate(41445 vs 42324)가 copytext를 1818로 판정한다.
- 로컬 `cd site && python -m http.server 8765`에서 다음을 확인한다.
  - `#/record/frankenstein`의 7절과 Contexts 3개 절
  - 각주 → Werther 카드
  - `#/rel/island-of-doctor-moreau/frankenstein/answers`: contact=none(점선), case 표시
  - 기존 서가 책들이 그대로 읽힌다
  - 모바일 폭
- 커밋은 QC1 뒤에 사용자 확인을 받고 한다.


---

# 이전 버전 (리뷰 반영판, 2026-10-04)
개정 3과 충돌하는 부분은 개정 3을 따른다.


## ▶ 지금 실행할 범위: 작품명만으로 만드는 샘플 (B0 + B1 최소판)
원문은 가져오지 않는다. 관계 데이터는 작품명과 장 번호 수준의 위치만으로 작성한다. 목적은 모델·검증·화면이 한 바퀴 도는지 확인하는 것이다.

- **데이터** (`content/graph/`):
  - `vocab.json`: note 5종, 정의, 판정 순서, 필수 필드, 근거 규칙, INTRO·Wikidata·Genette 대응
  - `nodes.jsonl`: work 6개(Frankenstein, Sorrows of Young Werther, The Birth-Mark, Island of Doctor Moreau, Jekyll and Hyde, Dorian Gray), paratext 1개(Shelley 1831 Introduction), heading 몇 개(subject:maker-and-made, subject:double, 작가 이름들)
  - `edges.jsonl`: index·context·note
  - `readings.jsonl`: close-reading 해석 2–3개(alignment 포함)
- **locator 샘플 규칙**: `{ch, desc}`만 쓰고 `quote`는 비운다. `check`는 quote가 없는 locator를 원문과 대조하지 않고 `unanchored` 경고로만 표시한다. 나중에 quote를 채우면 원문 검사가 켜진다.
- **`tools/catalog.py`**:
  - `check`: SQLite 적재, PK/FK/UNIQUE, vocab.json 기반 필드·근거 규칙, 시간 역행, 고립
  - `build`: `site/data/graph.json` 생성
- **화면 최소판**: `site/js/catalog.js`, `site/js/doc.js`, `site/css/doc.css`. `site/js/app.js`에 `#/record/<work>`(Text·Contexts·Conversations·Shelved under)와 `#/rel/<from>/<to>/<type>`(claim, alignment 행, question) 라우트를 추가한다. `Read`는 기존 `#/read/<slug>`로 연결한다.
- 기존 서가 화면과 `content/books.json`은 건드리지 않는다. 진입은 URL로 직접 한다(샘플).
- **검증**:
  - `python tools/catalog.py check`가 통과한다.
  - 일부러 넣은 중복 note와 reading 없는 answers가 실패로 잡힌다(임시로 넣고 되돌림).
  - 로컬 서버에서 `#/record/frankenstein` → 서류철 → `Read`가 동작한다.

## Context
- Gutenberg PD 책을 골라 **한 권씩 입고**한다. 들일 때마다 기존 책들과의 관계로 꽂는다. Claude가 제안하고 사용자가 승인한다. 기존 원문(`content/sources/*.txt`)은 다시 쓴다.
- 데이터는 **그래프가 원본, 테이블로 검증**한다. 빌드 때 SQLite로 정규화해서 PK/FK/UNIQUE를 건다. 구절은 노드가 아니라 locator다. 공통 개념은 heading 노드 하나다.
- 프론트엔드는 책과 서가 컨셉을 유지한다. 누르면 책으로도, 문서로도 간다.
- 제3자 리뷰에서 지적된 점을 반영했다:
  - 인프라를 먼저 다 짓지 말고 스터디에서 먼저 검증한다.
  - close-reading 관계의 품질 기준과 구조를 세밀화한다.
  - "누가 누구를 읽을 수 있었나" 화면을 넣는다.
  - 미입고 책을 둘 서고 칸, 번역 판본, 승인 비용을 정한다.
- 추가 요구: **Norton Critical Edition처럼 paratext(서문·편지·서평·출처)를 1급으로 두고**, 그래프로 화면을 만들 때 close-reading을 세밀한 구조로 보여준다.

---

## 1. 데이터 모델

### 노드 2종
| 노드 | 속성 |
|---|---|
| `work` | title, year, `form`(novel·story·**preface·letter·essay·review·source**), volumes[], accession, `translation`{translator, year}(번역 작품만), status(`admitted`·`stacks`) |
| `heading` | kind(subject·name·periodical), label, scope, wikidata. 이름 heading에는 born·died |

paratext도 `work` 노드다(`form`으로 구분). 원문 파일이 있으면 본문 화면에서 읽을 수 있다. **PD가 아닌 것은 노드로 만들지 않고 evidence의 서지 참조로만** 남긴다(예: Forster 1947 서문).

### 엣지 3종
| 엣지 | 방향 | 용도 |
|---|---|---|
| `index` | work → heading | role: creator·enacts·published-in. loci[] |
| `context` | paratext work → work | role: preface·letter·review·source·composition. Norton의 "Contexts" 절 |
| `note` | work → work | 관계. 아래 5종 |

### note 종류 5개 (판정 가이드 포함)
| type | 판정 기준 (위에서부터 처음 맞는 것) | 하위 `mode` |
|---|---|---|
| `cites` | 본문이 상대 작품·작가를 **이름으로 부르거나 인용**한다 | name, quote, reading-scene |
| `read` | 작가가 상대를 **읽었다는 외부 기록**이 있다 (본문 언급 없음) | — |
| `rewrites` | 상대의 **플롯·인물·장면을 가져와 변형**한다 | continuation, parody, inversion, transposition |
| `answers` | 장면은 다르지만 **같은 질문에 다른 답**을 낸다 | — |
| `shares-form` | 내용이 아니라 **서술 형식·장치**를 물려받는다 | frame, epistolary, found-manuscript, … |

모티프 공유와 같은 지면 게재는 note로 쓰지 않는다. 같은 heading을 공유하면 성립한다.

### 관계 어휘는 데이터 파일 — `content/graph/vocab.json`
note 종류, 각 종류의 정의, 판정 순서, 필수 필드, 근거 규칙, 외부 대응을 담는다. `check`와 화면은 이 파일만 읽는다. 다른 기관 기준을 도입하거나 확장할 때는 이 파일만 고친다.

| 우리 | INTRO | Wikidata | Genette |
|---|---|---|---|
| work | F2 Expression / `INT16_Segment`(우리 판본) | 작품 QID | — |
| locator | `INT21_TextPassage` | — | — |
| heading(subject) | `INT4_Feature`(`INT_Motif`·`INT_Theme`) | P6962 / P921 | — |
| index enacts + loci | `INT2_ActualizationOfFeature` (`R17`) | — | — |
| note | `INT31_IntertextualRelation` (`R13` from, `R12` to). type = `INT11_TypeOfInterrelation` 인스턴스 | rewrites→P144/P4969, read·answers→P737 (정보가 줄어듦) | cites=intertextuality, rewrites=hypertextuality, shares-form≈architextuality |
| reading | `INT_Interpretation`, `R21_identifies` | — | — |
| alignment.same | `R22_providesSimilarityForRelation` | — | — |
| context | — | — | paratextuality |

- 3개 이상 텍스트 사이의 관계(INTRO 허용)는 heading으로 표현한다. note는 방향 있는 쌍 관계만 다룬다.

### 관계와 해석의 분리 (INTRO의 R21_identifies)
- `note` = 관계 자체. PK `(from, to, type)`, evidence(text·reading·venue 등 사실 근거).
- `reading` = 그 관계에 대한 해석 하나. note당 여러 개 가능하다(스터디원별 해석 포함).
```json
{"note":["work:island-of-doctor-moreau","work:frankenstein","answers"],
 "by":"mingon","date":"2026-10-20",
 "claim":"한 문장 논지",
 "alignments":[
   {"from":{locator},"to":{locator},
    "same":"두 구절이 공유하는 것 (한 문장)",
    "differs":"from이 to와 어떻게 다른가 (한 문장)"}],
 "question":"스터디 토론 질문 하나", "status":"proposed"}
```
- 파일: `content/graph/readings.jsonl`. SQLite 테이블은 `readings(PK reading_id, FK note)`, `alignments(PK reading_id, seq)`.
- rewrites·answers·shares-form note는 승인된 reading이 1개 이상 있어야 한다.
- alignment는 1–3쌍이다. 각 쌍이 "같은 점 → 다른 점"을 구절 단위로 보여준다.
- `claim`은 alignment들의 "다른 점"이 모여서 무엇을 말하는지를 쓴다.

### 품질 기준 (admit 스킬에 수록, 승인 때 적용)
- **대체 테스트**: 한쪽 작품을 같은 서가의 다른 작품으로 바꿔도 claim이 참이면 너무 일반적이다 → 거부.
- `same`과 `differs`는 구절 안의 구체적 행위·이미지·말을 가리켜야 한다. 주제어("오만", "정체성")만으로 쓰면 거부.
- `differs`가 없으면 그건 관계가 아니라 모티프 공유다 → note 대신 index로 처리.
- 스킬에 좋은 예와 나쁜 예를 각 5개씩 둔다(A1에서 실제로 만든 것으로 채운다).
- `check`가 기계적으로 강제하는 것: 종류별 필수 필드, alignment ≥1, 양쪽 locator가 원문에서 찾아짐, 문장 길이 상한, 근거 규칙.

### 근거 규칙
| 엣지 | 필요한 evidence |
|---|---|
| cites | `text` locator (from 쪽) |
| read | `reading`(UK RED, 장서 목록) 또는 `paratext`(편지·일기) 또는 `scholarship`(서지 참조) |
| rewrites·answers·shares-form | alignment(양쪽 locator) + `close-reading` |
| context | paratext 원문이 존재함 |
| index enacts / published-in | locator / `venue` |

번역 작품: `cites`·`read`의 대상이 번역 작품이면, 영국·미국 작가가 접할 수 있었던 **영역 연도**(`translation.year`)를 시간 검사에 쓴다.

---

## 2. 화면 (그래프에서 만드는 뷰)

### 목록 카드 `#/record/<work>` — Norton Critical Edition 구성
1. **The Text**: `Read` 버튼, 판본·번역 정보.
2. **Contexts**: context 엣지로 이어진 paratext들(서문, 편지, 서평, 출처). 각각 본문으로 열린다.
3. **Conversations**: 들어오고 나가는 note. 종류별로 묶고, 각 줄에 claim 한 문장. 누르면 서류철.
4. **Shelved under**: heading 서가들.
5. **Reading horizon**: 이 작품을 쓸 때 작가가 읽을 수 있었던 라이브러리 작품들. 연도와 영역 연도로 계산한다. `cites`·`read` 근거가 있는 것은 진하게, 나머지는 흐리게 표시한다.

### 서류철 `#/rel/<from>/<to>/<type>` — close-reading 세밀 뷰
- reading이 여러 개면 탭으로 나눠 보여준다(작성자, 날짜).
- 위: claim.
- 가운데: alignment마다 한 줄. 왼쪽 구절 | 가운데 `same` / `differs` | 오른쪽 구절. 각 구절에 `Open in book`(본문 해당 문단으로).
- 아래: 토론 question, evidence 목록.
- 좁은 화면에서는 구절 → same/differs → 구절 순으로 세로로 쌓는다.

### 서가
- 열람실 `#/`: 신착 서가(입고순), heading 서가들, 그리고 맨 아래 **서고**(입고 전이지만 읽을 수 있는 책들, 지금의 180여 권).
- heading 서가 `#/shelf/<heading>`: 연도순 책등. 그 아래에 "이 서가 안의 대화"로, 서가 안 작품들 사이의 note 목록을 보여준다.
- 작가 서가 `#/shelf/name:<id>`: 쓴 작품, 그리고 그 작가의 Reading horizon 전체(생애 기준).

### 본문
- 여백 표시: alignment·index·context의 locator. 누르면 `card.js` 팝오버로 해당 서류철이나 서가를 보여준다.

---

## 3. 승인 비용과 웨이브 크기
- 추정: note 하나 검토에 3–5분(서류철 화면으로 보고 수정). **주당 승인 예산은 20–25개**로 잡는다(사용자 조정).
- 웨이브 크기 = 예산에 맞춘 **작품 5–7개(note 약 20–30개)**.
- 검토는 로컬 미리보기 `?drafts=1`에서 proposed 상태의 서류철을 같은 화면으로 보고, `python tools/pipeline.py admit <work> --accept …`로 승인한다.
- 작품 완료 기준: enacts index ≥1, note ≥2(그중 close-reading ≥1). 가능하면 context ≥1.
- 웨이브 완료 기준: 모든 작품 연결, `check` 통과, 스터디에서 서류철 1개 이상 사용.

---

## 4. 웨이브 계획
**순서**: B0 → A1 → B1 → S1(스터디 검증 관문) → B2 → A2 → A3 → B3 → A4… → B4

### B0 — 최소 토대
- `content/graph/nodes.jsonl`, `content/graph/edges.jsonl`, `content/graph/readings.jsonl`, `content/graph/vocab.json`(note 5종 + INTRO·Wikidata·Genette 대응).
- `tools/catalog.py check`: SQLite 적재, 제약, vocab.json 기반 근거·필드 규칙, locator, 시간 역행(영역 연도 반영).
- `.claude/skills/admit/SKILL.md`: 입고 절차, note 5종 판정 가이드, 품질 기준.
- 자동화(scan-mentions, wikidata, n-gram)는 넣지 않는다.

### A1 — 창조자와 피조물 (손으로 입고, 7작품 + paratext)
- 작품: Frankenstein · Sorrows of Young Werther · The Birth-Mark · Rappaccini's Daughter · Island of Doctor Moreau · Jekyll and Hyde · Dorian Gray
- paratext: Shelley 1831 Introduction, Stevenson "A Chapter on Dreams"
- 예상 note:
  - Frankenstein cites Werther (reading-scene)
  - Moreau answers Frankenstein
  - Birth-Mark·Rappaccini answers Frankenstein
  - Dorian rewrites Jekyll? → 대체 테스트로 판정
- 결과로 품질 기준의 좋은 예·나쁜 예를 채운다.

### B1 — 최소 화면 (첫 배포)
- `tools/build.py`: `site/data/library.json`, `marks`.
- `site/js/catalog.js`(로드, 인접 Map, `hrefFor`), `site/js/doc.js` + `site/css/doc.css`(목록 카드의 Text·Contexts·Conversations·Shelved under, 서류철).
- 본문 여백 표시, 라우트 `record`·`rel`.
- 열람실: 신착 서가 + **서고**(기존 책은 모두 서고에 남는다).

### S1 — 스터디 검증 (관문)
- 스터디 1회를 A1의 서류철 2–3개로 진행한다.
- 확인할 것: question이 토론을 만드는지, alignment가 읽히는지, 어떤 화면을 실제로 썼는지.
- 결과로 품질 기준, 서류철 레이아웃, note 종류를 조정한 뒤에 B2로 간다.

### B2 — 서가와 Reading horizon
- heading 서가와 "서가 안의 대화", 작가 서가.
- 목록 카드의 Reading horizon 절.
- pull-out한 책에 `Read`·`Catalog card` 버튼.

### A2 — 고딕과 분신 (6–7작품)
Fall of the House of Usher · Haunted and the Haunters · Canterville Ghost · Turn of the Screw · Yellow Wallpaper · Northanger Abbey · Dracula

### A3 — 탐정 (6–7작품, 홈스 단편은 대표 2편)
Murders in the Rue Morgue · Purloined Letter · Study in Scarlet · Scandal in Bohemia · Blue Cross · Mysterious Affair at Styles · Hound of the Baskervilles
- 근거: cites(Watson의 Dupin), venue(Graham's, The Strand).

### B3 — 자동화 (웨이브가 커지기 전에)
- `catalog.py scan-mentions`(본문 속 작품·작가 이름), `catalog.py wikidata <work>`, `candidates`(heading 공유 + n-gram).
- `tools/pipeline.py`의 입고 단계 `unindexed → proposed → admitted` 와 control queue `feed` 연동. 승인은 사람 관문으로 남긴다. `PIPELINE.md`에 A 웨이브 표.

### A4 이후 (각 5–7작품)
- 2026-10-07: A4–A14를 서고 책으로 확정해 그래프 웨이브 G7–G17로 등록했다. 작품 목록과 관계 후보는 `docs/graph/PLAN.md` §8과 `docs/graph/steps.json`이 원본이다. 아래는 처음 잡은 초안이다.
- A4: 과학 로맨스 1 (Time Machine, War of the Worlds, Machine Stops, Journey to the Centre, Lost World…)
- A5: 과학 로맨스 2와 유토피아 (Flatland, Micromegas, Herland, Diamond Lens…)
- A6: 미국 로맨스 (Irving → Hawthorne → Poe → Melville; paratext: Poe의 Hawthorne 서평, "Hawthorne and His Mosses")
- A7: 풍자 (Candide, Modest Proposal, Hadleyburg…)
- A8–A9: 단편 형식 (Overcoat, Necklace, Chekhov, Joyce, Mansfield…)
- 장편 import 웨이브가 원문을 확보하는 대로 기존 서가에 붙인다.

### B4 — 데이터 공개
- `graph.jsonld`와 `library.sqlite` export. JSON-LD는 vocab.json의 대응표로 INTRO 어휘를 쓰고, Wikidata는 `sameAs`로 단다. README 데이터셋 절, CC BY.
- 확인: CWRC 온톨로지의 read·knew 대응 여부. 대응이 있으면 vocab.json에 열을 추가한다.

---

## 5. 수정 및 신규 파일
- 신규: `content/graph/nodes.jsonl`, `content/graph/edges.jsonl`, `content/graph/readings.jsonl`, `content/graph/vocab.json`, `tools/catalog.py`, `.claude/skills/admit/SKILL.md`, `site/js/catalog.js`, `site/js/doc.js`, `site/css/doc.css`, paratext 원문(`content/sources/`)
- 수정: `tools/build.py`, `tools/pipeline.py`(B3), `PIPELINE.md`(B3), `site/js/app.js`, `site/js/library.js`, `site/js/reader.js`, `site/sw.js`, `README.md`(B4)

## 6. Verification
- B0: `python tools/catalog.py check`가 다음을 각각 실패로 잡는다.
  - 중복 note
  - 없는 heading 참조
  - alignment 없는 answers
  - 영역 연도보다 앞선 cites
- A1: 7작품이 모두 연결되고, 모든 close-reading note가 품질 기준 체크리스트를 통과한다(승인 기록에 남김).
- B1: 로컬 `cd site && python -m http.server 8765`에서 다음을 확인한다.
  - 신착 서가 → 책 → 목록 카드(Contexts에 Shelley 서문) → 서류철(alignment 행) → `Open in book` → 해당 문단
  - 서고의 기존 책들이 그대로 읽힌다
  - 모바일 폭
- S1: 스터디 피드백을 기록하고, 그에 따른 조정 사항을 반영한 다음에 B2를 시작한다.
- B2: Moreau 목록 카드의 Reading horizon에 Frankenstein이 진하게(근거 있음), 다른 1896년 이전 작품들이 흐리게 보인다.

---

## 7. 재개 메모 (구현 시작 전 확인된 사실)
- 이 문서가 최신 계획이다. 이전 라운드(Work/Passage 노드 분리, 4 테이블 RDB, 시대 사전 등)는 모두 폐기됐다.
- `site/data/`는 `.gitignore`에 있다. CI(`.github/workflows/pages.yml`)는 `python tools/build.py`만 실행한다. 그래서 `graph.json` 생성은 `tools/build.py`의 `main()` 끝에서 `catalog.py`의 build 함수를 호출하는 식으로 연결해야 배포에 반영된다.
- 샘플 작품의 원문 slug(모두 reviewed, `site/data/books/`에 빌드됨):
  - `frankenstein-1`, `frankenstein-2`
  - `sorrows-of-young-werther`
  - `birth-mark`
  - `island-of-doctor-moreau-1`, `island-of-doctor-moreau-2`
  - `jekyll-and-hyde`
  - `dorian-gray-1`, `dorian-gray-2`
  - `rappaccinis-daughter`
- 프론트엔드는 vanilla ES modules에 해시 라우터(`site/js/app.js`의 `route()`)를 쓴다. 페이지 레이아웃은 `.page`, `.panel`(`site/css/pages.css`)이고, 색은 `site/css/tokens.css` 변수를 쓴다. 본문 링크는 `#/read/<slug>[/<para>]`이다.
- 다음 단계: 맨 위 "▶ 지금 실행할 범위"(샘플 B0 + B1 최소판)부터 실행한다.
