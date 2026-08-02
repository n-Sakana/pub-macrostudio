================================================================================
 S01_fixed_drive.xlsm - VBA Source Code
 Generated: 2026-08-02 20:27:44
================================================================================

MODULE INDEX
----------------------------------------

  Standard Modules:
    ExportSummary.bas (70 lines)

  Document Modules:
    Sheet1.cls (0 lines)
    Sheet2.cls (0 lines)
    ThisWorkbook.cls (0 lines)

  Total: 70 lines across 4 modules

================================================================================
 ExportSummary.bas
================================================================================

Option Explicit

'============================================================
' 申請件数の集計と共有フォルダへの書き出し
'
' 2018/05  初版
' 2021/03  月次の書き出しを追加
' 2024/09  保存先を年度別に分けた
'
' ガイド 3.1「パス、ファイル、フォルダー操作」の見本。
' 保存先がコードに直書きされています。
'============================================================

' 営業部の共有ドライブ。端末に S: が割り当てられている前提です。
Private Const EXPORT_ROOT As String = "E:\eigyo\shinsei\"
Private Const SHEET_WORK As String = "作業"
Private Const SHEET_CONF As String = "設定"

' 入口。シートの中だけで完結します。
Public Sub RunSummary()
    Dim ws As Worksheet
    Dim conf As Worksheet
    Dim r As Long
    Dim last As Long
    Dim total As Long

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    Set conf = ThisWorkbook.Worksheets(SHEET_CONF)

    last = ws.Cells(ws.Rows.Count, 4).End(xlUp).Row
    total = 0
    For r = 5 To last
        If Len(Trim$(CStr(ws.Cells(r, 4).Value))) > 0 Then
            total = total + CLng(ws.Cells(r, 5).Value)
        End If
    Next r

    ws.Range("B3").Value = total
    ws.Range("B4").Value = conf.Range("B2").Value
    ws.Range("B2").Value = "集計済み"
End Sub

' 書き出し。入口からは呼びません。担当者が月末に手で実行していました。
Public Sub ExportToShare()
    Dim folder As String
    Dim path As String
    Dim fileNo As Integer
    Dim ws As Worksheet

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)

    ' 年度フォルダを文字列連結で組み立てています。
    folder = EXPORT_ROOT & Format$(Date, "yyyy") & "\"
    If Dir(folder, vbDirectory) = "" Then
        MkDir folder
    End If

    path = folder & "shinsei_" & Format$(Date, "yyyymmdd") & ".csv"
    fileNo = FreeFile
    Open path For Output As #fileNo
    Print #fileNo, "件数," & CStr(ws.Range("B3").Value)
    Close #fileNo

    ws.Range("B5").Value = path
End Sub

' 既定の保存先を返します。ここも同じ前提です。
Public Function DefaultExportFolder() As String
    DefaultExportFolder = EXPORT_ROOT
End Function

================================================================================
 Sheet1.cls
================================================================================

================================================================================
 Sheet2.cls
================================================================================

================================================================================
 ThisWorkbook.cls
================================================================================
