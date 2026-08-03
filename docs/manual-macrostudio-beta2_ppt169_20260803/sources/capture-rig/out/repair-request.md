添付ファイル source-code-for-ai.md は、Excel ブック sample_share_and_win32.xlsm の VBA コード全文です
（7 モジュール、合計 188 行。省略はありません）。
ソースコードが欠落している・省略されていると判断せず、追加の資料を求めず、
診断結果と希望する動作、想定動作環境をすべて守って改修してください。

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

【診断結果】
## PURPOSE
経理課が毎月まわしている請求データの集計マクロです。明細シートを読んで件数と合計を作業シートへ書き、控えを共有フォルダへ書き出します。

## FLOW
BillingReport.RunBilling が入口です。TimerUtils で待機し、明細シートを 1 行ずつ読んで件数と合計を集計し、作業シートへ書き戻します。控えの書き出し（ShareExport）は入口からは呼ばれておらず、担当者が手で実行しています。

## DEPENDENCY
待ち時間の処理に Windows の Sleep 関数を使っています。控えの書き出しは共有ドライブとファイルサーバー、および手元のユーザーフォルダを前提にしています。外部の参照ライブラリは使っていません。

## ENVIRONMENT
提示された環境では、Windows の関数を直接呼ぶ待機処理がそのままでは動きません。固定の場所を前提にした書き出しも、移行後は成立しない可能性があります。集計そのものの処理は環境に依存していません。

#01 [BLOCKER/CONFIRMED] 待ち時間の処理が Windows の関数を直接呼んでいるため、実行できません。
    成立条件: このマクロを実行すると必ず通ります。分岐や設定で避けられる箇所ではありません。
    影響: 最初の待機で止まり、それ以降の集計も書き込みも行われません。データが壊れることはありませんが、処理は完了しません。
    該当箇所: module: TimerUtils / proc: - / lines: 14,16
    根拠: TimerUtils の 14 行目と 16 行目に Declare による Sleep の宣言があり、同じモジュールの 21・26・27・35・41・42 行目で呼んでいます。共通のラッパーは作られていません。

#02 [BLOCKER/CONFIRMED] 入口の集計処理が、最初の待機でそのまま止まります。
    成立条件: 入口 RunBilling を実行したときに必ず通ります。
    影響: 作業シートの件数・合計・状態のいずれも更新されません。元の値がそのまま残ります。
    該当箇所: module: BillingReport / proc: RunBilling / lines: 33
    根拠: BillingReport の 33 行目が TimerUtils.WaitBeforeRead を呼んでおり、その先が Windows の関数です。

#03 [CONDITIONAL/LIKELY] 控えの保存先がドライブ文字で書かれているため、場所が変わると書き出せません。
    成立条件: 新しい端末に同じドライブ文字が割り当てられていない場合に起きます。割り当てが残っていればこれまでどおり動きます。
    影響: 控えの書き出しが実行時エラーで止まります。集計そのものには影響しません。
    該当箇所: module: ShareExport / proc: - / lines: 15
    根拠: ShareExport の 15 行目で EXPORT_ROOT に "S:\keiri\seikyu\" を直接書いています。

#04 [CONDITIONAL/LIKELY] ひな形の取得先がファイルサーバー名で書かれているため、移行後に見つかりません。
    成立条件: ファイルサーバーの名前または共有名が変わる場合に起きます。
    影響: ひな形を取得できず、控えの整形が行えません。
    該当箇所: module: ShareExport / proc: - / lines: 18
    根拠: ShareExport の 18 行目で TEMPLATE_DIR に "\\fileserver\keiri\hinagata\" を直接書いています。

#05 [CONDITIONAL/LIKELY] 手元の控え先がユーザーフォルダの固定パスで書かれています。
    成立条件: ドキュメントが OneDrive へ移っている端末、またはユーザー名が異なる端末で起きます。
    影響: 控えの複製先が作られず、複製が行われません。
    該当箇所: module: ShareExport / proc: CopyToLocalBackup / lines: 22
    根拠: ShareExport の 22 行目で LOCAL_BACKUP に "%USERPROFILE%\Documents\keiri\" を直接書いています。

