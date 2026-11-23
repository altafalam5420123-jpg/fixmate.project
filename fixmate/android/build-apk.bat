@echo off
setlocal

echo Setting up Android Build Environment...

if exist "C:\Program Files\Android\Android Studio\jbr" (
    set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
    set "PATH=C:\Program Files\Android\Android Studio\jbr\bin;%PATH%"
)

echo Using JAVA_HOME: %JAVA_HOME%
echo Building FixMate Debug APK...

call "%~dp0gradlew.bat" assembleDebug

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo SUCCESS: APK successfully built!
    echo Location: %~dp0app\build\outputs\apk\debug\app-debug.apk
    echo ========================================================
    echo.
) else (
    echo.
    echo ========================================================
    echo Build failed. Please check the error message above.
    echo ========================================================
    echo.
)
pause

