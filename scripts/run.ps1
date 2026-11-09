param([ValidateSet('install','dev','build','start','test','test:desktop','pack:win','pack:dir')][string]$Task='dev')
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$selectedNode=$null
foreach($candidate in (Get-Command node -All -ErrorAction SilentlyContinue)) {
    $version=& $candidate.Source --version
    if($version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) { $selectedNode=$candidate.Source; break }
}
if(-not $selectedNode) { throw 'Reading Desk requires Node.js 24 or newer. Install Node.js 24 LTS, reopen your terminal, then try again.' }
$npmCommand=Get-Command npm.cmd -ErrorAction Stop
$npmCli=Join-Path (Split-Path -Parent $npmCommand.Source) 'node_modules\npm\bin\npm-cli.js'
if(-not (Test-Path -LiteralPath $npmCli)) { throw 'npm CLI was not found. Install Node.js with npm.' }
$previousPath=$env:PATH
$env:PATH=(Split-Path -Parent $selectedNode)+';'+$env:PATH
Push-Location -LiteralPath $projectPath
try {
    Write-Host "Node: $selectedNode"
    if($Task -eq 'install') { & $selectedNode $npmCli ci } else { & $selectedNode $npmCli run $Task }
    $taskExit=$LASTEXITCODE
} finally { Pop-Location; $env:PATH=$previousPath }
exit $taskExit
