$ErrorActionPreference = 'Stop'
$guideRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\output\user-guide'))
$docxPath = Join-Path $guideRoot 'ColDesk用户手册.docx'
$pdfPath = Join-Path $guideRoot 'ColDesk用户手册.pdf'
$wordApp = $null
$guideDocument = $null
$ownsEmptyInstance = $false
try {
    $wordApp = New-Object -ComObject Word.Application
    if ($wordApp.Documents.Count -gt 0) { throw '新建 Word 实例包含其他文档，停止自动转换。' }
    $ownsEmptyInstance = $true
    $wordApp.Visible = $false
    $wordApp.DisplayAlerts = 0
    $wordApp.AutomationSecurity = 3
    $guideDocument = $wordApp.Documents.Open($docxPath, $false, $true, $false)
    $guideDocument.Repaginate()
    $guideDocument.ExportAsFixedFormat($pdfPath, 17)
    Write-Output ('Word 已渲染用户手册：' + $pdfPath)
} finally {
    if ($guideDocument) { $guideDocument.Close(0); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($guideDocument) }
    if ($wordApp -and $ownsEmptyInstance) { $wordApp.Quit(0); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wordApp) }
}
