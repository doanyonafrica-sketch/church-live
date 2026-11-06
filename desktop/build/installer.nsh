; Ferme TPR Live et son ffmpeg avant l'installation : plus de message "fermez l'application"
!macro customInit
  nsExec::Exec 'taskkill /F /IM "TPR Live.exe" /T'
  nsExec::Exec 'taskkill /F /IM ffmpeg.exe /T'
  Sleep 800
!macroend
