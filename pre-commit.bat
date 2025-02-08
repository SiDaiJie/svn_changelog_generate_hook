setlocal enabledelayedexpansion
set HOOKS_DIR=%~dp0
set LOG_FILE=%HOOKS_DIR%\svn-hooks.log
set NODE_PATH=%HOOKS_DIR%\node_modules

:: 记录参数到日志文件（调试用）
:: https://tortoisesvn.net/docs/release/TortoiseSVN_en/tsvn-dug-settings.html#tsvn-dug-settings-hooks
:: PATH DEPTH MESSAGEFILE CWD
echo [Pre-commit hook started at %date% %time%] > "%LOG_FILE%"
echo PATH(contain hook script path): "%~1" >> "%LOG_FILE%"
echo DEPTH(commit depth): "%~2" >> "%LOG_FILE%"
echo MESSAGEFILE(contain commit message): "%~3" >> "%LOG_FILE%"
echo CWD(current working directory): "%~4" >> "%LOG_FILE%"

:: 检查参数%3（提交消息文件）是否提供
if "%~3" == "" (
    echo ERROR: Commit message file not provided. Check %LOG_FILE% for details. >&2
    echo ERROR: Commit message file "%~3" does not exist. Check %LOG_FILE% for details. >> "%LOG_FILE%"
    powershell -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::MsgBox('Commit message file not provided. Check %LOG_FILE% for details.', 'OKOnly,Exclamation', 'Error')"
    exit /b 1
)

:: 检查文件是否存在
if not exist "%~3" (
    echo ERROR: Commit message file "%~3" does not exist. Check %LOG_FILE% for details. >&2
    echo ERROR: Commit message file "%~3" does not exist. Check %LOG_FILE% for details. >> "%LOG_FILE%"
    powershell -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::MsgBox('Commit message file does not exist. Check %LOG_FILE% for details.', 'OKOnly,Exclamation', 'Error')"
    exit /b 1
)

:: 检查参数%4（仓库路径）是否提供
if "%~4" == "" (
    echo WARNING: CWD path not provided, assuming Copy Branch/Tag >> "%LOG_FILE%"
    exit /b 0
)

:: 读取提交消息内容
set "SVN_MESSAGEFILE="
for /f "usebackq delims=" %%a in ("%~3") do (
    set "SVN_MESSAGEFILE=!SVN_MESSAGEFILE!%%a"
)

:: 调试：记录读取到的提交消息
echo Commit Message: "!SVN_MESSAGEFILE!" >> "%LOG_FILE%"

:: 检查消息是否为空
if "!SVN_MESSAGEFILE!" == "" (
    echo ERROR: Commit message cannot be empty. Check %LOG_FILE% for details. >&2
    echo ERROR: Commit message cannot be empty. Check %LOG_FILE% for details. >> "%LOG_FILE%"
    powershell -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::MsgBox('Commit message cannot be empty. Check %LOG_FILE% for details.', 'OKOnly,Exclamation', 'Error')"
    exit /b 1
)

:: 记录环境配置
echo NODE_PATH: !NODE_PATH! >> "%LOG_FILE%"

echo [Starting pre-commit hook]  >> "%LOG_FILE%"
:: 调用 Node.js 脚本，传递仓库路径和消息文件路径
echo node "%HOOKS_DIR%\generate-changelog.js" "%~4" "%~3" >> "%LOG_FILE%"
node "%HOOKS_DIR%\generate-changelog.js" "%~4" "%~3" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo ERROR: Failed to generate changelog. Check %LOG_FILE% for details. >&2
    echo ERROR: Failed to generate changelog. Check %LOG_FILE% for details. >> "%LOG_FILE%" 
    powershell -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::MsgBox('Failed to generate changelog. Check %LOG_FILE% for details.', 'OKOnly,Exclamation', 'Error')"
    exit /b 1
)

:: 结束
echo Pre-commit hook completed successfully at %date% %time% >> "%LOG_FILE%"
endlocal
exit /b 0