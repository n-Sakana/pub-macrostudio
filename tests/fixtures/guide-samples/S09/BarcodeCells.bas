Option Explicit

'============================================================
' 管理票のバーコード欄
'
' 2017/02  初版
' 2020/11  桁数の点検を追加
'
' ガイド 3.4「バーコード生成」の見本。
' Code 39 用フォントと、値を * で挟む書き方に依存しています。
'============================================================

Private Const SHEET_WORK As String = "作業"
Private Const BARCODE_FONT As String = "Code39"

' 入口。バーコード欄を作ります。
Public Sub RunFill()
    Dim ws As Worksheet
    Dim r As Long
    Dim last As Long
    Dim code As String

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    last = ws.Cells(ws.Rows.Count, 4).End(xlUp).Row

    For r = 5 To last
        code = Trim$(CStr(ws.Cells(r, 4).Value))
        If Len(code) > 0 Then
            ws.Cells(r, 5).Value = Encode39(code)
            ws.Cells(r, 5).Font.Name = BARCODE_FONT
            ws.Cells(r, 5).Font.Size = 24
        End If
    Next r

    ws.Range("B3").Value = last - 4
    ws.Range("B2").Value = Encode39(CStr(ws.Range("D5").Value))
End Sub

' 前後に * を付けるだけです。規格の検査桁は付けていません。
Public Function Encode39(ByVal value As String) As String
    Encode39 = "*" & UCase$(Trim$(value)) & "*"
End Function

' フォントが入っているかどうかは、当ててみても分かりません。
' 代替表示されるだけで、エラーにはなりません。
Public Function BarcodeFontName() As String
    BarcodeFontName = BARCODE_FONT
End Function
