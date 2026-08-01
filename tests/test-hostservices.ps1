param(
    [string]$BookPath,
    [switch]$TestExplorer
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($BookPath)) {
    $BookPath = Join-Path $PSScriptRoot '..\testdata\test_large.xlsm'
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-HostSource {
    $names = @(
        '04_HostServices.cs',
        '05_Ole2.cs',
        '06_VbaCompression.cs',
        '07_VbaProject.cs',
        '08_BookIO.cs',
        '09_BookInventory.cs'
    )
    $combined = ($names | ForEach-Object {
        $path = Join-Path (Join-Path $PSScriptRoot '..\src') $_
        [IO.File]::ReadAllText(
            (Resolve-Path -LiteralPath $path),
            [Text.Encoding]::UTF8)
    }) -join "`n"

    $usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
    $usings = [regex]::Matches($combined, $usingPattern) |
        ForEach-Object { $_.Value.Trim() } |
        Sort-Object -Unique
    $body = $combined -replace $usingPattern, ''
    return ($usings -join "`n") + "`n`n" + $body
}

function Assert-InsideDirectory {
    param(
        [string]$Path,
        [string]$Directory
    )

    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullDirectory = [IO.Path]::GetFullPath($Directory).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar)
    $prefix = $fullDirectory + [IO.Path]::DirectorySeparatorChar
    Assert-True (
        $fullPath.StartsWith(
            $prefix,
            [StringComparison]::OrdinalIgnoreCase)) `
        "Test path is outside the expected directory: $fullPath"
}

function Get-ClipboardDataForCleanup {
    $lastError = $null
    foreach ($attempt in 1..40) {
        try {
            return [Windows.Clipboard]::GetDataObject()
        } catch {
            $lastError = $_
            Start-Sleep -Milliseconds 50
        }
    }
    throw (
        'The test could not capture the clipboard for cleanup: ' +
        $lastError.Exception.Message)
}

function Restore-ClipboardDataForCleanup {
    param([Windows.IDataObject]$Data)

    $lastError = $null
    foreach ($attempt in 1..40) {
        try {
            if ($null -eq $Data) {
                [Windows.Clipboard]::Clear()
            } else {
                [Windows.Clipboard]::SetDataObject($Data, $true)
            }
            return
        } catch {
            $lastError = $_
            Start-Sleep -Milliseconds 250
        }
    }
    throw (
        'The test could not restore the clipboard during cleanup: ' +
        $lastError.Exception.Message)
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Xaml
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$references = @(
    [System.Windows.Window].Assembly.Location
    [System.Windows.UIElement].Assembly.Location
    [System.Windows.DependencyObject].Assembly.Location
    [System.Xaml.XamlReader].Assembly.Location
    'System.IO.Compression',
    'System.IO.Compression.FileSystem'
)
Add-Type -TypeDefinition (Get-HostSource) `
    -ReferencedAssemblies $references `
    -Language CSharp

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$testdataRoot = (Resolve-Path (
    Join-Path $PSScriptRoot '..\testdata')).Path
$resolvedBookPath = (Resolve-Path -LiteralPath $BookPath).Path
$service = New-Object MacroStudio.HostServices($null, $repoRoot)

$environmentHostRoot = Join-Path $testdataRoot (
    'target-environment-host-' + [Guid]::NewGuid().ToString('N'))
Assert-InsideDirectory $environmentHostRoot $testdataRoot
$environmentDirectory = Join-Path $environmentHostRoot 'environment'
$environmentPath = Join-Path $environmentDirectory 'target-environment.json'
try {
    [IO.Directory]::CreateDirectory($environmentDirectory) | Out-Null
    $environmentService = New-Object MacroStudio.HostServices(
        $null,
        $environmentHostRoot)

    $missingEnvironmentCode = ''
    $missingEnvironmentValidation = ''
    try {
        [void]$environmentService.GetTargetEnvironment()
    } catch [MacroStudio.HostActionException] {
        $missingEnvironmentCode = $_.Exception.ErrorCode
        $missingEnvironmentValidation =
            $_.Exception.ErrorData['validationId']
    }
    Assert-True (
        $missingEnvironmentCode -eq 'E-ENV-01' -and
        $missingEnvironmentValidation -eq 'ENV-READ') `
        'A missing target environment must fail with E-ENV-01/ENV-READ.'

    $environmentProbe = 'not-json: the host must not interpret this text'
    [IO.File]::WriteAllText(
        $environmentPath,
        $environmentProbe,
        (New-Object Text.UTF8Encoding($false, $true)))
    $environmentRead = $environmentService.GetTargetEnvironment()
    Assert-True ($environmentRead['content'] -ceq $environmentProbe) `
        'The host must carry target-environment text without interpreting it.'

    [IO.File]::WriteAllText(
        $environmentPath,
        $environmentProbe,
        (New-Object Text.UTF8Encoding($true, $true)))
    $environmentBomRead = $environmentService.GetTargetEnvironment()
    Assert-True ($environmentBomRead['content'] -ceq $environmentProbe) `
        'A valid UTF-8 BOM must be accepted and removed by the host transport.'

    [IO.File]::WriteAllBytes(
        $environmentPath,
        [byte[]]@(0x7B, 0x22, 0x78, 0x22, 0x3A, 0x22, 0xC3, 0x28,
            0x22, 0x7D))
    $invalidEnvironmentCode = ''
    $invalidEnvironmentValidation = ''
    try {
        [void]$environmentService.GetTargetEnvironment()
    } catch [MacroStudio.HostActionException] {
        $invalidEnvironmentCode = $_.Exception.ErrorCode
        $invalidEnvironmentValidation =
            $_.Exception.ErrorData['validationId']
    }
    Assert-True (
        $invalidEnvironmentCode -eq 'E-ENV-01' -and
        $invalidEnvironmentValidation -eq 'ENV-READ') `
        'Invalid UTF-8 must fail with E-ENV-01/ENV-READ.'
} finally {
    Assert-InsideDirectory $environmentHostRoot $testdataRoot
    if ([IO.Directory]::Exists($environmentHostRoot)) {
        [IO.Directory]::Delete($environmentHostRoot, $true)
    }
}

$appInfo = $service.GetAppInfo()
Assert-True ($appInfo['version'] -eq 'beta 2.0.0') `
    'Application version mismatch.'
$expectedBuildFileLabel = [IO.File]::ReadAllText(
    (Join-Path $repoRoot 'assets\messages\build-file-label.txt'),
    [Text.Encoding]::UTF8).Trim()
Assert-True (
    $appInfo['buildFileLabel'] -eq $expectedBuildFileLabel) `
    'Build file label mismatch.'
$expectedRequestTemplate = [IO.File]::ReadAllText(
    (Join-Path $repoRoot 'templates\request-template.txt'),
    [Text.Encoding]::UTF8)
Assert-True (
    $service.ReadRequestTemplate('request-template')['content'] -ceq
    $expectedRequestTemplate) `
    'Request template content mismatch.'

$attached = $service.AttachBook($resolvedBookPath)
$book = $attached['book']
$modules = $attached['modules']
Assert-True ($book['path'] -eq $resolvedBookPath) `
    'Attached book path mismatch.'
Assert-True ($book['ext'] -eq '.xlsm') `
    'Attached book extension mismatch.'
Assert-True ($book['totalLines'] -eq 19) `
    'Attached book total line count mismatch.'
Assert-True ($modules.Count -eq 6) `
    'Attached module count mismatch.'

# A healthy workbook must raise nothing at all. "Incomplete" used to be a
# single boolean OR-ed from about seventy places, so the report of what
# actually fired is checked here against real files.
Assert-True ($attached['warning'] -eq $false) `
    'A healthy workbook must not report a read warning.'
$cleanRead = $attached['read']
Assert-True ($cleanRead['level'] -eq 'clean') `
    ('A healthy workbook must read clean: ' + $cleanRead['level'])
foreach ($key in @('containerFallback', 'salvaged', 'shortStream')) {
    Assert-True ($cleanRead[$key] -eq $false) `
        ('A healthy workbook must not set ' + $key + '.')
}
foreach ($key in @(
    'partialModules',
    'recoveredOffsetModules',
    'unreadableModules')) {
    Assert-True ($cleanRead[$key].Count -eq 0) `
        ('A healthy workbook must name no module in ' + $key + '.')
}

$expectedNames = @(
    'Sheet1',
    'ThisWorkbook',
    'AppController',
    'SystemInfo',
    'TimerUtils',
    'WindowUtils'
)
$expectedTypes = @(
    'document',
    'document',
    'standard',
    'standard',
    'standard',
    'standard'
)
$expectedLines = @(0, 0, 2, 5, 4, 8)
for ($index = 0; $index -lt $modules.Count; $index++) {
    Assert-True ($modules[$index]['name'] -eq $expectedNames[$index]) `
        "Module name mismatch at $index."
    Assert-True ($modules[$index]['type'] -eq $expectedTypes[$index]) `
        "Module type mismatch at $index."
    Assert-True ($modules[$index]['lineCount'] -eq $expectedLines[$index]) `
        "Module line count mismatch at $index."
    Assert-True (
        -not [string]::IsNullOrEmpty($modules[$index]['typeLabel'])) `
        "Module type label is empty at $index."
}

# A damaged container must still hand the real VBA source to the UI:
# a warning is allowed, an empty module list is not.
$damagedAttachPath = Join-Path $testdataRoot (
    'host-damaged-' + [Guid]::NewGuid().ToString('N') + '.xlsm')
Assert-InsideDirectory $damagedAttachPath $testdataRoot
try {
    [byte[]]$damagedBytes = [IO.File]::ReadAllBytes($resolvedBookPath)
    for ($index = 0; $index -lt $damagedBytes.Length - 3; $index++) {
        if ($damagedBytes[$index] -eq 0x50 -and
            $damagedBytes[$index + 1] -eq 0x4B -and
            $damagedBytes[$index + 2] -eq 0x05 -and
            $damagedBytes[$index + 3] -eq 0x06) {
            $damagedBytes[$index + 2] = 0x00
            $damagedBytes[$index + 3] = 0x00
        }
    }
    [IO.File]::WriteAllBytes($damagedAttachPath, $damagedBytes)
    $damagedAttached = $service.AttachBook($damagedAttachPath)
    Assert-True ($damagedAttached['warning'] -eq $true) `
        'A damaged workbook did not report a read warning.'
    Assert-True ($damagedAttached['modules'].Count -eq $modules.Count) `
        'A damaged workbook returned an empty module list.'

    # A broken archive directory is a container finding: the VBA part had
    # to be found another way, and every module then read normally. That
    # must be reported as a complete read, not as code in doubt.
    $damagedRead = $damagedAttached['read']
    Assert-True ($damagedRead['level'] -eq 'structureOnly') `
        ('A recoverable container must not put the code in doubt: ' +
            $damagedRead['level'])
    Assert-True ($damagedRead['containerFallback'] -eq $true) `
        'The container fallback was not reported.'
    Assert-True ($damagedRead['salvaged'] -eq $false) `
        'A recoverable container must not be reported as salvaged.'
    Assert-True ($damagedRead['shortStream'] -eq $false) `
        'No stream was short, so none may be reported.'
    Assert-True ($damagedRead['partialModules'].Count -eq 0) `
        'No module source was partial, so none may be named.'
    Assert-True ($damagedRead['unreadableModules'].Count -eq 0) `
        'Every module was read, so none may be named as unreadable.'
    for ($index = 0; $index -lt $modules.Count; $index++) {
        Assert-True (
            $damagedAttached['modules'][$index]['code'] -ceq
            $modules[$index]['code']) `
            "Damaged-workbook VBA source changed at $index."
    }
} finally {
    Assert-InsideDirectory $damagedAttachPath $testdataRoot
    if ([IO.File]::Exists($damagedAttachPath)) {
        [IO.File]::Delete($damagedAttachPath)
    }
}

# The other half of the split: a VBA part that is physically cut short.
# Some source is still there, so the attach must succeed, but the code
# cannot be vouched for and the report has to say which level it is.
$truncatedPath = Join-Path $testdataRoot (
    'host-truncated-' + [Guid]::NewGuid().ToString('N') + '.xlsm')
Assert-InsideDirectory $truncatedPath $testdataRoot
try {
    [IO.File]::Copy($resolvedBookPath, $truncatedPath)
    $archive = [IO.Compression.ZipFile]::Open(
        $truncatedPath,
        [IO.Compression.ZipArchiveMode]::Update)
    try {
        $vbaEntry = $null
        foreach ($entry in $archive.Entries) {
            if ($entry.Name -ieq 'vbaProject.bin') {
                $vbaEntry = $entry
                break
            }
        }
        Assert-True ($null -ne $vbaEntry) `
            'The test workbook has no vbaProject.bin to cut short.'
        $entryName = $vbaEntry.FullName
        $stream = $vbaEntry.Open()
        try {
            $buffer = New-Object IO.MemoryStream
            $stream.CopyTo($buffer)
            $vbaBytes = $buffer.ToArray()
        } finally {
            $stream.Dispose()
        }
        $keep = [int]($vbaBytes.Length * 0.6)
        $vbaEntry.Delete()
        $replacement = $archive.CreateEntry($entryName)
        $output = $replacement.Open()
        try {
            $output.Write($vbaBytes, 0, $keep)
        } finally {
            $output.Dispose()
        }
    } finally {
        $archive.Dispose()
    }

    $truncatedAttached = $service.AttachBook($truncatedPath)
    $truncatedRead = $truncatedAttached['read']
    Assert-True ($truncatedAttached['warning'] -eq $true) `
        'A cut-short VBA part must report a read warning.'
    Assert-True ($truncatedRead['level'] -eq 'sourceDoubt') `
        ('A cut-short VBA part must put the code in doubt: ' +
            $truncatedRead['level'])
    Assert-True (
        $truncatedRead['shortStream'] -eq $true -or
        $truncatedRead['salvaged'] -eq $true -or
        $truncatedRead['partialModules'].Count -gt 0 -or
        $truncatedRead['unreadableModules'].Count -gt 0) `
        'The finding that put the code in doubt was not reported.'
} finally {
    Assert-InsideDirectory $truncatedPath $testdataRoot
    if ([IO.File]::Exists($truncatedPath)) {
        [IO.File]::Delete($truncatedPath)
    }
}
[void]$service.AttachBook($resolvedBookPath)

# A workbook that another process holds open (Excel) is still read.
$held = [IO.File]::Open(
    $resolvedBookPath,
    [IO.FileMode]::Open,
    [IO.FileAccess]::Read,
    [IO.FileShare]::ReadWrite)
try {
    $sharedAttached = $service.AttachBook($resolvedBookPath)
    Assert-True ($sharedAttached['modules'].Count -eq $modules.Count) `
        'A shared-locked workbook lost modules.'
    Assert-True ($sharedAttached['warning'] -eq $false) `
        'A shared-locked workbook produced a read warning.'
} finally {
    $held.Dispose()
}

# An unreadable path still reports a clear attach error.
$missingAttachPath = Join-Path $testdataRoot (
    'host-missing-' + [Guid]::NewGuid().ToString('N') + '.xlsm')
Assert-InsideDirectory $missingAttachPath $testdataRoot
$lockErrorCode = ''
try {
    $service.AttachBook($missingAttachPath)
} catch [MacroStudio.MacroStudioException] {
    $lockErrorCode = $_.Exception.ErrorCode
}
Assert-True ($lockErrorCode -eq 'E-ATTACH-02') `
    "Missing workbook error mismatch: $lockErrorCode"

$tempBase = Join-Path $testdataRoot (
    'p3-host-' + [Guid]::NewGuid().ToString('N'))
$presetRoot = Join-Path $tempBase 'presets'
$diagnoseFolderName = '01_' + [char]0x8A3A + [char]0x65AD
$repairFolderName = '02_' + [char]0x6539 + [char]0x4FEE
$diagnosePresetRoot = Join-Path $presetRoot $diagnoseFolderName
$repairPresetRoot = Join-Path $presetRoot $repairFolderName
$templateRoot = Join-Path $tempBase 'templates'
$messageRoot = Join-Path $tempBase 'assets\messages'
Assert-InsideDirectory $tempBase $testdataRoot
[IO.Directory]::CreateDirectory($presetRoot) | Out-Null
[IO.Directory]::CreateDirectory($diagnosePresetRoot) | Out-Null
[IO.Directory]::CreateDirectory($repairPresetRoot) | Out-Null
[IO.Directory]::CreateDirectory($templateRoot) | Out-Null
[IO.Directory]::CreateDirectory($messageRoot) | Out-Null
[IO.File]::Copy(
    (Join-Path $repoRoot 'assets\messages\build-file-label.txt'),
    (Join-Path $messageRoot 'build-file-label.txt'))
[IO.File]::Copy(
    (Join-Path $repoRoot 'assets\messages\preset-encoding-error.txt'),
    (Join-Path $messageRoot 'preset-encoding-error.txt'))
[IO.File]::WriteAllText(
    (Join-Path $diagnosePresetRoot '01_D.md'),
    'diagnose',
    (New-Object Text.UTF8Encoding($true)))
[IO.File]::WriteAllText(
    (Join-Path $repairPresetRoot 'b.md'),
    'second',
    (New-Object Text.UTF8Encoding($true)))
[IO.File]::WriteAllText(
    (Join-Path $repairPresetRoot 'A.md'),
    'first',
    (New-Object Text.UTF8Encoding($true)))
$requestTemplatePath = Join-Path $templateRoot 'request-template.txt'
$diagnoseTemplatePath = Join-Path $templateRoot 'diagnose-template.txt'
[IO.File]::WriteAllText(
    $requestTemplatePath,
    'first template',
    (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText(
    $diagnoseTemplatePath,
    'diagnose template',
    (New-Object Text.UTF8Encoding($false)))

try {
    $presetService = New-Object MacroStudio.HostServices($null, $tempBase)
    $presetInfo = $presetService.GetAppInfo()
    $diagnosePresets = @($presetInfo['presets']['diagnose'])
    $repairPresets = @($presetInfo['presets']['repair'])
    Assert-True (
        $diagnosePresets.Count -eq 1 -and
        $repairPresets.Count -eq 2) `
        'Grouped preset count mismatch.'
    Assert-True (
        $diagnosePresets[0]['file'] -eq
            (Join-Path $diagnoseFolderName '01_D.md')) `
        'Diagnosis preset path mismatch.'
    Assert-True (
        $repairPresets[0]['file'] -eq
            (Join-Path $repairFolderName 'A.md')) `
        'Preset sort order mismatch.'
    # The host carries the markdown text; the UI parses it. No preset
    # name is computed here.
    Assert-True (
        -not $repairPresets[0].ContainsKey('name')) `
        'The host must not name presets.'
    Assert-True (
        $diagnosePresets[0]['content'] -ceq 'diagnose' -and
        $repairPresets[0]['content'] -ceq 'first' -and
        $repairPresets[1]['content'] -ceq 'second') `
        'GetAppInfo must return the markdown of every preset.'
    Assert-True (
        $presetService.ReadPreset(
            (Join-Path $repairFolderName 'A.md'))['content'] -eq 'first') `
        'Preset content mismatch.'

    # The card order is the file name order, with a leading number read as
    # a number. Sorting the names as text alone would put "10_" in front of
    # "2_", which is not the order the folder shows the owner.
    foreach ($numbered in @('2_two.md', '10_ten.md')) {
        [IO.File]::WriteAllText(
            (Join-Path $repairPresetRoot $numbered),
            'numbered',
            (New-Object Text.UTF8Encoding($false)))
    }
    $numberedFiles = @(
        $presetService.GetAppInfo()['presets']['repair'] |
        ForEach-Object { $_['file'] })
    Assert-True (
        ($numberedFiles -join '|') -ceq (
            (Join-Path $repairFolderName '2_two.md') + '|' +
            (Join-Path $repairFolderName '10_ten.md') + '|' +
            (Join-Path $repairFolderName 'A.md') + '|' +
            (Join-Path $repairFolderName 'b.md'))) `
        ('Preset order mismatch: ' + ($numberedFiles -join '|'))
    [IO.File]::Delete((Join-Path $repairPresetRoot '2_two.md'))
    [IO.File]::Delete((Join-Path $repairPresetRoot '10_ten.md'))

    # Discovery is dynamic: adding, removing and renaming files, or
    # editing one, changes the list with no code change and no restart.
    [IO.File]::WriteAllText(
        (Join-Path $repairPresetRoot 'c.md'),
        'third',
        (New-Object Text.UTF8Encoding($true)))
    [IO.File]::WriteAllText(
        (Join-Path $repairPresetRoot 'notes.txt'),
        'not a preset',
        (New-Object Text.UTF8Encoding($true)))
    $addedInfo = $presetService.GetAppInfo()
    Assert-True ($addedInfo['presets']['repair'].Count -eq 3) `
        'An added preset file was not discovered.'
    Assert-True (
        @($addedInfo['presets']['repair'] |
            ForEach-Object { $_['file'] }) -contains
                (Join-Path $repairFolderName 'c.md')) `
        'The added preset is missing from the list.'
    Assert-True (
        -not (@($addedInfo['presets']['repair'] |
            ForEach-Object { $_['file'] }) -contains
                (Join-Path $repairFolderName 'notes.txt'))) `
        'A non-markdown file must not become a preset.'

    [IO.File]::Move(
        (Join-Path $repairPresetRoot 'c.md'),
        (Join-Path $repairPresetRoot 'renamed.md'))
    [IO.File]::WriteAllText(
        (Join-Path $repairPresetRoot 'b.md'),
        'edited',
        (New-Object Text.UTF8Encoding($true)))
    $renamedInfo = $presetService.GetAppInfo()
    $renamedFiles = @($renamedInfo['presets']['repair'] |
        ForEach-Object { $_['file'] })
    Assert-True (
        ($renamedFiles -contains
            (Join-Path $repairFolderName 'renamed.md')) -and
        -not ($renamedFiles -contains
            (Join-Path $repairFolderName 'c.md'))) `
        'A renamed preset file was not rediscovered.'
    Assert-True (
        @($renamedInfo['presets']['repair'] |
            Where-Object {
                $_['file'] -eq (Join-Path $repairFolderName 'b.md')
            })[0]['content'] -ceq
        'edited') `
        'An edited preset was not read again.'

    [IO.File]::Delete((Join-Path $repairPresetRoot 'renamed.md'))
    [IO.File]::Delete((Join-Path $repairPresetRoot 'notes.txt'))
    Assert-True (
        $presetService.GetAppInfo()['presets']['repair'].Count -eq 2) `
        'A deleted preset file is still listed.'
    Assert-True (
        $presetService.ReadRequestTemplate(
            'request-template')['content'] -ceq
        'first template') `
        'Initial request template content mismatch.'
    Assert-True (
        $presetService.ReadRequestTemplate(
            'diagnose-template')['content'] -ceq
        'diagnose template') `
        'Named diagnosis template content mismatch.'
    foreach ($invalidTemplateName in @(
        '',
        '..\outside',
        '../outside',
        'request-template.txt',
        'Request-Template')) {
        $invalidTemplateErrorCode = ''
        try {
            $presetService.ReadRequestTemplate($invalidTemplateName)
        } catch [MacroStudio.HostActionException] {
            $invalidTemplateErrorCode = $_.Exception.ErrorCode
        }
        Assert-True ($invalidTemplateErrorCode -eq 'E-GEN-02') `
            ('Invalid template name was accepted: ' +
                $invalidTemplateName)
    }
    [IO.File]::WriteAllText(
        $requestTemplatePath,
        'second template',
        (New-Object Text.UTF8Encoding($false)))
    Assert-True (
        $presetService.ReadRequestTemplate(
            'request-template')['content'] -ceq
        'second template') `
        'Request template was not read again after editing.'

    $presetErrorCode = ''
    try {
        $presetService.ReadPreset('..\outside.md')
    } catch [MacroStudio.HostActionException] {
        $presetErrorCode = $_.Exception.ErrorCode
    }
    Assert-True ($presetErrorCode -eq 'E-SYS-02') `
        "Preset traversal error mismatch: $presetErrorCode"

    $outsidePresetPath = Join-Path $tempBase 'outside.md'
    [IO.File]::WriteAllText(
        $outsidePresetPath,
        'outside',
        (New-Object Text.UTF8Encoding($false)))
    $outsidePresetErrorCode = ''
    try {
        $presetService.ReadPreset($outsidePresetPath)
    } catch [MacroStudio.HostActionException] {
        $outsidePresetErrorCode = $_.Exception.ErrorCode
    }
    Assert-True ($outsidePresetErrorCode -eq 'E-SYS-02') `
        "Preset absolute-path error mismatch: $outsidePresetErrorCode"
    [IO.File]::Delete($outsidePresetPath)

    $invalidPresetPath = Join-Path $repairPresetRoot 'invalid-encoding.md'
    [IO.File]::WriteAllBytes(
        $invalidPresetPath,
        [byte[]](0x83, 0x76))
    $presetEncodingErrorCode = ''
    $presetEncodingMessage = ''
    $presetEncodingUserMessage = ''
    try {
        $presetService.ReadPreset(
            (Join-Path $repairFolderName 'invalid-encoding.md'))
    } catch [MacroStudio.HostActionException] {
        $presetEncodingErrorCode = $_.Exception.ErrorCode
        $presetEncodingMessage = $_.Exception.Message
        $presetEncodingUserMessage =
            $_.Exception.ErrorData['userMessage']
    }
    $expectedEncodingMessage = [IO.File]::ReadAllText(
        (Join-Path $messageRoot 'preset-encoding-error.txt'),
        [Text.Encoding]::UTF8).Trim()
    Assert-True ($presetEncodingErrorCode -eq 'E-SYS-02') `
        "Preset encoding error mismatch: $presetEncodingErrorCode"
    Assert-True ($presetEncodingMessage -eq $expectedEncodingMessage) `
        'Preset encoding exception message mismatch.'
    Assert-True (
        $presetEncodingUserMessage -eq $expectedEncodingMessage) `
        'Preset encoding user message mismatch.'

    # A file the host cannot decode stays visible in the list, marked
    # as unreadable, so the mistake is not silently hidden.
    $encodingEntry = @(
        $presetService.GetAppInfo()['presets']['repair'] |
        Where-Object {
            $_['file'] -eq
                (Join-Path $repairFolderName 'invalid-encoding.md')
        })
    Assert-True ($encodingEntry.Count -eq 1) `
        'An unreadable preset disappeared from the list.'
    Assert-True (
        $encodingEntry[0]['error'] -eq 'read' -and
        $encodingEntry[0]['content'] -eq '') `
        'An unreadable preset must be reported with an error flag.'
    [IO.File]::Delete($invalidPresetPath)

    [IO.File]::Delete($requestTemplatePath)
    $missingTemplateErrorCode = ''
    try {
        $presetService.ReadRequestTemplate('request-template')
    } catch [MacroStudio.HostActionException] {
        $missingTemplateErrorCode = $_.Exception.ErrorCode
    }
    Assert-True ($missingTemplateErrorCode -eq 'E-GEN-02') `
        "Missing template error mismatch: $missingTemplateErrorCode"

    [IO.File]::WriteAllBytes(
        $requestTemplatePath,
        [byte[]](0x83, 0x76))
    $templateEncodingErrorCode = ''
    try {
        $presetService.ReadRequestTemplate('request-template')
    } catch [MacroStudio.HostActionException] {
        $templateEncodingErrorCode = $_.Exception.ErrorCode
    }
    Assert-True ($templateEncodingErrorCode -eq 'E-GEN-02') `
        "Template encoding error mismatch: $templateEncodingErrorCode"
} finally {
    Assert-InsideDirectory $tempBase $testdataRoot
    if ([IO.Directory]::Exists($tempBase)) {
        [IO.Directory]::Delete($tempBase, $true)
    }
}

$identityChanges = New-Object `
    'System.Collections.Generic.Dictionary[string,string]' `
    ([StringComparer]::OrdinalIgnoreCase)
$identityChanges.Add(
    'AppController',
    $modules[2]['attributes'] + $modules[2]['code'])

$successOutput = ''
try {
    $buildTimestamp = [DateTime]::Now.ToString('yyyyMMdd_HHmmss')
    $build = $service.BuildBook($identityChanges, $buildTimestamp)
    $successOutput = $build['outputPath']
    Assert-InsideDirectory $successOutput $testdataRoot
    Assert-True ([IO.File]::Exists($successOutput)) `
        'Host build output was not created.'
    Assert-True ($build['results'].Count -eq 1) `
        'Host build result count mismatch.'
    Assert-True (
        $build['results'][0]['result'] -eq 'skipped_no_change') `
        'Host identity build result mismatch.'
    $runFolder = [IO.Path]::GetDirectoryName($successOutput)
    Assert-True (
        [IO.Path]::GetFileName($runFolder) -ceq
        ('test_large_' + $buildTimestamp)) `
        'Host build did not use the run folder for this timestamp.'
    Assert-True (
        [IO.Path]::GetFileName(
            [IO.Path]::GetDirectoryName($runFolder)) -ceq 'MacroStudio') `
        'The run folder must sit under a MacroStudio folder.'
    # Without a name from the screen the host falls back to the same
    # shape the screen would have produced.
    Assert-True (
        [IO.Path]::GetFileName($successOutput) -ceq
        ('test_large-Modified-' +
            [DateTime]::Now.ToString('yyyyMMdd') + '.xlsm')) `
        ('Host build output name mismatch: ' +
            [IO.Path]::GetFileName($successOutput))
} finally {
    if (-not [string]::IsNullOrEmpty($successOutput)) {
        Assert-InsideDirectory $successOutput $testdataRoot
        if ([IO.File]::Exists($successOutput)) {
            [IO.File]::Delete($successOutput)
        }
    }
}

$diffLabel = [IO.File]::ReadAllText(
    (Join-Path $repoRoot 'assets\messages\diff-file-label.txt'),
    [Text.Encoding]::UTF8).Trim()
$diffHtml = (
    '<!doctype html><html lang="ja"><head>' +
    '<meta charset="utf-8"><style>body{color:#fff}</style>' +
    '</head><body><h1>diff</h1></body></html>')
$noAdditions = New-Object `
    'System.Collections.Generic.List[MacroStudio.VbaModuleAddition]'
$diffBuildOutput = ''
$diffPath = ''
try {
    $diffTimestamp = [DateTime]::Now.AddSeconds(
        2).ToString('yyyyMMdd_HHmmss')
    $diffBuild = $service.BuildBook(
        $identityChanges,
        $noAdditions,
        $diffTimestamp,
        $diffHtml)
    $diffBuildOutput = $diffBuild['outputPath']
    $diffPath = $diffBuild['diffPath']
    Assert-InsideDirectory $diffBuildOutput $testdataRoot
    Assert-InsideDirectory $diffPath $testdataRoot
    Assert-True ([IO.File]::Exists($diffBuildOutput)) `
        'Diff-report build output was not created.'
    Assert-True ([IO.File]::Exists($diffPath)) `
        'Diff report was not created.'
    Assert-True (
        [IO.Path]::GetFileName($diffPath) -ceq
        ('test_large-Diff-Report-' +
            [DateTime]::Now.ToString('yyyyMMdd') + '.html')) `
        ('Diff report file name mismatch: ' +
            [IO.Path]::GetFileName($diffPath))
    Assert-True (
        [IO.Path]::GetDirectoryName($diffPath) -ceq
        [IO.Path]::GetDirectoryName($diffBuildOutput)) `
        'The diff report must sit beside the built workbook.'
    $diffBytes = [IO.File]::ReadAllBytes($diffPath)
    Assert-True (
        $diffBytes.Length -ge 3 -and
        $diffBytes[0] -eq 0xEF -and
        $diffBytes[1] -eq 0xBB -and
        $diffBytes[2] -eq 0xBF) `
        'Diff report does not have a UTF-8 BOM.'
    Assert-True (
        [IO.File]::ReadAllText(
            $diffPath,
            [Text.Encoding]::UTF8) -ceq
        $diffHtml) `
        'Diff report content mismatch.'
    Assert-True (-not $diffBuild.ContainsKey('diffError')) `
        'Successful diff output reported an error.'
} finally {
    foreach ($path in @($diffBuildOutput, $diffPath)) {
        if (-not [string]::IsNullOrEmpty($path)) {
            Assert-InsideDirectory $path $testdataRoot
            if ([IO.File]::Exists($path)) {
                [IO.File]::Delete($path)
            }
        }
    }
}

$collisionOutput = ''
$collisionPath = ''
try {
    $collisionTimestamp = [DateTime]::Now.AddSeconds(
        4).ToString('yyyyMMdd_HHmmss')
    $collisionFolder = Join-Path $testdataRoot (
        'MacroStudio\test_large_' + $collisionTimestamp)
    [IO.Directory]::CreateDirectory($collisionFolder) | Out-Null
    # A report of the same name that this run did not write is left where
    # it is, and the workbook is still produced.
    $collisionName = 'test_large-Diff-Report-' +
        [DateTime]::Now.ToString('yyyyMMdd') + '.html'
    $collisionPath = Join-Path $collisionFolder $collisionName
    [IO.File]::WriteAllText(
        $collisionPath,
        'existing report',
        (New-Object Text.UTF8Encoding($false)))
    $collisionService = New-Object MacroStudio.HostServices($null, $repoRoot)
    [void]$collisionService.AttachBook($resolvedBookPath)
    $collisionBuild = $collisionService.BuildBook(
        $identityChanges,
        $noAdditions,
        $collisionTimestamp,
        $diffHtml,
        $null,
        $null,
        $collisionName)
    $collisionOutput = $collisionBuild['outputPath']
    Assert-InsideDirectory $collisionOutput $testdataRoot
    Assert-True ([IO.File]::Exists($collisionOutput)) `
        'A diff-report failure cancelled the workbook build.'
    Assert-True (
        -not [string]::IsNullOrEmpty(
            $collisionBuild['diffError'])) `
        'A diff-report failure was not returned.'
    Assert-True (-not $collisionBuild.ContainsKey('diffPath')) `
        'A failed diff report returned a path.'
    Assert-True (
        [IO.File]::ReadAllText(
            $collisionPath,
            [Text.Encoding]::UTF8) -ceq
        'existing report') `
        'A pre-existing diff report was overwritten or removed.'
} finally {
    foreach ($path in @($collisionOutput, $collisionPath)) {
        if (-not [string]::IsNullOrEmpty($path)) {
            Assert-InsideDirectory $path $testdataRoot
            if ([IO.File]::Exists($path)) {
                [IO.File]::Delete($path)
            }
        }
    }
}

$invalidChanges = New-Object `
    'System.Collections.Generic.Dictionary[string,string]' `
    ([StringComparer]::OrdinalIgnoreCase)
$invalidChanges.Add('MissingModule', 'Option Explicit' + "`r`n")
$buildErrorCode = ''
$buildErrorData = $null
try {
    $service.BuildBook(
        $invalidChanges,
        [DateTime]::Now.ToString('yyyyMMdd_HHmmss'))
} catch [MacroStudio.HostActionException] {
    $buildErrorCode = $_.Exception.ErrorCode
    $buildErrorData = $_.Exception.ErrorData
}
Assert-True ($buildErrorCode -eq 'E-BUILD-01') `
    "Host build error mismatch: $buildErrorCode"
Assert-True ($null -ne $buildErrorData) `
    'Host build error data was not preserved.'
Assert-True ($null -ne $buildErrorData['results']) `
    'Host build error results were not preserved.'

$timestampErrorCode = ''
try {
    $service.BuildBook($identityChanges, '20260230_010203')
} catch [MacroStudio.HostActionException] {
    $timestampErrorCode = $_.Exception.ErrorCode
}
Assert-True ($timestampErrorCode -eq 'E-BUILD-01') `
    "Host build timestamp error mismatch: $timestampErrorCode"

# Audit 2026-07-30, P2-2 and P1-2.
#
# P2-2: building again after a success is a documented way through the
# flow, and the run folder is fixed when the request is written. So this
# run's own workbook, diff report and summary note are replaced as one
# generation, while a file of the same name that this run did not write
# is never touched.
#
# P1-2: the answer was written against the VBA as it stood when the
# request was prepared. If the workbook was edited and saved in the
# meantime, writing that answer would silently drop the edit, so the
# build refuses instead of producing an output.
$signatureBase = Join-Path $testdataRoot (
    'host-signature-' + [Guid]::NewGuid().ToString('N'))
Assert-InsideDirectory $signatureBase $testdataRoot
[IO.Directory]::CreateDirectory($signatureBase) | Out-Null
try {
    $signatureBook = Join-Path $signatureBase 'signature.xlsm'
    [IO.File]::Copy($resolvedBookPath, $signatureBook)

    $signatureService = New-Object MacroStudio.HostServices($null, $repoRoot)
    $signatureModules = @(
        $signatureService.AttachBook($signatureBook)['modules'])
    $signatureChanges = New-Object `
        'System.Collections.Generic.Dictionary[string,string]' `
        ([StringComparer]::OrdinalIgnoreCase)
    $signatureChanges.Add(
        $signatureModules[2]['name'],
        $signatureModules[2]['attributes'] +
            $signatureModules[2]['code'])
    $signatureStamp = [DateTime]::Now.AddSeconds(
        6).ToString('yyyyMMdd_HHmmss')
    # The names the screen produces: one date for the whole run.
    $signatureDate = $signatureStamp.Substring(0, 8)
    $signatureName = 'signature-Modified-' + $signatureDate + '.xlsm'
    $signatureDiffName =
        'signature-Diff-Report-' + $signatureDate + '.html'

    $firstBuild = $signatureService.BuildBook(
        $signatureChanges,
        $noAdditions,
        $signatureStamp,
        '<!doctype html><html><body>first</body></html>',
        $signatureName,
        "first note`r`n",
        $signatureDiffName)
    Assert-True (
        [IO.Path]::GetFileName($firstBuild['diffPath']) -ceq
        $signatureDiffName) `
        ('The report must use the name the screen gave: ' +
            [IO.Path]::GetFileName($firstBuild['diffPath']))
    $signatureOutput = $firstBuild['outputPath']
    $signatureFolder = [IO.Path]::GetDirectoryName($signatureOutput)
    Assert-InsideDirectory $signatureOutput $signatureBase
    Assert-True ([IO.File]::Exists($signatureOutput)) `
        'The first build of the attached workbook must succeed.'
    Assert-True (
        [IO.File]::ReadAllText(
            (Join-Path $signatureFolder 'result.md'),
            [Text.Encoding]::UTF8) -ceq "first note`r`n") `
        'The first summary note was not written.'

    # The same run builds again with the default output name. Before the
    # fix this failed outright, and a renamed output left the report and
    # the note behind from the earlier generation.
    $rebuild = $signatureService.BuildBook(
        $signatureChanges,
        $noAdditions,
        $signatureStamp,
        '<!doctype html><html><body>second</body></html>',
        $signatureName,
        "second note`r`n",
        $signatureDiffName)
    Assert-True ($rebuild['outputPath'] -ceq $signatureOutput) `
        'The rebuild must keep the output name of the same run.'
    Assert-True (
        [IO.Path]::GetFileName($rebuild['diffPath']) -ceq
        $signatureDiffName) `
        'The rebuild must replace the report of the same name.'
    Assert-True (
        @([IO.Directory]::GetFiles(
            $signatureFolder, '*-Diff-Report-*.html')).Count -eq 1) `
        'The rebuild left a second report beside the first.'

    Assert-True ([IO.File]::Exists($signatureOutput)) `
        'The rebuild must leave a workbook behind.'
    Assert-True (-not $rebuild.ContainsKey('diffError')) `
        'The rebuild could not replace its own diff report.'
    Assert-True (-not $rebuild.ContainsKey('resultError')) `
        'The rebuild could not replace its own summary note.'
    Assert-True (
        [IO.File]::ReadAllText(
            $rebuild['diffPath'],
            [Text.Encoding]::UTF8).Contains('second')) `
        'The diff report is still the one from the earlier build.'
    Assert-True (
        [IO.File]::ReadAllText(
            $rebuild['resultPath'],
            [Text.Encoding]::UTF8) -ceq "second note`r`n") `
        'The summary note is still the one from the earlier build.'
    Assert-True (
        @([IO.Directory]::GetFiles(
            $signatureFolder, '*.rebuild')).Count -eq 0 -and
        @([IO.Directory]::GetFiles(
            $signatureFolder, '*.previous')).Count -eq 0) `
        'The rebuild left its workpiece or the old generation behind.'

    # An unusable report name is refused, but it never cancels a workbook
    # that was built: the report is the one artifact whose failure is
    # reported beside a successful build.
    foreach ($badName in @(
        '..\escaped.html',
        'wrong_kind.txt',
        'sub/report.html')) {
        $badBuild = $signatureService.BuildBook(
            $signatureChanges,
            $noAdditions,
            $signatureStamp,
            $diffHtml,
            $signatureName,
            '',
            $badName)

        Assert-True ([IO.File]::Exists($badBuild['outputPath'])) `
            ('An unusable report name cancelled the workbook: ' +
                $badName)
        Assert-True (
            -not [string]::IsNullOrEmpty($badBuild['diffError'])) `
            ('An unusable report name was not reported: ' + $badName)
        Assert-True (-not $badBuild.ContainsKey('diffPath')) `
            ('A refused report name returned a path: ' + $badName)
        Assert-True (
            @([IO.Directory]::GetFiles(
                $signatureFolder, '*-Diff-Report-*.html')).Count -eq 1) `
            ('A refused report name disturbed the existing report: ' +
                $badName)
        Assert-True (
            [IO.File]::ReadAllText(
                (Join-Path $signatureFolder $signatureDiffName),
                [Text.Encoding]::UTF8).Contains('second')) `
            ('A refused report name overwrote the existing report: ' +
                $badName)
    }

    # A workbook of the same name that this run did not write stays put.
    $foreignService = New-Object MacroStudio.HostServices($null, $repoRoot)
    [void]$foreignService.AttachBook($signatureBook)
    $foreignPath = Join-Path $signatureFolder 'foreign.xlsm'
    [IO.File]::WriteAllText(
        $foreignPath,
        'not ours',
        (New-Object Text.UTF8Encoding($false)))
    $foreignCode = ''
    try {
        $foreignService.BuildBook(
            $signatureChanges,
            $noAdditions,
            $signatureStamp,
            $diffHtml,
            'foreign.xlsm',
            "note`r`n")
    } catch [MacroStudio.HostActionException] {
        $foreignCode = $_.Exception.ErrorCode
    }
    Assert-True ($foreignCode -eq 'E-BUILD-03') `
        "A foreign output file must not be replaced: $foreignCode"
    Assert-True (
        [IO.File]::ReadAllText(
            $foreignPath,
            [Text.Encoding]::UTF8) -ceq 'not ours') `
        'A file this run did not write was overwritten.'

    # The workbook is edited and saved after the request was prepared.
    $editedPath = Join-Path $signatureBase 'edited.xlsm'
    $editedChanges = New-Object `
        'System.Collections.Generic.Dictionary[string,string]' `
        ([StringComparer]::OrdinalIgnoreCase)
    $editedChanges.Add(
        $signatureModules[2]['name'],
        $signatureModules[2]['attributes'] +
            $signatureModules[2]['code'] +
            "' edited in Excel`r`n")
    $editedBuild = [MacroStudio.BookIO]::BuildCopy(
        $signatureBook,
        $editedPath,
        $editedChanges,
        $noAdditions)
    Assert-True $editedBuild.Success `
        ('Could not produce an edited workbook: ' + $editedBuild.Message)
    [IO.File]::Copy($editedPath, $signatureBook, $true)

    $staleCode = ''
    try {
        $signatureService.BuildBook(
            $signatureChanges,
            $noAdditions,
            $signatureStamp,
            $diffHtml,
            $signatureName,
            "stale note`r`n")
    } catch [MacroStudio.HostActionException] {
        $staleCode = $_.Exception.ErrorCode
    }
    Assert-True ($staleCode -eq 'E-BUILD-04') `
        ('A workbook edited after the request must refuse the build: ' +
            $staleCode)
    Assert-True (
        [IO.File]::ReadAllText(
            $rebuild['resultPath'],
            [Text.Encoding]::UTF8) -ceq "second note`r`n") `
        'A refused build replaced the earlier generation anyway.'
    Assert-True (
        @([IO.Directory]::GetFiles(
            $signatureFolder, '*.rebuild')).Count -eq 0 -and
        @([IO.Directory]::GetFiles(
            $signatureFolder, '*.previous')).Count -eq 0) `
        'A refused build left a workpiece or an aside copy behind.'
    Assert-True (
        [IO.File]::Exists((Join-Path $signatureFolder $signatureName))) `
        'A refused build removed the workbook the earlier build made.'

    # The signature is what the attach step read, so attaching the edited
    # workbook makes it buildable again.
    $freshService = New-Object MacroStudio.HostServices($null, $repoRoot)
    $freshModules = @(
        $freshService.AttachBook($signatureBook)['modules'])
    $freshChanges = New-Object `
        'System.Collections.Generic.Dictionary[string,string]' `
        ([StringComparer]::OrdinalIgnoreCase)
    $freshChanges.Add(
        $freshModules[2]['name'],
        $freshModules[2]['attributes'] + $freshModules[2]['code'])
    $freshBuild = $freshService.BuildBook(
        $freshChanges,
        $noAdditions,
        [DateTime]::Now.AddSeconds(8).ToString('yyyyMMdd_HHmmss'),
        $diffHtml,
        'fresh_macrostudio.xlsm',
        "fresh note`r`n")
    Assert-True ([IO.File]::Exists($freshBuild['outputPath'])) `
        'Re-attaching the edited workbook must make it buildable again.'
    Assert-True (
        $freshModules[2]['code'].Contains('edited in Excel')) `
        'The re-attached workbook must carry the edit.'
} finally {
    Assert-InsideDirectory $signatureBase $testdataRoot
    if ([IO.Directory]::Exists($signatureBase)) {
        [IO.Directory]::Delete($signatureBase, $true)
    }
}

# Opening the output folder must never open something else instead.
# Explorer, handed a target it cannot resolve, quietly shows the default
# folder (the Desktop on a normal machine) and still starts successfully,
# so a run folder that has been moved or deleted would be reported as
# opened. A missing target is an error here, and no window is started.
$revealService = New-Object MacroStudio.HostServices($null, $repoRoot)
$revealBase = Join-Path $testdataRoot (
    'host-reveal-' + [Guid]::NewGuid().ToString('N'))
Assert-InsideDirectory $revealBase $testdataRoot
try {
    $missingFolder = Join-Path $revealBase 'MacroStudio\gone_20260730_000000'
    $missingFile = Join-Path $revealBase 'gone.xlsm'

    foreach ($target in @($missingFolder, $missingFile)) {
        $revealCode = ''
        $revealMessage = ''
        try {
            $revealService.RevealPath($target)
        } catch [MacroStudio.HostActionException] {
            $revealCode = $_.Exception.ErrorCode
            if ($null -ne $_.Exception.ErrorData) {
                $revealMessage =
                    [string]$_.Exception.ErrorData['userMessage']
            }
        }
        Assert-True ($revealCode -eq 'E-SYS-02') `
            ('A target that does not exist must be refused instead of ' +
                'opening another folder: ' + $target + ' -> ' +
                $revealCode)
        Assert-True ($revealMessage.Length -gt 0) `
            'A refused reveal must carry a message for the user.'
    }

    # An empty path was already refused, and still is.
    $emptyRevealRefused = $false
    try {
        $revealService.RevealPath('')
    } catch [ArgumentException] {
        $emptyRevealRefused = $true
    }
    Assert-True $emptyRevealRefused `
        'An empty path must stay refused.'
} finally {
    Assert-InsideDirectory $revealBase $testdataRoot
    if ([IO.Directory]::Exists($revealBase)) {
        [IO.Directory]::Delete($revealBase, $true)
    }
}

$clipboardService = New-Object MacroStudio.HostServices($null, $repoRoot)
$originalClipboardData = Get-ClipboardDataForCleanup
try {
    $clipboardProbe = "MacroStudio clipboard probe`r`n2 lines`r`n"
    [void]$clipboardService.WriteClipboard($clipboardProbe)
    $clipboardReadResult = $clipboardService.ReadClipboard()
    Assert-True ($clipboardReadResult.ContainsKey('text')) `
        'A successful clipboard read must return the text field.'
    $clipboardRead = $clipboardReadResult['text']
    Assert-True ($clipboardRead -ceq $clipboardProbe) `
        'Clipboard round trip mismatch.'
    $clipboardNullCode = ''
    try {
        [void]$clipboardService.WriteClipboard([NullString]::Value)
    } catch [MacroStudio.HostActionException] {
        $clipboardNullCode = $_.Exception.ErrorCode
    }
    Assert-True ($clipboardNullCode -eq 'E-GEN-03') `
        "Clipboard null error mismatch: $clipboardNullCode"
} finally {
    # Cleanup is deliberately independent of the product retry budget. Product
    # behavior is asserted above and in test-clipboard-retry.ps1; this path must
    # preserve every clipboard format even when a background service is busy.
    Restore-ClipboardDataForCleanup $originalClipboardData
}

if ($TestExplorer) {
    $requestBookPath = Join-Path (
        Join-Path $testdataRoot 't2_6_outputs') 'identity.xlsm'
    Assert-True (Test-Path -LiteralPath $requestBookPath -PathType Leaf) `
        "Request test workbook was not found: $requestBookPath"

    $requestService = New-Object MacroStudio.HostServices($null, $repoRoot)
    [void]$requestService.AttachBook($requestBookPath)
    $requestBody = "request body`r`n"
    $codeBody = "code body`r`n"
    $runFolder = ''
    $runFolders = @()
    try {
        $stamp = [DateTime]::Now.ToString('yyyyMMdd_HHmmss')
        $written = $requestService.WriteRequestFiles(
            'diagnose',
            $stamp,
            $requestBody,
            $codeBody)
        $runFolder = $written['folderPath']
        $runFolders += $runFolder
        Assert-InsideDirectory $runFolder (
            Join-Path $testdataRoot 't2_6_outputs')
        Assert-True (
            [IO.Path]::GetFileName($runFolder) -ceq
            ([IO.Path]::GetFileNameWithoutExtension($requestBookPath) +
                '_' + $stamp)) `
            'The run folder name must be the book name plus the stamp.'
        Assert-True (
            [IO.Path]::GetFileName(
                [IO.Path]::GetDirectoryName($runFolder)) -ceq
            'MacroStudio') `
            'The run folder must sit under a MacroStudio folder.'
        Assert-True (
            [IO.Path]::GetFileName($written['requestPath']) -ceq
            'diagnose-request.md' -and
            [IO.Path]::GetFileName($written['codePath']) -ceq
            'source-code.md') `
            ('The diagnosis files must be diagnose-request.md and ' +
                'source-code.md.')

        foreach ($pair in @(
            @($written['requestPath'], $requestBody),
            @($written['codePath'], $codeBody))) {
            Assert-True ([IO.File]::Exists($pair[0])) `
                ('Request file was not created: ' + $pair[0])
            $bytes = [IO.File]::ReadAllBytes($pair[0])
            Assert-True (
                $bytes.Length -ge 3 -and
                $bytes[0] -eq 0xEF -and
                $bytes[1] -eq 0xBB -and
                $bytes[2] -eq 0xBF) `
                ('Request file has no UTF-8 BOM: ' + $pair[0])
            Assert-True (
                [IO.File]::ReadAllText(
                    $pair[0],
                    [Text.Encoding]::UTF8) -ceq $pair[1]) `
                ('Request file content mismatch: ' + $pair[0])
        }

        # Rebuilding the diagnosis request generation-replaces only the
        # request. source-code.md remains the first generation.
        $sourceBytesBefore = [IO.File]::ReadAllBytes($written['codePath'])
        $diagnoseBody2 = "diagnose request generation 2`r`n"
        $diagnose2 = $requestService.WriteRequestFiles(
            'diagnose',
            $stamp,
            $diagnoseBody2,
            "ignored replacement code`r`n")
        Assert-True (
            [IO.File]::ReadAllText(
                $diagnose2['requestPath'],
                [Text.Encoding]::UTF8) -ceq $diagnoseBody2) `
            'The diagnosis request was not generation-replaced.'
        Assert-True (
            [Convert]::ToBase64String(
                [IO.File]::ReadAllBytes($diagnose2['codePath'])) -ceq
            [Convert]::ToBase64String($sourceBytesBefore)) `
            'A diagnosis request rebuild must not rewrite source-code.md.'

        $repairBody = "repair request generation 1`r`n"
        $repair = $requestService.WriteRequestFiles(
            'repair',
            $stamp,
            $repairBody,
            [NullString]::Value)
        Assert-True (
            [IO.Path]::GetFileName($repair['requestPath']) -ceq
                'repair-request.md' -and
            -not $repair.ContainsKey('codePath')) `
            'Repair stage must write repair-request.md only.'
        Assert-True (
            [IO.File]::ReadAllText(
                $repair['requestPath'],
                [Text.Encoding]::UTF8) -ceq $repairBody) `
            'Repair request content mismatch.'
        $repairBody2 = "repair request generation 2`r`n"
        [void]$requestService.WriteRequestFiles(
            'repair',
            $stamp,
            $repairBody2,
            [NullString]::Value)
        Assert-True (
            [IO.File]::ReadAllText(
                $repair['requestPath'],
                [Text.Encoding]::UTF8) -ceq $repairBody2) `
            'The repair request was not generation-replaced.'

        $diagnosisBody = "# diagnosis generation 1`r`n"
        $diagnosis = $requestService.WriteDiagnosisFile(
            $stamp,
            $diagnosisBody)
        Assert-True (
            [IO.Path]::GetFileName($diagnosis['path']) -ceq
                'diagnosis.md' -and
            [IO.File]::ReadAllText(
                $diagnosis['path'],
                [Text.Encoding]::UTF8) -ceq $diagnosisBody) `
            'diagnosis.md content mismatch.'
        $diagnosisBody2 = "# diagnosis generation 2`r`n"
        [void]$requestService.WriteDiagnosisFile($stamp, $diagnosisBody2)
        Assert-True (
            [IO.File]::ReadAllText(
                $diagnosis['path'],
                [Text.Encoding]::UTF8) -ceq $diagnosisBody2) `
            'diagnosis.md was not generation-replaced.'
        Assert-True (
            @(Get-ChildItem -LiteralPath $runFolder -File |
                Where-Object {
                    $_.Name -like '*.tmp' -or
                    $_.Name -like '*.previous'
                }).Count -eq 0) `
            'Atomic run-file writes left a temporary generation behind.'

        # The build of the same run reuses the folder created here.
        $sameRunChanges = New-Object `
            'System.Collections.Generic.Dictionary[string,string]' `
            ([StringComparer]::OrdinalIgnoreCase)
        $sameRunModules = @($requestService.AttachBook(
            $requestBookPath)['modules'])
        $secondStamp = [DateTime]::Now.AddSeconds(1).ToString(
            'yyyyMMdd_HHmmss')
        $secondWritten = $requestService.WriteRequestFiles(
            'diagnose',
            $secondStamp,
            $requestBody,
            $codeBody)
        $runFolder = $secondWritten['folderPath']
        $runFolders += $runFolder
        $sameRunChanges.Add(
            $sameRunModules[0]['name'],
            $sameRunModules[0]['attributes'] +
                $sameRunModules[0]['code'])
        $noAdds = New-Object `
            'System.Collections.Generic.List[MacroStudio.VbaModuleAddition]'
        $sameRunBuild = $requestService.BuildBook(
            $sameRunChanges,
            $noAdds,
            $secondStamp,
            '<!doctype html><html><body>d</body></html>',
            'renamed_output.xlsm')
        Assert-True (
            [IO.Path]::GetDirectoryName(
                $sameRunBuild['outputPath']) -ceq $runFolder) `
            'The build must stay in the run folder of this request.'
        Assert-True (
            [IO.Path]::GetFileName(
                $sameRunBuild['outputPath']) -ceq
            'renamed_output.xlsm') `
            'The build must use the name given by the screen.'
        Assert-True (
            $sameRunBuild.ContainsKey('diffPath') -and
            [IO.Path]::GetDirectoryName(
                $sameRunBuild['diffPath']) -ceq $runFolder -and
            [IO.File]::Exists($sameRunBuild['diffPath'])) `
            'The diff report must join the same folder.'

        $nameErrorCode = ''
        try {
            $requestService.BuildBook(
                $sameRunChanges,
                $noAdds,
                $stamp,
                '<!doctype html><html><body>d</body></html>',
                '..\escaped.xlsm')
        } catch [MacroStudio.HostActionException] {
            $nameErrorCode = $_.Exception.ErrorCode
        }
        Assert-True ($nameErrorCode -eq 'E-BUILD-03') `
            "An unusable output name must be refused: $nameErrorCode"

        $extensionErrorCode = ''
        try {
            $requestService.BuildBook(
                $sameRunChanges,
                $noAdds,
                $stamp,
                '<!doctype html><html><body>d</body></html>',
                'wrong_kind.txt')
        } catch [MacroStudio.HostActionException] {
            $extensionErrorCode = $_.Exception.ErrorCode
        }
        Assert-True ($extensionErrorCode -eq 'E-BUILD-03') `
            "A different extension must be refused: $extensionErrorCode"
    } finally {
        foreach ($folderToRemove in @($runFolders | Select-Object -Unique)) {
            if ([string]::IsNullOrEmpty($folderToRemove)) {
                continue
            }
            Assert-InsideDirectory $folderToRemove (
                Join-Path $testdataRoot 't2_6_outputs')
            if ([IO.Directory]::Exists($folderToRemove)) {
                [IO.Directory]::Delete($folderToRemove, $true)
            }
            $macroRoot = [IO.Path]::GetDirectoryName($folderToRemove)
            if ([IO.Directory]::Exists($macroRoot) -and
                @([IO.Directory]::GetFileSystemEntries(
                    $macroRoot)).Count -eq 0) {
                [IO.Directory]::Delete($macroRoot)
            }
        }
    }
}

Write-Output 'test-hostservices: PASS'
Write-Output (
    'version={0}, modules={1}, totalLines={2}, lock=E-ATTACH-02, explorer={3}' -f `
    $appInfo['version'],
    $modules.Count,
    $book['totalLines'],
    $(if ($TestExplorer) { 'run-folder' } else { 'not-run' }))
