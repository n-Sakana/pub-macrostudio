添付ファイル source-code-for-ai.md は、Excel ブック sample_share_and_win32.xlsm の VBA コード全文です
（7 モジュール、合計 188 行。省略はありません）。
ソースコードが欠落している・省略されていると判断せず、追加の資料を求めず、
添付ファイルの内容と下の【想定動作環境】だけを根拠に、事実を診断してください。

【想定動作環境】
================================================================================
 TARGET ENVIRONMENT: 新しい業務端末 (new-business-terminal / rev 2026-08-01)
================================================================================
EDR / DLP 管理下の Windows 端末。ブックは SharePoint / OneDrive 上に置かれる。

[DLL_LOAD_BLOCKED] execution / blocked / inferred
  実行時の DLL 読み込みができない
  実行中に外部 DLL を読み込む処理は、読み込みの時点で止められる。

[SCRIPT_HOST_BLOCKED] execution / blocked / declared
  スクリプトホストの起動が実行できない
  PowerShell / pwsh / wscript / cscript / mshta の起動が止められる。
  例: powershell, pwsh, wscript, cscript, mshta

[SHELL_EXEC_BLOCKED] execution / blocked / declared
  外部プログラムの起動が実行できない
  Shell 関数、WScript.Shell、cmd /c による外部プロセスの起動が止められる。
  例: Shell, WScript.Shell, cmd /c

[WIN32API_BLOCKED] execution / blocked / declared
  Win32 API の Declare 呼び出しが実行できない
  Declare / Declare PtrSafe による外部 DLL の呼び出しが止められる。宣言だけでなく、その API を呼んでいる箇所も動かない。
  例: Declare, Declare PtrSafe, Sleep, GetTickCount

[WMI_BLOCKED] execution / blocked / declared
  WMI 経由の操作が実行できない
  CreateObject / GetObject を通した WMI への接続と、そこからのプロセス操作が止められる。

[APPDATA_PATH] storage / changed / inferred
  固定の AppData パスが解決できない
  AppData の位置を直接書いたパスは、端末や利用者が変わると解決できない。

[BOOK_PATH_IS_URL] storage / changed / declared
  ブックの場所が URL になる
  ブックが SharePoint / OneDrive 上に置かれると ThisWorkbook.Path は https:// で始まる文字列を返す。これを起点にしたパスの組み立てはドライブ形式を前提にできない。
  例: ThisWorkbook.Path, ActiveWorkbook.Path

[CURDIR_CHDIR] storage / changed / inferred
  CurDir / ChDir が期待どおりに働かない
  CurDir は同期フォルダ上で意図しない位置を返すことがあり、ChDir は URL パスに対して失敗する。
  例: CurDir, ChDir, ChDrive

[DIR_EXISTENCE_CHECK] storage / changed / inferred
  Dir() による存在確認が URL パスでは機能しない
  Dir 関数はファイルシステムのパスを前提とするため、https:// で始まる場所に対しては存在確認として働かない。
  例: Dir, Dir$

[EXTERNAL_WORKBOOK_LINK] storage / changed / inferred
  外部ブックの参照と保存が場所の変更で失敗する
  Workbooks.Open、SaveAs、外部ブックへのリンク、LinkSources / UpdateLink は、いずれも対象の場所が変わると失敗する。

[FIXED_DRIVE_LETTER] storage / changed / inferred
  固定のドライブ文字が解決できない
  新しい端末に同じドライブ文字が割り当てられているとは限らない。

[KNOWN_FOLDER_PATH] storage / changed / inferred
  デスクトップ・ドキュメントが OneDrive へ移る
  既知フォルダのリダイレクトにより、デスクトップやドキュメントの実体が OneDrive 配下へ移動していることがある。

[PATH_CONCATENATION] storage / changed / inferred
  文字列連結で組み立てたパスが成立しない
  区切り文字を \ と決め打ちしてパスを連結する処理は、起点が URL になると正しい場所を指さない。

[PROGRAM_FILES_PATH] storage / changed / inferred
  固定の Program Files パスが解決できない
  導入先や 32 / 64 ビットの別により、Program Files の位置は端末ごとに変わりうる。

[UNC_PATH] storage / changed / inferred
  固定の UNC パスが新環境で変わる
  サーバ名・共有名が新環境で同じである保証がない。

