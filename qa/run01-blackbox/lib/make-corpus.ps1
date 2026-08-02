# make-corpus.ps1 - generate corpus workbooks + machine-checkable oracles.
#
# Writes only into run01\corpus\. Never touches the product repo, the teacher's
# files, or an already-running Excel. Uses its own hidden Excel instance and
# quits only that one. Existing files are never overwritten: a book that is
# already there is skipped and reported.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File make-corpus.ps1

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$OUT = Join-Path $RUN 'corpus\books'
$ORA = Join-Path $RUN 'corpus\oracles'
foreach ($d in $OUT, $ORA) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null } }

# vbext_ComponentType
$VBEXT_STD = 1; $VBEXT_CLASS = 2; $VBEXT_FORM = 3

function New-Spec {
  param([string]$Id, [string]$File, [string]$Format, [string]$Entry,
        [array]$Modules, [array]$MustFix, [array]$MustPreserve,
        [array]$PostRun, [string[]]$Route, [string]$Expect, [string]$Why)
  [pscustomobject]@{
    id = $Id; file = $File; format = $Format; entryMacro = $Entry
    modules = $Modules; mustFix = $MustFix; mustPreserve = $MustPreserve
    postRun = $PostRun; route = $Route; expect = $Expect; why = $Why
  }
}

# ---- code fragments -------------------------------------------------------

function Body-Simple([string]$marker) {
@"
Option Explicit

' $marker
Public Sub Run$marker()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "$marker 済み"
End Sub
"@
}

function Body-FixedPath([string]$drive) {
@"
Option Explicit

Private Const EXPORT_ROOT As String = "$($drive):\eigyo\shinsei\"
Private Const LOG_NAME As String = "log.csv"

Public Function DefaultExportFolder() As String
    DefaultExportFolder = EXPORT_ROOT
End Function

Public Sub RunPath()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "パス済み"
End Sub
"@
}

function Body-Formats() {
@"
Option Explicit

' 書式文字列。パス候補に出てはいけない。
Public Function StampNow() As String
    StampNow = Format`$(Now, "yyyy/mm/dd hh:mm:ss")
End Function

Public Function Ratio(ByVal a As Double) As String
    Ratio = Format`$(a, "0.00")
End Function

Public Sub RunFormat()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "書式済み"
End Sub
"@
}

function Body-LineContinuation() {
@"
Option Explicit

Public Function Joined() As String
    Joined = "abc" & _
        "def" & _
        "ghi"
End Function

Public Sub RunCont()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "継続済み"
End Sub
"@
}

function Body-CondCompile() {
@"
Option Explicit

#If VBA7 Then
Private Const BITNESS As String = "VBA7"
#Else
Private Const BITNESS As String = "VBA6"
#End If

Public Function WhichBitness() As String
    WhichBitness = BITNESS
End Function

Public Sub RunCond()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "条件済み"
End Sub
"@
}

function Body-ErrorHandling() {
@"
Option Explicit

Public Sub RunErr()
    On Error GoTo Fallback
    Err.Raise 5, "RunErr", "わざと"
    Exit Sub
Fallback:
    ThisWorkbook.Worksheets(1).Range("B2").Value = "例外済み"
End Sub
"@
}

function Body-LongLine() {
  # ORACLE correction: the matrix asked for a 4,000-character line, but VBA
  # itself caps a physical line near 1,023 characters - Excel refuses to save
  # beyond it ("ファイルを保存できませんでした。"). That is a VBA limit, not a
  # MacroStudio defect, so the boundary case is the largest line VBA accepts.
  $long = "x" * 950
  @"
Option Explicit

Public Function LongOne() As String
    LongOne = "$long"
End Function

Public Sub RunLong()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "長行済み"
End Sub
"@
}

function Body-Class() {
@"
Option Explicit

Private mName As String

Public Property Let ItemName(ByVal v As String)
    mName = v
End Property

Public Property Get ItemName() As String
    ItemName = mName
End Property
"@
}

