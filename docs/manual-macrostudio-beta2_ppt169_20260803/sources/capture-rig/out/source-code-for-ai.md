================================================================================
 sample_share_and_win32.xlsm - VBA Source Code
 Generated: 2026-08-03 12:01:24
================================================================================

MODULE INDEX
----------------------------------------

  Standard Modules:
    BillingReport.bas (69 lines)
    ShareExport.bas (76 lines)
    TimerUtils.bas (43 lines)

  Document Modules:
    Sheet1.cls (0 lines)
    Sheet2.cls (0 lines)
    Sheet3.cls (0 lines)
    ThisWorkbook.cls (0 lines)

  Total: 188 lines across 7 modules

================================================================================
 BillingReport.bas
================================================================================

Option Explicit

'============================================================
' 請求データの月次集計
'
' 2017/04  初版
' 2020/11  返品行の扱いを分けた
' 2023/08  共有フォルダへの控え出力を追加
'
' 入口は RunBilling。シートの中だけで完結します。
' 控えの書き出し（ShareExport）は入口からは呼びません。
'============================================================

Private Const SHEET_WORK As String = "作業"
Private Const SHEET_CONF As String = "設定"
Private Const SHEET_DATA As String = "明細"

' 入口。集計して、作業シートへ結果を書きます。
Public Sub RunBilling()
    Dim ws As Worksheet
    Dim conf As Worksheet
    Dim data As Worksheet
    Dim r As Long
    Dim lastRow As Long
    Dim billed As Long
    Dim total As Double

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    Set conf = ThisWorkbook.Worksheets(SHEET_CONF)
    Set data = ThisWorkbook.Worksheets(SHEET_DATA)

    ' 集計前に画面を落ち着かせるための待機です。
    TimerUtils.WaitBeforeRead

    lastRow = data.Cells(data.Rows.Count, 2).End(xlUp).Row
    billed = 0
    total = 0
    For r = 3 To lastRow
        If Len(Trim$(CStr(data.Cells(r, 2).Value))) > 0 Then
            If CStr(data.Cells(r, 5).Value) <> "返品" Then
                billed = billed + 1
                total = total + CDbl(data.Cells(r, 4).Value)
            End If
        End If
    Next r

    ws.Range("B3").Value = billed
    ws.Range("B4").Value = total
    ws.Range("B5").Value = conf.Range("B2").Value

    ' 集計結果を書いたあと、後続処理のために少し待ちます。
    TimerUtils.WaitAfterWrite

    ws.Range("B2").Value = "集計済み"
End Sub

' 対象年月の表示用文字列。入口から呼びます。
Public Function TargetMonthLabel() As String
    Dim conf As Worksheet
    Dim monthText As String

    Set conf = ThisWorkbook.Worksheets(SHEET_CONF)
    monthText = CStr(conf.Range("B2").Value)
    If Len(monthText) = 6 Then
        TargetMonthLabel = Left$(monthText, 4) & "/" & Right$(monthText, 2)
    Else
        TargetMonthLabel = monthText
    End If
End Function

================================================================================
 ShareExport.bas
================================================================================

Option Explicit

'============================================================
' 控えの書き出しと、ひな形の取り込み
'
' 2018/06  初版
' 2021/02  ひな形をファイルサーバーから取るようにした
' 2023/08  手元の控えフォルダを追加
'
' 保存先はコードに直書きしています。端末が変わると成り立ちません。
' ここの手続きは入口（BillingReport.RunBilling）からは呼びません。
'============================================================

' 営業所の共有ドライブ。端末に S: が割り当てられている前提です。
Private Const EXPORT_ROOT As String = "D:\keiri_share\seikyu\"

' 請求書のひな形。ファイルサーバーの名前を直書きしています。
Private Const TEMPLATE_DIR As String = "\\file01.example.local\keiri\hinagata\"
Private Const TEMPLATE_FILE As String = "seikyu_hinagata.xlsx"

' 手元に残す控え。環境変数を含む形で書いています。
Private Const LOCAL_BACKUP As String = "D:\keiri_local\hikae\"

Private Const SHEET_WORK As String = "作業"

' 共有フォルダへ控えを書き出します。入口からは呼びません。
Public Sub ExportToShare()
    Dim yearFolder As String
    Dim filePath As String
    Dim fileNo As Integer
    Dim ws As Worksheet

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)

    ' 年度フォルダを文字列連結で組み立てています。
    yearFolder = EXPORT_ROOT & Format$(Date, "yyyy") & "\"
    If Dir(yearFolder, vbDirectory) = "" Then
        MkDir yearFolder
    End If

    filePath = yearFolder & "seikyu_" & Format$(Date, "yyyymmdd") & ".csv"
    fileNo = FreeFile
    Open filePath For Output As #fileNo
    Print #fileNo, "件数," & CStr(ws.Range("B3").Value)
    Print #fileNo, "合計," & CStr(ws.Range("B4").Value)
    Close #fileNo

    ws.Range("B6").Value = filePath
End Sub

' 手元の控えフォルダへ同じものを置きます。入口からは呼びません。
Public Sub CopyToLocalBackup()
    Dim fso As Object
    Dim srcPath As String
    Dim dstPath As String

    ' ここは場所ではなく、部品の名前です。
    Set fso = CreateObject("Scripting.FileSystemObject")

    srcPath = EXPORT_ROOT & "control\" & TEMPLATE_FILE
    dstPath = LOCAL_BACKUP & "\backup\" & TEMPLATE_FILE

    If fso.FileExists(srcPath) Then
        fso.CopyFile srcPath, dstPath, True
    End If
End Sub

' ひな形の場所を返します。入口からは呼びません。
Public Function TemplatePath() As String
    TemplatePath = TEMPLATE_DIR & TEMPLATE_FILE
End Function

' 既定の保存先を返します。ここも同じ前提です。
Public Function DefaultExportFolder() As String
    DefaultExportFolder = EXPORT_ROOT
End Function

================================================================================
 TimerUtils.bas
================================================================================

Option Explicit

'============================================================
' 待ち時間の処理
'
' 2017/04  初版
' 2019/10  VBA7 の分岐を足した（64bit の端末が出たため）
'
' 待機はすべて kernel32 の Sleep を直に呼んでいます。
' 共通のラッパーは作っていません。
'============================================================

#If VBA7 Then
Private Declare PtrSafe Sub Sleep Lib "kernel32" (ByVal ms As LongPtr)
#Else
Private Declare Sub Sleep Lib "kernel32" (ByVal ms As Long)
#End If

' 読み取り前の待機。入口から呼びます。
Public Sub WaitBeforeRead()
    Sleep 120
End Sub

' 書き込み後の待機。入口から呼びます。
Public Sub WaitAfterWrite()
    Sleep 80
    Sleep 80
End Sub

' 共有フォルダの応答を待つつもりの固定待機。入口からは呼びません。
Public Sub WaitForShare()
    Dim i As Long

    For i = 1 To 3
        Sleep 250
    Next i
End Sub

' 印刷完了の待ち合わせ。入口からは呼びません。
Public Sub WaitForSpooler()
    Sleep 500
    Sleep 500
End Sub

================================================================================
 Sheet1.cls
================================================================================

================================================================================
 Sheet2.cls
================================================================================

================================================================================
 Sheet3.cls
================================================================================

================================================================================
 ThisWorkbook.cls
================================================================================
