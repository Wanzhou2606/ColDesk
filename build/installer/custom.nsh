!macro customHeader
  SetFont "Microsoft YaHei UI" 9
  BrandingText "ColDesk · 把时间留给重要的事"
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONINFORMATION "ColDesk 需要 Windows 10 或 Windows 11（64 位）。"
    Abort
  ${EndIf}
!macroend

  !define /redef MUI_BGCOLOR "FAFCFF"
  !define /redef MUI_TEXTCOLOR "26354C"
  !define /redef MUI_INSTFILESPAGE_COLORS "4F77BD F6F9FF"
  !define /redef MUI_WELCOMEPAGE_TITLE "把日常，慢慢安放"
  !define /redef MUI_WELCOMEPAGE_TITLE_3LINES
  !define /redef MUI_WELCOMEPAGE_TEXT "欢迎安装 ColDesk。$\r$\n$\r$\n把重要的事安排进日程，把心事写成日记，把小小的坚持留在打卡里。$\r$\n$\r$\n桌面浮窗，让日常轻一点。$\r$\n$\r$\n点击「下一步」，为这份日常选择一个位置。"
  !define /redef MUI_FINISHPAGE_TITLE "你的日常田园，准备好了"
  !define /redef MUI_FINISHPAGE_TITLE_3LINES
  !define /redef MUI_FINISHPAGE_TEXT "ColDesk 已安装完成。$\r$\n$\r$\n首次打开会带你认识日程、home 日记与其他功能。$\r$\n$\r$\n想再看教程？$\r$\n设置 → 使用帮助 → 重新查看引导。"
  !define /redef MUI_UNWELCOMEPAGE_TITLE "暂别 ColDesk"
  !define /redef MUI_UNWELCOMEPAGE_TEXT "此向导将移除 ColDesk 应用。$\r$\n$\r$\n你的任务、日记和其他个人记录会保留在本机，重新安装后仍可继续使用。"