#06 [CONDITIONAL/LIKELY] 保存先を文字列連結で組み立てているため、区切りの有無で成立しなくなります。
    成立条件: 置き換え後の場所が区切り記号で終わっていない場合に起きます。
    影響: 存在しない場所へ書き出そうとして止まります。
    該当箇所: module: ShareExport / proc: ExportToShare / lines: 36-43
    根拠: ShareExport の 36 行目から 43 行目で、EXPORT_ROOT に 年と "\" を継ぎ足し、Dir と MkDir で確認してから Open For Output に渡しています。

#07 [EXTERNAL/UNVERIFIED] 書き出し先の共有フォルダに書き込み権限があるかは、コードからは分かりません。
    成立条件: 移行先で共有の権限設定が変わっている場合に問題になります。
    影響: 場所を直しても、権限が無ければ書き出しは失敗します。
    該当箇所: module: ShareExport / proc: ExportToShare / lines: 36
    根拠: コードは権限を確認せずに MkDir と Open を行っています。権限はブックの外にあり、人が確かめる必要があります。

#08 [INFO/LIKELY] 明細をセル単位で 1 行ずつ読んでいます。
    成立条件: 行数が増えるほど時間がかかります。現在の 12 行では問題になりません。
    影響: 動作に支障はありません。行数が数千に増えたときの実行時間だけが変わります。
    該当箇所: module: BillingReport / proc: RunBilling / lines: 38-45
    根拠: BillingReport の 38 行目から 45 行目で data.Cells(r, n).Value を 1 セルずつ読んでいます。

【選んだ指摘と希望する動作】
--------------------------------------------------------------------------------
 REQUESTED CHANGES
--------------------------------------------------------------------------------
#01 [BLOCKER] 待ち時間の処理が Windows の関数を直接呼んでいるため、実行できません。
    module: TimerUtils / proc: - / lines: 14,16
    成立条件: このマクロを実行すると必ず通ります。分岐や設定で避けられる箇所ではありません。
    影響: 最初の待機で止まり、それ以降の集計も書き込みも行われません。データが壊れることはありませんが、処理は完了しません。

#02 [BLOCKER] 入口の集計処理が、最初の待機でそのまま止まります。
    module: BillingReport / proc: RunBilling / lines: 33
    成立条件: 入口 RunBilling を実行したときに必ず通ります。
    影響: 作業シートの件数・合計・状態のいずれも更新されません。元の値がそのまま残ります。

--------------------------------------------------------------------------------

【改修指示】
Win32 API を利用できない端末でも、元のマクロと同じ機能・結果で動くように
改修してください。

- 対象コード内の Win32 API 依存箇所（Declare 宣言と、その API を
  呼び出している箇所）をすべて見つける。特定の API だけに限定しない。
- 依存箇所を、Win32 API を使わない VBA 標準機能だけで作った代替関数
  （ラッパー）へ置き換える。
- 代替関数は既存の処理モジュールへ混在させず、原則として新しい標準モジュールへ
  まとめる。新しく増やすモジュールは標準モジュールだけにする。
- 呼び出し側がクラスモジュールやシートのモジュールでも、置き換えが必要なら
  そこも直してよい。
- 既存の処理モジュールは、API 依存の呼び出しを代替関数の呼び出しへ差し替える
  箇所だけを変更する。
- 目的は Win32 API への依存そのものをなくすこと。Declare 宣言を書き直して
  残す改修にはしない。

【このコードは一部を置き換え済みです】
添付したコードは、次の文字列を機械的に置き換えたあとのものです。置き換えは確認済みなので、**元の値へ戻さないでください。**
- S:\keiri\seikyu\ → D:\keiri_share\seikyu\
- \\fileserver\keiri\hinagata\ → \\file01.example.local\keiri\hinagata\
- %USERPROFILE%\Documents\keiri\ → D:\keiri_local\hikae\
これらの新しい値はそのまま残し、依頼された改修だけを行ってください。

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

変更したモジュールと新しく作ったモジュールの全文を、**ひとつだけのコードブロック**に
まとめて返してください。モジュールごとにコードブロックを分けないでください。

コードブロックの中は、次の順に書きます。区切りの行は 1 行に 1 つだけ、
そのままの形で書いてください。

まず、何をどう直したかの要約を、この 2 行ではさんで書きます。

