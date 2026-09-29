param(
    [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$packageName = "ARVION-BMT-Dashboard-$($manifest.version)"
$dist = Join-Path $root $OutputDirectory
$stage = Join-Path $dist $packageName
$zip = Join-Path $dist "$packageName.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage "assets/brand"), (Join-Path $stage "src/background"), (Join-Path $stage "src/dashboard"), (Join-Path $stage "src/devtools"), (Join-Path $stage "src/popup") | Out-Null

$required = @(
    "manifest.json", "rules.json", "icon.png", "view.html",
    "assets/brand/arvion-system-roundel.png",
    "src/background/background.js", "src/dashboard/chart.js", "src/dashboard/style.css", "src/dashboard/view.js",
    "src/devtools/devtools.html", "src/devtools/devtools.js",
    "src/popup/popup.html", "src/popup/popup.js", "src/popup/style.css"
)

foreach ($relative in $required) {
    $source = Join-Path $root $relative
    if (-not (Test-Path $source -PathType Leaf)) { throw "Required extension file is missing: $relative" }
    Copy-Item $source (Join-Path $stage $relative)
}

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
Write-Output "Created: $zip"
Write-Output "Load unpacked folder: $stage"
