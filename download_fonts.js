const https = require('https');
const fs = require('fs');
const path = require('path');

const fontsDir = path.join(__dirname, 'public', 'fonts');
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

// Monoline / consistent-stroke-width fonts from Google Fonts
// Only fonts where letter strokes are uniform thickness (true neon-compatible)
const fonts = [
    // From reference image + additional monoline picks
    { name: 'Gruppo', file: 'Gruppo-Regular.ttf', path: 'ofl/gruppo/Gruppo-Regular.ttf' },
    { name: 'Kodchasan', file: 'Kodchasan-Regular.ttf', path: 'ofl/kodchasan/Kodchasan-Regular.ttf' },
    { name: 'Sacramento', file: 'Sacramento-Regular.ttf', path: 'ofl/sacramento/Sacramento-Regular.ttf' },
    { name: 'Megrim', file: 'Megrim-Regular.ttf', path: 'ofl/megrim/Megrim.ttf' },
    { name: 'Sue Ellen Francisco', file: 'SueEllenFrancisco-Regular.ttf', path: 'ofl/sueellenfrancisco/SueEllenFrancisco-Regular.ttf' },
    { name: 'Julius Sans One', file: 'JuliusSansOne-Regular.ttf', path: 'ofl/juliussansone/JuliusSansOne-Regular.ttf' },
    { name: 'Poiret One', file: 'PoiretOne-Regular.ttf', path: 'ofl/poiretone/PoiretOne-Regular.ttf' },
    { name: 'Wire One', file: 'WireOne-Regular.ttf', path: 'ofl/wireone/WireOne-Regular.ttf' },
    { name: 'Syncopate', file: 'Syncopate-Regular.ttf', path: 'ofl/syncopate/Syncopate-Regular.ttf' },
    { name: 'Text Me One', file: 'TextMeOne-Regular.ttf', path: 'ofl/textmeone/TextMeOne-Regular.ttf' },
    { name: 'Tulpen One', file: 'TulpenOne-Regular.ttf', path: 'ofl/tulpenone/TulpenOne-Regular.ttf' },
    { name: 'Meow Script', file: 'MeowScript-Regular.ttf', path: 'ofl/meowscript/MeowScript-Regular.ttf' },
    { name: 'Yellowtail', file: 'Yellowtail-Regular.ttf', path: 'ofl/yellowtail/Yellowtail-Regular.ttf' },
    { name: 'Mr Dafoe', file: 'MrDafoe-Regular.ttf', path: 'ofl/mrdafoe/MrDafoe-Regular.ttf' },
    { name: 'Alex Brush', file: 'AlexBrush-Regular.ttf', path: 'ofl/alexbrush/AlexBrush-Regular.ttf' },
    // Good monoline cursive additions
    { name: 'Neonderthaw', file: 'Neonderthaw-Regular.ttf', path: 'ofl/neonderthaw/Neonderthaw-Regular.ttf' },
    { name: 'Ms Madi', file: 'MsMadi-Regular.ttf', path: 'ofl/msmadi/MsMadi-Regular.ttf' },
    { name: 'Vampiro One', file: 'VampiroOne-Regular.ttf', path: 'ofl/vampiroone/VampiroOne-Regular.ttf' },
];

let completed = 0;
let failed = [];

fonts.forEach(font => {
    const url = `https://raw.githubusercontent.com/google/fonts/main/${font.path}`;
    const dest = path.join(fontsDir, font.file);

    if (fs.existsSync(dest)) {
        console.log(`[SKIP] ${font.name} already exists.`);
        completed++;
        if (completed === fonts.length) summarize();
        return;
    }

    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
        if (res.statusCode !== 200) {
            file.close();
            fs.unlinkSync(dest);
            failed.push(font.name);
            console.log(`[FAIL] ${font.name} → HTTP ${res.statusCode}`);
            completed++;
            if (completed === fonts.length) summarize();
            return;
        }
        res.pipe(file);
        file.on('finish', () => {
            file.close();
            console.log(`[OK]   ${font.name}`);
            completed++;
            if (completed === fonts.length) summarize();
        });
    }).on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        failed.push(font.name);
        console.log(`[ERR]  ${font.name} → ${err.message}`);
        completed++;
        if (completed === fonts.length) summarize();
    });
});

function summarize() {
    console.log('\n=== Download Summary ===');
    console.log(`Downloaded ${fonts.length - failed.length} / ${fonts.length} fonts.`);
    if (failed.length > 0) console.log('Failed:', failed.join(', '));
    else console.log('All fonts downloaded successfully!');
}
