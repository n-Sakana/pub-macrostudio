# make-corpus-rest.ps1 - the corpus rows MATRIX.md still lacks a physical file for.
#
# Covers A02 A03 A04 A05 A08 / B02 B04 B05 B06 / C04 C05 C07 / D06 D08 D10 /
# E02 E03 E04 / F03 F04 F05 / H01 H02 H04   (G06 needs CFB surgery: separate script)
#
# Same discipline as make-corpus.ps1: writes only into run01\corpus\, never
# overwrites an existing file, uses its own hidden Excel and quits only that one.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File make-corpus-rest.ps1

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$OUT = Join-Path $RUN 'corpus\books'
$ORA = Join-Path $RUN 'corpus\oracles'
$TMP = (Join-Path $env:TEMP 'macrostudio-qa')
foreach ($d in $OUT, $ORA, $TMP) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null } }

$VBEXT_STD = 1; $VBEXT_CLASS = 2; $VBEXT_FORM = 3
$made = @(); $skipped = @(); $failed = @(); $notes = @()

function Save-Oracle($spec, $modules) {
  $o = [ordered]@{
    id = $spec.id; file = $spec.file; format = $spec.fmt
    expect = $spec.kind; why = $spec.why
    entryMacro = $spec.entry
    postRun = @()
    mustFix = @($spec.mustFix); mustPreserve = @($spec.mustPreserve)
    route = @($spec.route)
    modules = @($modules)
  }
  if ($spec.cell) { $o.postRun = @(@{ sheet = $spec.psheet; cell = $spec.cell; equals = $spec.val }) }
  if ($spec.ContainsKey('extra')) { foreach ($k in $spec.extra.Keys) { $o[$k] = $spec.extra[$k] } }
  $json = $o | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText((Join-Path $ORA ($spec.id + '.json')), $json, (New-Object System.Text.UTF8Encoding($true)))
}

# ---- bodies ---------------------------------------------------------------

function Body-Bulk([string]$tag, [int]$targetLines, [string]$entryName, [string]$cellVal) {
  $L = New-Object System.Collections.Generic.List[string]
  $L.Add('Option Explicit'); $L.Add('')
  if ($entryName) {
    $L.Add("Public Sub $entryName()")
    $L.Add('    ThisWorkbook.Worksheets(1).Range("B2").Value = "' + $cellVal + '"')
    $L.Add('End Sub'); $L.Add('')
  }
  $i = 1
  while ($L.Count -lt $targetLines) {
    $f = [int]($i % 9) + 1
    $L.Add("Public Function ${tag}Calc$i(ByVal v As Double) As Double")
    $L.Add('    Dim r As Double')
    $L.Add("    r = v * 1.0$f")
    $L.Add('    If r > 1000# Then r = r - 100#')
    $L.Add("    ${tag}Calc$i = r")
    $L.Add('End Function')
    $L.Add('')
    $i++
  }
  ($L -join "`r`n")
}

function New-Book($sheets) {
  $wb = $script:xl.Workbooks.Add()
  while ($wb.Worksheets.Count -gt $sheets.Count) { $wb.Worksheets($wb.Worksheets.Count).Delete() }
  while ($wb.Worksheets.Count -lt $sheets.Count) { $wb.Worksheets.Add() | Out-Null }
  for ($i = 0; $i -lt $sheets.Count; $i++) { $wb.Worksheets($i + 1).Name = $sheets[$i] }
  $wb
}

function Add-Mod($wb, [string]$name, [int]$type, [string]$code) {
  $c = $wb.VBProject.VBComponents.Add($type)
  $c.Name = $name
  if ($code) { $c.CodeModule.AddFromString($code) }
  $c
}

function Get-ThisWorkbookComponent($wb) {
  $sheetCodeNames = @()
  foreach ($ws in $wb.Worksheets) { $sheetCodeNames += $ws.CodeName }
  foreach ($c in $wb.VBProject.VBComponents) {
    if ($c.Type -eq 100 -and $sheetCodeNames -notcontains $c.Name) { return $c }
  }
  $null
}

# ===========================================================================
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$script:xl = $xl