# ---- corpus definition ----------------------------------------------------
# name, ext, sheets, modules(list of @{name;type;code}), entry, oracle bits
$CORPUS = @(
  @{ id='A01'; file='A01_minimal.xlsm'; sheets=@('作業')
     mods=@(@{n='Mod1';t=$VBEXT_STD;c=(Body-Simple 'Min')}); entry='RunMin'
     cell='B2'; expect='Min 済み'; route=@('ai'); kind='normal'
     why='最小構成。1標準モジュール' }

  @{ id='A06'; file='A06_mixed_types.xlsm'; sheets=@('作業','設定')
     mods=@(@{n='StdOne';t=$VBEXT_STD;c=(Body-Simple 'Mix')},
            @{n='ClsOne';t=$VBEXT_CLASS;c=(Body-Class)}); entry='RunMix'
     cell='B2'; expect='Mix 済み'; route=@('ai'); kind='normal'
     why='標準+クラス+シート+ThisWorkbook の混在' }

  @{ id='A07'; file='A07_class_only.xlsm'; sheets=@('作業')
     mods=@(@{n='ClsA';t=$VBEXT_CLASS;c=(Body-Class)},
            @{n='ClsB';t=$VBEXT_CLASS;c=(Body-Class)},
            @{n='Boot';t=$VBEXT_STD;c=(Body-Simple 'Cls')}); entry='RunCls'
     cell='B2'; expect='Cls 済み'; route=@('ai'); kind='normal'
     why='クラス主体' }

  @{ id='B01'; file='B01_japanese_names.xlsm'; sheets=@('作業')
     mods=@(@{n='集計処理';t=$VBEXT_STD;c=(Body-Simple 'Jp')},
            @{n='帳票出力';t=$VBEXT_STD;c=(Body-Class)}); entry='RunJp'
     cell='B2'; expect='Jp 済み'; route=@('ai'); kind='normal'
     why='日本語モジュール名' }

  @{ id='B03'; file='B03_name31.xlsm'; sheets=@('作業')
     mods=@(@{n='Mod31CharacterNameExactlyHere';t=$VBEXT_STD;c=(Body-Simple 'Long31')}); entry='RunLong31'
     cell='B2'; expect='Long31 済み'; route=@('ai'); kind='normal'
     why='VBA識別子上限31文字' }

  @{ id='C01'; file='C01_line_continuation.xlsm'; sheets=@('作業')
     mods=@(@{n='Cont';t=$VBEXT_STD;c=(Body-LineContinuation)}); entry='RunCont'
     cell='B2'; expect='継続済み'; route=@('ai'); kind='normal'
     why='行継続 _ を含む' }

  @{ id='C02'; file='C02_cond_compile.xlsm'; sheets=@('作業')
     mods=@(@{n='Cond';t=$VBEXT_STD;c=(Body-CondCompile)}); entry='RunCond'
     cell='B2'; expect='条件済み'; route=@('ai'); kind='normal'
     why='#If VBA7 条件コンパイル' }

  @{ id='C03'; file='C03_long_line.xlsm'; sheets=@('作業')
     mods=@(@{n='LongL';t=$VBEXT_STD;c=(Body-LongLine)}); entry='RunLong'
     cell='B2'; expect='長行済み'; route=@('ai'); kind='boundary'
     why='1行3,800文字級' }

  @{ id='C06'; file='C06_error_handling.xlsm'; sheets=@('作業')
     mods=@(@{n='ErrH';t=$VBEXT_STD;c=(Body-ErrorHandling)}); entry='RunErr'
     cell='B2'; expect='例外済み'; route=@('ai'); kind='normal'
     why='On Error GoTo / Err.Raise' }

  @{ id='C08'; file='C08_format_not_path.xlsm'; sheets=@('作業')
     mods=@(@{n='Fmt';t=$VBEXT_STD;c=(Body-Formats)}); entry='RunFormat'
     cell='B2'; expect='書式済み'; route=@('path'); kind='normal'
     why='PROD-03 回帰: 日付/数値書式をパス候補に出してはいけない'
     mustPreserveText=@('yyyy/mm/dd hh:mm:ss','0.00') }

  @{ id='D01'; file='D01_fixed_drive.xlsm'; sheets=@('作業')
     mods=@(@{n='PathOne';t=$VBEXT_STD;c=(Body-FixedPath 'S')}); entry='RunPath'
     cell='B2'; expect='パス済み'; route=@('path','both'); kind='normal'
     why='固定ドライブ1種。DefaultExportFolder で実行結果を観測できる'
     mustFixText=@('S:\eigyo\shinsei\') }

  @{ id='D02'; file='D02_fixed_drive_T.xlsm'; sheets=@('作業')
     mods=@(@{n='PathT';t=$VBEXT_STD;c=(Body-FixedPath 'T')}); entry='RunPath'
     cell='B2'; expect='パス済み'; route=@('path'); kind='normal'
     why='別ドライブ文字。置換の汎用性'
     mustFixText=@('T:\eigyo\shinsei\') }
)

# ---- generate -------------------------------------------------------------
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$made = @(); $skipped = @(); $failed = @()
try {
  foreach ($spec in $CORPUS) {
    $path = Join-Path $OUT $spec.file
    if (Test-Path $path) { $skipped += $spec.id; continue }
    try {
      $wb = $xl.Workbooks.Add()
      while ($wb.Worksheets.Count -gt $spec.sheets.Count) { $wb.Worksheets($wb.Worksheets.Count).Delete() }
      while ($wb.Worksheets.Count -lt $spec.sheets.Count) { $wb.Worksheets.Add() | Out-Null }
      for ($i = 0; $i -lt $spec.sheets.Count; $i++) { $wb.Worksheets($i + 1).Name = $spec.sheets[$i] }

      foreach ($m in $spec.mods) {
        $c = $wb.VBProject.VBComponents.Add($m.t)
        $c.Name = $m.n
        $c.CodeModule.AddFromString($m.c)
      }
      $wb.SaveAs($path, 52)   # 52 = xlOpenXMLWorkbookMacroEnabled
      $wb.Close($false)

      $oracle = [ordered]@{
        id = $spec.id; file = $spec.file; format = 'xlsm'
        entryMacro = $spec.entry
        postRun = @(@{ sheet = $spec.sheets[0]; cell = $spec.cell; equals = $spec.expect })
        mustFix = @(); mustPreserve = @()
        route = $spec.route; expect = $spec.kind; why = $spec.why
        modules = @($spec.mods | ForEach-Object { @{ name = $_.n; type = $_.t } })
      }
      if ($spec.ContainsKey('mustFixText')) { $oracle.mustFix = @($spec.mustFixText) }
      if ($spec.ContainsKey('mustPreserveText')) { $oracle.mustPreserve = @($spec.mustPreserveText) }
      $oracle | ConvertTo-Json -Depth 6 |
        Set-Content (Join-Path $ORA ($spec.id + '.json')) -Encoding UTF8
      $made += $spec.id
    } catch {
      $failed += "$($spec.id): $($_.Exception.Message)"
      try { $wb.Close($false) } catch {}
    }
  }
} finally {
  $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}

"MADE    ($($made.Count)): $($made -join ', ')"
"SKIPPED ($($skipped.Count)): $($skipped -join ', ')"
if ($failed.Count) { "FAILED  ($($failed.Count)):"; $failed | ForEach-Object { "  $_" } }
