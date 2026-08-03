================================================================================
 S04_win32_bitness.xlsm - VBA Source Code
 Generated: 2026-08-02 02:07:03
================================================================================

MODULE INDEX
----------------------------------------

  Standard Modules:
    TimerUtils.bas (46 lines)
    WindowUtils.bas (43 lines)

  Document Modules:
    Sheet1.cls (0 lines)
    ThisWorkbook.cls (0 lines)

  Total: 89 lines across 4 modules

================================================================================
 TimerUtils.bas
================================================================================

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

================================================================================
 WindowUtils.bas
================================================================================

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

()

================================================================================
 Sheet1.cls
================================================================================

================================================================================
 ThisWorkbook.cls
================================================================================
