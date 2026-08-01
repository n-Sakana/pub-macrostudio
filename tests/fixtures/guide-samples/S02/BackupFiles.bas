Option Explicit

'============================================================
' 添付ファイルの点検と共有への控え取り
'
' 2019/07  初版
' 2022/02  控えの取得先を部門共有へ変更
'
' ガイド 3.1「FileSystemObject の主な検索対象」の見本。
' UNC パスと FileSystemObject が組み合わさっています。
'============================================================

' 部門共有。新しい端末では別名になります。
Private Const SHARE_ROOT As String = "\\fileserver\share\soumu\shinsei\"
Private Const SHEET_WORK As String = "作業"

' 入口。シートに書かれた件数の点検だけを行います。
Public Sub RunCheck()
    Dim ws As Worksheet
    Dim r As Long
    Dim last As Long
    Dim missing As Long

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    last = ws.Cells(ws.Rows.Count, 4).End(xlUp).Row
    missing = 0
    For r = 5 To last
        If Len(Trim$(CStr(ws.Cells(r, 5).Value))) = 0 Then
            missing = missing + 1
        End If
    Next r

    ws.Range("B3").Value = last - 4
    ws.Range("B4").Value = missing
    ws.Range("B2").Value = "点検済み"
End Sub

' 控えの取得。入口からは呼びません。
Public Sub CopyToShare()
    Dim fso As Object
    Dim ws As Worksheet
    Dim r As Long
    Dim last As Long
    Dim src As String
    Dim dst As String

    Set fso = CreateObject("Scripting.FileSystemObject")
    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    last = ws.Cells(ws.Rows.Count, 4).End(xlUp).Row

    For r = 5 To last
        src = CStr(ws.Cells(r, 5).Value)
        If Len(src) > 0 Then
            If fso.FileExists(src) Then
                dst = SHARE_ROOT & fso.GetFileName(src)
                fso.CopyFile src, dst, True
                ws.Cells(r, 6).Value = dst
            Else
                ws.Cells(r, 6).Value = "見つかりません"
            End If
        End If
    Next r
End Sub

' 親フォルダを取り出しています。URL では期待どおりになりません。
Public Function ParentOf(ByVal path As String) As String
    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    ParentOf = fso.GetParentFolderName(path)
End Function

' 共有の既定位置。
Public Function ShareRoot() As String
    ShareRoot = SHARE_ROOT
End Function
