/**
 * Neon Sign Creator — SVG Pathfinding Engine
 *
 * Architecture:
 *  - Loads TTF fonts via opentype.js and parses them into raw Bézier path data
 *  - Each word becomes an independent SVG element on the canvas
 *  - The SVG contains: acrylic backboard (thick stroke expansion) + neon glow layers + white tube
 *  - getTotalLength() on the rendered SVG path yields exact neon strip length in cm
 *  - Words can be dragged freely, resized, and individually styled
 */

document.addEventListener('DOMContentLoaded', async () => {

    // ============================================================
    // FONT REGISTRY — only consistent monoline-stroke typefaces
    // ============================================================
    const FONT_LIST = [
        { name: 'Adventure Island Script', file: 'Adventure Island Script.ttf' },
        { name: 'Andolucia',           file: 'Andolucia.ttf' },
        { name: 'Anthony Houston',     file: 'Anthony_Houston.ttf' },
        { name: 'Barokah Signature',   file: 'Barokah Signature by Alifinart Studio.ttf' },
        { name: 'Famulred',            file: 'Famulred.otf' },
        { name: 'High Empathy',        file: 'High Empathy.ttf' },
        { name: 'Jastyka',             file: 'Jastyka.ttf' },
        { name: 'Nickainley',          file: 'Nickainley.ttf' },
        { name: 'Zing Script Rust',    file: 'ZingScriptRustSBDemo-Base.otf' },
        { name: 'Gruppo',              file: 'Gruppo-Regular.ttf' },
        { name: 'Kodchasan',           file: 'Kodchasan-Regular.ttf' },
        { name: 'Meow Script',         file: 'MeowScript-Regular.ttf' },
        { name: 'Sacramento',          file: 'Sacramento-Regular.ttf' },
        { name: 'Megrim',              file: 'Megrim-Regular.ttf' },
        { name: 'Sue Ellen Francisco', file: 'SueEllenFrancisco-Regular.ttf' },
        { name: 'Julius Sans One',     file: 'JuliusSansOne-Regular.ttf' },
        { name: 'Wire One',            file: 'WireOne-Regular.ttf' },
        { name: 'Poiret One',          file: 'PoiretOne-Regular.ttf' },
        { name: 'Text Me One',         file: 'TextMeOne-Regular.ttf' },
        { name: 'Tulpen One',          file: 'TulpenOne-Regular.ttf' },
        { name: 'Neonderthaw',         file: 'Neonderthaw-Regular.ttf' },
        { name: 'Ms Madi',             file: 'MsMadi-Regular.ttf' },
    ];

    // ============================================================
    // NEON COLORS
    // ============================================================
    const NEON_COLORS = [
        { id: 'pink',       name: 'Pink',       glowColor: '#ff0080' },
        { id: 'red',        name: 'Red',        glowColor: '#ff0000' },
        { id: 'orange',     name: 'Orange',     glowColor: '#ff6600' },
        { id: 'yellow',     name: 'Yellow',     glowColor: '#ffff00' },
        { id: 'green',      name: 'Green',      glowColor: '#00ff00' },
        { id: 'lime-yellow', name: 'Lime Yellow', glowColor: '#ccff00' },
        { id: 'ice-blue',   name: 'Ice Blue',   glowColor: '#19d6ff' },
        { id: 'blue',       name: 'Blue',       glowColor: '#0055ff' },
        { id: 'purple',     name: 'Purple',     glowColor: '#bf00ff' },
        { id: 'white',      name: 'White',       glowColor: '#ffffff' },
        { id: 'warm-white', name: 'Warm White', glowColor: '#fff0cc' },
        { id: 'rgb',        name: 'RGB Cycle',  glowColor: '#ff0000' }, 
        { id: 'flow',       name: 'Color Flow', glowColor: '#ff0000' },
    ];

    // 1px ≈ 0.22cm at base font size (120px) — calibrated to real neon sign ratios
    const BASE_FONT_SIZE = 120;
    const PX_TO_CM = 0.22;

    // ============================================================
    // STATE
    let currentSign = {
        text: 'Good Vibes',
        fontName: 'Meow Script',
        colorId: 'ice-blue',
        scale: 1.0,
        lineSpacing: 1.2,
        x: 0, // offset from center
        y: 0,
        selected: true,
        targetWidthIn: 24, // Default physical width in inches (matches active Medium size-card)
        visualScale: 1.0, // Cache visual scale from dragging blue handles
        calculatedHeightIn: 0,
        calculatedWidthCm: 0,
        calculatedHeightCm: 0,
        environment: 'indoor',
        backingColor: 'acrylic',
        backing: 'cut-to-shape',
        _stripCm: 0
    };
    let currentBacking = 'cut-to-shape';
    let currentBackingColor = 'acrylic';
    const fontCache = {};

    // ============================================================
    // DOM REFERENCES
    // ============================================================
    const textInput      = document.getElementById('sign-text');
    const charCountEl    = document.getElementById('char-count');
    const priceTotal     = document.getElementById('price-total');
    const estHeightEl    = document.getElementById('est-height');
    const estWidthEl     = document.getElementById('est-width');
    const totalLengthEl  = document.getElementById('total-strip-length');
    const inputWidthIn   = document.getElementById('input-width-in');
    const inputHeightIn  = document.getElementById('input-height-in');
    const customSizeEquiv = document.getElementById('custom-size-equiv');
    const customInputs   = document.getElementById('custom-inputs-section');
    const neonContainer  = document.getElementById('neon-container');
    const contextMenu    = document.getElementById('word-context-menu');
    const ctxFontGallery = document.getElementById('ctx-font-gallery');
    const ctxColorGrid   = document.getElementById('ctx-color-grid');
    const ctxSizeLabel   = document.getElementById('ctx-size-label');
    const previewSection = document.querySelector('.preview-section');
    const uploadInput    = document.getElementById('bg-upload-input');
    const uploadBtn      = document.getElementById('upload-bg-btn');

    function checkElements() {
        const required = [textInput, neonContainer, totalLengthEl];
        return required.every(el => el !== null);
    }
    
    if (!checkElements()) {
        console.error("Critical DOM elements missing. Neon engine cannot start.");
        return;
    }

    // ============================================================
    // FONT LOADING
    // ============================================================
    const loadFont = (fontName) => {
        if (fontCache[fontName]) return Promise.resolve(fontCache[fontName]);
        const entry = FONT_LIST.find(f => f.name === fontName);
        if (!entry) return Promise.reject(new Error(`Unknown font: ${fontName}`));
        return new Promise((resolve, reject) => {
            opentype.load(`/fonts/${entry.file}`, (err, font) => {
                if (err) { reject(err); return; }
                fontCache[fontName] = font;
                resolve(font);
            });
        });
    };

    const preloadAllFonts = async () => {
        await Promise.all(FONT_LIST.map(f => loadFont(f.name).catch(() => {})));
    };

    // ============================================================
    // POPULATE CONTEXT MENU UI (null-guarded)
    // ============================================================
    if (ctxFontGallery) {
        ctxFontGallery.innerHTML = '';
        FONT_LIST.forEach(f => {
            const btn = document.createElement('div');
            btn.className = 'font-item';
            btn.dataset.fontName = f.name;
            btn.textContent = f.name;
            btn.style.fontFamily = `"${f.name}", sans-serif`;
            ctxFontGallery.appendChild(btn);
        });
    }

    if (ctxColorGrid) ctxColorGrid.innerHTML = '';

    // Populate Sidebar Color Grid
    const globalColorGrid = document.getElementById('global-color-grid');
    if (globalColorGrid) globalColorGrid.innerHTML = '';

    // Populate Sidebar Font Gallery
    const globalFontGallery = document.getElementById('global-font-gallery');
    if (globalFontGallery) {
        globalFontGallery.innerHTML = '';
        FONT_LIST.forEach(f => {
            const card = document.createElement('div');
            card.className = 'font-item';
            card.dataset.fontName = f.name;
            card.textContent = 'Good Vibes';
            card.style.fontFamily = `"${f.name}", sans-serif`;
            
            card.addEventListener('click', () => {
                document.querySelectorAll('.font-item').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                currentSign.fontName = f.name;
                syncTextToCanvas();
            });
            globalFontGallery.appendChild(card);
        });

        // Mark current font as active after small delay
        setTimeout(() => {
            const activeCard = globalFontGallery.querySelector(`[data-font-name="${currentSign.fontName}"]`);
            if (activeCard) activeCard.classList.add('active');
        }, 100);
    }

    // Line Spacing Slider
    const lineSpacingSlider = document.getElementById('line-spacing-slider');
    const lineSpacingVal    = document.getElementById('line-spacing-val');
    if (lineSpacingSlider) {
        lineSpacingSlider.addEventListener('input', () => {
            currentSign.lineSpacing = parseFloat(lineSpacingSlider.value);
            if (lineSpacingVal) lineSpacingVal.textContent = `${currentSign.lineSpacing.toFixed(1)}x`;
            syncTextToCanvas();
        });
    }

    // Populate Neon Color Buttons
    if (globalColorGrid) {
        NEON_COLORS.forEach(color => {
            const btn = document.createElement('div');
            btn.className = 'neon-color-button';
            btn.dataset.colorId = color.id;
            if (currentSign.colorId === color.id) btn.classList.add('active');
            
            const dot = document.createElement('div');
            dot.className = 'color-status-dot';
            
            if (color.id === 'rgb') {
                dot.style.background = 'linear-gradient(45deg, red, orange, yellow, green, blue, indigo, violet)';
            } else if (color.id === 'flow') {
                dot.style.background = 'linear-gradient(to right, #ff0080, #19d6ff, #00ff00)';
            } else {
                dot.style.setProperty('--dot-color', color.glowColor);
            }
            
            const name = document.createElement('span');
            name.textContent = color.name;
            
            btn.appendChild(dot);
            btn.appendChild(name);
            
            btn.addEventListener('click', () => {
                document.querySelectorAll('.neon-color-button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentSign.colorId = color.id;
                syncTextToCanvas();
            });
            
            globalColorGrid.appendChild(btn);
        });
    }

    // ============================================================
    // SVG RENDERING ENGINE — the heart of the pathfinder
    // ============================================================
    const svgNS = 'http://www.w3.org/2000/svg';

    /**
     * Builds a single SVG for the entire sign (multi-line)
     */
    const buildSignSVG = (signData, font, backing) => {
        const lines = signData.text.split('\n');
        const fontSize = BASE_FONT_SIZE * signData.scale;
        const lineSpacing = fontSize * signData.lineSpacing;
        
        const combinedPaths = [];
        let totalMaxX = -Infinity, totalMinX = Infinity;
        let totalMaxY = -Infinity, totalMinY = Infinity;

        // 1. Calculate paths and overall bounding box
        lines.forEach((line, idx) => {
            const yOffset = idx * lineSpacing;
            const linePath = font.getPath(line || ' ', 0, yOffset, fontSize);
            const bbox = linePath.getBoundingBox();
            
            // Center the line horizontally by offsetting its path
            const lineWidth = (bbox.x2 - bbox.x1) || 0;
            const xShift = -lineWidth / 2;
            
            combinedPaths.push({ path: linePath, xShift, yOffset, bbox, lineWidth });

            totalMinX = Math.min(totalMinX, -lineWidth / 2);
            totalMaxX = Math.max(totalMaxX, lineWidth / 2);
            totalMinY = Math.min(totalMinY, bbox.y1 + yOffset);
            totalMaxY = Math.max(totalMaxY, bbox.y2 + yOffset);
        });

        if (totalMinX === Infinity) return null;

        const color = NEON_COLORS.find(c => c.id === signData.colorId) || NEON_COLORS[0];
        const glow = color.glowColor;

        // Padding for backboard and glow
        const boardPadding = fontSize * (backing === 'cut-to-letter' ? 0.18 : 0.30);
        const bleed = boardPadding + 40;

        const vx = totalMinX - bleed;
        const vy = totalMinY - bleed;
        const vw = (totalMaxX - totalMinX) + 2 * bleed;
        const vh = (totalMaxY - totalMinY) + 2 * bleed;

        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
        svg.setAttribute('width', Math.round(vw));
        svg.setAttribute('height', Math.round(vh));
        svg.style.cssText = 'display:block;overflow:visible;pointer-events:none;';

        const defs = document.createElementNS(svgNS, 'defs');
        const uid = 'sign';
        defs.innerHTML = `
            <linearGradient id="flow-grad" x1="0%" y1="0%" x2="200%" y2="0%" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#ff0000" />
                <stop offset="10%" stop-color="#ff7700" />
                <stop offset="20%" stop-color="#ffff00" />
                <stop offset="30%" stop-color="#00ff00" />
                <stop offset="40%" stop-color="#00aaff" />
                <stop offset="50%" stop-color="#8800ff" />
                <stop offset="60%" stop-color="#ff0000" />
                <stop offset="70%" stop-color="#ff7700" />
                <stop offset="80%" stop-color="#ffff00" />
                <stop offset="90%" stop-color="#00ff00" />
                <stop offset="100%" stop-color="#ff0000" />
                <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="-1000 0" dur="10s" repeatCount="indefinite" />
            </linearGradient>
            <filter id="glow-outer-${uid}" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="25"/>
            </filter>
            <filter id="glow-mid-${uid}" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="10"/>
            </filter>
            <filter id="glow-inner-${uid}" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3.5"/>
            </filter>`;
        svg.appendChild(defs);

        const group = document.createElementNS(svgNS, 'g');

        // --- RECTANGLE BACKBOARD: drawn as a single SVG rect behind everything ---
        if (backing === 'rectangle') {
            const rectPad = fontSize * 0.5;
            const rRect = document.createElementNS(svgNS, 'rect');
            rRect.setAttribute('x', totalMinX - rectPad);
            rRect.setAttribute('y', totalMinY - rectPad);
            rRect.setAttribute('width', (totalMaxX - totalMinX) + rectPad * 2);
            rRect.setAttribute('height', (totalMaxY - totalMinY) + rectPad * 2);
            rRect.setAttribute('rx', fontSize * 0.15);
            rRect.setAttribute('ry', fontSize * 0.15);

            let rectFill = 'rgba(255, 255, 255, 0.12)';
            let rectStroke = 'rgba(255, 255, 255, 0.2)';
            if (currentBackingColor === 'black') { rectFill = 'rgba(0,0,0,0.85)'; rectStroke = '#222'; }
            if (currentBackingColor === 'white') { rectFill = 'rgba(255,255,255,0.9)'; rectStroke = '#ddd'; }

            rRect.setAttribute('fill', rectFill);
            rRect.setAttribute('stroke', rectStroke);
            rRect.setAttribute('stroke-width', '4');
            group.appendChild(rRect);
        }

        combinedPaths.forEach(cp => {
            const lineG = document.createElementNS(svgNS, 'g');
            lineG.setAttribute('transform', `translate(${cp.xShift}, ${cp.yOffset})`);
            
            const d = cp.path.toPathData(2);
            
            // Layer 0: Backboard (contoured — cut-to-shape and cut-to-letter only)
            if (backing !== 'rectangle') {
                let fill = 'rgba(255, 255, 255, 0.12)';
                let stroke = 'rgba(255, 255, 255, 0.15)';
                
                if (currentBackingColor === 'black') { fill = '#000'; stroke = '#000'; }
                if (currentBackingColor === 'white') { fill = '#fff'; stroke = '#fff'; }
                
                const pBoard = document.createElementNS(svgNS, 'path');
                pBoard.setAttribute('d', d);
                pBoard.setAttribute('fill', fill);
                pBoard.setAttribute('stroke', stroke);
                pBoard.setAttribute('stroke-width', boardPadding * 2);
                pBoard.setAttribute('stroke-linejoin', 'round');
                pBoard.setAttribute('stroke-linecap', 'round');
                lineG.appendChild(pBoard);
            }

            // Create a sub-group for the lighting (glow + tube)
            const lightingG = document.createElementNS(svgNS, 'g');
            if (signData.colorId === 'rgb') lightingG.classList.add('neon-rgb-anim');
            lineG.appendChild(lightingG);

            // Layers 1-3: Glow
            ['outer', 'mid', 'inner'].forEach(level => {
                const p = document.createElementNS(svgNS, 'path');
                p.setAttribute('d', d);
                p.setAttribute('fill', signData.colorId === 'flow' ? 'url(#flow-grad)' : glow);
                p.setAttribute('filter', `url(#glow-${level}-${uid})`);
                p.setAttribute('opacity', level === 'outer' ? '0.4' : level === 'mid' ? '0.7' : '0.9');
                lightingG.appendChild(p);
            });

            const pTube = document.createElementNS(svgNS, 'path');
            pTube.setAttribute('d', d);
            pTube.setAttribute('fill', signData.colorId === 'flow' ? 'url(#flow-grad)' : '#fff');
            pTube.classList.add('neon-tube-core');
            if (signData.colorId === 'flow') {
                pTube.classList.add('neon-flow-anim');
            }
            lightingG.appendChild(pTube);

            group.appendChild(lineG);
        });

        svg.appendChild(group);

        return { svg, vw, vh };
    };

    // ============================================================
    // WORD NODE DOM MANAGEMENT
    // ============================================================
    // Obsolete per-word rendering

    // ============================================================
    // SELECTION & CONTEXT MENU
    // ============================================================
    // Obsolete selection logic

    // ============================================================
    // TEXT INPUT → CANVAS SYNC (Sentence Flow Layout Engine)
    // ============================================================
    const syncTextToCanvas = async () => {
        const text = textInput.value || ' ';
        currentSign.text = text;
        
        charCountEl.textContent = `${text.replace(/\s/g, '').length} letter${text.length !== 1 ? 's' : ''}`;

        const font = await loadFont(currentSign.fontName);
        const result = buildSignSVG(currentSign, font, currentBacking);
        
        neonContainer.innerHTML = '';
        if (!result) return;

        const currentPxWidth  = result.vw;
        const currentPxHeight = result.vh;

        const signNode = document.createElement('div');
        signNode.className = 'unified-sign';
        signNode.style.position = 'absolute';
        signNode.style.left = '50%';
        signNode.style.top = '50%';
        signNode.style.transform = `translate(calc(-50% + ${currentSign.x}px), calc(-50% + ${currentSign.y}px))`;
        
        const svgWrapper = document.createElement('div');
        svgWrapper.className = 'interaction-wrapper';
        svgWrapper.style.position = 'relative';

        // Calculate auto-scale factor to fit the preview section boundaries
        const containerWidth = neonContainer.clientWidth || window.innerWidth * 0.6;
        const containerHeight = neonContainer.clientHeight || window.innerHeight * 0.5;

        // Apply a safety margin (e.g. 60px padding)
        const horizontalScale = (containerWidth - 60) / currentPxWidth;
        const verticalScale = (containerHeight - 80) / currentPxHeight;
        const autoScale = Math.min(horizontalScale, verticalScale, 1.0);

        const finalScale = autoScale * (currentSign.visualScale || 1.0);
        svgWrapper.style.transform = `scale(${finalScale})`;
        svgWrapper.appendChild(result.svg);
        signNode.appendChild(svgWrapper);

        // 3. Dimension Logic (Decoupled: Visual scale vs Physical Inches)
        
        // Calibration factor: how many Inches is 1 PX for this specific setup?
        const currentInPerPx = currentSign.targetWidthIn / currentPxWidth;

        const finalWIn = currentSign.targetWidthIn.toFixed(1);
        const finalHIn = (currentPxHeight * currentInPerPx).toFixed(1);
        const finalWCm = (currentSign.targetWidthIn * 2.54).toFixed(1);
        const finalHCm = (currentPxHeight * currentInPerPx * 2.54).toFixed(1);

        // Cache sizes in currentSign for external handlers (like Add to Cart)
        currentSign.calculatedHeightIn = parseFloat(finalHIn);
        currentSign.calculatedWidthCm = parseFloat(finalWCm);
        currentSign.calculatedHeightCm = parseFloat(finalHCm);

        if (inputHeightIn) inputHeightIn.value = Math.round(finalHIn);
        if (customSizeEquiv) {
            customSizeEquiv.textContent = `Equivalent to: ${Math.round(finalWCm)}cm x ${Math.round(finalHCm)}cm`;
        }

        // Update Sidebar Labels for Size Cards
        document.querySelectorAll('.size-card').forEach(card => {
            if (card.dataset.custom) return;
            const cardWIn = parseFloat(card.dataset.width);
            const cardHIn = (cardWIn * (result.vh / result.vw)).toFixed(0);
            const cardWCm = (cardWIn * 2.54).toFixed(0);
            const cardHCm = (parseFloat(cardHIn) * 2.54).toFixed(0);
            
            const dimsEl = card.querySelector('.size-dims');
            if (dimsEl) {
                dimsEl.textContent = `${cardWIn}in x ${cardHIn}in / ${cardWCm}cm x ${cardHCm}cm`;
            }
        });

        const badge = document.createElement('div');
        badge.className = 'dim-badge';
        badge.textContent = `${finalWIn}in x ${finalHIn}in / ${finalWCm}cm x ${finalHCm}cm`;
        svgWrapper.appendChild(badge);

        // 4. Ruler Lines (Re-adding missing style definitions in JS for layout)
        const hr = document.createElement('div'); hr.className = 'ruler-line h';
        hr.style.cssText = 'height:1px; top:-15px; left:0; right:0; position:absolute; background:rgba(255,255,255,0.4);';
        const vr = document.createElement('div'); vr.className = 'ruler-line v';
        vr.style.cssText = 'width:1px; left:-15px; top:0; bottom:0; position:absolute; background:rgba(255,255,255,0.4);';
        
        const hTxt = document.createElement('div'); hTxt.className = 'ruler-text h';
        hTxt.style.cssText = 'position:absolute; top:-30px; left:50%; transform:translateX(-50%); color:rgba(255,255,255,0.7); font-size:0.75rem;';
        const vTxt = document.createElement('div'); vTxt.className = 'ruler-text v';
        vTxt.style.cssText = 'position:absolute; left:-55px; top:50%; transform:translateY(-50%); color:rgba(255,255,255,0.7); font-size:0.75rem; text-align:right;';
        
        hTxt.textContent = `${finalWIn}in`;
        vTxt.innerHTML = `${finalHIn}in<br><span style="font-size:0.65rem;opacity:0.8;">${finalHCm}cm</span>`;
        
        // Exact alignment: The sign's outer edge is 40px from the SVG border at scale 1
        const bleedOffset = 40;
        hr.style.left = `${bleedOffset}px`;
        hr.style.right = `${bleedOffset}px`;
        vr.style.top = `${bleedOffset}px`;
        vr.style.bottom = `${bleedOffset}px`;

        svgWrapper.appendChild(hr); svgWrapper.appendChild(vr);
        svgWrapper.appendChild(hTxt); svgWrapper.appendChild(vTxt);

        // 1. Selection Box
        const selectionBox = document.createElement('div');
        selectionBox.className = 'selection-box';
        svgWrapper.appendChild(selectionBox);

        // 2. Multi-Point Handles (visual-only — does NOT change physical size/price)
        ['tl', 'tr', 'tm', 'bl', 'br'].forEach(pos => {
            const h = document.createElement('div');
            h.className = `sign-handle ${pos}`;
            svgWrapper.appendChild(h);

            let resizing = false;
            let startDist, centerX, centerY;
            let startScale = 1.0;

            h.addEventListener('pointerdown', e => {
                e.stopPropagation();
                resizing = true;
                const rect = svgWrapper.getBoundingClientRect();
                centerX = rect.left + rect.width / 2;
                centerY = rect.top + rect.height / 2;
                startDist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
                startScale = currentSign.visualScale || 1.0;
                h.setPointerCapture(e.pointerId);
                svgWrapper.style.transition = 'none';
            });

            h.addEventListener('pointermove', e => {
                if (!resizing) return;
                const dist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
                const visualFactor = Math.max(0.2, Math.min(5.0, (dist / startDist) * startScale));
                
                // Recalculate autoScale to keep dragging smooth relative to autoScale
                const containerWidth = neonContainer.clientWidth || window.innerWidth * 0.6;
                const containerHeight = neonContainer.clientHeight || window.innerHeight * 0.5;
                const horizontalScale = (containerWidth - 60) / currentPxWidth;
                const verticalScale = (containerHeight - 80) / currentPxHeight;
                const autoScale = Math.min(horizontalScale, verticalScale, 1.0);

                // Pure CSS visual scale — no effect on physical metrics or price
                svgWrapper.style.transform = `scale(${autoScale * visualFactor})`;
                currentSign.visualScale = visualFactor;
            });

            h.addEventListener('pointerup', () => { 
                resizing = false; 
            });
        });

        neonContainer.appendChild(signNode);

        // --- Interaction: Dragging ---
        let dragging = false;
        let startX, startY, origX, origY;

        // Selection Toggle logic
        if (currentSign.selected) signNode.classList.add('selected');

        signNode.addEventListener('pointerdown', e => {
            // Dragging prep
            if (e.target.classList.contains('sign-handle')) return;
            
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            origX = currentSign.x; origY = currentSign.y;
            signNode.setPointerCapture(e.pointerId);

            // Selection toggle
            if (!currentSign.selected) {
                currentSign.selected = true;
                syncTextToCanvas(); 
            }
        }, { capture: true }); 

        signNode.addEventListener('pointermove', e => {
            if (!dragging) return;
            currentSign.x = origX + (e.clientX - startX);
            currentSign.y = origY + (e.clientY - startY);
            signNode.style.transform = `translate(calc(-50% + ${currentSign.x}px), calc(-50% + ${currentSign.y}px))`;
        });

        signNode.addEventListener('pointerup', () => { dragging = false; });

        // Update Global metrics
        const tubes = signNode.querySelectorAll('.neon-tube-core');
        let totalPx = 0;
        tubes.forEach(t => { try { totalPx += t.getTotalLength(); } catch(e) {} });
        
        const totalIn = (totalPx * currentInPerPx).toFixed(1);
        const totalCm = (totalPx * currentInPerPx * 2.54).toFixed(1);

        if (totalLengthEl) {
            totalLengthEl.textContent = `${totalIn} in / ${totalCm} cm`;
        }
        
        if (estWidthEl) estWidthEl.textContent = `Total: ${finalWIn}in x ${finalHIn}in / ${finalWCm}cm x ${finalHCm}cm`;
        
        // Accurate price based on width, height and neon strip length
        const wIn = parseFloat(finalWIn) || 0;
        const hIn = parseFloat(finalHIn) || 0;
        const lIn = parseFloat(totalIn) || 0;

        let calculatedPrice = 50 + (wIn + hIn) * 1.2 + lIn * 0.79;

        // Apply color multiplier (RGB Cycle is 2x, Color Flow is 3x)
        let colorMult = 1.0;
        if (currentSign.colorId === 'rgb') colorMult = 2.0;
        else if (currentSign.colorId === 'flow') colorMult = 3.0;
        calculatedPrice *= colorMult;

        // Apply backboard material multiplier (White and Black are 1.1x)
        let materialMult = 1.0;
        if (currentSign.backingColor === 'white' || currentSign.backingColor === 'black') {
            materialMult = 1.1;
        }
        calculatedPrice *= materialMult;

        // Apply use environment multiplier (Outdoor waterproof is 1.35x)
        let envMult = 1.0;
        if (currentSign.environment === 'outdoor') {
            envMult = 1.35;
        }
        calculatedPrice *= envMult;

        priceTotal.textContent = `$${calculatedPrice.toFixed(2)}`;
    };

    // Background click to deselect
    previewSection.addEventListener('pointerdown', e => {
        if (!e.target.closest('.unified-sign') && !e.target.closest('.control-panel')) {
            if (currentSign.selected) {
                currentSign.selected = false;
                syncTextToCanvas();
            }
        }
    });

    // ============================================================
    // BACKBOARD & MATERIAL SELECTION
    // ============================================================
    document.querySelectorAll('.bb-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.bb-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            currentBacking = card.dataset.backing;
            currentSign.backing = card.dataset.backing;
            syncTextToCanvas();
        });
    });

    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            currentBackingColor = swatch.dataset.bcolor;
            currentSign.backingColor = swatch.dataset.bcolor;
            syncTextToCanvas();
        });
    });

    // ============================================================
    // USE ENVIRONMENT SELECTION
    // ============================================================
    document.querySelectorAll('.env-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.env-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            currentSign.environment = card.dataset.env;
            syncTextToCanvas();
        });
    });

    // ============================================================
    // BACKGROUND SWITCHING
    // ============================================================
    const uploadBgBtn   = document.getElementById('upload-bg-btn');
    const bgUploadInput = document.getElementById('bg-upload-input');

    if (uploadBgBtn && bgUploadInput) {
        uploadBgBtn.addEventListener('click', () => bgUploadInput.click());
        bgUploadInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            document.querySelectorAll('.bg-option').forEach(b => b.classList.remove('active'));
            uploadBgBtn.classList.add('active');
            previewSection.className = 'preview-section';
            previewSection.style.backgroundImage = `url(${url})`;
            previewSection.style.backgroundSize = 'cover';
            previewSection.style.backgroundPosition = 'center';
        });
    }

    document.querySelectorAll('.bg-option.bg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.bg-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            previewSection.style.backgroundImage = '';
            previewSection.className = `preview-section bg-${btn.dataset.bg}`;
        });
    });

    // ============================================================
    // SIZE CARDS
    // ============================================================
    previewSection.classList.add('bg-black');

    document.querySelectorAll('.size-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.size-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            if (card.dataset.custom) {
                if (customInputs) customInputs.style.display = 'grid';
            } else {
                if (customInputs) customInputs.style.display = 'none';
                currentSign.targetWidthIn = parseFloat(card.dataset.width);
                if (inputWidthIn) inputWidthIn.value = currentSign.targetWidthIn;
            }
            syncTextToCanvas();
        });
    });

    if (inputWidthIn) {
        inputWidthIn.addEventListener('input', () => {
            currentSign.targetWidthIn = parseFloat(inputWidthIn.value) || 4;
            syncTextToCanvas();
        });
    }

    // ============================================================
    // STARTUP — load fonts then render
    // ============================================================
    neonContainer.innerHTML = '<div class="fonts-loading">⚡ Loading neon fonts…</div>';
    await preloadAllFonts();
    neonContainer.innerHTML = '';

    textInput.addEventListener('input', syncTextToCanvas);
    window.addEventListener('resize', syncTextToCanvas);
    syncTextToCanvas();

    // ============================================================
    // CART LOGIC
    // ============================================================
    let cart = JSON.parse(localStorage.getItem('neon_cart')) || [];

    const cartSidebar    = document.getElementById('cart-sidebar');
    const cartToggleBtn  = document.getElementById('cart-toggle-btn');
    const closeCartBtn   = document.getElementById('close-cart');
    const cartCountEl    = document.getElementById('cart-count');
    const cartItemsList  = document.getElementById('cart-items-list');
    const cartSubtotalEl = document.getElementById('cart-subtotal-val');
    const addToCartBtn   = document.getElementById('add-to-cart-btn');
    const continueBtn    = document.getElementById('continue-shopping');
    const goToCartBtn    = document.getElementById('go-to-cart-btn');

    const updateCartUI = () => {
        const totalQty = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
        cartCountEl.textContent = totalQty;
        
        if (cart.length === 0) {
            cartItemsList.innerHTML = '<div class="empty-cart-msg">Your cart is empty</div>';
            cartSubtotalEl.textContent = '$0.00';
        } else {
            cartItemsList.innerHTML = '';
            let subtotal = 0;
            
            cart.forEach((item, index) => {
                const qty = item.quantity || 1;
                subtotal += item.price * qty;
                const itemEl = document.createElement('div');
                itemEl.className = 'cart-item';
                itemEl.innerHTML = `
                    <div class="cart-item-img">
                        ${item.svgMarkup}
                    </div>
                    <div class="cart-item-info">
                        <div class="cart-item-name">${item.text.replace(/\n/g, ' ')}</div>
                        <div class="cart-item-details">
                            ${item.fontName} • ${item.colorName}<br>
                            ${item.widthIn || Math.round(item.widthCm / 2.54)}in x ${item.heightIn || Math.round(item.heightCm / 2.54)}in / ${item.widthCm}cm x ${item.heightCm}cm • ${item.backing === 'cut-to-letter' ? 'Cut to Letter' : item.backing === 'rectangle' ? 'Rectangle' : 'Cut to Shape'}<br>
                            Material: ${item.backingColor === 'black' ? 'Black Acrylic' : item.backingColor === 'white' ? 'White Acrylic' : 'Clear Glass'} • Use: ${item.environment === 'outdoor' ? 'Outdoor Waterproof' : 'Indoor Use'}
                        </div>
                        <div class="cart-item-price">$${(item.price * qty).toFixed(2)}</div>
                        
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 8px;">
                            <span style="font-size: 0.72rem; color: var(--text-secondary);">Qty:</span>
                            <div class="qty-control" style="display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 2px 4px;">
                                <button class="qty-btn dec-qty-btn" data-index="${index}" style="background: transparent; border: none; color: #fff; cursor: pointer; width: 20px; height: 20px; font-weight: bold; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; padding: 0;">-</button>
                                <span class="qty-val" style="font-size: 0.85rem; font-weight: 600; min-width: 20px; text-align: center; color: #fff;">${qty}</span>
                                <button class="qty-btn inc-qty-btn" data-index="${index}" style="background: transparent; border: none; color: #fff; cursor: pointer; width: 20px; height: 20px; font-weight: bold; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; padding: 0;">+</button>
                            </div>
                        </div>
                    </div>
                    <button class="remove-item-btn" data-index="${index}">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                `;
                cartItemsList.appendChild(itemEl);
            });
            
            cartSubtotalEl.textContent = `$${subtotal.toFixed(2)}`;
            
            // Add remove listeners
            document.querySelectorAll('.remove-item-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.index);
                    cart.splice(idx, 1);
                    localStorage.setItem('neon_cart', JSON.stringify(cart));
                    updateCartUI();
                });
            });

            // Add quantity listeners
            document.querySelectorAll('.dec-qty-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.index);
                    const qty = cart[idx].quantity || 1;
                    if (qty > 1) {
                        cart[idx].quantity = qty - 1;
                    } else {
                        cart.splice(idx, 1);
                    }
                    localStorage.setItem('neon_cart', JSON.stringify(cart));
                    updateCartUI();
                });
            });

            document.querySelectorAll('.inc-qty-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.index);
                    const qty = cart[idx].quantity || 1;
                    cart[idx].quantity = qty + 1;
                    localStorage.setItem('neon_cart', JSON.stringify(cart));
                    updateCartUI();
                });
            });
        }
    };

    const openCart = () => cartSidebar.classList.add('open');
    const closeCart = () => cartSidebar.classList.remove('open');

    if (cartToggleBtn) cartToggleBtn.addEventListener('click', openCart);
    if (closeCartBtn)  closeCartBtn.addEventListener('click', closeCart);
    if (continueBtn)   continueBtn.addEventListener('click', closeCart);

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', () => {
            const currentPrice = parseFloat(priceTotal.textContent.replace('$', ''));
            const colorObj = NEON_COLORS.find(c => c.id === currentSign.colorId);
            
            // Generate a simplified SVG preview for the cart
            const font = fontCache[currentSign.fontName];
            const result = buildSignSVG({...currentSign, scale: 0.5}, font, currentBacking);
            const svgMarkup = result ? result.svg.outerHTML : '';

            const cartItem = {
                text: currentSign.text,
                fontName: currentSign.fontName,
                colorName: colorObj ? colorObj.name : 'Custom',
                widthIn: Math.round(currentSign.targetWidthIn),
                heightIn: Math.round(currentSign.calculatedHeightIn || (currentSign.targetWidthIn * 0.35)),
                widthCm: Math.round(currentSign.calculatedWidthCm || (currentSign.targetWidthIn * 2.54)),
                heightCm: Math.round(currentSign.calculatedHeightCm || (currentSign.targetWidthIn * 2.54 * 0.35)),
                backing: currentBacking,
                backingColor: currentSign.backingColor || 'acrylic',
                environment: currentSign.environment || 'indoor',
                price: currentPrice,
                svgMarkup: svgMarkup,
                timestamp: Date.now()
            };

            const isSameCartItem = (a, b) => {
                return a.text === b.text &&
                       a.fontName === b.fontName &&
                       a.colorName === b.colorName &&
                       a.widthCm === b.widthCm &&
                       a.heightCm === b.heightCm &&
                       a.backing === b.backing &&
                       a.backingColor === b.backingColor &&
                       a.environment === b.environment;
            };

            const existingIndex = cart.findIndex(item => isSameCartItem(item, cartItem));
            if (existingIndex > -1) {
                cart[existingIndex].quantity = (cart[existingIndex].quantity || 1) + 1;
            } else {
                cartItem.quantity = 1;
                cart.push(cartItem);
            }
            localStorage.setItem('neon_cart', JSON.stringify(cart));
            updateCartUI();
            openCart();

            // Success feedback on button
            const originalText = addToCartBtn.textContent;
            addToCartBtn.textContent = 'Added! ✓';
            addToCartBtn.style.background = '#10b981';
            setTimeout(() => {
                addToCartBtn.textContent = originalText;
                addToCartBtn.style.background = '';
            }, 2000);
        });
    }

    if (goToCartBtn) {
        goToCartBtn.addEventListener('click', () => {
            window.location.href = 'cart.html';
        });
    }

    // ─── CUSTOMIZER USER AUTH & SAVE/LOAD INTEGRATION ────────────────────────────
    function showToast(text, color = '#ff007f') {
        if (!document.getElementById('toast-animation-style')) {
            const style = document.createElement('style');
            style.id = 'toast-animation-style';
            style.textContent = `
                @keyframes fadeSlideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }
        const toast = document.createElement('div');
        toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:#060608; color:#fff; padding:16px 24px; border-radius:12px; border:1px solid ${color}; z-index:9999; font-weight:600; font-size:0.9rem; box-shadow:0 10px 30px rgba(0,0,0,0.25); animation: fadeSlideUp 0.3s ease-out;`;
        toast.textContent = text;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    async function getActiveUser() {
        const supabase = await window.supabaseInitPromise;
        if (!supabase) return null;
        const { data: { user } } = await supabase.auth.getUser();
        return user;
    }

    const saveToAccountBtn = document.getElementById('save-to-account-btn');
    const loadDesignsBtn = document.getElementById('load-designs-btn');
    const savedDesignsSidebar = document.getElementById('saved-designs-sidebar');
    const closeSavedDesignsBtn = document.getElementById('close-saved-designs');
    const savedDesignsList = document.getElementById('saved-designs-list');

    if (saveToAccountBtn) {
        saveToAccountBtn.addEventListener('click', async () => {
            const user = await getActiveUser();
            const colorObj = NEON_COLORS.find(c => c.id === currentSign.colorId);
            const designData = {
                text: currentSign.text,
                fontName: currentSign.fontName,
                colorId: currentSign.colorId,
                colorName: colorObj ? colorObj.name : 'Custom',
                lineSpacing: currentSign.lineSpacing,
                targetWidthIn: currentSign.targetWidthIn,
                visualScale: currentSign.visualScale,
                environment: currentSign.environment,
                backingColor: currentSign.backingColor,
                backing: currentSign.backing,
                x: currentSign.x,
                y: currentSign.y
            };

            if (!user) {
                // Not logged in -> save pending sign to sessionStorage and redirect
                sessionStorage.setItem('pending_save_design', JSON.stringify(designData));
                showToast('🔑 Please sign in to save your design. Redirecting...', '#ff007f');
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 1500);
                return;
            }

            const originalText = saveToAccountBtn.innerHTML;
            saveToAccountBtn.disabled = true;
            saveToAccountBtn.innerHTML = '⏳ Saving...';

            try {
                const { data, error } = await window.supabase
                    .from('saved_designs')
                    .insert({
                        user_id: user.id,
                        name: `${currentSign.text.substring(0, 15) || 'Untitled'} Sign`,
                        design_data: designData
                    });

                if (error) throw error;

                showToast('✨ Design saved successfully to your account!', '#10b981');
                saveToAccountBtn.innerHTML = 'Saved! ✓';
                setTimeout(() => {
                    saveToAccountBtn.innerHTML = originalText;
                    saveToAccountBtn.disabled = false;
                }, 2000);
            } catch (err) {
                console.error('Error saving design:', err.message);
                showToast('❌ Failed to save design. Please try again.', '#ef4444');
                saveToAccountBtn.innerHTML = originalText;
                saveToAccountBtn.disabled = false;
            }
        });
    }

    if (loadDesignsBtn) {
        loadDesignsBtn.addEventListener('click', async () => {
            const user = await getActiveUser();
            if (!user) {
                showToast('🔑 Please sign in to view your saved designs.', '#ff007f');
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 1500);
                return;
            }

            savedDesignsSidebar.classList.add('open');
            await loadSavedDesignsList(user.id);
        });
    }

    if (closeSavedDesignsBtn) {
        closeSavedDesignsBtn.addEventListener('click', () => {
            savedDesignsSidebar.classList.remove('open');
        });
    }

    async function loadSavedDesignsList(userId) {
        savedDesignsList.innerHTML = '<div class="empty-cart-msg">⏳ Loading designs...</div>';
        
        try {
            const { data: designs, error } = await window.supabase
                .from('saved_designs')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (!designs || designs.length === 0) {
                savedDesignsList.innerHTML = '<div class="empty-cart-msg">No saved designs found</div>';
                return;
            }

            savedDesignsList.innerHTML = '';
            designs.forEach(async design => {
                const item = design.design_data;
                const card = document.createElement('div');
                card.className = 'cart-item';
                card.style.cssText = 'border-bottom:1px solid rgba(0,0,0,0.08); padding:15px; display:flex; gap:16px; position:relative; background:rgba(255,255,255,0.45); border-radius:12px; margin-bottom:12px;';
                
                card.innerHTML = `
                    <div class="cart-item-img" style="background:#050507; flex-shrink:0; width:80px; height:80px; display:flex; justify-content:center; align-items:center; border:1px solid rgba(0,0,0,0.08); border-radius:8px; overflow:hidden;">
                        <div class="preview-loading" style="font-size:0.65rem; color:rgba(255,255,255,0.35); font-weight:600; font-family:inherit;">⏳ Preview</div>
                    </div>
                    <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                        <div style="font-weight:700; color:var(--text-primary); font-size:0.95rem; line-height:1.2;">${item.text.replace(/\n/g, ' ')}</div>
                        <div style="font-size:0.75rem; color:var(--text-secondary); line-height:1.4;">
                            Font: ${item.fontName} • Color: ${item.colorName}<br>
                            Size: ${item.targetWidthIn}in • Backing: ${item.backing}<br>
                            Material: ${item.backingColor === 'black' ? 'Black Acrylic' : item.backingColor === 'white' ? 'White Acrylic' : 'Clear Glass'} • Use: ${item.environment === 'outdoor' ? 'Outdoor' : 'Indoor'}
                        </div>
                        <div style="display:flex; gap:10px; margin-top:4px;">
                            <button class="load-btn" data-id="${design.id}" style="flex:1.2; padding:8px 12px; background:linear-gradient(135deg,#ff007f,#00c6fb); color:white; border:none; border-radius:8px; font-weight:700; cursor:pointer; font-size:0.8rem;">Load</button>
                            <button class="delete-btn" data-id="${design.id}" style="flex:0.8; padding:8px 12px; background:rgba(239,68,68,0.08); color:#ef4444; border:1px solid rgba(239,68,68,0.15); border-radius:8px; font-weight:600; cursor:pointer; font-size:0.8rem;">Delete</button>
                        </div>
                    </div>
                `;

                // Load design event
                card.querySelector('.load-btn').addEventListener('click', () => {
                    applySavedDesign(item);
                    savedDesignsSidebar.classList.remove('open');
                    showToast('✨ Design loaded successfully!', '#10b981');
                });

                // Delete design event
                card.querySelector('.delete-btn').addEventListener('click', async () => {
                    if (confirm('Are you sure you want to delete this design?')) {
                        const { error: delErr } = await window.supabase
                            .from('saved_designs')
                            .delete()
                            .eq('id', design.id);
                        
                        if (!delErr) {
                            showToast('🗑️ Design deleted.');
                            loadSavedDesignsList(userId);
                        } else {
                            showToast('❌ Failed to delete design.');
                        }
                    }
                });

                savedDesignsList.appendChild(card);

                // Render dynamic SVG preview in the background
                try {
                    const font = await loadFont(item.fontName);
                    const mockSign = {
                        text: item.text,
                        fontName: item.fontName,
                        colorId: item.colorId,
                        scale: 0.35, // Scale down for thumbnail
                        lineSpacing: item.lineSpacing || 1.2,
                        x: 0,
                        y: 0,
                        targetWidthIn: item.targetWidthIn,
                        environment: item.environment,
                        backingColor: item.backingColor,
                        backing: item.backing
                    };
                    const result = buildSignSVG(mockSign, font, item.backing);
                    if (result && result.svg) {
                        const imgContainer = card.querySelector('.cart-item-img');
                        imgContainer.innerHTML = '';
                        result.svg.setAttribute('width', '100%');
                        result.svg.setAttribute('height', '100%');
                        result.svg.style.maxWidth = '90%';
                        result.svg.style.maxHeight = '90%';
                        result.svg.style.display = 'block';
                        result.svg.style.margin = 'auto';
                        imgContainer.appendChild(result.svg);
                    }
                } catch (previewErr) {
                    console.warn('Failed to render preview for saved design:', previewErr);
                }
            });

        } catch (err) {
            console.error('Error loading designs list:', err.message);
            savedDesignsList.innerHTML = '<div class="empty-cart-msg" style="color:#ef4444;">❌ Failed to load designs.</div>';
        }
    }

    function applySavedDesign(item) {
        // 1. Update state object
        currentSign.text = item.text || 'Good Vibes';
        currentSign.fontName = item.fontName || 'Meow Script';
        currentSign.colorId = item.colorId || 'ice-blue';
        currentSign.lineSpacing = item.lineSpacing || 1.2;
        currentSign.targetWidthIn = item.targetWidthIn || 24;
        currentSign.visualScale = item.visualScale || 1.0;
        currentSign.environment = item.environment || 'indoor';
        currentSign.backingColor = item.backingColor || 'acrylic';
        currentSign.backing = item.backing || 'cut-to-shape';
        currentSign.x = item.x || 0;
        currentSign.y = item.y || 0;

        currentBacking = currentSign.backing;
        currentBackingColor = currentSign.backingColor;

        // 2. Update DOM inputs
        textInput.value = currentSign.text;
        
        const lineSpacingSlider = document.getElementById('line-spacing-slider');
        const lineSpacingVal = document.getElementById('line-spacing-val');
        if (lineSpacingSlider) {
            lineSpacingSlider.value = currentSign.lineSpacing;
            if (lineSpacingVal) lineSpacingVal.textContent = `${currentSign.lineSpacing.toFixed(1)}x`;
        }

        if (inputWidthIn) inputWidthIn.value = currentSign.targetWidthIn;

        // 3. Highlight/select control items in UI
        // Fonts
        document.querySelectorAll('.font-item').forEach(card => {
            if (card.dataset.fontName === currentSign.fontName) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });

        // Colors
        document.querySelectorAll('.neon-color-button').forEach(btn => {
            if (btn.dataset.colorId === currentSign.colorId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Backings
        document.querySelectorAll('.bb-card').forEach(card => {
            if (card.dataset.backing === currentSign.backing) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });

        // Backing Colors
        document.querySelectorAll('.color-swatch').forEach(swatch => {
            if (swatch.dataset.bcolor === currentSign.backingColor) {
                swatch.classList.add('active');
            } else {
                swatch.classList.remove('active');
            }
        });

        // Environments
        document.querySelectorAll('.env-card').forEach(card => {
            if (card.dataset.env === currentSign.environment) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });

        // Sizes
        const customInputs = document.getElementById('custom-inputs-section');
        document.querySelectorAll('.size-card').forEach(card => {
            if (!card.dataset.custom && parseFloat(card.dataset.width) === currentSign.targetWidthIn) {
                card.classList.add('active');
                if (customInputs) customInputs.style.display = 'none';
            } else if (card.dataset.custom && ![12, 20, 28, 36, 40].includes(currentSign.targetWidthIn)) {
                card.classList.add('active');
                if (customInputs) customInputs.style.display = 'grid';
            } else {
                card.classList.remove('active');
            }
        });

        // 4. Trigger redraw
        syncTextToCanvas();
    }

    // Initial UI Sync
    updateCartUI();
});
