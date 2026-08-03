"""Builds fixture.json for the βv2.00 screenshot rig.

Everything the mock host serves comes from the repository itself:

  * the workbook and its modules  -> walkthrough-sample/modules.json, which
    was produced by the product's own reader (MacroStudio.BookIO.ReadProject)
  * the templates                 -> templates/*.txt
  * the presets                   -> presets/01_診断, presets/02_改修
  * the target environment        -> environment/target-environment.json

Only two things are written here rather than read: the diagnosis package the
chat would return, and the repair package the chat would return. Both are
composed against the real contracts (SPEC 4.4 and 13.9) and their line
numbers are LOOKED UP in the module text rather than typed, so a change to
the sample cannot silently leave the fixture pointing at the wrong line.

Run from this directory:

    python fixtures_build.py

Writes fixture.json beside this script. Reads nothing outside the repository
and writes nothing outside this directory.
"""

import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)                 # ...\sources
REPO = os.path.abspath(os.path.join(PROJECT, "..", "..", ".."))
SAMPLE = os.path.join(PROJECT, "walkthrough-sample")

# The run folder the host would create, and the temp folder that holds the
# one file the chat is handed (SPEC 8.1). Shown in screenshots, so they are
# written the way a reader's machine would show them.
RUN_STAMP = "20260803_101500"
RUN_ROOT = "C:\\Tools\\MacroStudio\\sample-book"
BOOK_NAME = "sample_share_and_win32.xlsm"
BOOK_STEM = "sample_share_and_win32"
RUN_FOLDER = "%s\\MacroStudio\\%s_%s" % (RUN_ROOT, BOOK_STEM, RUN_STAMP)
HANDOFF_FOLDER = "%s\\temp\\%s_%s" % (RUN_ROOT, BOOK_STEM, RUN_STAMP)
AI_CODE_NAME = "source-code-for-ai.md"


def read_text(path):
    with io.open(path, encoding="utf-8") as handle:
        return handle.read()


def read_json(path):
    with io.open(path, encoding="utf-8") as handle:
        return json.load(handle)


def find_line(code, needle, occurrence=1):
    """1-based line number of the nth line containing `needle`."""
    hits = 0
    for index, line in enumerate(code.replace("\r\n", "\n").split("\n"), 1):
        if needle in line:
            hits += 1
            if hits == occurrence:
                return index
    raise SystemExit("fixtures_build: not found in module text: %r" % needle)


def find_all_lines(code, pattern):
    """1-based line numbers of every line matching `pattern`."""
    found = []
    for index, line in enumerate(code.replace("\r\n", "\n").split("\n"), 1):
        if re.search(pattern, line):
            found.append(index)
    if not found:
        raise SystemExit("fixtures_build: no line matched %r" % pattern)
    return found


def load_presets():
    """The shape src/04_HostServices.cs GetAppInfo returns."""
    groups = {"diagnose": "01_診断", "repair": "02_改修"}
    result = {}
    for key, folder in groups.items():
        root = os.path.join(REPO, "presets", folder)
        entries = []
        for name in sorted(os.listdir(root)):
            if not name.lower().endswith(".md"):
                continue
            entries.append({
                "file": folder + "\\" + name,
                "content": read_text(os.path.join(root, name))
            })
        result[key] = entries
    return result


def load_type_labels():
    """The host reads these itself (04_HostServices.GetModuleTypeLabel), so
    the mock must too rather than inventing Japanese labels of its own."""
    root = os.path.join(REPO, "assets", "messages")
    labels = {}
    for kind in ("document", "form", "standard", "class"):
        labels[kind] = read_text(
            os.path.join(root, "module-type-%s.txt" % kind)).strip()
    return labels


def load_templates():
    root = os.path.join(REPO, "templates")
    result = {}
    for name in sorted(os.listdir(root)):
        if name.lower().endswith(".txt"):
            result[name[:-4]] = read_text(os.path.join(root, name))
    return result


