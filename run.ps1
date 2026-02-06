# Run Interview app - add Node to PATH so Electron can find node.exe
$nodeDir = "C:\Program Files\nodejs"
$npm = Join-Path $nodeDir "npm.cmd"

if (-not (Test-Path $npm)) {
    Write-Host "Node.js not found at $nodeDir. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# So Electron (and npm) can find "node"
$env:Path = "$nodeDir;$env:Path"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    & $npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Starting Interview app..." -ForegroundColor Green
& $npm start
