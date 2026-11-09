const {app,BrowserWindow,dialog,Menu,powerSaveBlocker,safeStorage}=require('electron');
const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
const {createServer,loadPin}=require('./server/server');
let srv,win=null,forceQuit=false;
const PORT=+process.env.TPR_PORT||3000;   /* la règle du pare-feu et les adresses affichées supposent 3000 : ne changer que pour les tests */
const stopServer=()=>{try{srv&&srv.shutdown&&srv.shutdown()}catch{}};
const liveCount=()=>{try{return srv&&srv.liveCount?srv.liveCount():0}catch{return 0}};

/* Journal : un fichier texte (dossier de données de TPR Live, « tpr-live.log ») pour comprendre après coup ce qui s'est passé.
   Une erreur inattendue est notée mais ne coupe plus le direct. */
const logFile=()=>path.join(app.getPath('userData'),'tpr-live.log');
const log=m=>{try{const f=logFile();try{if(fs.statSync(f).size>1e6)fs.renameSync(f,f+'.old')}catch{}fs.appendFileSync(f,new Date().toISOString()+' '+m+'\n')}catch{}};
process.on('uncaughtException',e=>log('Erreur inattendue : '+(e&&e.stack||e)));
process.on('unhandledRejection',e=>log('Promesse rejetée : '+(e&&e.stack||e)));
process.on('exit',stopServer);

/* Chiffrement des mots de passe des caméras IP (lié à la session Windows de l'utilisateur) */
const makeCipher=()=>{try{if(safeStorage&&safeStorage.isEncryptionAvailable())return{enc:t=>safeStorage.encryptString(t).toString('base64'),dec:b=>safeStorage.decryptString(Buffer.from(b,'base64'))}}catch(e){log('Chiffrement indisponible : '+e.message)}return null};

/* Autorise les téléphones à joindre le PC (pare-feu Windows). Demandé une seule fois ; Windows réclame l'accord de l'administrateur. */
function firewall(){
  if(process.platform!=='win32'||!app.isPackaged)return;
  const flag=path.join(app.getPath('userData'),'firewall-asked');
  if(fs.existsSync(flag))return;
  execFile('netsh',['advfirewall','firewall','show','rule','name=TPRLive'],{windowsHide:true},err=>{
    if(!err)return;   /* la règle existe déjà */
    try{fs.writeFileSync(flag,'1')}catch{}
    dialog.showMessageBox(win,{type:'question',buttons:['Autoriser','Plus tard'],defaultId:0,cancelId:1,title:'Connexion des téléphones',
      message:'Autoriser les téléphones à se connecter à ce PC ?',
      detail:'Windows va vous demander votre accord une seule fois. Sans cela, les téléphones peuvent ne pas trouver le PC sur certains réseaux Wi-Fi (réseau classé « public »).'})
    .then(r=>{
      if(r.response!==0)return;
      const add="Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=TPRLive dir=in action=allow protocol=TCP localport=3000 profile=any' -Verb RunAs -WindowStyle Hidden -Wait";
      execFile('powershell',['-NoProfile','-Command',add],{windowsHide:true},er=>log('Pare-feu : '+(er?'refusé ou échec ('+er.message+')':'règle ajoutée')));
    }).catch(()=>{});
  });
}

/* Mises à jour : jamais pendant un direct (le téléchargement prendrait de la bande passante à l'image) */
function updates(){
  const {autoUpdater}=require('electron-updater');
  autoUpdater.autoDownload=false;
  let pending=false,downloading=false,ready=null,asked=false;
  const download=()=>{
    if(!pending||downloading||ready||liveCount()>0)return;
    pending=false;downloading=true;
    autoUpdater.downloadUpdate().catch(e=>{downloading=false;log('Téléchargement de la mise à jour : '+(e&&e.message))});
  };
  autoUpdater.on('update-available',()=>{pending=true;download()});
  autoUpdater.on('update-downloaded',i=>{downloading=false;ready=i});
  autoUpdater.on('error',e=>{downloading=false;log('Mise à jour : '+(e&&e.message))});
  /* La fenêtre « redémarrer » n'apparaît que lorsqu'aucun téléphone n'est en direct */
  const offer=()=>{
    if(!ready||asked||liveCount()>0||!win||win.isDestroyed())return;
    asked=true;
    dialog.showMessageBox(win,{type:'info',buttons:['Redémarrer maintenant','Plus tard'],defaultId:1,cancelId:1,
      title:'Mise à jour',message:'La version '+ready.version+' est prête.',detail:'Redémarrez TPR Live pour l\'installer. Ne le faites pas pendant un direct.'})
    .then(r=>{if(r.response===0){forceQuit=true;stopServer();autoUpdater.quitAndInstall()}else setTimeout(()=>{asked=false},60*60*1000)}).catch(()=>{asked=false});
  };
  const chk=()=>{
    if(ready||downloading)return;
    if(pending)return download();
    if(liveCount()===0)autoUpdater.checkForUpdates().catch(()=>{});
  };
  chk();setInterval(chk,30*60*1000);setInterval(offer,60*1000);
}

function start(){
  /* Empêche Windows de se mettre en veille pendant que TPR Live tourne */
  try{powerSaveBlocker.start('prevent-app-suspension')}catch(e){log('Anti-veille indisponible : '+e.message)}
  srv=createServer({dataDir:app.getPath('userData'),pin:loadPin(app.getPath('userData')),cipher:makeCipher()});
  srv.on('error',e=>{log('Serveur : '+e.message);dialog.showErrorBox('TPR Live','Impossible de démarrer le serveur (port 3000 déjà utilisé ?) : '+e.message);app.quit()});
  srv.listen(PORT,'0.0.0.0',()=>{
    Menu.setApplicationMenu(null);
    win=new BrowserWindow({width:1000,height:820,minWidth:720,minHeight:560,backgroundColor:'#140d12',autoHideMenuBar:true,title:'TPR Live',icon:path.join(__dirname,'build','icon.png')});
    win.loadURL('http://localhost:'+PORT+'/control.html');
    /* Fermer la fenêtre coupe l'image dans OBS : on demande confirmation tant qu'un téléphone est en direct */
    win.on('close',e=>{
      if(forceQuit)return;
      const n=liveCount();
      if(n>0){
        const r=dialog.showMessageBoxSync(win,{type:'warning',buttons:['Continuer le direct','Quitter quand même'],defaultId:0,cancelId:0,title:'Direct en cours',
          message:n+(n>1?' téléphones sont':' téléphone est')+' en direct.',detail:'Fermer TPR Live coupe immédiatement l\'image dans OBS.'});
        if(r===0)e.preventDefault();
      }
    });
    win.on('closed',()=>{win=null});
    if(app.isPackaged){try{updates()}catch(e){log('Mises à jour indisponibles : '+e.message)}firewall()}
  });
}

/* Une seule copie de TPR Live à la fois : relancer le programme ramène simplement la fenêtre au premier plan */
if(!app.requestSingleInstanceLock()){app.quit()}
else{
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus()}});
  app.whenReady().then(start);
}
app.on('before-quit',stopServer);
app.on('will-quit',stopServer);
app.on('quit',stopServer);
app.on('window-all-closed',()=>app.quit());
