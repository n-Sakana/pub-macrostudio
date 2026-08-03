$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
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

function Read-SharedText {
    param([string]$Path)

    if (-not [IO.File]::Exists($Path)) {
        return ''
    }

    $stream = New-Object IO.FileStream(
        $Path,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::ReadWrite)
    try {
        $reader = New-Object IO.StreamReader(
            $stream,
            [Text.Encoding]::UTF8,
            $true)
        try {
            return $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Invoke-WindowsPowerShell {
    param(
        [string]$Executable,
        [string[]]$Arguments,
        [string]$Label
    )

    $oldErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $Executable @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw (
            $Label + " failed with exit code " +
            $exitCode + ":`n" +
            ($output -join "`n"))
    }
    return $output
}

function Get-StagedPowerShell {
    param(
        [hashtable]$Baseline,
        [string]$ScriptPath
    )

    $items = @(Get-CimInstance Win32_Process -Filter `
        "Name = 'powershell.exe'" | Where-Object {
            -not $Baseline.ContainsKey([int]$_.ProcessId) -and
            -not [string]::IsNullOrEmpty($_.CommandLine) -and
            $_.CommandLine.IndexOf(
                $ScriptPath,
                [StringComparison]::OrdinalIgnoreCase) -ge 0
        } | Sort-Object -Property CreationDate)
    if ($items.Count -eq 0) {
        return $null
    }
    return $items[$items.Count - 1]
}

function Stop-StagedApplication {
    param(
        [int]$ProcessId,
        [string]$StageRoot
    )

    if ($ProcessId -le 0) {
        return
    }

    $info = Get-CimInstance Win32_Process -Filter (
        'ProcessId = ' + $ProcessId) -ErrorAction SilentlyContinue
    if ($null -eq $info) {
        return
    }
    Assert-True (
        -not [string]::IsNullOrEmpty($info.CommandLine) -and
        $info.CommandLine.IndexOf(
            $StageRoot,
            [StringComparison]::OrdinalIgnoreCase) -ge 0) `
        "Refusing to stop a process outside the P9 stage: $ProcessId"

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return
    }
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(15000)) {
        $info = Get-CimInstance Win32_Process -Filter (
            'ProcessId = ' + $ProcessId) -ErrorAction SilentlyContinue
        Assert-True (
            $null -ne $info -and
            $info.CommandLine.IndexOf(
                $StageRoot,
                [StringComparison]::OrdinalIgnoreCase) -ge 0) `
            "P9 process identity changed before cleanup: $ProcessId"
        Stop-Process -Id $ProcessId -Force
        [void]$process.WaitForExit(5000)
    }
}

$repoRoot = (Resolve-Path (
    Join-Path $PSScriptRoot '..')).Path
$testdataRoot = (Resolve-Path (
    Join-Path $PSScriptRoot '..\testdata')).Path
$stageContainer = Join-Path $testdataRoot (
    'p9-smoke-' + [Guid]::NewGuid().ToString('N'))
$stageRoot = Join-Path $stageContainer 'distribution'
$smokeBook = Join-Path $testdataRoot 'test_large.xlsm'
$stagedScript = Join-Path $stageRoot 'macrostudio.ps1'
$launchPath = Join-Path $stageRoot 'launch.vbs'
$repairFolderName = '02_' + [char]0x6539 + [char]0x4FEE
$stagedRepairPresetRoot = Join-Path (
    Join-Path $stageRoot 'presets') $repairFolderName
$stagedProcessId = 0
$launcher = $null

Assert-InsideDirectory $stageContainer $testdataRoot
Assert-True (
    -not [IO.Directory]::Exists($stageContainer)) `
    "P9 stage already exists: $stageContainer"

try {
    [IO.Directory]::CreateDirectory($stageRoot) | Out-Null

    # exports / temp are one run's output, never part of what is
    # distributed, and a working tree that has been used carries them.
    # They also cannot always be copied: a run that exercised the
    # reserved-name refusal leaves a file called CON.xlsm behind, and
    # Windows will not let anything copy that name.
    $excludedNames = @{
        '.git' = $true
        'testdata' = $true
        'public-release' = $true
        'docs' = $true
        'tests' = $true
        '_audit' = $true
        '.playwright-mcp' = $true
        'exports' = $true
        'temp' = $true
        'qa' = $true
        'audit-results' = $true
    }
    foreach ($item in Get-ChildItem -LiteralPath $repoRoot -Force) {
        if ($excludedNames.ContainsKey($item.Name)) {
            continue
        }
        Copy-Item -LiteralPath $item.FullName `
            -Destination $stageRoot -Recurse -Force
    }
    Assert-True (
        -not [string]::Equals(
            $stageRoot,
            $repoRoot,
            [StringComparison]::OrdinalIgnoreCase)) `
        'The P9 product was not copied to an alternate base path.'
    foreach ($requiredPath in @(
        $launchPath,
        $stagedScript,
        (Join-Path $stageRoot 'assets\index.html'),
        (Join-Path $stageRoot 'src\01_App.cs'),
        (Join-Path $stageRoot 'templates\diagnose-template.txt'),
        (Join-Path $stageRoot 'templates\repair-template.txt'),
        (Join-Path $stageRoot 'environment\target-environment.json'),
        (Join-Path $stageRoot `
            'lib\Microsoft.Web.WebView2.Wpf.dll'))) {
        Assert-True ([IO.File]::Exists($requiredPath)) `
            "Staged distribution file is missing: $requiredPath"
    }
    foreach ($excludedName in $excludedNames.Keys) {
        Assert-True (
            -not [IO.Directory]::Exists((Join-Path $stageRoot $excludedName)) -and
            -not [IO.File]::Exists((Join-Path $stageRoot $excludedName))) `
            "Excluded development content entered the stage: $excludedName"
    }

    $runtimeTextFiles = @(
        Get-ChildItem -LiteralPath (
            Join-Path $stageRoot 'src') -Filter '*.cs' -File
        Get-ChildItem -LiteralPath (
            Join-Path $stageRoot 'assets') -Recurse -File
        Get-ChildItem -LiteralPath (
            Join-Path $stageRoot 'templates') -Recurse -File
        Get-ChildItem -LiteralPath (
            Join-Path $stageRoot 'environment') -Recurse -File
        Get-Item -LiteralPath $launchPath
        Get-Item -LiteralPath $stagedScript
        Get-Item -LiteralPath (Join-Path $stageRoot 'launch.bat')
    )
    foreach ($file in $runtimeTextFiles) {
        $text = [IO.File]::ReadAllText(
            $file.FullName,
            [Text.Encoding]::UTF8)
        Assert-True (
            $text.IndexOf(
                $repoRoot,
                [StringComparison]::OrdinalIgnoreCase) -lt 0) `
            "Original repository path is baked into: $($file.FullName)"
    }

    $readme = [IO.File]::ReadAllText(
        (Join-Path $stageRoot 'README.md'),
        [Text.Encoding]::UTF8)
    foreach ($requiredText in @(
        'launch.vbs',
        'WebView2',
        '%LOCALAPPDATA%\MacroStudio\logs\',
        'templates\diagnose-template.txt',
        'templates\repair-template.txt',
        'environment\target-environment.json',
        '.xlsm',
        '.xlam',
        '.xlsb')) {
        Assert-True (
            $readme.IndexOf(
                $requiredText,
                [StringComparison]::OrdinalIgnoreCase) -ge 0) `
            "README runtime guidance is missing: $requiredText"
    }

    $windowsPowerShell = (Get-Command powershell.exe).Source
    $presetProbePath = Join-Path $PSScriptRoot `
        'test-p9-preset.ps1'
    $probeArguments = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $presetProbePath,
        '-ProductRoot',
        $stageRoot,
        '-BookPath',
        $smokeBook
    )
    $initialProbeOutput = Invoke-WindowsPowerShell `
        -Executable $windowsPowerShell `
        -Arguments $probeArguments `
        -Label 'Initial staged preset probe'
    $initialJson = @($initialProbeOutput | Where-Object {
        ([string]$_).TrimStart().StartsWith('{')
    } | Select-Object -Last 1)
    Assert-True ($initialJson.Count -eq 1) `
        'Initial staged preset probe returned no JSON.'
    $initialPresets = [string]$initialJson[0] | ConvertFrom-Json
    $diskPresetCount = @(
        Get-ChildItem -LiteralPath (Join-Path $stageRoot 'presets') `
            -Filter '*.md' -File -Recurse
    ).Count
    Assert-True (
        ($initialPresets.stateCount + $initialPresets.diagnoseCount) -eq
            $diskPresetCount) `
        'Initial preset count does not match staged files.'

    $launchText = [IO.File]::ReadAllText(
        $launchPath,
        [Text.Encoding]::ASCII)
    Assert-True (
        $launchText -match
        '(?i)shell\.Run\(\s*command\s*,\s*0\s*,\s*True\s*\)') `
        'launch.vbs does not wait for a hidden launcher window.'

    # wscript.exe reads a .vbs as the system ANSI code page unless it starts
    # with a UTF-16 byte order mark, so a single non-ASCII byte saved as UTF-8
    # makes the launcher fail to compile before it can report anything.
    $launchNonAscii = @(
        [IO.File]::ReadAllBytes($launchPath) |
        Where-Object { $_ -gt 127 }
    ).Count
    Assert-True ($launchNonAscii -eq 0) `
        'launch.vbs contains non-ASCII bytes; wscript.exe cannot compile it.'

    $baseline = @{}
    foreach ($item in Get-CimInstance Win32_Process) {
        $baseline[[int]$item.ProcessId] = $true
    }

    $logPath = Join-Path (
        [Environment]::GetFolderPath(
            [Environment+SpecialFolder]::LocalApplicationData)) (
        'MacroStudio\logs\macrostudio_' +
        [DateTime]::Now.ToString('yyyyMMdd') +
        '.log')
    $logBefore = Read-SharedText $logPath

    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $env:SystemRoot `
        'System32\wscript.exe'
    $startInfo.Arguments = '"' + $launchPath + '"'
    $startInfo.WorkingDirectory = $testdataRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $launcher = [Diagnostics.Process]::Start($startInfo)
    Assert-True ($null -ne $launcher) `
        'wscript.exe did not start launch.vbs.'

    $stagedProcessInfo = $null
    $stagedProcess = $null
    $launchDeadline = [DateTime]::UtcNow.AddSeconds(75)
    while ([DateTime]::UtcNow -lt $launchDeadline) {
        $stagedProcessInfo = Get-StagedPowerShell `
            -Baseline $baseline `
            -ScriptPath $stagedScript
        if ($null -ne $stagedProcessInfo) {
            $stagedProcessId = [int]$stagedProcessInfo.ProcessId
            $stagedProcess = Get-Process -Id $stagedProcessId `
                -ErrorAction SilentlyContinue
            if (
                $null -ne $stagedProcess -and
                $stagedProcess.MainWindowHandle -ne [IntPtr]::Zero -and
                $stagedProcess.MainWindowTitle -like 'MacroStudio*') {
                break
            }
        }
        Start-Sleep -Milliseconds 100
    }
    Assert-True (
        $null -ne $stagedProcess -and
        $stagedProcess.MainWindowHandle -ne [IntPtr]::Zero -and
        $stagedProcess.MainWindowTitle -like 'MacroStudio*') `
        'Staged launch.vbs did not open the MacroStudio window.'

    $visibleConsoleWindows = @(
        Get-Process -ErrorAction SilentlyContinue |
        Where-Object {
            -not $baseline.ContainsKey([int]$_.Id) -and
            @(
                'cmd',
                'conhost',
                'powershell',
                'pwsh',
                'WindowsTerminal'
            ) -contains $_.ProcessName -and
            $_.MainWindowHandle -ne [IntPtr]::Zero -and
            -not ($_.MainWindowTitle -like 'MacroStudio*')
        }
    )
    Assert-True ($visibleConsoleWindows.Count -eq 0) `
        'A visible console window appeared during launch.vbs startup.'

    $startupLogText = ''
    $startupLogDeadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $startupLogDeadline) {
        $startupLogText = Read-SharedText $logPath
        if (
            $startupLogText.IndexOf(
                'startup: ' + $stageRoot,
                [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            break
        }
        Start-Sleep -Milliseconds 100
    }
    Assert-True (
        $startupLogText.IndexOf(
            'startup: ' + $stageRoot,
            [StringComparison]::OrdinalIgnoreCase) -ge 0) `
        'Staged startup did not finish after the window appeared.'

    Stop-StagedApplication `
        -ProcessId $stagedProcessId `
        -StageRoot $stageRoot
    $stagedProcessId = 0

    $logAfter = ''
    $logDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $logDeadline) {
        $logAfter = Read-SharedText $logPath
        if (
            $logAfter.IndexOf(
                'startup: ' + $stageRoot,
                [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $logAfter.IndexOf(
                'shutdown: ' + $stageRoot,
                [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            break
        }
        Start-Sleep -Milliseconds 100
    }
    Assert-True ($logAfter.StartsWith($logBefore)) `
        'The daily log prefix changed during the P9 launch.'
    $newLogText = $logAfter.Substring($logBefore.Length)
    Assert-True (
        $newLogText.IndexOf(
            'startup: ' + $stageRoot,
            [StringComparison]::OrdinalIgnoreCase) -ge 0) `
        'Staged startup was not written to the operational log.'
    Assert-True (
        $newLogText.IndexOf(
            'shutdown: ' + $stageRoot,
            [StringComparison]::OrdinalIgnoreCase) -ge 0) `
        'Staged shutdown was not written to the operational log.'
    Assert-True (
        $newLogText -notmatch
        'Option Explicit|Attribute VB_|Debug\.Print') `
        'P9 operational log contains VBA code text.'

    $flowOutput = Invoke-WindowsPowerShell `
        -Executable $windowsPowerShell `
        -Arguments @(
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            (Join-Path $PSScriptRoot 'test-flow-webview.ps1'),
            '-ProductRoot',
            $stageRoot,
            '-BookPath',
            $smokeBook
        ) `
        -Label 'Staged flow WebView smoke'
    Assert-True (
        ($flowOutput -join "`n") -match
        'test-flow-webview: PASS') `
        'Staged flow WebView smoke did not report PASS.'

    $addedPresetName = 'p9-added.md'
    $addedPresetPath = Join-Path $stagedRepairPresetRoot $addedPresetName
    $addedPresetTitle = 'P9 Added Preset'
    # The section headings are part of the preset contract, so they are
    # written by code point to keep this script ASCII.
    $instructionHeading = '## ' + [string]::Join(
        '',
        [char[]](0x6539, 0x4FEE, 0x6307, 0x793A))
    $outputHeading = '## ' + [string]::Join(
        '',
        [char[]](0x51FA, 0x529B, 0x6307, 0x793A))
    $brokenPresetName = 'p9-broken.md'
    $brokenPresetPath = Join-Path $stagedRepairPresetRoot $brokenPresetName
    Assert-True (-not [IO.File]::Exists($addedPresetPath)) `
        "Temporary P9 preset already exists: $addedPresetPath"
    Assert-True (-not [IO.File]::Exists($brokenPresetPath)) `
        "Temporary P9 preset already exists: $brokenPresetPath"
    [IO.File]::WriteAllText(
        $addedPresetPath,
        ("# $addedPresetTitle`r`n`r`n" +
            "<!-- editor note, never sent to the chat -->`r`n`r`n" +
            "$instructionHeading`r`n`r`n" +
            "P9 preset restart smoke.`r`n`r`n" +
            "$outputHeading`r`n`r`n" +
            "Answer in chat code blocks.`r`n"),
        (New-Object Text.UTF8Encoding($false)))
    # A file with no H1 and no sections must stay unusable instead of
    # falling back to the old plain-body behaviour.
    [IO.File]::WriteAllText(
        $brokenPresetPath,
        "P9 preset without any heading.`r`n",
        (New-Object Text.UTF8Encoding($false)))

    $restartedProbeOutput = Invoke-WindowsPowerShell `
        -Executable $windowsPowerShell `
        -Arguments $probeArguments `
        -Label 'Restarted staged preset probe'
    $restartedJson = @($restartedProbeOutput | Where-Object {
        ([string]$_).TrimStart().StartsWith('{')
    } | Select-Object -Last 1)
    Assert-True ($restartedJson.Count -eq 1) `
        'Restarted staged preset probe returned no JSON.'
    $restartedPresets = [string]$restartedJson[0] |
        ConvertFrom-Json
    Assert-True (
        $restartedPresets.count -eq
        ($initialPresets.count + 1)) `
        'Preset count did not increase after restart.'
    Assert-True (
        @($restartedPresets.files) -contains
        (Join-Path $repairFolderName $addedPresetName)) `
        'The added preset is missing after restart.'
    Assert-True (
        @($restartedPresets.labels) -contains $addedPresetTitle) `
        'The added preset does not show its H1 name.'
    Assert-True (
        @($restartedPresets.invalidFiles) -contains
        (Join-Path $repairFolderName $brokenPresetName)) `
        'The unusable preset is not listed with its reason.'
    Assert-True (
        -not (@($restartedPresets.names) -contains
        'P9 preset without any heading.')) `
        'An unusable preset must not become selectable.'

    Write-Output 'test-p9-distribution: PASS'
    Write-Output (
        'alternate-base=PASS, launch.vbs=no-console, ' +
        'lifecycle-log=PASS')
    Write-Output (
        'staged flow/build/self-loop=PASS, presets=' +
        $initialPresets.count + '->' +
        $restartedPresets.count)
} finally {
    if ($stagedProcessId -gt 0) {
        Stop-StagedApplication `
            -ProcessId $stagedProcessId `
            -StageRoot $stageRoot
    }
    if ($null -ne $launcher) {
        $launcher.Dispose()
    }

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    [GC]::Collect()

    for ($attempt = 0; $attempt -lt 300; $attempt++) {
        if (-not [IO.Directory]::Exists($stageContainer)) {
            break
        }
        try {
            Assert-InsideDirectory $stageContainer $testdataRoot
            [IO.Directory]::Delete($stageContainer, $true)
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    Assert-True (
        -not [IO.Directory]::Exists($stageContainer)) `
        "P9 stage was not removed: $stageContainer"
}
