!macro customInit
  ; Older OpenCord clients launched update installers with --updated but without /S.
  ; Make updater-driven installs silent while keeping manually opened Setup files interactive.
  ${if} ${isUpdated}
    SetSilent silent
  ${endif}
!macroend
