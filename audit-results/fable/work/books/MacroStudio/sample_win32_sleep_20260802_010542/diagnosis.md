# 診断結果

## PURPOSE

シート「アプリ一覧」の申請データを点検し、状態の更新と結果のログ出力を行うマクロです。

## FLOW

AppController.RunApplicationReview が入口です。WindowUtils で各行を検証し、
SystemInfo で環境情報を集め、TimerUtils で経過時間を計ってログへ書き込みます。

## DEPENDENCY

ブック内のシートだけを読み書きします。外部ファイル、外部ブック、参照ライブラリは
使っていません。待ち時間の処理に Windows の Sleep 関数を使っています。

## ENVIRONMENT

提示された環境では、Windows の関数を直接呼ぶ待ち時間の処理が実行できません。
シートの点検と更新そのものは環境に依存していません。

## #1 待ち時間の処理が Windows の Sleep 関数を直接呼んでいるため、実行できません。

- META: CLASS=BLOCKER CONFIDENCE=CONFIRMED MODULE=TimerUtils PROC=ElapsedSeconds LINES=4,6,11 ENVKEY=WIN32API_BLOCKED
- CONDITION: 経過時間を計算する処理を通ると必ず実行されます。分岐や設定で避けられる箇所ではありません。
- IMPACT: 点検処理の途中でマクロが止まり、状態の更新とログの出力が完了しません。
すでに書き込んだ行はそのまま残ります。
- EVIDENCE: TimerUtils の 4 行目と 6 行目に Declare による Sleep の宣言があり、
11 行目の ElapsedSeconds がそれを呼んでいます。

## #2 経過時間の計算のたびに 15 ミリ秒の待ちが入り、処理をわずかに遅くしています。

- META: CLASS=INFO CONFIDENCE=LIKELY MODULE=TimerUtils PROC=ElapsedSeconds LINES=11 ENVKEY=-
- CONDITION: 経過時間を計算するたびに毎回発生します。
- IMPACT: 結果は変わりませんが、行数が多いときに全体の処理時間が延びます。
- EVIDENCE: TimerUtils の 11 行目で、計算の前に Sleep 15 を呼んでいます。
計算自体に待ち時間は必要ありません。
