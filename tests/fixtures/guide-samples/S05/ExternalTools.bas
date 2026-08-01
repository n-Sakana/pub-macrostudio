Option Explicit

'============================================================
' 外部ツールの呼び出し
'
' 2018/09  初版
' 2021/06  レポートフォルダを開く処理を追加
'
' ガイド 3.2「Windows Shell、外部ライブラリ」の見本。
'============================================================

Private Const SHEET_WORK As String = "作業"
Private Const REPORT_FOLDER As String = "S:\eigyo\report\"

' 入口。生成できるかどうかを確かめて書くだけです。
' 外部プロセスは起動しません。
Public Sub RunProbe()
    Dim ws As Worksheet

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    ws.Range("B3").Value = ProbeScriptHost()
    ws.Range("B4").Value = ProbeShellApplication()
    ws.Range("B2").Value = "確認済み"
End Sub

' スクリプトホストを作れるかどうか。
Private Function ProbeScriptHost() As String
    Dim wsh As Object

    On Error Resume Next
    Set wsh = CreateObject("WScript.Shell")
    If Err.Number <> 0 Then
        ProbeScriptHost = "作れません(" & CStr(Err.Number) & ")"
        Err.Clear
    Else
        ProbeScriptHost = "作れます"
    End If
    On Error GoTo 0
    Set wsh = Nothing
End Function

' シェルを作れるかどうか。
Private Function ProbeShellApplication() As String
    Dim shellApp As Object

    On Error Resume Next
    Set shellApp = CreateObject("Shell.Application")
    If Err.Number <> 0 Then
        ProbeShellApplication = "作れません(" & CStr(Err.Number) & ")"
        Err.Clear
    Else
        ProbeShellApplication = "作れます"
    End If
    On Error GoTo 0
    Set shellApp = Nothing
End Function

' レポートフォルダを開きます。入口からは呼びません。
Public Sub OpenReportFolder()
    Dim shellApp As Object

    Set shellApp = CreateObject("Shell.Application")
    shellApp.Open REPORT_FOLDER
End Sub

' 変換ツールを起動して環境変数を読みます。入口からは呼びません。
Public Sub RunConverter()
    Dim wsh As Object
    Dim userName As String

    Set wsh = CreateObject("WScript.Shell")
    userName = wsh.ExpandEnvironmentStrings("%USERNAME%")
    Shell "cmd.exe /c convert.bat " & userName, vbHide
End Sub
