const {app,BrowserWindow,dialog}=require('electron');
const {createServer}=require('./server/server');
app.whenReady().then(()=>{
  const srv=createServer();
  srv.on('error',e=>{dialog.showErrorBox('Church Live','Impossible de démarrer le serveur (port 3000 déjà utilisé ?) : '+e.message);app.quit()});
  srv.listen(3000,'0.0.0.0',()=>{
    const w=new BrowserWindow({width:760,height:620,autoHideMenuBar:true,title:'Church Live'});
    w.loadURL('http://localhost:3000/control.html');
  });
});
app.on('window-all-closed',()=>app.quit());