[USER_PROFILE_PATH] storage / changed / inferred
  ユーザーフォルダを含む固定パスが壊れる
  C:\Users\<名前> を直接書いたパスは、利用者やプロファイルが変わると解決できない。

[CONNECTION_STRING] host / uncertain / inferred
  接続文字列の接続先が変わる可能性がある
  サーバ名・データベース名・ファイルの場所・認証方法のいずれかが新環境で変わりうる。

[FIXED_HOST_NAME] host / uncertain / inferred
  固定の接続先ホスト名が変わる可能性がある
  名前解決が新環境で同じ相手を指すかは、コードからは判断できない。

[FIXED_IP_ADDRESS] host / uncertain / inferred
  固定 IP アドレスが変わる可能性がある
  新しいネットワークで同じアドレスに同じ相手がいるかは、コードからは判断できない。

[FIXED_PRINTER_NAME] host / uncertain / inferred
  固定のプリンタ名が存在しない可能性がある
  新しい端末に同じ名前のプリンタが登録されているかは、コードからは判断できない。

[DAO_UNAVAILABLE] components / uncertain / inferred
  DAO が使えない可能性がある
  DAO の参照設定が新しい端末に入っているかは、コードからは判断できない。

[DDE_IE_UNAVAILABLE] components / blocked / inferred
  DDE と Internet Explorer の自動操作が使えない
  どちらも提供が終了しており、新しい端末では動かない。

[LEGACY_UI_AUTOMATION] components / uncertain / inferred
  画面操作に頼る処理が期待どおり動かない可能性がある
  SendKeys、AppActivate、旧式のコントロールは、相手の窓の状態に依存するため結果が変わりうる。

[POINTER_AND_32BIT] components / uncertain / inferred
  32 ビットを前提にしたコードが動かない可能性がある
  VarPtr / ObjPtr / StrPtr と、ハンドルを Long で受け渡すコードは、64 ビット版 Office では成立しない。

--------------------------------------------------------------------------------
 basis: observed=実測 / declared=前提として宣言 / inferred=設計上の推定
================================================================================

【診断指示】
添付した VBA コードの全体を読み、このマクロの目的、処理の流れ、依存関係、
想定動作環境で実行したときに起きる事実を監査してください。

コードは書き換えません。改修方針、直し方、修正後の動作予測、修正コードは書かず、
コードと想定動作環境から確認できる事実、その成立条件、影響、根拠だけを報告してください。
曖昧なことは断定せず、確認できない理由を明示してください。

4 つの SECTION は指摘が 0 件でも省略しないでください。指摘には必ず、該当する
モジュール・プロシージャ・可視コードの行番号と、根拠となる環境キーを規則どおり付けます。
該当箇所を名乗れない項目は `-` とし、存在しない名前や行番号を作らないでください。

【対象モジュール】※ 0 行のモジュールは元から空です
  - Sheet1 （ドキュメントモジュール, 0 行）
  - Sheet2 （ドキュメントモジュール, 0 行）
  - Sheet3 （ドキュメントモジュール, 0 行）
  - ThisWorkbook （ドキュメントモジュール, 0 行）
  - BillingReport （標準モジュール, 69 行）
  - ShareExport （標準モジュール, 76 行）
  - TimerUtils （標準モジュール, 43 行）

【出力指示】
回答はチャットの本文に書いてください。ダウンロード用のテキストファイル、添付ファイル、
ダウンロードリンクでは返さないでください。

診断の結果は、**ひとつだけのコードブロック**にまとめて返してください。
コードブロックを分けないでください。区切りの行は 1 行に 1 つだけ、そのままの形で
書いてください。コードブロックの外には、あいさつ、前置き、要約、感想を書かないで
ください。`6d9a4d06-08a3-4025-a84a-fdd941e553b6` はこの依頼に書かれた値のまま使います。

コードは書き換えず、修正コード、改修案、ダウンロード用ファイルは返さないでください。

SECTION は PURPOSE / FLOW / DEPENDENCY / ENVIRONMENT の 4 種を 1 回ずつ書きます。
各 FINDING の META は `CLASS CONFIDENCE MODULE PROC LINES ENVKEY` の順を変えず、
TEXT は TITLE / CONDITION / IMPACT / EVIDENCE の 4 種を 1 回ずつ書きます。
TITLE は 120 文字以内の 1 行にし、EVIDENCE にはコード上の根拠を書いてください。

