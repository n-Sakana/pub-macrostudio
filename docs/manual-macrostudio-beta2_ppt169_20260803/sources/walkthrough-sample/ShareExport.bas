Option Explicit

'============================================================
' 控えの書き出しと、ひな形の取り込み
'
' 2018/06  初版
' 2021/02  ひな形をファイルサーバーから取るようにした
' 2023/08  手元の控えフォルダを追加
'
' 保存先はコードに直書きしています。端末が変わると成り立ちません。
' ここの手続きは入口（BillingReport.RunBilling）からは呼びません。
'============================================================

' 営業所の共有ドライブ。端末に S: が割り当てられている前提です。
Private Const EXPORT_ROOT As String = "S:\keiri\seikyu\"

' 請求書のひな形。ファイルサーバーの名前を直書きしています。
Private Const TEMPLATE_DIR As String = "\\fileserver\keiri\hinagata\"
Private Const TEMPLATE_FILE As String = "seikyu_hinagata.xlsx"

' 手元に残す控え。環境変数を含む形で書いています。
Private Const LOCAL_BACKUP As String = "%USERPROFILE%\Documents\keiri\"

Private Const SHEET_WORK As String = "作業"

' 共有フォルダへ控えを書き出します。入口からは呼びません。
Public Sub ExportToShare()
    Dim yearFolder As String
    Dim filePath As String
    Dim fileNo As Integer
    Dim ws As Worksheet

    Set ws = ThisWorkbook.Worksheets(SHEET_WORK)

    ' 年度フォルダを文字列連結で組み立てています。
    yearFolder = EXPORT_ROOT & Format$(Date, "yyyy") & "\"
    If Dir(yearFolder, vbDirectory) = "" Then
        MkDir yearFolder
    End If

    filePath = yearFolder & "seikyu_" & Format$(Date, "yyyymmdd") & ".csv"
    fileNo = FreeFile
    Open filePath For Output As #fileNo
    Print #fileNo, "件数," & CStr(ws.Range("B3").Value)
    Print #fileNo, "合計," & CStr(ws.Range("B4").Value)
    Close #fileNo

    ws.Range("B6").Value = filePath
End Sub

' 手元の控えフォルダへ同じものを置きます。入口からは呼びません。
Public Sub CopyToLocalBackup()
    Dim fso As Object
    Dim srcPath As String
    Dim dstPath As String

    ' ここは場所ではなく、部品の名前です。
    Set fso = CreateObject("Scripting.FileSystemObject")

    srcPath = EXPORT_ROOT & "control\" & TEMPLATE_FILE
    dstPath = LOCAL_BACKUP & "\backup\" & TEMPLATE_FILE

    If fso.FileExists(srcPath) Then
        fso.CopyFile srcPath, dstPath, True
    End If
End Sub

' ひな形の場所を返します。入口からは呼びません。
Public Function TemplatePath() As String
    TemplatePath = TEMPLATE_DIR & TEMPLATE_FILE
End Function

' 既定の保存先を返します。ここも同じ前提です。
Public Function DefaultExportFolder() As String
    DefaultExportFolder = EXPORT_ROOT
End Function
