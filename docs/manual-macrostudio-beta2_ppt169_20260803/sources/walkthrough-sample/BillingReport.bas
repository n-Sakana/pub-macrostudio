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
