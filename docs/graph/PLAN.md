# 관계 도서관 개정 4: 그래프가 도서관이 된다

## Context
B0/B1에서 만든 것은 관계를 문서 페이지(목록 카드 `#/record`, 서류철 `#/rel`)로 보여 줬다. 그래프 화면(`#/graph`)은 그 뒤에 덧붙인 정적인 SVG였다. 사용자 평가는 이렇다.
- 그래프가 예쁘지 않고 동적이지 않다.
- 노드를 열면 문서가 나오는 구조가 이상하다. **노드를 열면 책이 나와야 한다.**
- 위키백과처럼 한 장씩 들어가 보는 구조로는 책이 늘어나도 텍스트끼리 유기적으로 엮이지 않는다.

사용자 결정:
- 책장과 그래프를 전환하는 구조로 한다.
- 노드는 읽을 수 있는 책 전부(약 190권)로 한다.
- 근거 데이터는 유지하고, 화면에서는 책의 뒷부분(부록·각주)으로 옮긴다.
- 관계 내용을 어디서 보여 줄지는 답이 없었다. 기본안은 **그래프 선 위 팝오버 + 책 여백 표시**이고, 두 책 나란히 읽기는 뒤로 미룬다.

유지하는 것:
- `content/graph/` 데이터
- `tools/catalog.py`(check·build·collate·authority), `tools/test_catalog.py`
- 1818 Frankenstein, `content/contexts/`
- 리더 각주

## 1. 화면 구조
```
책장 ⇄ 그래프   (상단 토글, 같은 책들)
   │        │
   │    노드 클릭 → 책이 노드에서 튀어나옴(pull-out) → Read → 리더
   │    선 hover/클릭 → 선 위 팝오버: claim, 대응 구절 2–3쌍, 질문, "구절로 가기"
   ↓
 리더: 관계 구절 여백 표시 → 상대 책 해당 문단으로 점프 / "그래프에서 보기"
       책 끝 부록: Contexts(서문·서평), A Note on the Text, Sources
```
- `#/record`와 `#/rel` 문서 페이지, `doc.js`의 렌더 부분은 없앤다. 각주 카드 함수(`glossMarks`, `glossCard`)는 `reader` 쪽으로 옮긴다.
- 책장 화면(`site/js/library.js`)은 그대로 둔다. 상단 토글로 `#/`(책장)와 `#/graph`를 오간다.

## 2. 그래프 화면 (G1)
- **엔진**: `force-graph`(vasturiano, Canvas, d3-force 기반)를 `site/vendor/`에 넣는다. CDN을 쓰지 않는 이유는 오프라인 PWA이기 때문이다. 직접 만든 SVG 시뮬레이터(`graph.js`)는 버린다.
  - 연속 물리 시뮬레이션, 부드러운 줌·팬, 노드 드래그, 관성을 쓸 수 있다.
  - 190개 노드와 수백 개의 선도 60fps로 그린다.
- **노드 = 책**:
  - 사각형 책 모양을 Canvas로 그린다. 색은 책장 책등 색(`books.json` `spine.color`), 금박 띠는 `cover.accent`를 쓴다. 책장과 같은 책이라는 것이 한눈에 보이게 한다.
  - 크기는 관계 수에 비례한다. 관계 없는 책은 작고 흐리게 표시한다.
  - 여러 권으로 나뉜 책(series)은 노드 하나로 묶는다.
- **선**: 두 층으로 그린다.
  - **관계(note)**: 진하게 그린다. 방향을 따라 입자가 흐른다(오래된 작품 → 새 작품, 영향의 흐름).
    - 선 모양 = contact: 실선 / 파선 / 점선
    - 굵기 = reading의 case
    - 색 = 관계 종류
  - **자동 약한 연결**: 같은 작가는 아주 옅은 선으로 잇는다. 같은 서가(heading)·장르는 선 없이 군집 힘으로만 모은다. 그래야 덩어리로 읽히고 털뭉치가 되지 않는다.
