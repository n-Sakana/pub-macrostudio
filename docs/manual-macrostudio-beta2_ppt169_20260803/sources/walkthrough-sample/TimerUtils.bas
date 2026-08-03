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
