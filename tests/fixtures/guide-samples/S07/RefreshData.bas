Option Explicit

'============================================================
' 取込データの更新と集計
'
' 2022/04  初版（クエリでの取り込みへ移行）
' 2024/01  更新後の集計を追加
'
' ガイド 3.3「Power Query」の見本。
' 接続先・資格情報・プライバシーレベルはブックの外にあります。
'============================================================

Private Const SHEET_WORK As String = "作業"
Private Const SHEET_SRC As String = "元データ"

' 入口。ブックの中の表だけを集計します。更新は行いません。
Public Sub RunLocalSummary()
    Dim ws As Worksheet
    Dim src As Worksheet
    Dim r As Long
    Dim last As Long
    Dim total As Double

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    Set src = ThisWorkbook.Worksheets(SHEET_SRC)

    last = src.Cells(src.Rows.Count, 1).End(xlUp).Row
    total = 0
    For r = 2 To last
        total = total + CDbl(src.Cells(r, 3).Value)
    Next r

    ws.Range("B3").Value = total
    ws.Range("B4").Value = last - 1
    ws.Range("B5").Value = ConnectionCount()
    ws.Range("B2").Value = "集計済み"
End Sub

' ブックが持つ接続の数。読むだけです。
Public Function ConnectionCount() As Long
    On Error Resume Next
    ConnectionCount = ThisWorkbook.Connections.Count
    On Error GoTo 0
End Function

' 全更新。入口からは呼びません。接続先へ出ていきます。
Public Sub RunRefresh()
    ThisWorkbook.RefreshAll
    ThisWorkbook.Worksheets(SHEET_WORK).Range("B6").Value = Now
End Sub
