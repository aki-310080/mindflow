# MindFlow アプリ画面（dist/ のみ）を GitHub Pages にデプロイするスクリプト
# ※個人データやトークンは一切含まれません。

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "1. アプリをビルドしています..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "ビルドに失敗しました。" }

$RepoName = "mindflow"
$Owner = "aki-310080"

# リポジトリが存在するか確認、なければ作成 (Public)
Write-Host "2. GitHubリポジトリ ($Owner/$RepoName) を確認しています..." -ForegroundColor Cyan
$ErrorActionPreference = "Continue"
gh repo view "$Owner/$RepoName" > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "リポジトリを作成します (Public: アプリ画面のみ)..." -ForegroundColor Yellow
    gh repo create $RepoName --public --description "MindFlow - MindMeister Style Web Mindmap App"
    if ($LASTEXITCODE -ne 0) { throw "リポジトリ作成に失敗しました。" }
}
$ErrorActionPreference = "Stop"

# 一時フォルダに dist の中身だけをコピーして Push
$TempDir = Join-Path $env:TEMP "mindflow-deploy-$(Get-Random)"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
Copy-Item -Path "$ScriptDir\dist\*" -Destination $TempDir -Recurse -Force

Push-Location $TempDir
try {
    git init -b main | Out-Null
    git add . | Out-Null
    git commit -m "Deploy MindFlow web app" | Out-Null
    git remote add origin "https://github.com/$Owner/$RepoName.git"
    Write-Host "3. アプリ画面を GitHub へアップロードしています..." -ForegroundColor Cyan
    git push -f origin main
} finally {
    Pop-Location
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}

# GitHub Pages を有効化
Write-Host "4. GitHub Pages の公開設定を確認しています..." -ForegroundColor Cyan
$ErrorActionPreference = "Continue"
gh api "repos/$Owner/$RepoName/pages" > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    gh api "repos/$Owner/$RepoName/pages" -X POST -f "source[branch]=main" -f "source[path]=/" > $null
}
$ErrorActionPreference = "Stop"

Write-Host "`n完了しました！数分後に以下のURLからアクセスできます:" -ForegroundColor Green
Write-Host "https://$Owner.github.io/$RepoName/" -ForegroundColor White -BackgroundColor DarkBlue
