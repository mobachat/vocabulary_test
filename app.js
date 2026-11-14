// ==========================================
// PERSISTENT IMAGE CACHE & 5-WORD PREFETCH ENGINE
// ==========================================
const IMG_DB_NAME = 'GRE_Image_Cache_DB';
const IMG_STORE_NAME = 'keyword_images';
const memoryImageCache = new Map();
const inFlightImageFetches = new Map();
let imgDbPromise = null;

function openImageDB() {
    if (imgDbPromise) return imgDbPromise;
    imgDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(IMG_DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IMG_STORE_NAME)) {
                db.createObjectStore(IMG_STORE_NAME, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return imgDbPromise;
}

async function getCachedImages(cacheKey) {
    if (memoryImageCache.has(cacheKey)) {
        return memoryImageCache.get(cacheKey);
    }
    try {
        const db = await openImageDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(IMG_STORE_NAME, 'readonly');
            const req = tx.objectStore(IMG_STORE_NAME).get(cacheKey);
            req.onsuccess = () => {
                const record = req.result;
                if (record && Array.isArray(record.urls) && record.urls.length > 0) {
                    memoryImageCache.set(cacheKey, record.urls);
                    resolve(record.urls);
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

async function saveCachedImages(cacheKey, urls) {
    if (!urls || urls.length === 0) return;
    memoryImageCache.set(cacheKey, urls);
    try {
        const db = await openImageDB();
        await new Promise((resolve) => {
            const tx = db.transaction(IMG_STORE_NAME, 'readwrite');
            tx.objectStore(IMG_STORE_NAME).put({
                key: cacheKey,
                urls: urls,
                updatedAt: Date.now()
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch {
        // Ignore storage quota errors gracefully
    }
}

function preloadImageBinary(url) {
    if (!url) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
}

// ==========================================
// KEYLESS, CORS-ENABLED IMAGE SEARCH (NO PROXY, NO API KEY)
// ==========================================
async function searchWikimediaCommons(query) {
    const cleanQ = query.replace(/["']/g, '').trim();
    if (!cleanQ) return [];

    const endpoint =
        `https://commons.wikimedia.org/w/api.php` +
        `?action=query` +
        `&generator=search` +
        `&gsrsearch=${encodeURIComponent(cleanQ)}` +
        `&gsrnamespace=6` +
        `&gsrlimit=6` +
        `&prop=imageinfo` +
        `&iiprop=url|mime` +
        `&iiurlwidth=420` +
        `&format=json` +
        `&origin=*`;

    try {
        const res = await fetch(endpoint);
        if (!res.ok) return [];
        const data = await res.json();
        const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
        pages.sort((a, b) => (a.index || 0) - (b.index || 0));

        const blacklist = ['svg', 'icon', 'logo', 'ambox', 'wikibooks', 'wiktionary', 'disambig', 'flag_of', 'map_of'];
        const validUrls = [];

        for (const page of pages) {
            const info = page.imageinfo?.[0];
            if (!info?.thumburl) continue;
            const lower = info.thumburl.toLowerCase();
            if (info.mime && (info.mime.includes('pdf') || info.mime.includes('djvu'))) continue;
            if (blacklist.some(term => lower.includes(term))) continue;
            validUrls.push(info.thumburl);
        }
        return validUrls;
    } catch (e) {
        console.warn(`Wikimedia Commons search failed for: ${cleanQ}`, e);
        return [];
    }
}

async function searchWikipediaThumbnail(query) {
    const cleanQ = query.replace(/["']/g, '').trim();
    if (!cleanQ) return [];

    try {
        const res = await fetch(
            `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&titles=${encodeURIComponent(cleanQ)}&pithumbsize=420`
        );
        const data = await res.json();
        const pages = data?.query?.pages || {};
        const pageId = Object.keys(pages)[0];

        if (pageId && pageId !== "-1" && pages[pageId].thumbnail) {
            const imgUrl = pages[pageId].thumbnail.source;
            const lowerUrl = imgUrl.toLowerCase();
            const isBlacklisted = ['svg', 'ambox', 'wiktionary', 'disambig', 'wikibooks', 'wikiquote', 'commons-logo', 'book', 'dictionary', 'icon', 'logo', 'text'].some(term => lowerUrl.includes(term));
            if (!isBlacklisted) return [imgUrl];
        }
    } catch (e) {
        console.warn(`Wikipedia thumbnail fallback failed for: ${cleanQ}`, e);
    }
    return [];
}

/**
 * Resolves and caches a list of candidate URLs for a word/keyword pair.
 * Guaranteed to hit the network at most ONCE per unique keyword/word.
 */
async function resolveWordImagePool(wordObj) {
    if (!wordObj) return [];
    const wordRef = wordObj.word || '';
    const definition = wordObj.def || '';
    const keyword = wordObj.keyword || '';

    const primaryKey = (keyword || wordRef).toLowerCase().trim();
    if (!primaryKey) return [];

    // 1. Return immediately from memory or IndexedDB if already fetched
    const cached = await getCachedImages(primaryKey);
    if (cached && cached.length > 0) {
        return cached;
    }

    // 2. Deduplicate concurrent requests for the exact same keyword
    if (inFlightImageFetches.has(primaryKey)) {
        return inFlightImageFetches.get(primaryKey);
    }

    const fetchTask = (async () => {
        // Split comma-separated keywords (e.g. barron800 has "phrase 1, phrase 2")
        const keywordParts = keyword
            ? keyword.split(',').map(k => k.trim()).filter(k => k.length > 0)
            : [];

        const cleanWords = definition.replace(/[^a-zA-Z\s]/g, '').split(' ').filter(w => w.length > 3);
        const brokenDef = cleanWords.slice(0, 2).join(' ');

        // Priority waterfall: CSV keyword phrases -> exact word -> short definition
        const queries = [...new Set([...keywordParts, wordRef, brokenDef].filter(q => q && q.trim().length > 0))];

        let collectedUrls = [];

        // Engine 1: Keyless Wikimedia Commons Search (Fast, CORS-enabled, no proxy)
        for (const q of queries) {
            const results = await searchWikimediaCommons(q);
            if (results.length > 0) {
                collectedUrls.push(...results);
                break; // Stop once we have solid matches for the highest-priority query
            }
        }

        // Engine 2: Wikipedia PageImages Fallback
        if (collectedUrls.length === 0) {
            for (const q of queries) {
                const wikiResults = await searchWikipediaThumbnail(q);
                if (wikiResults.length > 0) {
                    collectedUrls.push(...wikiResults);
                    break;
                }
            }
        }

        // Engine 3: Deterministic Picsum Fallback (so cache is always populated & offline-safe)
        if (collectedUrls.length === 0) {
            const safeWordSeed = wordRef.replace(/[^a-zA-Z0-9]/g, '') || 'vocab';
            collectedUrls.push(`https://picsum.photos/seed/${safeWordSeed}/320/240`);
        }

        // Deduplicate URLs, save permanently to IndexedDB, and preload first image binary
        collectedUrls = [...new Set(collectedUrls)];
        await saveCachedImages(primaryKey, collectedUrls);
        preloadImageBinary(collectedUrls[0]);

        inFlightImageFetches.delete(primaryKey);
        return collectedUrls;
    })();

    inFlightImageFetches.set(primaryKey, fetchTask);
    return fetchTask;
}

async function fetchContextualImage(wordRef, definition, isRegenerate = false, keyword = '') {
    const urls = await resolveWordImagePool({ word: wordRef, def: definition, keyword: keyword });
    if (!urls || urls.length === 0) {
        const safeWordSeed = wordRef.replace(/[^a-zA-Z0-9]/g, '');
        return `https://picsum.photos/seed/${safeWordSeed}/320/240`;
    }

    if (isRegenerate) {
        if (urls.length > 1) {
            // Pick an alternate image from the already-cached pool without re-fetching
            const altIndex = 1 + Math.floor(Math.random() * (urls.length - 1));
            return urls[altIndex];
        }
        const safeWordSeed = wordRef.replace(/[^a-zA-Z0-9]/g, '') + Math.floor(Math.random() * 1000);
        return `https://picsum.photos/seed/${safeWordSeed}/320/240`;
    }

    return urls[0];
}

/**
 * Prefetches the next N words in activeDeck seamlessly.
 * Note: generateQuestion() uses activeDeck.pop(), so the next 5 words are at the end of activeDeck.
 */
function prefetchNextImages(count = 5) {
    if (!Array.isArray(activeDeck) || activeDeck.length === 0) return;
    const nextBatch = activeDeck.slice(-count).reverse();

    nextBatch.forEach(wordObj => {
        if (!wordObj || wordObj.customImage) return;
        resolveWordImagePool(wordObj).catch(() => {});
    });
}

// ==========================================
// INITIALIZATION & UI
// ==========================================
window.onload = async function() {
    await loadData();
    buildDatasetMenu();
};

function buildDatasetMenu() {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('entry-screen').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('main-ui').style.display = 'none';
    document.getElementById('btn-reload').style.display = 'none';
    
    let listContainer = document.getElementById('dataset-list');
    listContainer.style.display = 'flex';
    listContainer.innerHTML = '';
    
    DATASETS.forEach(ds => {
        let progress = appData.progress[ds.id] || {};
        let score = progress.score || 0;
        let statusText = `Score: ${score}`;
        
        let btn = document.createElement('button');
        btn.className = 'dataset-btn';
        btn.innerHTML = `<span>${ds.name}</span> <span class="dataset-status">${statusText}</span>`;
        btn.onclick = () => { selectDataset(ds.id); };
        listContainer.appendChild(btn);
    });
}

function showEntryScreen() {
    enforceFullscreen();
    buildDatasetMenu();
}

function updateDashStats() {
    if(!activeDatasetId) return;
    let pData = appData.progress[activeDatasetId];
    document.getElementById('dash-score').innerText = pData.score;
    document.getElementById('score').innerText = pData.score;
    document.getElementById('streak').innerText = pData.streak;
    document.getElementById('dash-mastered').innerText = pData.mastered.length;
    let mistakeBtn = document.getElementById('dash-review-mistakes');
    if (pData.mistakes && pData.mistakes.length > 0) {
        document.getElementById('dash-mistake-count').innerText = pData.mistakes.length;
        mistakeBtn.style.display = 'block';
    } else {
        mistakeBtn.style.display = 'none';
    }
}

function renderDecks() {
    var container = document.getElementById('deck-container');
    container.innerHTML = '';
    let pData = appData.progress[activeDatasetId];
    
    decks.forEach(function(d, index) {
        var masteredInDeck = d.words.filter(w => pData.mastered.includes(w.word)).length;
        var progressPct = Math.min(100, (masteredInDeck / d.words.length) * 100);
        
        var div = document.createElement('div');
        div.className = 'deck-card';
        div.innerHTML = `
            <div class="deck-letter">${d.label}</div>
            <div class="deck-info">${masteredInDeck} / ${d.words.length}</div>
            <div class="deck-progress-bar"><div class="deck-progress-fill" style="width: ${progressPct}%"></div></div>
        `;
        
        if (progressPct >= 100) {
            var restartBtn = document.createElement('button');
            restartBtn.innerText = 'Restart Deck';
            restartBtn.style.cssText = 'margin-top: 10px; padding: 6px 12px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; width: 100%; font-weight: bold; font-family: inherit;';
            restartBtn.onclick = function(e) {
                e.stopPropagation(); 
                
                d.words.forEach(w => {
                    pData.mastered = pData.mastered.filter(m => m !== w.word);
                    pData.mistakes = pData.mistakes.filter(m => m !== w.word);
                });
                delete pData.deckStates[d.label];
                
                saveData();
                renderDecks();
                updateDashStats();
            };
            div.appendChild(restartBtn);
        }
        div.onclick = function() { startDeck(index); };
        container.appendChild(div);
    });
}

// ==========================================
// THEME ENGINE
// ==========================================
const themes = ['', 'theme-light', 'theme-blue', 'theme-forest'];
let currentThemeIndex = 0;

function toggleTheme() {
    currentThemeIndex++;
    if (currentThemeIndex >= themes.length) currentThemeIndex = 0;
    
    document.body.className = '';
    if (themes[currentThemeIndex] !== '') {
        document.body.classList.add(themes[currentThemeIndex]);
    }
    enforceFullscreen();
}

// ==========================================
// FULLSCREEN CONTROLS
// ==========================================
function enforceFullscreen() {
    var doc = window.document;
    var docEl = doc.documentElement;
    var req = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
    let themeClass = themes[currentThemeIndex];
    
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
        if(req) {
            req.call(docEl).catch(err => {
                document.body.className = themeClass ? themeClass + ' pseudo-fullscreen' : 'pseudo-fullscreen';
            });
        } else {
            document.body.className = themeClass ? themeClass + ' pseudo-fullscreen' : 'pseudo-fullscreen';
        }
    } else {
        document.body.className = themeClass;
    }
}
document.body.addEventListener('touchstart', enforceFullscreen, { passive: true });
document.body.addEventListener('click', enforceFullscreen, { passive: true });

// ==========================================
// GAME NAVIGATION & DECK MANAGEMENT
// ==========================================
function enterApp(mode) {
    enforceFullscreen();
    if (mode === 'memory') {
        let pData = appData.progress[activeDatasetId];
        activeDeck = master.filter(function(w) { return pData.mistakes.includes(w.word); });
        currentMode = 'memory';
        document.getElementById('dashboard').style.display = 'none';
        document.getElementById('main-ui').style.display = 'flex';
        historyArray = []; historyIndex = -1;
        generateQuestion();
    }
}

function startDeck(index) {
    enforceFullscreen();
    let pData = appData.progress[activeDatasetId];
    currentDeckLabel = decks[index].label;
    currentMode = 'normal';
    historyArray = []; historyIndex = -1;
    
    if (pData.deckStates[currentDeckLabel] && pData.deckStates[currentDeckLabel].length > 0) {
        activeDeck = [];
        pData.deckStates[currentDeckLabel].forEach(function(wordStr) {
            var found = master.find(function(w) { return w.word === wordStr; });
            if (found) activeDeck.push(found);
        });
        if(activeDeck.length === 0) activeDeck = decks[index].words.slice().sort(function() { return Math.random() - 0.5; });
    } else {
        activeDeck = decks[index].words.slice();
        activeDeck.sort(function() { return Math.random() - 0.5; });
    }
    
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('main-ui').style.display = 'flex';
    generateQuestion();
}

function exitToDashboard() {
    enforceFullscreen();
    let pData = appData.progress[activeDatasetId];
    
    if (currentMode === 'normal') {
        if (canAnswer && currentQuestionTarget) activeDeck.push(currentQuestionTarget);
        if (activeDeck.length === 0) delete pData.deckStates[currentDeckLabel];
        else pData.deckStates[currentDeckLabel] = activeDeck.map(function(w){return w.word;});
        saveData();
    }
    
    document.getElementById('main-ui').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    renderDecks();
    updateDashStats();
}

// ==========================================
// QUIZ ENGINE
// ==========================================
function clean(text, wordToRemove, blankStyle = "...") {
    if (!text) return "No data.";
    var c = text.replace(/<[^>]*>?/gm, ' ');
    c = c.split(/(?:syn\.|ant\.)/i)[0];
    
    if (wordToRemove) {
        try {
            let safeWord = wordToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            c = c.replace(new RegExp(safeWord, 'gi'), blankStyle);
        } catch(e) {}
    }
    return c.replace(/\s+/g, ' ').trim().replace(/^[;,\-:\.]+|[;,\-:\.]+$/g, "");
}

function goNext() {
    enforceFullscreen();
    if (historyIndex < historyArray.length - 1) {
        historyIndex++;
        displayQuestion(historyArray[historyIndex]);
    } else generateQuestion();
}

function goBack() {
    enforceFullscreen();
    if (historyIndex > 0) {
        historyIndex--;
        displayQuestion(historyArray[historyIndex]);
    }
}

function generateQuestion() {
    if (activeDeck.length === 0) {
        exitToDashboard();
        return;
    }
    canAnswer = false;
    currentQuestionTarget = activeDeck.pop();

    // Immediately trigger background prefetch for the next 5 words in the deck
    prefetchNextImages(5);
    
    let qMode = 0;
    let badgeText = "Definition";
    if (activeDatasetId === 'idioms') {
        let r = Math.random();
        if (r < 0.33) { qMode = 1; badgeText = "Find the Idiom"; }
        else if (r < 0.66 && currentQuestionTarget.extra) { qMode = 2; badgeText = "Complete Context"; }
        else { qMode = 0; badgeText = "Meaning"; }
    }
    
    let displayPrompt = currentQuestionTarget.word;
    let targetOptionText = clean(currentQuestionTarget.def, currentQuestionTarget.word, "...");
    
    if (qMode === 1) {
        displayPrompt = clean(currentQuestionTarget.def, currentQuestionTarget.word, "____");
        targetOptionText = currentQuestionTarget.word;
    } else if (qMode === 2) {
        displayPrompt = `"${clean(currentQuestionTarget.extra, currentQuestionTarget.word, "____")}"`;
        targetOptionText = currentQuestionTarget.word;
    }
    
    var options = [{ text: targetOptionText, isCorrect: true }];
    let targetLen = targetOptionText.length;
    let distractorPool = [];
    
    for(let i=0; i<40; i++) {
        let rItem = master[Math.floor(Math.random() * master.length)];
        if (rItem.word !== currentQuestionTarget.word) {
            distractorPool.push(rItem);
        }
    }
    
    distractorPool.sort((a,b) => {
        let lenA = a.def ? a.def.length : 10;
        let lenB = b.def ? b.def.length : 10;
        return Math.abs(lenA - targetLen) - Math.abs(lenB - targetLen);
    });
    
    for(let i=0; i<distractorPool.length && options.length < 4; i++) {
        let dText = clean(distractorPool[i].def, distractorPool[i].word, "...");
        if (dText && dText.length > 1 && !options.find(o => o.text === dText)) {
            options.push({ text: dText, isCorrect: false });
        }
    }
    
    let attempts = 0;
    while(options.length < 4 && attempts < 100) {
        attempts++;
        let rItem = master[Math.floor(Math.random() * master.length)];
        let dText = clean(rItem.def, rItem.word, "...");
        if (dText && dText.length > 1 && !options.find(o => o.text === dText)) {
            options.push({ text: dText, isCorrect: false });
        }
    }
    
    while(options.length < 4) {
        options.push({ text: "None of the above", isCorrect: false });
    }
    options.sort(function() { return Math.random() - 0.5; });
    
    var questionObj = { 
        target: currentQuestionTarget, 
        wordRef: currentQuestionTarget.word,
        displayPrompt: displayPrompt, 
        badgeText: badgeText,
        options: options 
    };
    
    historyArray.push(questionObj);
    historyIndex++;
    displayQuestion(questionObj);
}

function displayQuestion(qObj) {
    canAnswer = true;
    enforceFullscreen();
    let badge = document.getElementById('question-type-badge');
    
    if (badge) {
        if (activeDatasetId === 'idioms') {
            badge.style.display = 'inline-block';
            badge.innerText = qObj.badgeText;
        } else {
            badge.style.display = 'none';
        }
    }
    document.getElementById('word-display').innerText = qObj.displayPrompt;
    
    var hintBox = document.getElementById('hint-box');
    var hintImg = document.getElementById('hint-img');
    
    // Track active word to prevent stale async image swaps if user swipes quickly
    hintBox.dataset.activeWord = qObj.wordRef;
    
    hintBox.style.display = 'flex';
    hintBox.style.justifyContent = 'center';
    hintBox.style.alignItems = 'center';
    hintBox.style.border = 'none';
    hintBox.style.background = 'rgba(0,0,0,0.03)';
    hintBox.style.boxShadow = 'none';
    hintImg.style.display = 'none';
    hintBox.innerHTML = `<div class="spinner" style="width: 30px; height: 30px; border-width: 3px; border-top-color: var(--primary);"></div><img id="hint-img" style="display:none; max-height:200px; max-width:100%; border-radius:15px; box-shadow:0 8px 25px rgba(0,0,0,0.15);">`;
    hintImg = document.getElementById('hint-img');
    
    var tempImg = new Image();
    tempImg.onload = function() {
        if (hintBox.dataset.activeWord !== qObj.wordRef) return;
        const sp = hintBox.querySelector('.spinner');
        if (sp) sp.style.display = 'none';
        hintImg.src = tempImg.src;
        hintImg.style.display = 'block';
    };
    tempImg.onerror = function() {
        if (hintBox.dataset.activeWord !== qObj.wordRef) return;
        this.onerror = null;
        const sp = hintBox.querySelector('.spinner');
        if (sp) sp.style.display = 'none';
        hintImg.src = "https://placehold.co/320x240/18181b/f43f5e?text=Image+Unavailable";
        hintImg.style.display = 'block';
    };
    
    if (qObj.target.customImage) {
        tempImg.src = qObj.target.customImage;
    } else {
        fetchContextualImage(qObj.wordRef, qObj.target.def, false, qObj.target.keyword).then(url => {
            if (hintBox.dataset.activeWord === qObj.wordRef) {
                tempImg.src = url;
            }
        });
    }
    
    hintBox.onclick = function() {
        if (!canAnswer) return;
        hintImg.style.display = 'none';
        hintBox.innerHTML = `<div class="spinner" style="width: 30px; height: 30px; border-width: 3px; border-top-color: var(--primary);"></div><img id="hint-img" style="display:none; max-height:200px; max-width:100%; border-radius:15px; box-shadow:0 8px 25px rgba(0,0,0,0.15);">`;
        hintImg = document.getElementById('hint-img');
        
        let newTempImg = new Image();
        newTempImg.onload = function() {
            if (hintBox.dataset.activeWord !== qObj.wordRef) return;
            const sp = hintBox.querySelector('.spinner');
            if (sp) sp.style.display = 'none';
            hintImg.src = newTempImg.src;
            hintImg.style.display = 'block';
        };
        newTempImg.onerror = tempImg.onerror;
        
        if (qObj.target.customImage) {
            newTempImg.src = qObj.target.customImage;
        } else {
            fetchContextualImage(qObj.wordRef, qObj.target.def, true, qObj.target.keyword).then(url => {
                if (hintBox.dataset.activeWord === qObj.wordRef) {
                    newTempImg.src = url;
                }
            });
        }
    };
    
    var list = document.getElementById('options-list');
    list.innerHTML = '';
    let pData = appData.progress[activeDatasetId];
    
    qObj.options.forEach(function(opt) {
        var b = document.createElement('button');
        b.className = 'option-btn';
        b.innerText = opt.text;
        
        b.onclick = function() {
            enforceFullscreen();
            if(!canAnswer) return;
            canAnswer = false;
            
            if(opt.isCorrect) {
                b.classList.add('correct');
                pData.score += 10; pData.streak++;
                if(!pData.mastered.includes(qObj.wordRef)) pData.mastered.push(qObj.wordRef);
                
                var mIndex = pData.mistakes.indexOf(qObj.wordRef);
                if(mIndex > -1) pData.mistakes.splice(mIndex, 1);
                
                if (currentMode === 'normal') {
                    pData.deckStates[currentDeckLabel] = activeDeck.map(function(w){return w.word;});
                }
                setTimeout(goNext, 800);
            } else {
                b.classList.add('wrong');
                pData.streak = 0;
                
                if(!pData.mistakes.includes(qObj.wordRef)) pData.mistakes.push(qObj.wordRef);
                
                var mIndex = pData.mastered.indexOf(qObj.wordRef);
                if(mIndex > -1) pData.mastered.splice(mIndex, 1);
                
                if (currentMode === 'normal') {
                    pData.deckStates[currentDeckLabel] = activeDeck.map(function(w){return w.word;});
                }
                var allBtns = document.querySelectorAll('.option-btn');
                for(var j=0; j<allBtns.length; j++) {
                    if(allBtns[j].innerText === qObj.options.find(function(o){return o.isCorrect}).text) allBtns[j].classList.add('correct');
                }
            }
            saveData();
        };
        list.appendChild(b);
    });
}

// ==========================================
// SWIPE GESTURES
// ==========================================
var touchstartX = 0, touchendX = 0;
var touchSurface = document.getElementById('touch-surface');
if (touchSurface) {
    touchSurface.addEventListener('touchstart', function(e) { touchstartX = e.changedTouches[0].screenX; }, {passive: true});
    touchSurface.addEventListener('touchend', function(e) {
        touchendX = e.changedTouches[0].screenX;
        if ((touchstartX - touchendX) > 50) goNext();
        if ((touchstartX - touchendX) < -50) goBack();
    }, {passive: true});
}