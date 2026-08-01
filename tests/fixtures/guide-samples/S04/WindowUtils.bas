Option Explicit

'============================================================
' 画面の取り回し
'
' 2016/03  初版
' 2019/10  VBA7 の分岐を足した
'
' ガイド 3.2 判定観点「Long とポインターサイズの扱いが正しいか」の見本。
' 宣言は 64bit へ直してありますが、受け側が Long のまま残っています。
'============================================================

#If VBA7 Then
Private Declare PtrSafe Function FindWindowA Lib "user32" _
    (ByVal lpClassName As String, ByVal lpWindowName As String) As LongPtr
Private Declare PtrSafe Function IsWindowVisible Lib "user32" _
    (ByVal hWnd As LongPtr) As Long
#Else
Private Declare Function FindWindowA Lib "user32" _
    (ByVal lpClassName As String, ByVal lpWindowName As String) As Long
Private Declare Function IsWindowVisible Lib "user32" _
    (ByVal hWnd As Long) As Long
#End If

' ハンドルを Long で持ち回っています。
' 64bit ではポインタが入りきらない場合があります。
Private m_hWnd As Long

' Excel 本体のウィンドウを探します。入口からは呼びません。
Public Function ExcelWindowHandle() As Long
    m_hWnd = FindWindowA("XLMAIN", vbNullString)
    ExcelWindowHandle = m_hWnd
End Function

' 見えているかどうかを返します。入口からは呼びません。
Public Function ExcelWindowVisible() As Boolean
    If m_hWnd = 0 Then
        m_hWnd = FindWindowA("XLMAIN", vbNullString)
    End If
    ExcelWindowVisible = (IsWindowVisible(m_hWnd) <> 0)
End Function
