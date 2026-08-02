# make-corpus-d.ps1 - D group (path shapes) + E/F/H groups.
# Writes only into run01\corpus\. Existing files are skipped.

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$OUT = Join-Path $RUN 'corpus\books'
$ORA = Join-Path $RUN 'corpus\oracles'
$VBEXT_STD = 1
$made = @(); $skipped = @(); $failed = @()

function Oracle($id, $file, $expect, $why, $entry, $equals, $mustFix, $mustPreserve, $route) {
  ([ordered]@{
    id = $id; file = $file; format = 'xlsm'; expect = $expect; why = $why
    entryMacro = $entry
    postRun = @(@{ sheet = '作業'; cell = 'B2'; equals = $equals })
    mustFix = $mustFix; mustPreserve = $mustPreserve
    route = $route
  }) | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $ORA ($id + '.json')) -Encoding UTF8
}

$SPECS = @(
  @{ id='D03'; file='D03_unc.xlsm'; why='UNC 複数'; route=@('path')
     fix=@('\\fileserver\share\','\\srv2\keiri\')
     keep=@()
     code=@'
Option Explicit

Private Const SHARE_A As String = "\\fileserver\share\"
Private Const SHARE_B As String = "\\srv2\keiri\"

Public Function PathA() As String
    PathA = SHARE_A
End Function

Public Sub RunUnc()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "UNC済み"
End Sub
'@; equals='UNC済み' }

  @{ id='D04'; file='D04_relative.xlsm'; why='相対パス（制限対象）'; route=@('path')
     fix=@(); keep=@()
     code=@'
Option Explicit

Private Const REL_A As String = "..\data\"
Private Const REL_B As String = ".\config\"

Public Function RelA() As String
    RelA = REL_A
End Function

Public Sub RunRel()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "相対済み"
End Sub
'@; equals='相対済み' }

  @{ id='D05'; file='D05_url.xlsm'; why='URL（SharePoint）'; route=@('path')
     fix=@(); keep=@()
     code=@'
Option Explicit

Private Const SITE As String = "https://contoso.sharepoint.com/sites/eigyo/"
Private Const DOCS As String = "/Shared Documents/"

Public Function SiteRoot() As String
    SiteRoot = SITE
End Function

Public Sub RunUrl()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "URL済み"
End Sub
'@; equals='URL済み' }

  @{ id='D07'; file='D07_all_mixed.xlsm'; why='ドライブ・UNC・相対・URL・書式の全混在'; route=@('path')
     fix=@('S:\eigyo\'); keep=@('yyyy/mm/dd','0.00')
     code=@'
Option Explicit

Private Const P_DRIVE As String = "S:\eigyo\"
Private Const P_UNC   As String = "\\srv\share\"
Private Const P_REL   As String = "..\out\"
Private Const P_URL   As String = "https://contoso.sharepoint.com/sites/x/"
Private Const F_DATE  As String = "yyyy/mm/dd"
Private Const F_NUM   As String = "0.00"

Public Function DriveRoot() As String
    DriveRoot = P_DRIVE
End Function

Public Sub RunMixed()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "混在済み"
End Sub
'@; equals='混在済み' }

  @{ id='D09'; file='D09_concat.xlsm'; why='連結の部分置換をしないこと'; route=@('path')
     fix=@(); keep=@('"S:\" & folder')
     code=@'
Option Explicit

Public Function Build(ByVal folder As String) As String
    Build = "S:\" & folder & "\out.csv"
End Function

Public Sub RunConcat()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "連結済み"
End Sub
'@; equals='連結済み' }

  @{ id='E01'; file='E01_no_ptrsafe.xlsm'; why='PtrSafe 無し Declare'; route=@('ai')
     fix=@('Declare'); keep=@()
     code=@'
Option Explicit

Private Declare Sub SleepNoPtr Lib "kernel32" Alias "Sleep" (ByVal ms As Long)

Public Sub RunNoPtr()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "宣言済み"
End Sub
'@; equals='宣言済み' }

  @{ id='F01'; file='F01_early_binding.xlsm'; why='Scripting.Dictionary 早期バインド'; route=@('ai')
     fix=@(); keep=@()
     code=@'
Option Explicit

Public Function CountKinds() As Long
    Dim d As Object
    Set d = CreateObject("Scripting.Dictionary")
    d("a") = 1
    d("b") = 2
    CountKinds = d.Count
End Function

Public Sub RunBind()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "束縛済み"
End Sub
'@; equals='束縛済み' }

  @{ id='F02'; file='F02_connection_string.xlsm'; why='接続文字列'; route=@('ai')
     fix=@(); keep=@()
     code=@'
Option Explicit

Private Const CONN As String = "Provider=SQLOLEDB;Data Source=SRV01;Initial Catalog=eigyo;"

Public Function ConnText() As String
    ConnText = CONN
End Function

Public Sub RunConn()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "接続済み"
End Sub
'@; equals='接続済み' }

  @{ id='H03'; file='H03_already_clean.xlsm'; why='既に対策済み。改修不要が妥当'; route=@('ai')
     fix=@(); keep=@()
     code=@'
Option Explicit

' 環境依存はありません。すべてブック内で完結します。
Public Function Total(ByVal a As Long, ByVal b As Long) As Long
    Total = a + b
End Function

Public Sub RunClean()
    ThisWorkbook.Worksheets(1).Range("B2").Value = "健全済み"
End Sub
'@; equals='健全済み' }
)

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
try {
  foreach ($s in $SPECS) {
    $path = Join-Path $OUT $s.file
    if (Test-Path $path) { $skipped += $s.id; continue }
    try {
      $wb = $xl.Workbooks.Add()
      while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets($wb.Worksheets.Count).Delete() }
      $wb.Worksheets(1).Name = '作業'
      $c = $wb.VBProject.VBComponents.Add($VBEXT_STD)
      $c.Name = ($s.id + 'Mod')
      $c.CodeModule.AddFromString($s.code)
      $wb.SaveAs($path, 52)
      $wb.Close($false)
      $entry = ([regex]::Match($s.code, 'Public Sub (Run\w+)')).Groups[1].Value
      Oracle $s.id $s.file 'normal' $s.why $entry $s.equals $s.fix $s.keep $s.route
      $made += $s.id
    } catch { $failed += "$($s.id): $($_.Exception.Message)"; try { $wb.Close($false) } catch {} }
  }
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }

"MADE    ($($made.Count)): $($made -join ', ')"
"SKIPPED ($($skipped.Count)): $($skipped -join ', ')"
if ($failed.Count) { "FAILED:"; $failed | ForEach-Object { "  $_" } }
