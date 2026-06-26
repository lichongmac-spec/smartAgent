const electron = require('electron');
console.log('=== MAIN PROCESS STARTED ===');
console.log('process.type:', process.type);
console.log('electron type:', typeof electron);
if (typeof electron === 'object') {
  console.log('electron keys:', Object.keys(electron).slice(0, 10));
  const { app, BrowserWindow } = electron;
  console.log('app type:', typeof app);
  if (app && app.whenReady) {
    app.whenReady().then(() => {
      console.log('App ready, creating window...');
      const win = new BrowserWindow({ width: 600, height: 400, title: 'SmartAgent Test' });
      win.loadURL('data:text/html,<h1 style="text-align:center;margin-top:100px;font-family:sans-serif">SmartAgent Electron 33 - Working!</h1>');
    });
  }
} else {
  console.log('ERROR: electron is a string, not an object');
  console.log('electron path:', electron);
}
