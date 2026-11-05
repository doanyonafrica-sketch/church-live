const {app,BrowserWindow,dialog,Menu}=require('electron');
const {createServer}=require('./server/server');
app.whenReady().then(()=>{
  const srv=createServer({dataDir:app.getPath('userData')});
  srv.on('error',e=>{dialog.showErrorBox('TPR Live','Impossible de démarrer le serveur (port 3000 déjà utilisé ?) : '+e.message);app.quit()});
  srv.listen(3000,'0.0.0.0',()=>{
    Menu.setApplicationMenu(null);
    const w=new BrowserWindow({width:1000,height:820,minWidth:720,minHeight:560,backgroundColor:'#140d12',autoHideMenuBar:true,title:'TPR Live',icon:require('path').join(__dirname,'build','icon.png')});
    w.loadURL('http://localhost:3000/control.html');
    if(app.isPackaged){
      try{
        const {autoUpdater}=require('electron-updater');
        autoUpdater.on('update-downloaded',i=>{
          dialog.showMessageBox(w,{type:'info',buttons:['Redémarrer maintenant','Plus tard'],defaultId:0,
            title:'Mise à jour',message:'La version '+i.version+' est prête.',detail:'Redémarrez TPR Live pour l\'installer. Ne le faites pas pendant un direct.'})
            .then(r=>{if(r.response===0)autoUpdater.quitAndInstall()});
        });
        autoUpdater.on('error',()=>{});
        const chk=()=>autoUpdater.checkForUpdates().catch(()=>{});chk();setInterval(chk,30*60*1000);
      }catch{}
    }
  });
});
app.on('window-all-closed',()=>app.quit());
