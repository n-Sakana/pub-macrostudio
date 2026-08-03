添付ファイル source-code.md は、Excel ブック S07_power_query.xlsm の VBA コード全文です
（4 モジュール、合計 51 行。省略はありません）。
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
シート「作業」に集計結果を書き込むマクロです。データの取得はブック側のクエリが行います。

## FLOW
RefreshData.RunLocalSummary が入口で、シート上の値を読んで集計し、結果を書き戻します。

## DEPENDENCY
VBA コードの中には、外部ファイル、Win32 API、外部プログラム、参照ライブラリへの
依存は見当たりません。データの取得先はコードの外にあります。

## ENVIRONMENT
渡された VBA コードの範囲では、提示された環境で動作を妨げる要因を確認できませんでした。
ただし、データの取得先や接続の設定はコードに現れないため、この範囲では判断できません。

（指摘 0 件: SCOPE_CLEAR）

【選んだ指摘と希望する動作】
--------------------------------------------------------------------------------
 REQUESTED CHANGES
--------------------------------------------------------------------------------
（指摘の選択なし。追加の要望のみ）
--------------------------------------------------------------------------------

【改修指示】
ここに、AI へ改修してほしい内容を書いてください。

- どのモジュールの、どの処理を、どう変えたいかを具体的に書く。
- 変えたくないこと（画面の見た目、保存先、処理の順序など）があれば、それも書く。

【追加の要望】
集計処理のエラー処理を追加して、失敗した理由がわかるようにしてほしいです。

【対象モジュール】※ 0 行のモジュールは元から空です
  - Sheet1 （ドキュメントモジュール, 0 行）
  - Sheet2 （ドキュメントモジュール, 0 行）
  - ThisWorkbook （ドキュメントモジュール, 0 行）
  - RefreshData （標準モジュール, 51 行）

【出力指示】
回答はチャットの本文に書いてください。ダウンロード用のテキストファイル、添付ファイル、
ダウンロードリンクでは返さないでください。

変更したモジュールと新しく作ったモジュールの全文を、**ひとつだけのコードブロック**に
まとめて返してください。モジュールごとにコードブロックを分けないでください。

コードブロックの中は、次の順に書きます。区切りの行は 1 行に 1 つだけ、
そのままの形で書いてください。

まず、何をどう直したかの要約を、この 2 行ではさんで書きます。

'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 SUMMARY BEGIN
（何をどう直したか。モジュール名を挙げて 3〜6 行程度。
　マクロを書かない人にも分かる言葉で）
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 SUMMARY END

続けて、モジュールごとに次の行ではさみます。

'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 BEGIN <種類> <モジュール名>
（そのモジュールの全文）
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 END <種類> <モジュール名>

すべてのモジュールを書き終えたら、最後に次の 1 行を置いてください。

'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 COMPLETE <モジュールの数>

直すところが無いと判断したとき、または、この形では直せないと判断したときは、
モジュールを 1 つも書かず、代わりに次の形で返してください。
求められていない変更を作って埋めることはしないでください。

'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 SUMMARY BEGIN
（なぜそう判断したか。何を見て、どこがそうなっているか。
　マクロを書かない人にも分かる言葉で 3〜6 行程度）
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 SUMMARY END
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 NOCHANGE <判断>
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 COMPLETE 0

<判断> は次の 3 つのどれかです。

- UNNECESSARY … いまのままで依頼の内容を満たしているので、直す必要がない
- IMPOSSIBLE … 直したほうがよいが、渡されたモジュールを書き換える形ではできない
- NEEDDECISION … コードだけでは決められず、人が選ぶ必要がある

NEEDDECISION のときは、SUMMARY END と NOCHANGE NEEDDECISION の間に、
決める必要があることを 1 件以上、次の形で書いてください。

'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 DECISION BEGIN 1
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 META FINDING=<指摘番号または-> MODULE=<モジュール名または->
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 TEXT BEGIN QUESTION
（人が決める必要がある質問）
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 TEXT END QUESTION
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 TEXT BEGIN OPTIONS
（考えられる選択肢と、それぞれの結果）
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 TEXT END OPTIONS
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 DECISION END 1
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 NOCHANGE NEEDDECISION
'@MACROSTUDIO c7b2b168-6299-4a34-8dc0-4d63e086a049 COMPLETE 0

DECISION の番号は 1 から始め、2、3 と重複なく増やしてください。01 のように
0 を付けません。FINDING は診断にある指摘番号、MODULE は対象モジュール名です。
どちらにも結び付かないときだけ `-` にします。質問と選択肢は空にしません。

UNNECESSARY / IMPOSSIBLE の 4 行と、NEEDDECISION の上記各行はすべて必要です。
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
- c7b2b168-6299-4a34-8dc0-4d63e086a049 は今回の依頼の番号です。書き換えたり省略したりしないでください。
- 変更していないモジュールは入れないでください。
- 変更は最小限にする。それ以外の行は、行の順序・空白・インデント・コメント・
  変数宣言の並び・命名を含め、渡したものと一字一句同じにして返す。
- 変更した既存モジュールと、新しく作ったモジュールは、先頭から末尾まで
  省略せず全文を書く。「'（以下変更なし）」のような省略はしない。
- コードブロックの中には、上の区切り行以外の説明文を入れない。
- モジュール先頭に「Attribute VB_」で始まる行を付けない。
- モジュール名の変更と、モジュールの削除はしない。
- 要約は上の SUMMARY の中だけに書きます。コードブロックの外には書かないでください。
