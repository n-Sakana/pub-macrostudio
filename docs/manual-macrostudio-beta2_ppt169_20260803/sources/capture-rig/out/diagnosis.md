# 診断結果

## PURPOSE

経理課が毎月まわしている請求データの集計マクロです。明細シートを読んで件数と合計を作業シートへ書き、控えを共有フォルダへ書き出します。

## FLOW

BillingReport.RunBilling が入口です。TimerUtils で待機し、明細シートを 1 行ずつ読んで件数と合計を集計し、作業シートへ書き戻します。控えの書き出し（ShareExport）は入口からは呼ばれておらず、担当者が手で実行しています。

## DEPENDENCY

待ち時間の処理に Windows の Sleep 関数を使っています。控えの書き出しは共有ドライブとファイルサーバー、および手元のユーザーフォルダを前提にしています。外部の参照ライブラリは使っていません。

## ENVIRONMENT

提示された環境では、Windows の関数を直接呼ぶ待機処理がそのままでは動きません。固定の場所を前提にした書き出しも、移行後は成立しない可能性があります。集計そのものの処理は環境に依存していません。

## #1 待ち時間の処理が Windows の関数を直接呼んでいるため、実行できません。

- META: CLASS=BLOCKER CONFIDENCE=CONFIRMED MODULE=TimerUtils PROC=- LINES=14,16 ENVKEY=WIN32API_BLOCKED
- CONDITION: このマクロを実行すると必ず通ります。分岐や設定で避けられる箇所ではありません。
- IMPACT: 最初の待機で止まり、それ以降の集計も書き込みも行われません。データが壊れることはありませんが、処理は完了しません。
- EVIDENCE: TimerUtils の 14 行目と 16 行目に Declare による Sleep の宣言があり、同じモジュールの 21・26・27・35・41・42 行目で呼んでいます。共通のラッパーは作られていません。

## #2 入口の集計処理が、最初の待機でそのまま止まります。

- META: CLASS=BLOCKER CONFIDENCE=CONFIRMED MODULE=BillingReport PROC=RunBilling LINES=33 ENVKEY=WIN32API_BLOCKED
- CONDITION: 入口 RunBilling を実行したときに必ず通ります。
- IMPACT: 作業シートの件数・合計・状態のいずれも更新されません。元の値がそのまま残ります。
- EVIDENCE: BillingReport の 33 行目が TimerUtils.WaitBeforeRead を呼んでおり、その先が Windows の関数です。

## #3 控えの保存先がドライブ文字で書かれているため、場所が変わると書き出せません。

- META: CLASS=CONDITIONAL CONFIDENCE=LIKELY MODULE=ShareExport PROC=- LINES=15 ENVKEY=FIXED_DRIVE_LETTER
- CONDITION: 新しい端末に同じドライブ文字が割り当てられていない場合に起きます。割り当てが残っていればこれまでどおり動きます。
- IMPACT: 控えの書き出しが実行時エラーで止まります。集計そのものには影響しません。
- EVIDENCE: ShareExport の 15 行目で EXPORT_ROOT に "S:\keiri\seikyu\" を直接書いています。

## #4 ひな形の取得先がファイルサーバー名で書かれているため、移行後に見つかりません。

- META: CLASS=CONDITIONAL CONFIDENCE=LIKELY MODULE=ShareExport PROC=- LINES=18 ENVKEY=UNC_PATH
- CONDITION: ファイルサーバーの名前または共有名が変わる場合に起きます。
- IMPACT: ひな形を取得できず、控えの整形が行えません。
- EVIDENCE: ShareExport の 18 行目で TEMPLATE_DIR に "\\fileserver\keiri\hinagata\" を直接書いています。

## #5 手元の控え先がユーザーフォルダの固定パスで書かれています。

- META: CLASS=CONDITIONAL CONFIDENCE=LIKELY MODULE=ShareExport PROC=CopyToLocalBackup LINES=22 ENVKEY=USER_PROFILE_PATH
- CONDITION: ドキュメントが OneDrive へ移っている端末、またはユーザー名が異なる端末で起きます。
- IMPACT: 控えの複製先が作られず、複製が行われません。
- EVIDENCE: ShareExport の 22 行目で LOCAL_BACKUP に "%USERPROFILE%\Documents\keiri\" を直接書いています。

## #6 保存先を文字列連結で組み立てているため、区切りの有無で成立しなくなります。

- META: CLASS=CONDITIONAL CONFIDENCE=LIKELY MODULE=ShareExport PROC=ExportToShare LINES=36-43 ENVKEY=PATH_CONCATENATION
- CONDITION: 置き換え後の場所が区切り記号で終わっていない場合に起きます。
- IMPACT: 存在しない場所へ書き出そうとして止まります。
- EVIDENCE: ShareExport の 36 行目から 43 行目で、EXPORT_ROOT に 年と "\" を継ぎ足し、Dir と MkDir で確認してから Open For Output に渡しています。

## #7 書き出し先の共有フォルダに書き込み権限があるかは、コードからは分かりません。

- META: CLASS=EXTERNAL CONFIDENCE=UNVERIFIED MODULE=ShareExport PROC=ExportToShare LINES=36 ENVKEY=-
- CONDITION: 移行先で共有の権限設定が変わっている場合に問題になります。
- IMPACT: 場所を直しても、権限が無ければ書き出しは失敗します。
- EVIDENCE: コードは権限を確認せずに MkDir と Open を行っています。権限はブックの外にあり、人が確かめる必要があります。

## #8 明細をセル単位で 1 行ずつ読んでいます。

- META: CLASS=INFO CONFIDENCE=LIKELY MODULE=BillingReport PROC=RunBilling LINES=38-45 ENVKEY=-
- CONDITION: 行数が増えるほど時間がかかります。現在の 12 行では問題になりません。
- IMPACT: 動作に支障はありません。行数が数千に増えたときの実行時間だけが変わります。
- EVIDENCE: BillingReport の 38 行目から 45 行目で data.Cells(r, n).Value を 1 セルずつ読んでいます。
