@echo off
echo ===================================================
echo   DANG TU DONG DONG GOI VA DAY CODE LEN GITHUB...
echo ===================================================
echo.

cd /d "c:\Users\jpong\Desktop\Antigravity-20260907T115932Z-1-001\Antigravity\ung_dung_tai_chinh"

echo [1/3] Dong goi index.html...
node scripts/bundle_github_pages.js
copy /y dist\index.html index.html > nul

echo [2/3] Add & Commit index.html...
"C:\Users\jpong\AppData\Local\github-copilot-git-2.53.0-4\cmd\git.exe" add index.html
"C:\Users\jpong\AppData\Local\github-copilot-git-2.53.0-4\cmd\git.exe" commit -m "Auto update index.html to GitHub Pages"

echo [3/3] Push len GitHub Pages...
"C:\Users\jpong\AppData\Local\github-copilot-git-2.53.0-4\cmd\git.exe" push origin main

echo.
echo ===================================================
echo   HOAN TAT! Da day thanh cong len GitHub Pages!
echo ===================================================
pause