- **상호작용**:
  - hover: 이웃만 밝아지고 나머지는 어두워진다. 책 제목·작가·연도 툴팁이 뜬다.
  - 노드 클릭: 카메라가 노드로 줌인한다. 이어서 책장과 같은 **pull-out** 애니메이션으로 책이 튀어나온다(`library.js` `pullOut`·`openBook` 재사용, 출발 위치만 노드 좌표). 패널에는 표지, 제목, 작가, "이 책과 이어진 책" 목록, **Read**가 있다.
  - 선 클릭: 선 중간에 팝오버를 띄운다. 내용은 claim, 대응 구절 쌍(같은 점/다른 점), 토론 질문이다. 각 구절에 "이 구절로" 링크가 있다(`#/read/<slug>/<para>`). 반론 reading이 있으면 탭으로 보여 준다.
  - 필터 칩: 관계 종류, 장르. 연도 슬라이더로 그 해까지 나온 책만 남긴다.
  - 검색창: 제목을 입력하면 카메라가 그 노드로 이동한다.
- **책장 ⇄ 그래프 전환**: 토글을 누르면 책장의 책등들이 페이드되고 그래프가 줌아웃으로 나타난다. 처음에는 간단한 크로스페이드로 하고, 책이 날아가는 연출은 G3 이후에 한다.
- **URL**: `#/graph`, `#/graph/<slug>`(그 책에 포커스). 리더의 "그래프에서 보기"는 `#/graph/<slug>`로 간다.
- **2026-10-06 G1 확인 피드백(G1-09~G1-16)**: 그래프를 3D(3d-force-graph, 책 상자 노드)로 옮기고 2D는 WebGL이 없을 때와 2D|3D 전환용으로 남긴다. 작가마다 작가 노드를 두어 그 작가의 책을 묶는다(같은 작가 옅은 선을 대신함). 작가 노드는 사이트 안의 작가 문서 `#/author/<slug>`(원본 `content/authors/<slug>.md`, 영어 설명문 + Sources)로 이어진다. 관계마다 방향이 있는 문장('X answers Y')과 관계 종류 정의를 선 툴팁·팝오버·Key·책 패널·리더 카드에 보인다.

## 3. 리더 통합 (G2)
- **관계 여백 표시**: 이 책의 구절이 어떤 reading의 alignment에 들어 있으면 그 문단 옆에 상대 책 이름 표식을 단다(예: "↔ Moreau"). 누르면 카드가 뜬다. 카드에는 same/differs 한 줄과 상대 구절이 있고, 상대 책의 해당 문단으로 바로 가는 링크가 있다. 기존 각주 마커와 같은 방식으로 `reader.js`의 `withMarks`를 확장한다.
- **책 끝 부록**: 마지막 권의 "The End" 뒤에 부록을 붙인다. 내용은 dossier 데이터에서 만든다.
  - Contexts: 서문·서평. 누르면 `ctx-*` 텍스트를 리더로 연다.
  - A Note on the Text: 판본 메모와 collation 결과
  - Sources
  - 같은 내용을 목차(TOC) 패널에도 "Appendix" 항목으로 넣는다.
- **리더 상단**: "그래프에서 보기" 버튼을 둔다.

## 4. 데이터·빌드 변경
- `catalog.build()`가 **읽을 수 있는 모든 책**을 노드로 내보낸다.
  - `content/graph/nodes.jsonl`에 없는 책은 `books.json`에서 가벼운 노드를 자동 생성한다: id `work:<series 또는 slug>`, title, author 문자열, year, genre, spine, slugs.
  - 등록된 work는 그 정보를 덮어쓴다.
- graph.json에 들어가는 것:
  - 노드: id, title, author, year, genre, spine, slugs, degree, status
  - 관계: notes + readings(+ 구절 문단 번호)
  - 같은 작가 연결
  - 부록 데이터(dossiers, contexts, collate, sources)
- `check` 규칙과 테스트는 그대로 둔다.
- `?drafts=1`로 proposed를 보는 방식도 그대로 둔다.

