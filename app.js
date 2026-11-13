// ==========================================
// IMAGE API CONFIGURATION & ENGINE (KEYLESS PWA)
// ==========================================
async function fetchContextualImage(wordRef, definition, isRegenerate = false, keyword = '') {
    // 1. Build a waterfall of search queries
    const cleanWords = definition.replace(/[^a-zA-Z\s]/g, '').split(' ').filter(w => w.length > 3);
    const brokenDef = cleanWords.slice(0, 2).join(' '); // Extracts up to 2 significant keywords
    
    // NEW: Put keyword first in the list so it is searched primarily if available
    let queries = [keyword, wordRef, brokenDef, definition].filter(q => q && q.trim().length > 0);
    
    // 2. Introduce randomness for the "Tap to Regenerate" feature
    if (isRegenerate) {
        queries = queries.sort(() => Math.random() - 0.5);
    }
    
    for (let query of queries) {
        let encoded = encodeURIComponent(query);
        try {
            let res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&titles=${encoded}&pithumbsize=400`);
            let data = await res.json();
            let pages = data.query.pages;
            let pageId = Object.keys(pages)[0];
            
            if (pageId !== "-1" && pages[pageId].thumbnail) {
                let imgUrl = pages[pageId].thumbnail.source;
                // VALIDATION: Reject Wikipedia's generic SVG icons, disambiguation graphics, UI placeholders, and Wikibooks logos
                let lowerUrl = imgUrl.toLowerCase();
                if (!lowerUrl.includes('.svg') && 
                    !lowerUrl.includes('ambox') && 
                    !lowerUrl.includes('wiktionary') && 
                    !lowerUrl.includes('disambig') &&
                    !lowerUrl.includes('wikibooks') && 
                    !lowerUrl.includes('wikiquote') && 
                    !lowerUrl.includes('commons-logo')) {
                    return imgUrl;
                }
            }
        } catch (e) {
             console.warn(`Wikimedia fetch failed for query: ${query}`, e);
        }
    }
    
    // Final Fallback: Picsum Word Seed (Always generates an abstract but consistent image)
    let safeWordSeed = isRegenerate
         ? wordRef.replace(/[^a-zA-Z0-9]/g, '') + Math.floor(Math.random() * 1000)
         : wordRef.replace(/[^a-zA-Z0-9]/g, '');
    return `https://picsum.photos/seed/${safeWordSeed}/320/240`;
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
        
        // Target specifically completed decks
        if (progressPct >= 100) {
            var restartBtn = document.createElement('button');
            restartBtn.innerText = 'Restart Deck';
            restartBtn.style.cssText = 'margin-top: 10px; padding: 6px 12px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; width: 100%; font-weight: bold; font-family: inherit;';
            restartBtn.onclick = function(e) {
                e.stopPropagation(); // Prevent launching the deck immediately
                
                // Clear out performance data for this specific word group
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
    
    // ==========================================
    // RENDER IMAGE (SMART KEYLESS FETCH ENGINE)
    // ==========================================
    var hintBox = document.getElementById('hint-box');
    var hintImg = document.getElementById('hint-img');
    
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
        if(document.querySelector('.spinner')) document.querySelector('.spinner').style.display = 'none';
        hintImg.src = tempImg.src;
        hintImg.style.display = 'block';
    };
    tempImg.onerror = function() {
        this.onerror = null;
        if(document.querySelector('.spinner')) document.querySelector('.spinner').style.display = 'none';
        hintImg.src = "https://placehold.co/320x240/18181b/f43f5e?text=Image+Unavailable";
        hintImg.style.display = 'block';
    };
    
    // Execute Data.js Custom Image Override OR run the Keyless Fetcher
    if (qObj.target.customImage) {
        tempImg.src = qObj.target.customImage;
    } else {
        // NEW: Passing qObj.target.keyword mapped from dataset to fetchContextualImage
        fetchContextualImage(qObj.wordRef, qObj.target.def, false, qObj.target.keyword).then(url => {
            tempImg.src = url;
        });
    }
    
    // TAP TO REGENERATE: Forces the API to shuffle the query array and pull a new result
    hintBox.onclick = function() {
        if (!canAnswer) return;
        hintImg.style.display = 'none';
        hintBox.innerHTML = `<div class="spinner" style="width: 30px; height: 30px; border-width: 3px; border-top-color: var(--primary);"></div><img id="hint-img" style="display:none; max-height:200px; max-width:100%; border-radius:15px; box-shadow:0 8px 25px rgba(0,0,0,0.15);">`;
        hintImg = document.getElementById('hint-img');
        
        let newTempImg = new Image();
        newTempImg.onload = function() {
            if(document.querySelector('.spinner')) document.querySelector('.spinner').style.display = 'none';
            hintImg.src = newTempImg.src;
            hintImg.style.display = 'block';
        };
        newTempImg.onerror = tempImg.onerror;
        
        if (qObj.target.customImage) {
            newTempImg.src = qObj.target.customImage;
        } else {
            // NEW: Passing qObj.target.keyword to fetchContextualImage
            fetchContextualImage(qObj.wordRef, qObj.target.def, true, qObj.target.keyword).then(url => {
                newTempImg.src = url;
            });
        }
    };
    
    // ==========================================
    // OPTIONS & ANSWER HANDLING
    // ==========================================
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