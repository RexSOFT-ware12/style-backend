// npm run fetch-bg-model — downloads the background-removal model so the first customer request is not slow.
const { startDownload, modelFile } = require('../src/lib/bgRemove');
console.log(`Downloading model to ${modelFile} …`);
startDownload().then(() => { console.log(require('fs').existsSync(modelFile) ? 'Done.' : 'Failed. Check the server can reach github.com.'); });
