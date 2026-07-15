const https = require('https');
const fs = require('fs');
const path = require('path');

const fontsDir = path.join(__dirname, 'public', 'fonts');

// Fixed paths for failed fonts
const fonts = [
    { name: 'Yellowtail', file: 'Yellowtail-Regular.ttf', path: 'apache/yellowtail/Yellowtail-Regular.ttf' },
    { name: 'Syncopate', file: 'Syncopate-Regular.ttf', path: 'apache/syncopate/Syncopate-Regular.ttf' },
];

fonts.forEach(font => {
    const url = `https://raw.githubusercontent.com/google/fonts/main/${font.path}`;
    const dest = path.join(fontsDir, font.file);
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
        if (res.statusCode !== 200) {
            file.close();
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            console.log(`[FAIL] ${font.name} → HTTP ${res.statusCode}`);
            return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); console.log(`[OK]   ${font.name}`); });
    }).on('error', (e) => console.log(`[ERR] ${font.name}: ${e.message}`));
});
