Option Explicit

'============================================================
' シート上のボタンと入力欄
'
' 2015/06  初版
' 2019/02  入力欄を追加
'
' ガイド 3.5「マクロ、ActiveX、信頼設定」の見本。
' コントロールはコードではなくシートの持ち物です。
'============================================================

Private Const SHEET_WORK As String = "作業"

' 入口。コントロールの有無を数えて書きます。
' 無効化された端末でも落ちません。
Public Sub RunUpdateCaption()
    Dim ws As Worksheet
    Dim found As Long

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    found = ControlCount(ws)

    ws.Range("B3").Value = found
    If found = 0 Then
        ws.Range("B4").Value = "見つかりません"
    Else
        ws.Range("B4").Value = "あります"
    End If
    ws.Range("B2").Value = "更新済み"
End Sub

' シートの ActiveX を数えます。
Private Function ControlCount(ws As Worksheet) As Long
    Dim n As Long

    On Error Resume Next
    n = ws.OLEObjects.Count
    On Error GoTo 0
    ControlCount = n
End Function

' ボタンの表示文字を差し替えます。無効化された端末では落ちます。
' 入口からは呼びません。
Public Sub SetButtonCaption(ByVal caption As String)
    Dim ws As Worksheet

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    ws.OLEObjects("CommandButton1").Object.Caption = caption
End Sub

' 入力欄の値を読みます。入口からは呼びません。
Public Function InputBoxValue() As String
    Dim ws As Worksheet

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    InputBoxValue = CStr(ws.OLEObjects("TextBox1").Object.Text)
End Function