# --------------------------------------------------------------------------
# The diagnosis the chat returns.
#
# Eight findings: two BLOCKER on WIN32API_BLOCKED, four CONDITIONAL on the
# storage keys, one EXTERNAL the code cannot answer, one INFO. Every ENVKEY
# exists in environment/target-environment.json, and BLOCKER only names a
# key whose effect is `blocked` (SPEC 4.4.1).
# --------------------------------------------------------------------------
def build_diagnosis(modules_by_name):
    timer = modules_by_name["TimerUtils"]
    billing = modules_by_name["BillingReport"]
    share = modules_by_name["ShareExport"]

    declare_lines = find_all_lines(timer, r"Declare\b")
    sleep_lines = find_all_lines(timer, r"^\s*Sleep\s+\d+")
    entry_wait = find_line(billing, "TimerUtils.WaitBeforeRead")
    drive_line = find_line(share, "EXPORT_ROOT As String")
    unc_line = find_line(share, "TEMPLATE_DIR As String")
    profile_line = find_line(share, "LOCAL_BACKUP As String")
    concat_from = find_line(share, "yearFolder = EXPORT_ROOT")
    concat_to = find_line(share, "Open filePath For Output")
    read_from = find_line(billing, "For r = 3 To lastRow")
    read_to = find_line(billing, "Next r")

    def meta(cls, conf, module, proc, lines, envkey):
        return ("META CLASS=%s CONFIDENCE=%s MODULE=%s PROC=%s "
                "LINES=%s ENVKEY=%s" % (cls, conf, module, proc, lines,
                                        envkey))

    findings = [
        {
            "meta": meta("BLOCKER", "CONFIRMED", "TimerUtils", "-",
                         ",".join(str(n) for n in declare_lines),
                         "WIN32API_BLOCKED"),
            "title": "待ち時間の処理が Windows の関数を直接呼んでいるため、"
                     "実行できません。",
            "condition": "このマクロを実行すると必ず通ります。"
                         "分岐や設定で避けられる箇所ではありません。",
            "impact": "最初の待機で止まり、それ以降の集計も書き込みも"
                      "行われません。データが壊れることはありませんが、"
                      "処理は完了しません。",
            "evidence": "TimerUtils の %s 行目に Declare による Sleep の宣言が"
                        "あり、同じモジュールの %s 行目で呼んでいます。"
                        "共通のラッパーは作られていません。" % (
                            " 行目と ".join(str(n) for n in declare_lines),
                            "・".join(str(n) for n in sleep_lines)),
        },
        {
            "meta": meta("BLOCKER", "CONFIRMED", "BillingReport",
                         "RunBilling", str(entry_wait), "WIN32API_BLOCKED"),
            "title": "入口の集計処理が、最初の待機でそのまま止まります。",
            "condition": "入口 RunBilling を実行したときに必ず通ります。",
            "impact": "作業シートの件数・合計・状態のいずれも更新されません。"
                      "元の値がそのまま残ります。",
            "evidence": "BillingReport の %d 行目が TimerUtils.WaitBeforeRead "
                        "を呼んでおり、その先が Windows の関数です。"
                        % entry_wait,
        },
        {
            "meta": meta("CONDITIONAL", "LIKELY", "ShareExport", "-",
                         str(drive_line), "FIXED_DRIVE_LETTER"),
            "title": "控えの保存先がドライブ文字で書かれているため、"
                     "場所が変わると書き出せません。",
            "condition": "新しい端末に同じドライブ文字が割り当てられて"
                         "いない場合に起きます。割り当てが残っていれば"
                         "これまでどおり動きます。",
            "impact": "控えの書き出しが実行時エラーで止まります。"
                      "集計そのものには影響しません。",
            "evidence": "ShareExport の %d 行目で EXPORT_ROOT に "
                        "\"S:\\keiri\\seikyu\\\" を直接書いています。"
                        % drive_line,
        },
        {
            "meta": meta("CONDITIONAL", "LIKELY", "ShareExport", "-",
                         str(unc_line), "UNC_PATH"),
            "title": "ひな形の取得先がファイルサーバー名で書かれているため、"
                     "移行後に見つかりません。",
            "condition": "ファイルサーバーの名前または共有名が変わる場合に"
                         "起きます。",
            "impact": "ひな形を取得できず、控えの整形が行えません。",
            "evidence": "ShareExport の %d 行目で TEMPLATE_DIR に "
                        "\"\\\\fileserver\\keiri\\hinagata\\\" を"
                        "直接書いています。" % unc_line,
        },
        {
            "meta": meta("CONDITIONAL", "LIKELY", "ShareExport",
                         "CopyToLocalBackup", str(profile_line),
                         "USER_PROFILE_PATH"),
            "title": "手元の控え先がユーザーフォルダの固定パスで"
                     "書かれています。",
            "condition": "ドキュメントが OneDrive へ移っている端末、または"
                         "ユーザー名が異なる端末で起きます。",
            "impact": "控えの複製先が作られず、複製が行われません。",
            "evidence": "ShareExport の %d 行目で LOCAL_BACKUP に "
                        "\"%%USERPROFILE%%\\Documents\\keiri\\\" を"
                        "直接書いています。" % profile_line,
        },
        {
            "meta": meta("CONDITIONAL", "LIKELY", "ShareExport",
                         "ExportToShare", "%d-%d" % (concat_from, concat_to),
                         "PATH_CONCATENATION"),
            "title": "保存先を文字列連結で組み立てているため、"
                     "区切りの有無で成立しなくなります。",
            "condition": "置き換え後の場所が区切り記号で終わっていない"
                         "場合に起きます。",
            "impact": "存在しない場所へ書き出そうとして止まります。",
            "evidence": "ShareExport の %d 行目から %d 行目で、EXPORT_ROOT に "
                        "年と \"\\\" を継ぎ足し、Dir と MkDir で確認してから "
                        "Open For Output に渡しています。" % (
                            concat_from, concat_to),
        },
        {
            "meta": meta("EXTERNAL", "UNVERIFIED", "ShareExport",
                         "ExportToShare", str(concat_from), "-"),
            "title": "書き出し先の共有フォルダに書き込み権限があるかは、"
                     "コードからは分かりません。",
            "condition": "移行先で共有の権限設定が変わっている場合に"
                         "問題になります。",
            "impact": "場所を直しても、権限が無ければ書き出しは失敗します。",
            "evidence": "コードは権限を確認せずに MkDir と Open を行って"
                        "います。権限はブックの外にあり、人が確かめる"
                        "必要があります。",
        },
        {
            "meta": meta("INFO", "LIKELY", "BillingReport", "RunBilling",
                         "%d-%d" % (read_from, read_to), "-"),
            "title": "明細をセル単位で 1 行ずつ読んでいます。",
            "condition": "行数が増えるほど時間がかかります。"
                         "現在の 12 行では問題になりません。",
            "impact": "動作に支障はありません。行数が数千に増えたときの"
                      "実行時間だけが変わります。",
            "evidence": "BillingReport の %d 行目から %d 行目で "
                        "data.Cells(r, n).Value を 1 セルずつ読んで"
                        "います。" % (read_from, read_to),
        },
    ]

    sections = {
        "PURPOSE":
            "経理課が毎月まわしている請求データの集計マクロです。"
            "明細シートを読んで件数と合計を作業シートへ書き、"
            "控えを共有フォルダへ書き出します。",
        "FLOW":
            "BillingReport.RunBilling が入口です。TimerUtils で待機し、"
            "明細シートを 1 行ずつ読んで件数と合計を集計し、"
            "作業シートへ書き戻します。控えの書き出し（ShareExport）は"
            "入口からは呼ばれておらず、担当者が手で実行しています。",
        "DEPENDENCY":
            "待ち時間の処理に Windows の Sleep 関数を使っています。"
            "控えの書き出しは共有ドライブとファイルサーバー、"
            "および手元のユーザーフォルダを前提にしています。"
            "外部の参照ライブラリは使っていません。",
        "ENVIRONMENT":
            "提示された環境では、Windows の関数を直接呼ぶ待機処理が"
            "そのままでは動きません。固定の場所を前提にした"
            "書き出しも、移行後は成立しない可能性があります。"
            "集計そのものの処理は環境に依存していません。",
    }

    # Both numbers are the finding count, not a version: the reply says how
    # many it carries at the top and again at the bottom, and the product
    # refuses the pair when they disagree (D29 / beginCount). The canonical
    # example is the one in presets/01_診断/01_動作環境の事実監査.md.
    lines = ["'@MACROSTUDIO {{REQUEST_ID}} DIAG BEGIN %d" % len(findings)]
    for name in ("PURPOSE", "FLOW", "DEPENDENCY", "ENVIRONMENT"):
        lines.append("'@MACROSTUDIO {{REQUEST_ID}} SECTION BEGIN " + name)
        lines.append(sections[name])
        lines.append("'@MACROSTUDIO {{REQUEST_ID}} SECTION END " + name)
    for number, finding in enumerate(findings, 1):
        lines.append("'@MACROSTUDIO {{REQUEST_ID}} FINDING BEGIN %d" % number)
        lines.append("'@MACROSTUDIO {{REQUEST_ID}} " + finding["meta"])
        for key, tag in (("title", "TITLE"), ("condition", "CONDITION"),
                         ("impact", "IMPACT"), ("evidence", "EVIDENCE")):
            lines.append("'@MACROSTUDIO {{REQUEST_ID}} TEXT BEGIN " + tag)
            lines.append(finding[key])
            lines.append("'@MACROSTUDIO {{REQUEST_ID}} TEXT END " + tag)
        lines.append("'@MACROSTUDIO {{REQUEST_ID}} FINDING END %d" % number)
    lines.append("'@MACROSTUDIO {{REQUEST_ID}} DIAG COMPLETE %d"
                 % len(findings))
    lines.append("'@MACROSTUDIO {{REQUEST_ID}} DIAG END")
    return "\n".join(lines), len(findings)