## 5. 실행 순서
1. **G1 그래프**: vendor 추가, `site/js/graph.js` 재작성, 토글, 노드 pull-out, 선 팝오버, 필터, 검색. `catalog.build` 확장.
2. **G2 리더**: 관계 여백 표시, 상대 책 점프, 부록, "그래프에서 보기". `#/record`·`#/rel`과 `doc.js`의 문서 렌더 삭제.
3. **G3 데이터 키우기**: A1 나머지(Rappaccini, Jekyll, Dorian + Stevenson "A Chapter on Dreams", Wilde 편지)를 파이프라인 잡으로 진행한다. 사람이 승인한다. 이후 A2 고딕, A3 탐정으로 이어간다.
4. **G4 연출·확장**: 책장 → 그래프 책 비행 전환, 두 책 나란히 읽기, 타임라인 레이아웃 토글.

## 6. 파일
- 신규: `site/vendor/force-graph.min.js`(라이선스 주석 포함)
- 재작성: `site/js/graph.js`
- 수정:
  - `site/js/app.js`(라우트 정리, 토글)
  - `site/index.html`(토글, vendor 스크립트)
  - `site/js/library.js`(`pullOut`이 임의 시작 좌표를 받도록)
  - `site/js/reader.js`(관계 여백, 부록, 그래프 버튼)
  - `site/js/card.js`
  - `site/css/doc.css` → `site/css/graph.css`로 이름 변경 후 정리
  - `site/sw.js`(파일 목록, VERSION)
  - `tools/catalog.py`(모든 책 노드, 작가 연결, degree)
- 삭제: `site/js/doc.js`의 record/rel 렌더(각주 헬퍼는 `reader` 쪽으로 이동)

## 7. 검증
- `python tools/test_catalog.py`가 통과한다. `python tools/build.py`의 graph.json 노드 수는 ready 책 수(series를 묶은 수)와 같다.
- 로컬 `python -m http.server 8765`와 Playwright(Chrome)로 확인한다.
  - `#/graph`: 노드 수, 콘솔 오류 0, 60fps 근처(성능 패널 또는 rAF 측정)
  - Frankenstein 노드 클릭 → pull-out 패널 → Read → `#/read/frankenstein-1`
  - Moreau–Frankenstein 선 클릭 → 팝오버에 claim과 구절 2쌍, "이 구절로" → 해당 문단
  - 리더 `frankenstein-1`의 "breathless horror" 문단에 "↔ Moreau" 표식 → Moreau 해당 문단으로 점프
  - Frankenstein 마지막 권 끝 부록에 1831 Introduction 링크
  - 책장 ⇄ 그래프 토글, 모바일 폭(390px)에서 터치 줌·팬
- 스크린샷을 사용자에게 보여 주고 디자인 피드백을 받은 뒤 G2로 넘어간다.

## 8. 웨이브 (Waves 프로젝트 `library-graph`)
2026-10-06 사용자 지시로 이 플랜을 컨트롤센터 프로젝트로 등록했다. 단계 목록과 선행 조건의 원본은 `docs/graph/steps.json`, 완료 기록은 `docs/graph/LOG.md`, 상태는 `python tools/graph_pipeline.py next`.

