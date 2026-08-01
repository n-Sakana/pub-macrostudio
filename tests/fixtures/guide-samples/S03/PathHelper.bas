Option Explicit

'============================================================
' ブックと同じ場所にあるファイルの取り回し
'
' 2017/11  初版
' 2020/08  カレントフォルダを合わせる処理を追加
'
' ガイド 3.1 留意点「URL ベースの保存先」の見本。
' ブックがローカルにある前提で書かれています。
'============================================================

Private Const SHEET_WORK As String = "作業"

' 入口。場所の種類を判定して書き出すだけです。
Public Sub RunDescribe()
    Dim ws As Worksheet
    Dim p As String

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)
    p = ThisWorkbook.Path

    ws.Range("B2").Value = p
    ws.Range("B4").Value = DriveLetterOf(p)
    ws.Range("B5").Value = SidecarPath("torikomi.csv")
    ws.Range("B3").Value = "判定済み"
End Sub

' 先頭 1 文字をドライブ文字として扱っています。
' https://... では "h" が返ります。
Public Function DriveLetterOf(ByVal p As String) As String
    If Len(p) = 0 Then
        DriveLetterOf = ""
    Else
        DriveLetterOf = Left(p, 1)
    End If
End Function

' 円記号で連結しています。URL では区切りが違います。
Public Function SidecarPath(ByVal fileName As String) As String
    SidecarPath = ThisWorkbook.Path & "\" & fileName
End Function

' 存在確認。URL パスでは Dir が働きません。入口からは呼びません。
Public Function SidecarExists(ByVal fileName As String) As Boolean
    SidecarExists = (Dir(SidecarPath(fileName)) <> "")
End Function

' カレントフォルダをブックの場所へ合わせています。
' 入口からは呼びません。
Public Sub ChangeCurrentFolder()
    Dim p As String

    p = ThisWorkbook.Path
    ChDrive Left(p, 1)
    ChDir p
    ThisWorkbook.Worksheets(SHEET_WORK).Range("B6").Value = CurDir
End Sub