# --------------------------------------------------------------------------
# The repair the chat returns (SPEC 13.9).
#
# Only TimerUtils changes: the Declare goes, and the waits are expressed
# without calling into Windows. ShareExport is NOT returned - the machine
# replacement already rewrote it, and a chat that was not asked to touch it
# has nothing to say about it. That is what keeps state.appliedMapping
# alive through the intake (SPEC 7.2).
# --------------------------------------------------------------------------
REPAIRED_TIMER_UTILS = """Option Explicit

'============================================================
' 待ち時間の処理
'
' 2017/04  初版
' 2019/10  VBA7 の分岐を足した（64bit の端末が出たため）
' 2026/08  Windows の関数呼び出しをやめ、VBA の標準機能だけにした
'
' Declare による Sleep を使わない形へ直しています。
' 待機はこのモジュールの WaitMilliseconds に集約しました。
'============================================================

' 指定したミリ秒だけ待ちます。Windows の関数は使いません。
Private Sub WaitMilliseconds(ByVal ms As Long)
    Dim endTime As Double

    If ms <= 0 Then
        Exit Sub
    End If

    endTime = Timer + (ms / 1000#)
    Do While Timer < endTime
        DoEvents
        ' 日付をまたぐと Timer が 0 に戻るため、その回は待たずに抜けます。
        If Timer < 0 Then
            Exit Do
        End If
    Loop
End Sub

' 読み取り前の待機。入口から呼びます。
Public Sub WaitBeforeRead()
    WaitMilliseconds 120
End Sub

' 書き込み後の待機。入口から呼びます。
Public Sub WaitAfterWrite()
    WaitMilliseconds 80
    WaitMilliseconds 80
End Sub

' 共有フォルダの応答を待つつもりの固定待機。入口からは呼びません。
Public Sub WaitForShare()
    Dim i As Long

    For i = 1 To 3
        WaitMilliseconds 250
    Next i
End Sub

' 印刷完了の待ち合わせ。入口からは呼びません。
Public Sub WaitForSpooler()
    WaitMilliseconds 500
    WaitMilliseconds 500
End Sub
"""

