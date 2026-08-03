param(
    [string]$ProductRoot
)

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

if ([string]::IsNullOrEmpty($ProductRoot)) {
    $ProductRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$repoRoot = (Resolve-Path -LiteralPath $ProductRoot).Path
$testdataRoot = (Resolve-Path (
    Join-Path $PSScriptRoot '..\testdata')).Path
$libDir = Join-Path $repoRoot 'lib'
$runId = [Guid]::NewGuid().ToString('N')
$cacheDir = Join-Path $testdataRoot ('security-cache-' + $runId)
$probeDir = Join-Path $testdataRoot ('security-probe-' + $runId)
Assert-InsideDirectory $cacheDir $testdataRoot
Assert-InsideDirectory $probeDir $testdataRoot

# The app writes its log next to its other user data, so that is where the
# record of a refusal has to be read from.
$logPath = Join-Path (
    Join-Path $env:LOCALAPPDATA 'MacroStudio\logs') (
    'macrostudio_' + (Get-Date -Format 'yyyyMMdd') + '.log')

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Xaml
Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$env:Path = $libDir + [IO.Path]::PathSeparator + $env:Path
$corePath = Join-Path $libDir 'Microsoft.Web.WebView2.Core.dll'
$wpfPath = Join-Path $libDir 'Microsoft.Web.WebView2.Wpf.dll'
[Reflection.Assembly]::LoadFrom($corePath) | Out-Null
[Reflection.Assembly]::LoadFrom($wpfPath) | Out-Null

$sourceFiles = Get-ChildItem -LiteralPath (
    Join-Path $repoRoot 'src') -Filter '*.cs' |
    Sort-Object -Property Name
$smokeSource = Join-Path $PSScriptRoot 'WebViewSecuritySmoke.cs'
$combined = (@($sourceFiles.FullName) + @($smokeSource) |
    ForEach-Object {
        [IO.File]::ReadAllText($_, [Text.Encoding]::UTF8)
    }) -join "`n"

$usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
$usings = [regex]::Matches($combined, $usingPattern) |
    ForEach-Object { $_.Value.Trim() } |
    Sort-Object -Unique
$body = $combined -replace $usingPattern, ''
$source = ($usings -join "`n") + "`n`n" + $body

$references = @(
    [System.Windows.Window].Assembly.Location
    [System.Windows.UIElement].Assembly.Location
    [System.Windows.DependencyObject].Assembly.Location
    [System.Xaml.XamlReader].Assembly.Location
    'Microsoft.CSharp'
    'System.Drawing'
    'System.Web.Extensions'
    'System.IO.Compression'
    'System.IO.Compression.FileSystem'
    $corePath
    $wpfPath
)

Add-Type -TypeDefinition $source `
    -ReferencedAssemblies $references `
    -Language CSharp

# ---- the trust rule, case by case ----
#
# The one thing every other refusal rests on. A prefix test would pass the
# look-alike hosts below, which anybody can register or stand up.

$trusted = @(
    'https://macrostudio.local/index.html',
    'https://macrostudio.local/',
    'https://macrostudio.local/js/app.js',
    'https://macrostudio.local/index.html#step3',
    'https://MacroStudio.Local/index.html',
    'https://macrostudio.local:443/index.html'
)
$untrusted = @(
    '',
    ' ',
    'macrostudio.local/index.html',
    '/index.html',
    'http://macrostudio.local/index.html',
    'https://macrostudio.local.example.com/index.html',
    'https://macrostudio.localhost/index.html',
    'https://evil-macrostudio.local/index.html',
    'https://macrostudio.local:8443/index.html',
    'https://user:secret@macrostudio.local/index.html',
    'https://macrostudio.local./index.html',
    'https://example.com/index.html',
    'file:///C:/temp/index.html',
    'data:text/html,<h1>x</h1>',
    'about:blank',
    'javascript:void(0)',
    'ws://macrostudio.local/socket',
    'https://untrusted.local/probe.html'
)

foreach ($value in $trusted) {
    Assert-True ([MacroStudio.WebViewSecurity]::IsTrustedSource($value)) `
        ("The product page must be trusted: " + $value)
}
foreach ($value in $untrusted) {
    Assert-True (
        -not [MacroStudio.WebViewSecurity]::IsTrustedSource($value)) `
        ("This source must not be trusted: " + $value)
}
Assert-True (
    -not [MacroStudio.WebViewSecurity]::IsTrustedSource($null)) `
    'A missing source must not be trusted.'
Assert-True (
    [MacroStudio.WebViewSecurity]::TrustedOrigin -ceq
    'https://macrostudio.local') `
    'The trusted origin changed.'

# ---- the boundary in a running window ----

try {
    try {
        $rawResult = [MacroStudio.Tests.WebViewSecuritySmoke]::Run(
            $repoRoot,
            $cacheDir,
            $probeDir,
            $logPath)
    } catch {
        throw $_.Exception.ToString()
    }

    $result = $rawResult | ConvertFrom-Json
    $startPage = [string]$result.startPage
    $settings = @($result.settings)
    $refusals = @($result.refusals)
    $startup = @($result.startupNavigations)
    $blocked = @($result.blockedNavigations)
    $trustedRequest = $result.trustedRequestWorks | ConvertFrom-Json
    $newWindow = $result.newWindow
    $frame = $result.frame
    $untrustedMessage = $result.untrustedMessage
    $log = $result.log

    # 5. The product itself is not regressed: the page loads from the
    # trusted origin and its host requests are still answered.
    Assert-True ($startPage -ceq 'https://macrostudio.local/index.html') `
        ("The app did not load from the trusted origin: " + $startPage)
    # What matters here is that the host answered at all, so the count is
    # read off the files rather than written down. Shipping one more
    # template is not a security regression.
    $shippedPresetCount = @(
        Get-ChildItem -LiteralPath (Join-Path $repoRoot 'presets') `
            -Filter '*.md' -File -Recurse
    ).Count
    Assert-True ($shippedPresetCount -gt 0) `
        'No shipped presets were found to compare against.'
    Assert-True ($trustedRequest.presets -eq $shippedPresetCount) `
        ("A trusted host request stopped working: presets=" +
            $trustedRequest.presets + " on disk=" + $shippedPresetCount)
    Assert-True (
        -not [string]::IsNullOrEmpty([string]$trustedRequest.version)) `
        'A trusted host request returned no app version.'

    # 4. DevTools and the browser keys are off in the product UI.
    foreach ($expected in @(
        'devTools=False',
        'acceleratorKeys=False',
        'contextMenus=False',
        'hostObjects=False',
        'webMessage=True')) {
        Assert-True ($settings -contains $expected) `
            ("Setting mismatch, expected " + $expected + " in: " +
                ($settings -join ', '))
    }

    # 2. Top-level navigation is limited to the app itself. Each attempt
    # is followed by reading where the window actually is.
    Assert-True (@($blocked).Count -ge 9) `
        ("Too few navigation attempts were exercised: " +
            @($blocked).Count)
    foreach ($outcome in $blocked) {
        Assert-True (
            ([string]$outcome).EndsWith(
                '-> https://macrostudio.local/index.html')) `
            ("A refused navigation moved the window: " + $outcome)
    }
    foreach ($needle in @(
        'https://example.com/',
        'http://macrostudio.local/index.html',
        'https://macrostudio.local.example.com/index.html',
        'https://macrostudio.local:8443/index.html',
        'about:blank',
        'https://untrusted.local/probe.html',
        'data:text/html',
        'file:///')) {
        Assert-True (
            @($refusals | Where-Object {
                $_ -like ('navigation refused: ' + $needle + '*') }
            ).Count -ge 1) `
            ("No navigation refusal was recorded for " + $needle + ': ' +
                ($refusals -join ' | '))
    }

    # The startup allowance is measured, not assumed: whatever the runtime
    # asked for before the app page is listed here, and about:blank is
    # only ever tolerated then - it is refused above, after startup.
    Assert-True (
        @($startup | Where-Object {
            $_ -like 'https://macrostudio.local/index.html*' }).Count -ge 1) `
        ("The app page never started loading: " + ($startup -join ' | '))

    # 3. No second window, and no frame from anywhere else.
    Assert-True (
        [int]$newWindow.windowsAfter -eq [int]$newWindow.windowsBefore) `
        ("A new window was opened: " + $newWindow.windowsBefore + ' -> ' +
            $newWindow.windowsAfter)
    Assert-True (
        ([string]$newWindow.source) -ceq
        'https://macrostudio.local/index.html') `
        'Opening a window moved the app.'
    Assert-True (
        @($refusals | Where-Object { $_ -like 'new window refused:*' }
        ).Count -ge 1) `
        'A new window request was not recorded as refused.'
    # window.open hands back a live handle only when a window was made.
    Assert-True (([string]$newWindow.openedClosed) -ceq 'true') `
        ("window.open produced a live window: handle=" +
            $newWindow.openedHandle)

    # The frame target is served by this test, so it would load if it
    # were allowed to. Its completion therefore has to say it did not.
    Assert-True (@($frame.completions).Count -ge 1) `
        'The frame never attempted to navigate, so nothing was proven.'
    foreach ($completion in @($frame.completions)) {
        Assert-True (([string]$completion).StartsWith('False:')) `
            ("A frame from another origin loaded: " + $completion)
    }
    Assert-True (
        ([string]$frame.frameUrl).IndexOf('untrusted.local') -lt 0) `
        ("A frame loaded from another origin: " + $frame.frameUrl)
    Assert-True (
        @($refusals | Where-Object {
            $_ -like 'frame navigation refused:*' }).Count -ge 1) `
        'A frame navigation was not recorded as refused.'

    # 1. A document from another origin reaches the same bridge and gets
    # nowhere: every accepted request is answered, so zero replies means
    # the message was dropped before any host action.
    Assert-True (
        ([string]$untrustedMessage.origin) -ceq
        'https://untrusted.local/probe.html') `
        ("The untrusted page did not load: " + $untrustedMessage.origin)
    Assert-True (([string]$untrustedMessage.bridgeReachable) -ceq 'true') `
        'The probe never reached the bridge, so nothing was proven.'
    Assert-True (([string]$untrustedMessage.replies) -ceq '0') `
        ("The host answered an untrusted page: " +
            $untrustedMessage.repliesText)
    Assert-True ([bool]$log.refusalLogged) `
        'The refusal was not written to the log.'
    Assert-True (-not [bool]$log.sentinelWritten) `
        'An untrusted page got a host action executed.'

    Write-Output 'test-webview-security: PASS'
    Write-Output ('trusted origin: ' +
        [MacroStudio.WebViewSecurity]::TrustedOrigin)
    Write-Output ('startup navigations: ' + ($startup -join ' | '))
    Write-Output ('refusals: ' + @($refusals).Count)
    foreach ($entry in $refusals) {
        Write-Output ('  ' + $entry)
    }
} finally {
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    [GC]::Collect()
    foreach ($path in @($cacheDir, $probeDir)) {
        if (Test-Path -LiteralPath $path) {
            Assert-InsideDirectory $path $testdataRoot
            Remove-Item -LiteralPath $path -Recurse -Force `
                -ErrorAction SilentlyContinue
        }
    }
}