| Wave | 내용 |
|---|---|
| G1 | 그래프 화면: force-graph, 책 모양 노드, pull-out, 선 팝오버, 필터·검색, 책장 ⇄ 그래프 토글 → 사용자 디자인 확인 → 배포 |
| G2 | 리더 통합: 관계 여백 표시와 상대 문단 점프, 책 끝 부록, "그래프에서 보기", 문서 페이지 제거 → 사용자 확인 → 배포 |
| G3 | A1 나머지 데이터: Rappaccini, Jekyll(+A Chapter on Dreams), Dorian(+1891 Preface) → 사용자 승인 → 배포 |
| G4 | 연출·확장: 책장 → 그래프 책 비행 전환, 두 책 나란히 읽기, 타임라인 레이아웃 → 사용자 확인 → 배포 |
| G5 | A2 고딕과 분신 데이터 → 사용자 승인 → 배포 |
| G6 | A3 탐정 데이터 → 사용자 승인 → 배포 |
| G7 | A4 과학 로맨스 1: Journey to the Centre · Twenty Thousand Leagues · Time Machine · Invisible Man · War of the Worlds · Lost World · Machine Stops |
| G8 | A5 과학 로맨스 2와 유토피아: Gulliver's Travels · Micromégas · Diamond Lens · Flatland · Country of the Blind · Herland |
| G9 | A6 미국 로맨스: Rip Van Winkle · Sleepy Hollow · Young Goodman Brown · Minister's Black Veil · Scarlet Letter · House of the Seven Gables · Moby-Dick (paratext 후보: Poe의 Twice-Told Tales 서평, Melville "Hawthorne and His Mosses") |
| G10 | A7 풍자: Modest Proposal · Candide · Connecticut Yankee · £1,000,000 Bank-Note · Hadleyburg · Tobermory |
| G11 | A8 단편 형식 1 — 외투에서: Overcoat · Bartleby · Notes from Underground · Necklace · Vanka · The Bet · Lady with the Dog |
| G12 | A9 단편 형식 2 — 깨달음의 순간: Story of an Hour · Paul's Case · Araby · The Dead · Jury of Her Peers · Winesburg, Ohio · Garden Party |
| G13 | A10 바다와 표류: Sindbad · Robinson Crusoe · Descent into the Maelström · Treasure Island · Open Boat · Lord Jim · Sea-Wolf |
| G14 | A11 제국과 모험: King Solomon's Mines · Man Who Would Be King · Heart of Darkness · Kim · Passage to India · Moon and Sixpence |
| G15 | A12 결혼과 여자의 선택: Pride and Prejudice · Jane Eyre · Wuthering Heights · Madame Bovary · Awakening · House of Mirth · Age of Innocence |
| G16 | A13 범죄와 의심: Gold-Bug · Moonstone · Sign of the Four · Hammer of God · Man Who Was Thursday · Secret Agent · Thirty-Nine Steps |
| G17 | A14 공포 단편과 고백하는 화자: Tell-Tale Heart · Black Cat · Cask of Amontillado · Signal-Man · Body Snatcher · Monkey's Paw · Oh, Whistle |
| G18 | A15 동화 1 — 영혼과 변신: Beauty and the Beast · Little Mermaid · Fisherman and His Soul · Snow Queen · Marsh King's Daughter · Two Brothers · Light Princess |
| G19 | A16 동화 2 — 이야기 속 이야기와 말하는 짐승: Camaralzaman · Enchanted Horse · Selected Fables · Kaa's Hunting · Rikki-Tikki-Tavi · King of the Golden River · Reluctant Dragon |
| G20 | A17 디킨스와 빅토리아의 아이들: Oliver Twist · Christmas Carol · Hard Times · Tale of Two Cities · Great Expectations · Silas Marner |
| G21 | A18 미국의 강과 개척지: Last of the Mohicans · Jumping Frog · Luck of Roaring Camp · Outcasts of Poker Flat · Tom Sawyer · Huckleberry Finn · Bride Comes to Yellow Sky (paratext 후보: Twain "Fenimore Cooper's Literary Offenses") |
| G22 | A19 모험과 위장 신분: Kidnapped · Around the World · Prisoner of Zenda · Scarlet Pimpernel · Phantom of the Opera · Three Men in a Boat |
| G23 | A20 도시의 범죄 단편: Red-Headed League · Speckled Band · Blue Carbuncle · After Twenty Years · Cop and the Anthem · Ransom of Red Chief |
| G24 | A21 아이러니 결말: Gift of the Magi · Pair of Silk Stockings · Lottery Ticket · Last Leaf · Furnished Room · Busy Broker · Désirée's Baby |
| G25 | A22 오싹한 반전: Owl Creek Bridge · Open Window · Upper Berth · Phantom Rickshaw · Masque of the Red Death · Magic Shop · Door in the Wall |
| G26 | A23 자연과 생존: Call of the Wild · White Fang · To Build a Fire · Interlopers · Red Badge of Courage · The Star |
| G27 | A24 러시아와 프랑스 장편: Hero of Our Time · Fathers and Sons · Crime and Punishment · Gambler · What Men Live By · Ivan the Fool · Germinal |
| G28 | A25 시골과 운명: Cranford · North and South · Warden · Far from the Madding Crowd · Mayor of Casterbridge · Tess · Jude |
| G29 | A26 Austen과 Brontë 2: Sense and Sensibility · Mansfield Park · Emma · Persuasion · Agnes Grey · Tenant of Wildfell Hall · Villette |
| G30 | A27 Henry James와 국제 주제: Daisy Miller · Washington Square · Aspern Papers · Room with a View · Howards End · Good Soldier · Ethan Frome |
| G31 | A28 모더니즘 장편: Portrait of the Artist · Sons and Lovers · Voyage Out · Jacob's Room · This Side of Paradise · Great Gatsby · Sun Also Rises |
| G32 | A29 미국의 도시와 평원: Sister Carrie · The Jungle · O Pioneers! · My Ántonia · Babbitt · Diamond as Big as the Ritz · Billy Budd |
| G33 | B1 고딕의 근원*: Castle of Otranto · Mysteries of Udolpho · The Monk · Vathek · The Vampyre · Carmilla · Melmoth the Wanderer |
| G34 | B2 분신과 기이한 것*: William Wilson · Oval Portrait · The Sandman · The Double · The Nose · Diary of a Madman · The Horla |
| G35 | B3 소설의 원형*: Don Quixote · Pilgrim's Progress · Joseph Andrews · Rasselas · Vicar of Wakefield · Tristram Shandy |
| G36 | B4 러시아 2*: Poor Folk · Death of Ivan Ilyich · Anna Karenina · Kreutzer Sonata · Dead Souls · The Darling · Ward No. 6 |
| G37 | B5 빅토리아 장편 2*: Woman in White · Lady Audley's Secret · Bleak House · David Copperfield · Vanity Fair · Middlemarch · Wives and Daughters |
| G38 | B6 아동문학의 계보*: Alice · Through the Looking-Glass · Water-Babies · Little Women · Wizard of Oz · Peter and Wendy · Wind in the Willows |
| G39 | B7 미국 르네상스 2*: Celestial Railroad · Dr. Heidegger's Experiment · Feathertop · Benito Cereno · Typee · Uncle Tom's Cabin |
| G40 | B8 유토피아와 미래*: Looking Backward · News from Nowhere · Erewhon · Coming Race · From the Earth to the Moon · First Men in the Moon |
| G41 | B9 식민과 남태평양*: She · Beach of Falesá · Almayer's Folly · Jungle Book · Swiss Family Robinson · Coral Island |