REPAIR_SUMMARY = (
    "待ち時間の処理から Windows の関数呼び出し（Declare による Sleep）を"
    "取り除きました。\n"
    "待機は TimerUtils の中の WaitMilliseconds に 1 か所へまとめ、"
    "VBA の標準機能（Timer と DoEvents）だけで同じ長さを待ちます。\n"
    "待つ長さと、どこで待つかは変えていません。"
    "呼び出し側（BillingReport）は変更していません。"
)


def build_repair():
    lines = [
        "'@MACROSTUDIO {{REQUEST_ID}} SUMMARY BEGIN",
        REPAIR_SUMMARY,
        "'@MACROSTUDIO {{REQUEST_ID}} SUMMARY END",
        "'@MACROSTUDIO {{REQUEST_ID}} BEGIN standard TimerUtils",
        REPAIRED_TIMER_UTILS.rstrip("\n"),
        "'@MACROSTUDIO {{REQUEST_ID}} END standard TimerUtils",
        "'@MACROSTUDIO {{REQUEST_ID}} COMPLETE 1",
    ]
    return "\n".join(lines)


def main():
    read_back = read_json(os.path.join(SAMPLE, "modules.json"))
    labels = load_type_labels()
    modules = []
    modules_by_name = {}
    for module in read_back["modules"]:
        modules.append({
            "name": module["name"],
            "type": module["type"],
            "typeLabel": labels[module["type"]],
            "ext": module["ext"],
            "lineCount": module["lineCount"],
            "code": module["code"],
            "attributes": module["attributes"],
        })
        modules_by_name[module["name"]] = module["code"]

    book = {
        "path": RUN_ROOT + "\\" + BOOK_NAME,
        "name": BOOK_NAME,
        "ext": ".xlsm",
        "totalLines": read_back["book"]["totalLines"],
    }

    diagnosis, finding_count = build_diagnosis(modules_by_name)

    fixture = {
        "version": "beta 2.0.0",
        "book": book,
        "modules": modules,
        "warning": bool(read_back["hasReadWarnings"]),
        "read": {
            "level": "clean",
            "partialModules": [],
            "recoveredOffsetModules": [],
            "unreadableModules": [],
            "containerFallback": False,
            "salvaged": False,
            "shortStream": False,
        },
        # No signature on this workbook, so the signature notice does not
        # appear. It is photographed from a separate scene that flips this.
        "inventory": {
            "sha256": "",
            "sizeBytes": 0,
            "modifiedUtc": "",
            "references": [],
            "connections": [],
            "barcodeFonts": [],
            "hasPowerQuery": False,
            "activeXCount": 0,
            "externalLinkCount": 0,
            "hasVbaSignature": False,
            "complete": True,
        },
        "presets": load_presets(),
        "requestTemplates": load_templates(),
        "targetEnvironment": read_text(
            os.path.join(REPO, "environment", "target-environment.json")),
        "runFolder": RUN_FOLDER,
        "handoffFolder": HANDOFF_FOLDER,
        "aiCodeName": AI_CODE_NAME,
        "runStamp": RUN_STAMP,
        "diagnosisPackage": diagnosis,
        "diagnosisFindingCount": finding_count,
        "repairPackage": build_repair(),
        "replacements": {
            "S:\\keiri\\seikyu\\": "D:\\keiri_share\\seikyu\\",
            "\\\\fileserver\\keiri\\hinagata\\":
                "\\\\file01.example.local\\keiri\\hinagata\\",
            "%USERPROFILE%\\Documents\\keiri\\":
                "D:\\keiri_local\\hikae\\",
        },
    }

    out = os.path.join(HERE, "fixture.json")
    with io.open(out, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(fixture, ensure_ascii=False, indent=1))
    sys.stdout.write("fixtures_build: OK\n")
    sys.stdout.write("  %s\n" % out)
    sys.stdout.write("  modules=%d findings=%d presets=%d/%d templates=%d\n" % (
        len(modules), finding_count,
        len(fixture["presets"]["diagnose"]),
        len(fixture["presets"]["repair"]),
        len(fixture["requestTemplates"])))


if __name__ == "__main__":
    main()
