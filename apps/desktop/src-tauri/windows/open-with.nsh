; Roadmap 41: "Open with" for data files in the Windows (.exe) installer.
;
; The app's own files (.psproj, .pspreset, .psstyle) are registered by `bundle.fileAssociations`,
; which makes the app their default. Data files that belong to other apps (.csv, .tsv and .xlsx:
; Excel; .pzfx: the app that writes it) must not change hands: they are only added to Explorer's
; "Open with" list (OpenWithProgids), never made the default. Removed again on uninstall.

!define PS_DATA_CLASS "statPlotter.DataFile"

!macro PS_OPEN_WITH EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${PS_DATA_CLASS}" ""
!macroend

!macro PS_NO_OPEN_WITH EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${PS_DATA_CLASS}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${PS_DATA_CLASS}" "" "Data file (import into ${PRODUCTNAME})"
  WriteRegStr SHCTX "Software\Classes\${PS_DATA_CLASS}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\${PS_DATA_CLASS}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  !insertmacro PS_OPEN_WITH "csv"
  !insertmacro PS_OPEN_WITH "tsv"
  !insertmacro PS_OPEN_WITH "xlsx"
  !insertmacro PS_OPEN_WITH "pzfx"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro PS_NO_OPEN_WITH "csv"
  !insertmacro PS_NO_OPEN_WITH "tsv"
  !insertmacro PS_NO_OPEN_WITH "xlsx"
  !insertmacro PS_NO_OPEN_WITH "pzfx"
  DeleteRegKey SHCTX "Software\Classes\${PS_DATA_CLASS}"
!macroend
