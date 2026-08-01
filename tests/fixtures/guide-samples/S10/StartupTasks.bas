Option Explicit

'============================================================
' 起動時の初期処理
'
' 2016/09  初版
' 2021/12  起動時の確認メッセージを外した
'
' ガイド 3.5「マクロ、ActiveX、信頼設定」の見本。
' Workbook_Open から呼ばれます。署名は付いていません。
'============================================================

Private Const SHEET_WORK As String = "作業"

' 入口。ThisWorkbook の Workbook_Open と同じ中身です。
Public Sub RunStartup()
    Dim ws As Worksheet

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    ws.Range("B3").Value = Format$(Date, "yyyy/mm/dd")
    ws.Range("B4").Value = SecurityLevel()
    ws.Range("B2").Value = "起動処理済み"
End Sub

' 実行時のマクロ設定を読みます。読むだけで、変えません。
Public Function SecurityLevel() As Long
    SecurityLevel = Application.AutomationSecurity
End Function

' 取り込みの前に確認を止めていました。入口からは呼びません。
Public Sub SuppressPrompts()
    Application.AutomationSecurity = msoAutomationSecurityLow
    Application.DisplayAlerts = False
End Sub