- \* = 서고에 없는 책. 목록은 `docs/graph/imports.json`(59권). 그 단계는 steps.json의 `books` 필드를 가지며, 책 파이프라인이 그 책을 서고에 올리기 전(원문 + reviewed)에는 `graph_pipeline.py`가 선행 대기로 둔다. 그래프 job은 books.json·content/sources를 건드리지 않는다.
- G18–G41(2026-10-07 추가): 서고 200작품 중 관계 후보가 약한 Racketty-Packetty House, The Golden Key, The Great Stone Face만 빼고 모두 웨이브에 들어갔다.
- G7–G17(2026-10-07 추가)은 모두 서고에서 이미 읽을 수 있는 책만 골랐다. 고른 기준: 앞 웨이브(또는 같은 웨이브 앞 단계)에 이미 있는 작품과 구절 단위 관계(cites·rewrites·answers·shares-form) 후보가 있어야 한다. 각 단계 task에 적힌 관계 후보는 leads이고, 원문 구절과 대체 테스트로 확인될 때만 note가 된다. 웨이브 끝마다 사용자 승인 → 커밋·배포.

- 웨이브는 앞 웨이브의 모든 단계(사용자 확인과 배포 포함)가 끝나야 열린다. 대시보드의 웨이브 칩으로 먼저 열 수도 있다.
- 사용자 단계(`*-OK`)는 job이 되지 않는다. 사용자가 화면을 보고 대시보드의 "확인" 버튼을 누르면 끝난다. 고칠 점은 세션에서 말하고, 그 단계는 `reopen`으로 다시 돌린다.
- 한 번에 job 하나만 돈다(`max_running` 1). 단계들이 같은 파일(graph.js, reader.js)을 고치기 때문이다.
