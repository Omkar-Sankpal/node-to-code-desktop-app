import path from 'path' 
import { app , BrowserWindow } from 'electron'

app.on('ready', ()=> {
    const mainWindow = new BrowserWindow({}); 
    mainWindow.loadFile(path.join(app.getAppPath(), '/dist-react/index.html'));
})
