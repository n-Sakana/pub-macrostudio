添付ファイル source-code.md は、Excel ブック sample_win32_sleep.xlsm の VBA コード全文です
（8 モジュール、合計 492 行。省略はありません）。
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

#01 [BLOCKER/CONFIRMED] 待ち時間の処理が Windows の Sleep 関数を直接呼んでいるため、実行できません。
    成立条件: 経過時間を計算する処理を通ると必ず実行されます。分岐や設定で避けられる箇所ではありません。
    影響: 点検処理の途中でマクロが止まり、状態の更新とログの出力が完了しません。
すでに書き込んだ行はそのまま残ります。
    該当箇所: module: TimerUtils / proc: ElapsedSeconds / lines: 4,6,11
    根拠: TimerUtils の 4 行目と 6 行目に Declare による Sleep の宣言があり、
11 行目の ElapsedSeconds がそれを呼んでいます。

#02 [INFO/LIKELY] 経過時間の計算のたびに 15 ミリ秒の待ちが入り、処理をわずかに遅くしています。
    成立条件: 経過時間を計算するたびに毎回発生します。
    影響: 結果は変わりませんが、行数が多いときに全体の処理時間が延びます。
    該当箇所: module: TimerUtils / proc: ElapsedSeconds / lines: 11
    根拠: TimerUtils の 11 行目で、計算の前に Sleep 15 を呼んでいます。
計算自体に待ち時間は必要ありません。

【選んだ指摘と希望する動作】
--------------------------------------------------------------------------------
 REQUESTED CHANGES
--------------------------------------------------------------------------------
#01 [BLOCKER] 待ち時間の処理が Windows の Sleep 関数を直接呼んでいるため、実行できません。
    module: TimerUtils / proc: ElapsedSeconds / lines: 4,6,11
    成立条件: 経過時間を計算する処理を通ると必ず実行されます。分岐や設定で避けられる箇所ではありません。
    影響: 点検処理の途中でマクロが止まり、状態の更新とログの出力が完了しません。
すでに書き込んだ行はそのまま残ります。

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

【追加の要望】
15ミリ秒の待ちは残さなくてよいです。待ちを無くして、経過時間の計算だけにしてください。

【対象モジュール】※ 0 行のモジュールは元から空です
  - Sheet1 （ドキュメントモジュール, 0 行）
  - Sheet2 （ドキュメントモジュール, 0 行）
  - Sheet3 （ドキュメントモジュール, 0 行）
  - ThisWorkbook （ドキュメントモジュール, 0 行）
  - AppController （標準モジュール, 105 行）
  - SystemInfo （標準モジュール, 159 行）
  - TimerUtils （標準モジュール, 16 行）
  - WindowUtils （標準モジュール, 212 行）

【出力指示（モジュール単位）】
回答はチャットの本文に書いてください。ダウンロード用のテキストファイル、添付ファイル、
ダウンロードリンクでは返さないでください。

コードが長いので、変更するモジュールを **1 回の返答につき 1 つだけ** 出してください。
すべてのモジュールを 1 回の返答にまとめないでください。

進め方:

1. まず、変更するモジュールが全部でいくつになるかを決めます。この数を <合計> とします。
2. 1 回目の返答では、要約と 1 つ目のモジュール（番号 00）だけを出します。
3. 返答の最後に、コードブロックの外で「次のモジュール 01 を出してよいですか」と
   1 行で確認してください。
4. 「はい」と言われたら、次の返答で番号 01 のモジュールを出します。
   以後 02、03 … と、<合計> に達するまで 1 回に 1 つずつ繰り返します。

1 回目の返答だけ、コードブロックのはじめに要約を書きます。

'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e SUMMARY BEGIN
（何をどう直したか。モジュール名を挙げて 3〜6 行程度。
　マクロを書かない人にも分かる言葉で）
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e SUMMARY END

そして毎回、1 つのモジュールを次の 4 行ではさんで、ひとつだけのコードブロックに
入れてください。区切りの行は 1 行に 1 つだけ、そのままの形で書いてください。
<番号> は 00 から始まる 2 桁、<合計> は変更するモジュールの総数（2 桁）です。

'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e PART <番号> OF <合計>
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e BEGIN <種類> <モジュール名>
（そのモジュールの全文）
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e END <種類> <モジュール名>
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e COMPLETE 1

直すところが無いと判断したとき、または、この形では直せないと判断したときは、
モジュールを 1 つも出さず、1 回の返答だけで次の形で返してください。
PART の行は付けません。番号を待つ必要も、続きを出す必要もありません。

'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e SUMMARY BEGIN
（なぜそう判断したか。何を見て、どこがそうなっているか。
　マクロを書かない人にも分かる言葉で 3〜6 行程度）
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e SUMMARY END
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e NOCHANGE <判断>
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e COMPLETE 0

<判断> は次の 3 つのどれかです。

- UNNECESSARY … いまのままで依頼の内容を満たしているので、直す必要がない
- IMPOSSIBLE … 直したほうがよいが、渡されたモジュールを書き換える形ではできない

- NEEDDECISION … コードだけでは決められず、人が選ぶ必要がある

NEEDDECISION のときは、SUMMARY END と NOCHANGE NEEDDECISION の間に、
決める必要があることを 1 件以上、次の形で書いてください。

'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e DECISION BEGIN 1
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e META FINDING=<指摘番号または-> MODULE=<モジュール名または->
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e TEXT BEGIN QUESTION
（人が決める必要がある質問）
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e TEXT END QUESTION
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e TEXT BEGIN OPTIONS
（考えられる選択肢と、それぞれの結果）
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e TEXT END OPTIONS
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e DECISION END 1
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e NOCHANGE NEEDDECISION
'@MACROSTUDIO 310f4b83-1a45-436f-be5c-0cb8431cb14e COMPLETE 0

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
- 1 回の返答に入れるモジュールは 1 つだけです。COMPLETE の数は毎回 1 です。
- <合計> は最初に決めた数のまま、毎回同じ数を書いてください。
- <番号> は 00、01、02 … と 1 つずつ増やします。飛ばしたり戻したりしないでください。
- <種類> は standard / class / form / document のどれかです。
  既存モジュールの <種類> は、依頼文の【対象モジュール】に書かれた種別を
  次のとおり読み替えて書いてください。
  標準モジュール = standard / クラスモジュール = class /
  フォームモジュール = form / ドキュメントモジュール = document
- 新しく増やすモジュールは、必ず standard（標準モジュール）にしてください。
  クラスモジュール・ユーザーフォームを新しく作らないでください。
  既存のクラスモジュールを直すことはできます。
- 310f4b83-1a45-436f-be5c-0cb8431cb14e は今回の依頼の番号です。書き換えたり省略したりしないでください。
- 変更していないモジュールは入れないでください。
- 変更は最小限にする。それ以外の行は、行の順序・空白・インデント・コメント・
  変数宣言の並び・命名を含め、渡したものと一字一句同じにして返す。
- 変更した既存モジュールと、新しく作ったモジュールは、先頭から末尾まで
  省略せず全文を書く。「'（以下変更なし）」のような省略はしない。
- コードブロックの中には、上の区切り行以外の説明文を入れない。
- モジュール先頭に「Attribute VB_」で始まる行を付けない。
- モジュール名の変更と、モジュールの削除はしない。
- 要約は 1 回目の SUMMARY の中だけに書きます。コードブロックの外には書かないでください。