try {

  # ---- A02 / A03 / A04 / A05 : scale -------------------------------------
  $SCALE = @(
    @{ id = 'A02'; file = 'A02_small.xlsm';  mods = 2;  lines = 40;    entry = 'RunSmall';  val = '小規模済み';   why = '標準2モジュール・40行級' }
    @{ id = 'A03'; file = 'A03_medium.xlsm'; mods = 6;  lines = 520;   entry = 'RunMedium'; val = '中規模済み';   why = '標準6モジュール・520行級' }
    @{ id = 'A04'; file = 'A04_large.xlsm';  mods = 18; lines = 5200;  entry = 'RunLarge';  val = '大規模済み';   why = '標準18モジュール・5,200行級。分割返答へ誘導' }
    @{ id = 'A05'; file = 'A05_xlarge.xlsm'; mods = 30; lines = 12000; entry = 'RunXLarge'; val = '超大規模済み'; why = '標準30モジュール・12,000行級。負荷・長時間ビルド' }
  )
  foreach ($s in $SCALE) {
    $path = Join-Path $OUT $s.file
    if (Test-Path $path) { $skipped += $s.id; continue }
    $wb = $null
    try {
      $wb = New-Book @('作業')
      $per = [int][Math]::Ceiling($s.lines / $s.mods)
      $modList = @()
      for ($m = 1; $m -le $s.mods; $m++) {
        $tag = '{0}M{1:D2}' -f $s.id, $m
        $entry = if ($m -eq 1) { $s.entry } else { '' }
        Add-Mod $wb $tag $VBEXT_STD (Body-Bulk $tag $per $entry $s.val) | Out-Null
        $modList += @{ name = $tag; type = $VBEXT_STD }
      }
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = $s.id; file = $s.file; fmt = 'xlsm'; kind = 'normal'; why = $s.why
        entry = $s.entry; psheet = '作業'; cell = 'B2'; val = $s.val
        mustFix = @(); mustPreserve = @(); route = @('ai') } $modList
      $made += $s.id
    } catch { $failed += "$($s.id): $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- A08 : empty modules mixed in --------------------------------------
  $path = Join-Path $OUT 'A08_empty_modules.xlsm'
  if (Test-Path $path) { $skipped += 'A08' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'Live' $VBEXT_STD @"
Option Explicit

Public Sub RunEmptyMix()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "空混在済み"
End Sub
"@ | Out-Null
      Add-Mod $wb 'EmptyOne' $VBEXT_STD '' | Out-Null
      Add-Mod $wb 'EmptyTwo' $VBEXT_STD '' | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'A08'; file = 'A08_empty_modules.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = '標準3モジュールのうち2つが空。空モジュールが消えないこと'
        entry = 'RunEmptyMix'; psheet = '作業'; cell = 'B2'; val = '空混在済み'
        mustFix = @(); mustPreserve = @(); route = @('ai') } @(
        @{ name = 'Live'; type = 1 }, @{ name = 'EmptyOne'; type = 1 }, @{ name = 'EmptyTwo'; type = 1 })
      $made += 'A08'
    } catch { $failed += "A08: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- B02 : Japanese / full-width identifiers ---------------------------
  # Ambitious first (full-width underscore + full-width digits in identifiers).
  # If VBA refuses, fall back and record what the language actually accepted.
  $path = Join-Path $OUT 'B02_japanese_idents.xlsm'
  if (Test-Path $path) { $skipped += 'B02' } else {
    $bold = @"
Option Explicit

Private 合計＿金額 As Double

Public Sub 売上集計実行()
    Dim 第１四半期 As Double
    第１四半期 = 1000
    合計＿金額 = 第１四半期 * 1.1
    ThisWorkbook.Worksheets(1).Range("B2").Value = "全角済み"
End Sub
"@
    $safe = @"
Option Explicit

Private 合計金額 As Double

Public Sub 売上集計実行()
    Dim 第一四半期 As Double
    第一四半期 = 1000
    合計金額 = 第一四半期 * 1.1
    ThisWorkbook.Worksheets(1).Range("B2").Value = "全角済み"
End Sub
"@
    $variant = 'full-width'
    $wb = $null
    try {
      $wb = New-Book @('作業')
      try {
        Add-Mod $wb '全角識別子' $VBEXT_STD $bold | Out-Null
      } catch {
        $variant = 'fallback-kanji-only'
        $notes += "B02: 全角＿/全角数字の識別子は VBA が拒否 -> 漢字のみへ縮退 ($($_.Exception.Message))"
        try { $wb.VBProject.VBComponents.Remove($wb.VBProject.VBComponents('全角識別子')) } catch {}
        Add-Mod $wb '全角識別子' $VBEXT_STD $safe | Out-Null
      }
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      # measure what actually survived the save
      $wb2 = $xl.Workbooks.Open($path, $false, $true)
      $txt = $wb2.VBProject.VBComponents('全角識別子').CodeModule.Lines(1, $wb2.VBProject.VBComponents('全角識別子').CodeModule.CountOfLines)
      $wb2.Close($false)
      $keptFullWidth = ($txt -match '合計＿金額')
      if ($variant -eq 'full-width' -and -not $keptFullWidth) {
        $variant = 'accepted-but-normalised'
        $notes += 'B02: 全角識別子は保存後に別表記へ正規化された'
      }
      Save-Oracle @{ id = 'B02'; file = 'B02_japanese_idents.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = "日本語＋全角記号の識別子（実測: $variant）"
        entry = '売上集計実行'; psheet = '作業'; cell = 'B2'; val = '全角済み'
        mustFix = @(); mustPreserve = @(); route = @('ai')
        extra = @{ identifierVariant = $variant } } @(@{ name = '全角識別子'; type = 1 })
      $made += 'B02'
    } catch { $failed += "B02: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- B04 : Japanese sheet names + Japanese cell reference ---------------
  $path = Join-Path $OUT 'B04_japanese_sheets.xlsm'
  if (Test-Path $path) { $skipped += 'B04' } else {
    $wb = $null
    try {
      $wb = New-Book @('売上台帳', '設定情報')
      $wb.Names.Add('消費税率', '=設定情報!$B$1') | Out-Null
      $wb.Worksheets('設定情報').Range('B1').Value = 0.1
      Add-Mod $wb 'JpSheet' $VBEXT_STD @"
Option Explicit

Public Function 税率() As Double
    税率 = ThisWorkbook.Names("消費税率").RefersToRange.Value
End Function

Public Sub RunJpSheet()
    ThisWorkbook.Worksheets("売上台帳").Range("B2").Value = "日本語シート済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'B04'; file = 'B04_japanese_sheets.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = '日本語シート名・日本語定義名をコードから参照'
        entry = 'RunJpSheet'; psheet = '売上台帳'; cell = 'B2'; val = '日本語シート済み'
        mustFix = @(); mustPreserve = @('売上台帳', '消費税率'); route = @('ai') } @(@{ name = 'JpSheet'; type = 1 })
      $made += 'B04'
    } catch { $failed += "B04: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- B06 : Unicode string literals (both route -> also carries a path) ---
  $path = Join-Path $OUT 'B06_unicode_literals.xlsm'
  if (Test-Path $path) { $skipped += 'B06' } else {
    $emoji = [char]::ConvertFromUtf32(0x1F4C8)      # chart increasing
    $cjkExtB = [char]::ConvertFromUtf32(0x20B9F)    # CJK ext-B
    $combining = "$([char]0x304B)$([char]0x3099)"   # ka + combining voiced mark
    $wb = $null
    try {
      $wb = New-Book @('作業')
      $code = @"
Option Explicit

Private Const EXPORT_ROOT As String = "S:\eigyo\shinsei\"
Private Const MARK_EMOJI As String = "$emoji"
Private Const MARK_EXTB As String = "$cjkExtB"
Private Const MARK_COMB As String = "$combining"

Public Function DefaultExportFolder() As String
    DefaultExportFolder = EXPORT_ROOT
End Function

Public Sub RunUni()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "Unicode済み"
    ThisWorkbook.Worksheets(1).Range("C2").Value = MARK_EMOJI & MARK_EXTB & MARK_COMB
End Sub
"@
      Add-Mod $wb 'Uni' $VBEXT_STD $code | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      # measure what actually round-tripped through the VBA code page
      $wb2 = $xl.Workbooks.Open($path, $false, $true)
      $cm = $wb2.VBProject.VBComponents('Uni').CodeModule
      $back = $cm.Lines(1, $cm.CountOfLines)
      $wb2.Close($false)
      $survived = @()
      if ($back -match [regex]::Escape($emoji)) { $survived += 'emoji' }
      if ($back -match [regex]::Escape($cjkExtB)) { $survived += 'cjk-ext-b' }
      if ($back -match [regex]::Escape($combining)) { $survived += 'combining' }
      $notes += "B06: VBA コードページを往復して残った文字種 = $(if($survived.Count){$survived -join ','}else{'なし（全て化けた）'})"
      Save-Oracle @{ id = 'B06'; file = 'B06_unicode_literals.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = "Unicode 文字列リテラル（絵文字/CJK拡張B/結合文字）。実測で残ったのは: $($survived -join ',')"
        entry = 'RunUni'; psheet = '作業'; cell = 'B2'; val = 'Unicode済み'
        mustFix = @('S:\eigyo\shinsei\'); mustPreserve = @(); route = @('both')
        extra = @{ unicodeSurvived = $survived } } @(@{ name = 'Uni'; type = 1 })
      $made += 'B06'
    } catch { $failed += "B06: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- C04 : no Option Explicit, implicit variables -----------------------
  $path = Join-Path $OUT 'C04_no_option_explicit.xlsm'
  if (Test-Path $path) { $skipped += 'C04' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'Implicit' $VBEXT_STD @"
' Option Explicit を意図的に書いていない。暗黙変数のまま動く。

Public Sub RunImplicit()
    total = 0
    For i = 1 To 10
        total = total + i
    Next
    ThisWorkbook.Worksheets(1).Range("B2").Value = "暗黙済み"
    ThisWorkbook.Worksheets(1).Range("C2").Value = total
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'C04'; file = 'C04_no_option_explicit.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = 'Option Explicit 無し＋暗黙変数。勝手に Option Explicit を足すと未宣言で落ちる'
        entry = 'RunImplicit'; psheet = '作業'; cell = 'B2'; val = '暗黙済み'
        mustFix = @(); mustPreserve = @(); route = @('ai') } @(@{ name = 'Implicit'; type = 1 })
      $made += 'C04'
    } catch { $failed += "C04: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- C05 : events (Workbook_Open / Worksheet_Change / UserForm_Initialize)
  $path = Join-Path $OUT 'C05_events.xlsm'
  if (Test-Path $path) { $skipped += 'C05' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      $twb = Get-ThisWorkbookComponent $wb
      if (-not $twb) { throw 'ThisWorkbook コンポーネントが特定できない' }
      $twb.CodeModule.AddFromString(@"
Private Sub Workbook_Open()
    Me.Worksheets(1).Range("C1").Value = "開いた"
End Sub
"@)
      $sheetCode = $wb.Worksheets(1).CodeName
      $wb.VBProject.VBComponents($sheetCode).CodeModule.AddFromString(@"
Private Sub Worksheet_Change(ByVal Target As Range)
    If Target.Address = "`$A`$1" Then Me.Range("D1").Value = "変更検知"
End Sub
"@)
      $frm = $wb.VBProject.VBComponents.Add($VBEXT_FORM)
      $frm.Name = 'FrmBoot'
      $frm.CodeModule.AddFromString(@"
Private Sub UserForm_Initialize()
    Me.Caption = "起動"
End Sub
"@)
      Add-Mod $wb 'EvBoot' $VBEXT_STD @"
Option Explicit

Public Sub RunEvents()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "イベント済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'C05'; file = 'C05_events.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = 'ThisWorkbook/シート/UserForm のイベントハンドラ。容器付きモジュールが消えないこと'
        entry = 'RunEvents'; psheet = '作業'; cell = 'B2'; val = 'イベント済み'
        mustFix = @(); mustPreserve = @('Workbook_Open', 'Worksheet_Change', 'UserForm_Initialize')
        route = @('ai') } @(
        @{ name = 'EvBoot'; type = 1 }, @{ name = 'FrmBoot'; type = 3 },
        @{ name = 'ThisWorkbook'; type = 100 }, @{ name = $sheetCode; type = 100 })
      $made += 'C05'
    } catch { $failed += "C05: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- C07 : procedures carrying Attribute lines (imported as .bas) -------
  $path = Join-Path $OUT 'C07_attributes.xlsm'
  if (Test-Path $path) { $skipped += 'C07' } else {
    $wb = $null
    try {
      $bas = Join-Path $TMP 'C07_AttrMod.bas'
      $basText = @"
Attribute VB_Name = "AttrMod"
Option Explicit

Public Sub RunAttr()
Attribute RunAttr.VB_Description = "MacroStudio corpus C07 entry point"
    ThisWorkbook.Worksheets(1).Range("B2").Value = "属性済み"
End Sub

Public Function Describe() As String
Attribute Describe.VB_Description = "returns a fixed label"
    Describe = "attributed"
End Function
"@
      [System.IO.File]::WriteAllText($bas, $basText, [System.Text.Encoding]::Default)
      $wb = New-Book @('作業')
      $wb.VBProject.VBComponents.Import($bas) | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Remove-Item $bas -Force -ErrorAction SilentlyContinue
      Save-Oracle @{ id = 'C07'; file = 'C07_attributes.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = 'Attribute VB_Description を持つプロシージャ。VBE 上は不可視なので往復で消えやすい'
        entry = 'RunAttr'; psheet = '作業'; cell = 'B2'; val = '属性済み'
        mustFix = @(); mustPreserve = @('VB_Description'); route = @('ai') } @(@{ name = 'AttrMod'; type = 1 })
      $made += 'C07'
    } catch { $failed += "C07: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- D06 : wildcards (restricted) --------------------------------------
  $path = Join-Path $OUT 'D06_wildcard.xlsm'
  if (Test-Path $path) { $skipped += 'D06' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'Wild' $VBEXT_STD @"
Option Explicit

Private Const CSV_GLOB As String = "S:\eigyo\torikomi\*.csv"
Private Const XLS_GLOB As String = "\\fileserver\kyoyu\*.xlsx"

Public Function FirstCsv() As String
    FirstCsv = Dir(CSV_GLOB)
End Function

Public Sub RunWild()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "ワイルド済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'D06'; file = 'D06_wildcard.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = 'ワイルドカード付きパス（制限対象）。ドライブ部だけを置換できるか'
        entry = 'RunWild'; psheet = '作業'; cell = 'B2'; val = 'ワイルド済み'
        mustFix = @(); mustPreserve = @(); route = @('path') } @(@{ name = 'Wild'; type = 1 })
      $made += 'D06'
    } catch { $failed += "D06: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- D08 : the same literal in 40 places --------------------------------
  $path = Join-Path $OUT 'D08_same_value_40.xlsm'
  if (Test-Path $path) { $skipped += 'D08' } else {
    $wb = $null
    try {
      $L = New-Object System.Collections.Generic.List[string]
      $L.Add('Option Explicit'); $L.Add('')
      $L.Add('Public Sub RunMany()')
      $L.Add('    ThisWorkbook.Worksheets(1).Range("B2").Value = "多数済み"')
      $L.Add('End Sub'); $L.Add('')
      for ($i = 1; $i -le 40; $i++) {
        $L.Add("Public Function Folder$i() As String")
        $L.Add('    Folder' + $i + ' = "S:\eigyo\shinsei\"')
        $L.Add('End Function'); $L.Add('')
      }
      $wb = New-Book @('作業')
      Add-Mod $wb 'Many' $VBEXT_STD ($L -join "`r`n") | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'D08'; file = 'D08_same_value_40.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = '同一値が40か所。集約表示・大量行スクロール・一括置換'
        entry = 'RunMany'; psheet = '作業'; cell = 'B2'; val = '多数済み'
        mustFix = @('S:\eigyo\shinsei\'); mustPreserve = @(); route = @('path')
        extra = @{ occurrences = 40 } } @(@{ name = 'Many'; type = 1 })
      $made += 'D08'
    } catch { $failed += "D08: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- D10 : 260-char path literal + Unicode directories -------------------
  $path = Join-Path $OUT 'D10_long_unicode_path.xlsm'
  if (Test-Path $path) { $skipped += 'D10' } else {
    $wb = $null
    try {
      $seg = '営業部共有フォルダ第一課'
      $deep = 'S:\'
      while ($deep.Length -lt 255) { $deep += "$seg\" }
      $notes += "D10: 生成したパスリテラル長 = $($deep.Length) 文字"
      $wb = New-Book @('作業')
      Add-Mod $wb 'LongPath' $VBEXT_STD @"
Option Explicit

Private Const DEEP_ROOT As String = "$deep"

Public Function DeepRoot() As String
    DeepRoot = DEEP_ROOT
End Function

Public Sub RunDeep()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "長パス済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'D10'; file = 'D10_long_unicode_path.xlsm'; fmt = 'xlsm'; kind = 'boundary'
        why = "260文字級かつ日本語ディレクトリのパス（実測 $($deep.Length) 文字）"
        entry = 'RunDeep'; psheet = '作業'; cell = 'B2'; val = '長パス済み'
        mustFix = @($deep); mustPreserve = @(); route = @('path')
        extra = @{ pathLength = $deep.Length } } @(@{ name = 'LongPath'; type = 1 })
      $made += 'D10'
    } catch { $failed += "D10: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- E02 : PtrSafe present but handle received as Long ------------------
  $path = Join-Path $OUT 'E02_ptrsafe_long_handle.xlsm'
  if (Test-Path $path) { $skipped += 'E02' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'PtrLong' $VBEXT_STD @"
Option Explicit

' PtrSafe は付いているが、ハンドルを LongPtr ではなく Long で受けている。
' 64bit では上位32bitが落ちる。
Private Declare PtrSafe Function FindWindowA Lib "user32" ( _
    ByVal lpClassName As String, ByVal lpWindowName As String) As Long

Private Declare PtrSafe Function GetActiveWindow Lib "user32" () As Long

Public Function ExcelHandle() As Long
    ExcelHandle = GetActiveWindow()
End Function

Public Sub RunPtr()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "PtrSafe済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'E02'; file = 'E02_ptrsafe_long_handle.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = 'PtrSafe あり・ハンドルが Long。PtrSafe だけ見て「対応済み」と判定しないこと'
        entry = 'RunPtr'; psheet = '作業'; cell = 'B2'; val = 'PtrSafe済み'
        mustFix = @(); mustPreserve = @(); route = @('ai') } @(@{ name = 'PtrLong'; type = 1 })
      $made += 'E02'
    } catch { $failed += "E02: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- E03 : both bitnesses behind #If VBA7 -------------------------------
  $path = Join-Path $OUT 'E03_both_bitness.xlsm'
  if (Test-Path $path) { $skipped += 'E03' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'BothBit' $VBEXT_STD @"
Option Explicit

#If VBA7 Then
Private Declare PtrSafe Sub SleepApi Lib "kernel32" Alias "Sleep" (ByVal dwMilliseconds As Long)
Private Declare PtrSafe Function GetTickCount64 Lib "kernel32" () As LongLong
#Else
Private Declare Sub SleepApi Lib "kernel32" Alias "Sleep" (ByVal dwMilliseconds As Long)
Private Declare Function GetTickCount Lib "kernel32" () As Long
#End If

Public Function Ticks() As Double
#If VBA7 Then
    Ticks = CDbl(GetTickCount64())
#Else
    Ticks = CDbl(GetTickCount())
#End If
End Function

Public Sub RunBit()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "両対応済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'E03'; file = 'E03_both_bitness.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = '#If VBA7 で32/64両方の Declare を持つ。片側だけ直すと他方が壊れる'
        entry = 'RunBit'; psheet = '作業'; cell = 'B2'; val = '両対応済み'
        mustFix = @(); mustPreserve = @('#Else', '#End If'); route = @('ai') } @(@{ name = 'BothBit'; type = 1 })
      $made += 'E03'
    } catch { $failed += "E03: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- E04 : Win32 + fixed path combined (both route) ---------------------
  $path = Join-Path $OUT 'E04_win32_and_path.xlsm'
  if (Test-Path $path) { $skipped += 'E04' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'MixWin' $VBEXT_STD @"
Option Explicit

Private Declare Sub SleepApi Lib "kernel32" Alias "Sleep" (ByVal dwMilliseconds As Long)

Private Const EXPORT_ROOT As String = "S:\eigyo\shinsei\"

Public Function DefaultExportFolder() As String
    DefaultExportFolder = EXPORT_ROOT
End Function

Public Sub WaitABit()
    SleepApi 100
End Sub

Public Sub RunMixWin()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "複合済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'E04'; file = 'E04_win32_and_path.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = 'Win32 Declare と固定パスの複合。両方経路で置換が AI 段を越えて生きること'
        entry = 'RunMixWin'; psheet = '作業'; cell = 'B2'; val = '複合済み'
        mustFix = @('S:\eigyo\shinsei\'); mustPreserve = @(); route = @('both') } @(@{ name = 'MixWin'; type = 1 })
      $made += 'E04'
    } catch { $failed += "E04: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- F03 : external workbook link in a formula ---------------------------
  $path = Join-Path $OUT 'F03_external_link.xlsm'
  if (Test-Path $path) { $skipped += 'F03' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      $linkTarget = Join-Path $OUT 'A01_minimal.xlsm'
      if (Test-Path $linkTarget) {
        $wb.Worksheets(1).Range('A5').Formula = "='$OUT\[A01_minimal.xlsm]作業'!`$A`$1"
      } else {
        $notes += 'F03: リンク先 A01 が無いため数式リンクを張れなかった'
      }
      Add-Mod $wb 'LinkMod' $VBEXT_STD @"
Option Explicit

Public Function LinkCount() As Long
    Dim v As Variant
    v = ThisWorkbook.LinkSources(1)
    If IsArray(v) Then LinkCount = UBound(v) Else LinkCount = 0
End Function

Public Sub RunLink()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "リンク済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'F03'; file = 'F03_external_link.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = '外部ブックリンク（数式）を持つ。書き戻しでリンクが失われないこと'
        entry = 'RunLink'; psheet = '作業'; cell = 'B2'; val = 'リンク済み'
        mustFix = @(); mustPreserve = @('A01_minimal.xlsm'); route = @('ai') } @(@{ name = 'LinkMod'; type = 1 })
      $made += 'F03'
    } catch { $failed += "F03: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- F04 : Shell launchers (code only - entry never launches anything) ---
  $path = Join-Path $OUT 'F04_shell_launch.xlsm'
  if (Test-Path $path) { $skipped += 'F04' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'ShellMod' $VBEXT_STD @"
Option Explicit

' 以下3つは「存在するコード」であって、入口マクロからは呼ばない。
Public Sub LaunchNotepad()
    Shell "notepad.exe", vbNormalFocus
End Sub

Public Sub LaunchViaWScript()
    Dim sh As Object
    Set sh = CreateObject("WScript.Shell")
    sh.Run "cmd.exe /c echo hello", 0, False
End Sub

Public Sub OpenFolder()
    Dim app As Object
    Set app = CreateObject("Shell.Application")
    app.Explore "S:\eigyo\shinsei\"
End Sub

Public Sub RunShellSafe()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "シェル済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'F04'; file = 'F04_shell_launch.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = 'Shell / WScript.Shell / Shell.Application。入口マクロは何も起動しない'
        entry = 'RunShellSafe'; psheet = '作業'; cell = 'B2'; val = 'シェル済み'
        mustFix = @(); mustPreserve = @(); route = @('ai')
        extra = @{ doNotRun = @('LaunchNotepad', 'LaunchViaWScript', 'OpenFolder') } } @(@{ name = 'ShellMod'; type = 1 })
      $made += 'F04'
    } catch { $failed += "F04: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- F05 : ActiveX-touching code ----------------------------------------
  $path = Join-Path $OUT 'F05_activex.xlsm'
  if (Test-Path $path) { $skipped += 'F05' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'AxMod' $VBEXT_STD @"
Option Explicit

' ActiveX を触るコード。この端末に現物のコントロールは無い。
' 入口マクロからは呼ばない。
Public Sub AddButton()
    ThisWorkbook.Worksheets(1).OLEObjects.Add ClassType:="Forms.CommandButton.1", _
        Left:=10, Top:=10, Width:=80, Height:=24
End Sub

Public Sub TouchProgressBar()
    Dim pb As Object
    Set pb = ThisWorkbook.Worksheets(1).OLEObjects("ProgressBar1").Object
    pb.Value = 50
End Sub

Public Sub RunAx()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "ActiveX済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'F05'; file = 'F05_activex.xlsm'; fmt = 'xlsm'; kind = 'normal'
        why = 'ActiveX/OLEObjects を触るコード。入口マクロからは呼ばない'
        entry = 'RunAx'; psheet = '作業'; cell = 'B2'; val = 'ActiveX済み'
        mustFix = @(); mustPreserve = @(); route = @('ai')
        extra = @{ doNotRun = @('AddButton', 'TouchProgressBar') } } @(@{ name = 'AxMod'; type = 1 })
      $made += 'F05'
    } catch { $failed += "F05: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- H01 : the right fix depends on a design decision -------------------
  $path = Join-Path $OUT 'H01_design_dependent.xlsm'
  if (Test-Path $path) { $skipped += 'H01' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'Ambig' $VBEXT_STD @"
Option Explicit

' 旧環境では部門ファイルサーバの共有だった。新環境では
'   (a) OneDrive 同期フォルダ  (b) SharePoint の URL  (c) 業務API
' のどれに寄せるかが未決。コードだけからは決まらない。
Private Const SHARE_ROOT As String = "\\kyu-fileserver\eigyo\teishutsu\"

Public Function SubmitFolder() As String
    SubmitFolder = SHARE_ROOT
End Function

Public Sub SubmitAll()
    Dim f As String
    f = Dir(SubmitFolder() & "*.xlsx")
    Do While Len(f) > 0
        f = Dir
    Loop
End Sub

Public Sub RunAmbig()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "設計判断済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'H01'; file = 'H01_design_dependent.xlsm'; fmt = 'xlsm'; kind = 'ambiguous'
        why = '移行先が同期フォルダ/URL/API のどれかコードから決まらない。NOCHANGE 判断が妥当'
        entry = 'RunAmbig'; psheet = '作業'; cell = 'B2'; val = '設計判断済み'
        mustFix = @(); mustPreserve = @(); route = @('ai')
        extra = @{ expectedJudgement = 'NOCHANGE 判断できない' } } @(@{ name = 'Ambig'; type = 1 })
      $made += 'H01'
    } catch { $failed += "H01: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- H02 : the request contradicts itself -------------------------------
  $path = Join-Path $OUT 'H02_contradictory.xlsm'
  if (Test-Path $path) { $skipped += 'H02' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'Contra' $VBEXT_STD @"
Option Explicit

#If VBA7 Then
Private Declare PtrSafe Sub SleepApi Lib "kernel32" Alias "Sleep" (ByVal ms As Long)
#Else
Private Declare Sub SleepApi Lib "kernel32" Alias "Sleep" (ByVal ms As Long)
#End If

' 「動作を変えずに」と「Win32 を使わない形へ」は両立しない。
' Application.Wait は 1 秒未満を待てず、待機中にメッセージを回すため
' 250ms 刻みのポーリングは意味が変わる。
Public Sub PollUntilReady()
    Dim i As Long
    For i = 1 To 20
        SleepApi 250
        If ThisWorkbook.Worksheets(1).Range("A1").Value = "ready" Then Exit For
    Next
End Sub

Public Sub RunContra()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "矛盾済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'H02'; file = 'H02_contradictory.xlsm'; fmt = 'xlsm'; kind = 'ambiguous'
        why = '「動作を変えずに」と「Win32 を使わない」が両立しない。250ms 刻みは Application.Wait で再現できない'
        entry = 'RunContra'; psheet = '作業'; cell = 'B2'; val = '矛盾済み'
        mustFix = @(); mustPreserve = @(); route = @('ai')
        extra = @{ expectedJudgement = 'NOCHANGE 改修できない' } } @(@{ name = 'Contra'; type = 1 })
      $made += 'H02'
    } catch { $failed += "H02: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- H04 : not enough information (a question back must be refused) -----
  $path = Join-Path $OUT 'H04_insufficient_info.xlsm'
  if (Test-Path $path) { $skipped += 'H04' } else {
    $wb = $null
    try {
      $wb = New-Book @('作業')
      Add-Mod $wb 'Lacking' $VBEXT_STD @"
Option Explicit

' 固定長レコードの桁位置。外部仕様書が無く、桁の意味も境界も不明。
' 「新様式へ合わせる」ためには仕様書が要る。
Public Function ParseRecord(ByVal s As String) As String
    ParseRecord = Mid(s, 1, 6) & "/" & Mid(s, 7, 8) & "/" & Mid(s, 15, 12) & "/" & Mid(s, 27, 4)
End Function

Public Function BuildRecord(ByVal a As String, ByVal b As String) As String
    BuildRecord = Left(a & Space(6), 6) & Left(b & Space(8), 8)
End Function

Public Sub RunLack()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "情報不足済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($path, 52); $wb.Close($false); $wb = $null
      Save-Oracle @{ id = 'H04'; file = 'H04_insufficient_info.xlsm'; fmt = 'xlsm'; kind = 'ambiguous'
        why = '外部仕様が無いと桁を決められない。質問を返したら製品が拒否すべき'
        entry = 'RunLack'; psheet = '作業'; cell = 'B2'; val = '情報不足済み'
        mustFix = @(); mustPreserve = @(); route = @('ai')
        extra = @{ expectedJudgement = 'NOCHANGE 判断できない'; questionsMustBeRejected = $true } } @(@{ name = 'Lacking'; type = 1 })
      $made += 'H04'
    } catch { $failed += "H04: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

  # ---- B05 : ~200-char file name at a deep path (boundary) ----------------
  # Built at a short path, then placed at the long one through the \\?\ prefix
  # so the OS limit is not what we are measuring - the product's handling is.
  $b05dir = Join-Path $OUT 'b05'
  $b05name = ('長いファイル名の境界試験' * 16) + '.xlsm'
  $b05full = Join-Path $b05dir $b05name
  if ([System.IO.File]::Exists('\\?\' + $b05full)) { $skipped += 'B05' } else {
    $wb = $null
    try {
      if (-not (Test-Path $b05dir)) { New-Item -ItemType Directory -Force $b05dir | Out-Null }
      $stage = Join-Path $TMP 'b05_stage.xlsm'
      if (Test-Path $stage) { Remove-Item $stage -Force }
      $wb = New-Book @('作業')
      Add-Mod $wb 'LongName' $VBEXT_STD @"
Option Explicit

Public Sub RunLongName()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "長名済み"
End Sub
"@ | Out-Null
      $wb.SaveAs($stage, 52); $wb.Close($false); $wb = $null
      [System.IO.File]::Copy('\\?\' + $stage, '\\?\' + $b05full, $true)
      Remove-Item $stage -Force -ErrorAction SilentlyContinue
      $len = $b05full.Length
      $notes += "B05: ファイル名 $($b05name.Length) 文字 / フルパス $len 文字（MAX_PATH 260 を $(if($len -gt 259){'超過'}else{'超えない'})）"
      Save-Oracle @{ id = 'B05'; file = "b05\$b05name"; fmt = 'xlsm'; kind = 'boundary'
        why = "200文字級のファイル名＋深いパス（実測 フルパス $len 文字）"
        entry = 'RunLongName'; psheet = '作業'; cell = 'B2'; val = '長名済み'
        mustFix = @(); mustPreserve = @(); route = @('ai')
        extra = @{ fullPathLength = $len; fileNameLength = $b05name.Length } } @(@{ name = 'LongName'; type = 1 })
      $made += 'B05'
    } catch { $failed += "B05: $($_.Exception.Message)"; if ($wb) { try { $wb.Close($false) } catch {} } }
  }

}
finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}

''
"MADE    ($($made.Count)): $($made -join ', ')"
"SKIPPED ($($skipped.Count)): $($skipped -join ', ')"
if ($notes.Count) { ''; 'NOTES:'; $notes | ForEach-Object { "  $_" } }
if ($failed.Count) { ''; "FAILED  ($($failed.Count)):"; $failed | ForEach-Object { "  $_" } }