`DIAG BEGIN <件数>` と `DIAG COMPLETE <件数>` の数字は、**どちらもこの返答に
書いた指摘の件数**です。同じ値を 2 か所へ書きます。指摘を 4 件書いたなら
`DIAG BEGIN 4` で始めて `DIAG COMPLETE 4` で終えます。版番号ではありません。

指摘が 0 件なら FINDING を書かず、`DIAG BEGIN 0` で始め、
`DIAG NOFINDING SCOPE_CLEAR` または `DIAG NOFINDING INSUFFICIENT` を 1 行だけ書き、
`DIAG COMPLETE 0` とします。指摘がある場合は NOFINDING を書きません。

完全な記入例:

```
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 DIAG BEGIN 2
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 SECTION BEGIN PURPOSE
支店ごとの売上データを読み込み、月次の集計表を作って所定のフォルダへ保存するマクロです。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 SECTION END PURPOSE
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 SECTION BEGIN FLOW
MonthlyReport.Main が入口です。CommonUtil で共有フォルダのブックを開き、
SalesRules で支店ごとの集計を行い、ReportFormatting で書式を整えたあと、
CoverSheet で表紙を作って保存します。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 SECTION END FLOW
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 SECTION BEGIN DEPENDENCY
共有フォルダ上の「支店データ.xlsx」を開きます。
待ち時間の処理に Windows の Sleep 関数を使っています。
外部の参照ライブラリは使っていません。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 SECTION END DEPENDENCY
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 SECTION BEGIN ENVIRONMENT
提示された環境では、Windows の関数を直接呼ぶ処理と、固定のドライブ文字を前提にした
ファイルの読み書きが、そのままでは動きません。集計そのものの処理は環境に依存していません。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 SECTION END ENVIRONMENT
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 FINDING BEGIN 1
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 META CLASS=BLOCKER CONFIDENCE=CONFIRMED MODULE=CommonUtil PROC=WaitSeconds LINES=8,21 ENVKEY=WIN32API_BLOCKED
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT BEGIN TITLE
待ち時間の処理が Windows の関数を直接呼んでいるため、実行できません。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT END TITLE
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT BEGIN CONDITION
このマクロを実行すると必ず通ります。分岐や設定で避けられる箇所ではありません。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT END CONDITION
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT BEGIN IMPACT
マクロが最初の待ち時間で止まり、それ以降の集計も保存も行われません。
データが壊れることはありませんが、処理は完了しません。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT END IMPACT
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT BEGIN EVIDENCE
CommonUtil の 8 行目に Declare による Sleep の宣言があり、21 行目の WaitSeconds が
それを呼んでいます。WaitSeconds は MonthlyReport.Main から 3 か所で呼ばれています。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT END EVIDENCE
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 FINDING END 1
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 FINDING BEGIN 2
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 META CLASS=CONDITIONAL CONFIDENCE=LIKELY MODULE=MonthlyReport PROC=LoadSource LINES=42-47 ENVKEY=FIXED_DRIVE_LETTER
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT BEGIN TITLE
読み込み元のフォルダがドライブ文字で書かれているため、場所が変わると開けません。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT END TITLE
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT BEGIN CONDITION
新しい端末に同じドライブ文字が割り当てられていない場合に起きます。
同じ割り当てが残っていれば、これまでどおり動きます。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT END CONDITION
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT BEGIN IMPACT
支店データを開けず、実行時エラーで止まります。書きかけのファイルは残りません。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT END IMPACT
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT BEGIN EVIDENCE
MonthlyReport の 42 行目から 47 行目で、"S:\eigyo\" とファイル名を連結して
Workbooks.Open に渡しています。存在確認は Dir で行っています。
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 TEXT END EVIDENCE
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 FINDING END 2
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 DIAG COMPLETE 2
'@MACROSTUDIO 6d9a4d06-08a3-4025-a84a-fdd941e553b6 DIAG END
```

- `BLOCKER` は `ENVKEY` を必ず持ちます。
- `CONFIDENCE=UNVERIFIED` は `BLOCKER` / `DEFECT` と組み合わせません。
- `LINES` はカンマ列でも範囲でもよく、画面に見えるコードの実在行だけを指します。
- どの `TEXT` にも「どう直すか」を書きません。
- マクロを書かない人にも読める言葉で書きます。
