<!-- ppt-master-schema: spec-lock/v1 -->
# Execution Lock

## canvas
- viewBox: 0 0 1280 720
- format: PPT 16:9

## communication
- audience: 業務で Excel マクロを引き継いだ担当者（VBA は書かないが、チャット AI は業務で使える）
- objective: 初回利用者が本書の手順どおりに一件を完了でき、アプリが検証する範囲と利用者が確かめる範囲を区別して理解している状態にする
- core_message: 何をするかはマクロを見てから決める。MacroStudio は元のブックに書き込まず、AI の返答を機械的に検証してから改修済みブックを別ファイルとして作る。改修後の動作確認は利用者が Excel で行う
- consumption_mode: text

## mode
- mode: instructional

## visual_style
- visual_style: soft-rounded

## colors
- bg: #FFFFFF
- secondary_bg: #F2F6FB
- primary: #24507F
- accent: #C05B21
- secondary_accent: #2B5C96
- text: #1F2A37
- surface: #FAFBFC
- grid: #E2E7EC
- divider: #CFD7DE
- muted: #5D6B7A
- positive: #3A7A47
- diff_removed: #C25560
- diff_added: #4C9155

## typography
- font_family: 'Yu Gothic UI','Segoe UI',sans-serif
- code_family: Consolas,monospace
- body: 22
- title: 40
- subtitle: 30
- lead: 26
- annotation: 18
- note: 17
- caption: 16
- small: 15
- footnote: 14
- cover_title: 54
- code: 18

## icons
- library: tabler-filled
- inventory: file-code, search, list-check, player-play, message-chatbot, copy, clipboard-check, eye, folder-open, shield-check, circle-check, circle-arrow-right, alert-triangle, user, device-desktop, help-circle, file-text

## images
- 21-done.png: images/21-done.png | source=user | pattern=右半分に大きく 1 枚、左に表題 | crop=no-crop
- 01-book-empty.png: images/01-book-empty.png | source=user | pattern=左右 2 枚並置の左 | crop=no-crop
- 02-book-loaded.png: images/02-book-loaded.png | source=user | pattern=左右 2 枚並置の右 | crop=no-crop
- 03-book-modules.png: images/03-book-modules.png | source=user | pattern=1 枚 + 右に注釈カード | crop=no-crop
- 04-diagnose-request.png: images/04-diagnose-request.png | source=user | pattern=左右 2 枚並置の左 | crop=no-crop
- 05-diagnose-environment.png: images/05-diagnose-environment.png | source=user | pattern=左右 2 枚並置の右 | crop=no-crop
- 06-diagnose-handed-over.png: images/06-diagnose-handed-over.png | source=user | pattern=左右 2 枚並置の左 | crop=no-crop
- 07-diagnose-imported.png: images/07-diagnose-imported.png | source=user | pattern=左右 2 枚並置の右 | crop=no-crop
- 08-findings.png: images/08-findings.png | source=user | pattern=1 枚 + 右に注釈カード | crop=no-crop
- 09-findings-open.png: images/09-findings-open.png | source=user | pattern=1 枚 + 下に語の対応表 | crop=no-crop
- 10-nextstep.png: images/10-nextstep.png | source=user | pattern=左右 2 枚並置の左 | crop=no-crop
- 11-nextstep-both.png: images/11-nextstep-both.png | source=user | pattern=左右 2 枚並置の右 | crop=no-crop
- 12-repairinput-table.png: images/12-repairinput-table.png | source=user | pattern=左右 2 枚並置の左 | crop=no-crop
- 13-repairinput-filled.png: images/13-repairinput-filled.png | source=user | pattern=左右 2 枚並置の右 | crop=no-crop
- 14-repairinput-ai.png: images/14-repairinput-ai.png | source=user | pattern=1 枚 + 右に注釈カード | crop=no-crop
- 15-repair-request.png: images/15-repair-request.png | source=user | pattern=左右 2 枚並置の左 | crop=no-crop
- 16-repair-imported.png: images/16-repair-imported.png | source=user | pattern=左右 2 枚並置の右 | crop=no-crop
- 17-review.png: images/17-review.png | source=user | pattern=1 枚 + 右に注釈カード | crop=no-crop
- 18-output.png: images/18-output.png | source=user | pattern=左右 2 枚並置の左 | crop=no-crop
- 19-output-reserved-name.png: images/19-output-reserved-name.png | source=user | pattern=左右 2 枚並置の右 | crop=no-crop
- 20-build.png: images/20-build.png | source=user | pattern=左右 2 枚並置の左 | crop=no-crop
- 22-done-followup.png: images/22-done-followup.png | source=user | pattern=1 枚 + 右に手順カード | crop=no-crop
- 23-back-after-done.png: images/23-back-after-done.png | source=user | pattern=左右 2 枚並置の右 | crop=no-crop
- 30-diagnose-skip.png: images/30-diagnose-skip.png | source=user | pattern=左右 2 枚並置の左 | crop=no-crop

## page_rhythm
- P01: anchor
- P02: dense
- P03: dense
- P04: anchor
- P05: dense
- P06: dense
- P07: dense
- P08: dense
- P09: dense
- P10: dense
- P11: dense
- P12: dense
- P13: dense
- P14: dense
- P15: dense
- P16: dense
- P17: dense
- P18: dense
- P19: dense
- P20: breathing
- P21: dense
- P22: dense

## page_charts
- P04: process_flow

## pptx_structure
- mode: flat

## forbidden
- Mixing icon libraries
- `mask`, `<style>`, `class`, external CSS, `<foreignObject>`, `textPath`, `@font-face`, `<animate*>`, `<set>`, `<script>` / event attributes, `<iframe>`
- HTML named entities in text; write typography as raw Unicode and escape XML reserved characters
