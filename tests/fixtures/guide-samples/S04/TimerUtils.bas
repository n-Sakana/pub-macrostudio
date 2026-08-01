Option Explicit

'============================================================
' 待ち時間の処理
'
' 2016/03  初版
' 2019/10  VBA7 の分岐を足した（64bit の端末が出たため）
'
' ガイド 3.2「Win32 API、Windows Shell、外部ライブラリ」の見本。
'============================================================

#If VBA7 Then
Private Declare PtrSafe Sub Sleep Lib "kernel32" (ByVal ms As LongPtr)
#Else
Private Declare Sub Sleep Lib "kernel32" (ByVal ms As Long)
#End If

Private Const SHEET_WORK As String = "作業"

' 入口。Sleep を 1 回だけ通ります。
Public Sub RunWait()
    Dim ws As Worksheet

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    ws.Range("B3").Value = 60
    Sleep 60
    ws.Range("B4").Value = WaitedTwice()
    ws.Range("B2").Value = "待機済み"
End Sub

' 呼び出し側の都合で 2 回待つ箇所があります。
Private Function WaitedTwice() As Long
    Sleep 30
    Sleep 30
    WaitedTwice = 60
End Function

' 外部処理の完了を待つつもりの固定待機。入口からは呼びません。
Public Sub WaitForExternalJob()
    Dim i As Long

    For i = 1 To 5
        Sleep 200
    Next i
End Sub