'@MACROSTUDIO 4c50c74e-1dbe-435f-905b-7044bfc3faba SUMMARY BEGIN
（何をどう直したか。モジュール名を挙げて 3〜6 行程度。
　マクロを書かない人にも分かる言葉で）
'@MACROSTUDIO 4c50c74e-1dbe-435f-905b-7044bfc3faba SUMMARY END

続けて、モジュールごとに次の行ではさみます。

'@MACROSTUDIO 4c50c74e-1dbe-435f-905b-7044bfc3faba BEGIN <種類> <モジュール名>
（そのモジュールの全文）
'@MACROSTUDIO 4c50c74e-1dbe-435f-905b-7044bfc3faba END <種類> <モジュール名>

すべてのモジュールを書き終えたら、最後に次の 1 行を置いてください。

'@MACROSTUDIO 4c50c74e-1dbe-435f-905b-7044bfc3faba COMPLETE <モジュールの数>

返せる答えは 2 つだけです。改修したコードを上の形で返すか、
改修できない理由を下の形で返すか、どちらかです。
**利用者へ質問を返したり、選択肢を示して選ばせたりしないでください。**
足りない情報があって決められない場合も、質問はせず UNCLEAR で返します。

直すところが無いと判断したとき、この形では直せないと判断したとき、
または渡された情報だけでは決められないときは、
モジュールを 1 つも書かず、代わりに次の形で返してください。
求められていない変更を作って埋めることはしないでください。

'@MACROSTUDIO 4c50c74e-1dbe-435f-905b-7044bfc3faba SUMMARY BEGIN
（なぜそう判断したか。何を見て、どこがそうなっているか。
　マクロを書かない人にも分かる言葉で 3〜6 行程度）
'@MACROSTUDIO 4c50c74e-1dbe-435f-905b-7044bfc3faba SUMMARY END
'@MACROSTUDIO 4c50c74e-1dbe-435f-905b-7044bfc3faba NOCHANGE <判断>
'@MACROSTUDIO 4c50c74e-1dbe-435f-905b-7044bfc3faba COMPLETE 0

<判断> は次の 3 つのどれかです。

- UNNECESSARY … いまのままで依頼の内容を満たしているので、直す必要がない
- IMPOSSIBLE … 直したほうがよいが、渡されたモジュールを書き換える形ではできない
- UNCLEAR … 依頼の内容が、渡された情報だけでは確定できない

UNCLEAR のときは、何がどう決まらないのかを SUMMARY に書いてください。
利用者へ質問を返したり、選択肢を示して選ばせたりしないでください。
この返答で対話は終わりです。決められない理由が読めれば、
利用者は依頼文を書き直して、もう一度渡します。

SUMMARY / NOCHANGE / COMPLETE の各行はすべて必要です。
理由を書かずに NOCHANGE だけを返したり、
COMPLETE 0 だけを返したりしないでください。何も返さないこと、
返答を途中でやめることも、「変更なし」とは扱われません。

守ってください:

- 明示されていない業務動作は変えないでください。
- 公開しているプロシージャ名・引数は変えないでください。
- コードだけでは判断できないことは勝手に決めず、
  決める必要があることとして返してください。
- <種類> は standard / class / form / document のどれかです。
  既存モジュールの <種類> は、依頼文の【対象モジュール】に書かれた種別を
  次のとおり読み替えて書いてください。
  標準モジュール = standard / クラスモジュール = class /
  フォームモジュール = form / ドキュメントモジュール = document
- 新しく増やすモジュールは、必ず standard（標準モジュール）にしてください。
  クラスモジュール・ユーザーフォームを新しく作らないでください。
  既存のクラスモジュールを直すことはできます。
- 4c50c74e-1dbe-435f-905b-7044bfc3faba は今回の依頼の番号です。書き換えたり省略したりしないでください。
- 変更していないモジュールは入れないでください。
- 変更は最小限にする。それ以外の行は、行の順序・空白・インデント・コメント・
  変数宣言の並び・命名を含め、渡したものと一字一句同じにして返す。
- 変更した既存モジュールと、新しく作ったモジュールは、先頭から末尾まで
  省略せず全文を書く。「'（以下変更なし）」のような省略はしない。
- コードブロックの中には、上の区切り行以外の説明文を入れない。
- モジュール先頭に「Attribute VB_」で始まる行を付けない。
- モジュール名の変更と、モジュールの削除はしない。
- 要約は上の SUMMARY の中だけに書きます。コードブロックの外には書かないでください。
