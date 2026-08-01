Option Explicit

'============================================================
' コードマスタの引き当て
'
' 2020/02  初版
' 2023/05  辞書へ載せ替えて速くした
'
' ガイド 3.2「参照設定の確認対象例」の見本。
' Microsoft Scripting Runtime を参照設定に入れて早期バインドしています。
' 参照はコードではなく VBA プロジェクトの属性です。
'============================================================

Private Const SHEET_WORK As String = "作業"

' 入口。辞書を作って件数を書きます。
Public Sub RunCount()
    Dim ws As Worksheet
    Dim map As Dictionary

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    Set map = BuildMap()

    ws.Range("B3").Value = map("A")
    ws.Range("B4").Value = map("B")
    ws.Range("B2").Value = CStr(map.Count)
End Sub

' New で作っています。参照設定が無い端末ではここで落ちます。
Private Function BuildMap() As Dictionary
    Dim map As Dictionary
    Dim ws As Worksheet
    Dim r As Long
    Dim last As Long
    Dim key As String

    Set map = New Dictionary
    map.CompareMode = TextCompare

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    last = ws.Cells(ws.Rows.Count, 4).End(xlUp).Row
    For r = 5 To last
        key = Trim$(CStr(ws.Cells(r, 4).Value))
        If Len(key) > 0 Then
            If map.Exists(key) Then
                map(key) = map(key) + 1
            Else
                map.Add key, 1
            End If
        End If
    Next r

    Set BuildMap = map
End Function

' こちらは書いた人が違い、ライブラリ名まで書いています。
' どちらも同じ参照設定に依存しています。
Public Function LookupCount(ByVal key As String) As Long
    Dim map As Scripting.Dictionary

    Set map = BuildMap()
    If map.Exists(key) Then
        LookupCount = map(key)
    Else
        LookupCount = 0
    End If
End Function
