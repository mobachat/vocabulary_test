// ==========================================
// CONFIGURATION & STATE
// ==========================================
const CROSSWORD_CSV_URL = 'https://raw.githubusercontent.com/mobachat/vocabulary/main/big_dave.csv';

let crosswordData = [];
let crosswordGrid = [];
let placedCrosswordWords = [];
let activeCrosswordWord = null;

let historyArray = [];
let historyIndex = -1;
let activeDeck = [];
let currentDeckLabel = '';
let currentMode = 'normal';
let canAnswer = false;
let currentQuestionTarget = null;

// ========================================== 
// INITIALIZATION & UI 
// ========================================== 
window.onload = async function() {     
    if (typeof loadData === 'function') {
        await loadData();     
    }
    
    if (typeof buildDatasetMenu === 'function') {
        buildDatasetMenu(); 
    }

    initNavigation();
    initSearchControls();
    initCrosswordControls();
    
    // Support for the new Flashcard UI (if using the flip-card layout)
    const btnFlip = document.getElementById('btn-flip');
    if (btnFlip) {
        btnFlip.addEventListener('click', () => {
            const defDisplay = document.getElementById('definition-display');
            if (defDisplay) defDisplay.classList.toggle('hidden');
        });
    }
    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.addEventListener('click', goNext);
    
    const btnPrev = document.getElementById('btn-prev');
    if (btnPrev) btnPrev.addEventListener('click', goBack);
};

function initNavigation() {
    const tabs = ['flashcards', 'search', 'crossword'];
    
    tabs.forEach(tab => {
        const tabBtn = document.getElementById(`nav-${tab}`);
        if (tabBtn) {
            tabBtn.addEventListener('click', () => {
                // Update active button
                tabs.forEach(t => {
                    const btn = document.getElementById(`nav-${t}`);
                    const mode = document.getElementById(`mode-${t}`);
                    if (btn) btn.classList.remove('active');
                    if (mode) mode.classList.add('hidden');
                });
                
                // Set current active
                tabBtn.classList.add('active');
                const activeMode = document.getElementById(`mode-${tab}`);
                if (activeMode) activeMode.classList.remove('hidden');
            });
        }
    });

    const datasetSelector = document.getElementById('dataset-selector');
    if (datasetSelector) {
        datasetSelector.addEventListener('change', (e) => {
            if (typeof selectDataset === 'function') {
                selectDataset(e.target.value);
            }
        });
    }
}

function buildDatasetMenu() {     
    const loader = document.getElementById('loader');
    const entryScreen = document.getElementById('entry-screen');
    const dashboard = document.getElementById('dashboard');
    const mainUi = document.getElementById('main-ui');
    const btnReload = document.getElementById('btn-reload');
    let listContainer = document.getElementById('dataset-list');     
    
    if (loader) loader.style.display = 'none';     
    if (entryScreen) entryScreen.style.display = 'flex';     
    if (dashboard) dashboard.style.display = 'none';     
    if (mainUi) mainUi.style.display = 'none';     
    if (btnReload) btnReload.style.display = 'none';     
    
    if (listContainer && typeof DATASETS !== 'undefined') {
        listContainer.style.display = 'flex';      
        listContainer.innerHTML = '';     
        
        DATASETS.forEach(ds => {         
            let isCached = appData.caches && appData.caches[ds.id];         
            let progress = appData.progress[ds.id] || {};         
            let score = progress.score || 0;         
            let statusText = isCached ? `Score: ${score}` : "Requires Download";                  
            
            let btn = document.createElement('button');         
            btn.className = 'dataset-btn';         
            btn.innerHTML = `<span>${ds.name}</span> <span class="dataset-status">${statusText}</span>`;         
            btn.onclick = () => { selectDataset(ds.id); };         
            listContainer.appendChild(btn);     
        }); 
    }
}

function showEntryScreen() {     
    enforceFullscreen();     
    buildDatasetMenu(); 
}

function updateDashStats() {     
    if(!activeDatasetId || typeof appData === 'undefined') return;     
    let pData = appData.progress[activeDatasetId];     
    
    const dashScore = document.getElementById('dash-score');
    if(dashScore) dashScore.innerText = pData.score;     
    
    const score = document.getElementById('score');
    if(score) score.innerText = pData.score;     
    
    const streak = document.getElementById('streak');
    if(streak) streak.innerText = pData.streak;     
    
    const dashMastered = document.getElementById('dash-mastered');
    if(dashMastered) dashMastered.innerText = pData.mastered.length;     
    
    let mistakeBtn = document.getElementById('dash-review-mistakes');     
    if (mistakeBtn) {
        if (pData.mistakes && pData.mistakes.length > 0) {         
            document.getElementById('dash-mistake-count').innerText = pData.mistakes.length;         
            mistakeBtn.style.display = 'block';     
        } else {         
            mistakeBtn.style.display = 'none';     
        } 
    }
}

function renderDecks() {     
    var container = document.getElementById('deck-container');     
    if (!container || typeof appData === 'undefined') return;
    
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
    if (mode === 'memory' && typeof appData !== 'undefined') {         
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
    
    const dashboard = document.getElementById('dashboard');
    const mainUi = document.getElementById('main-ui');
    if (dashboard) dashboard.style.display = 'none';     
    if (mainUi) mainUi.style.display = 'flex';          
    
    generateQuestion(); 
}

function exitToDashboard() {     
    enforceFullscreen();     
    if (typeof appData === 'undefined') return;
    let pData = appData.progress[activeDatasetId];          
    
    if (currentMode === 'normal') {         
        if (canAnswer && currentQuestionTarget) activeDeck.push(currentQuestionTarget);         
        if (activeDeck.length === 0) delete pData.deckStates[currentDeckLabel];         
        else pData.deckStates[currentDeckLabel] = activeDeck.map(function(w){return w.word;});         
        if (typeof saveData === 'function') saveData();     
    }     
    
    const mainUi = document.getElementById('main-ui');
    const dashboard = document.getElementById('dashboard');
    if (mainUi) mainUi.style.display = 'none';     
    if (dashboard) dashboard.style.display = 'flex';     
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
    } else {
        generateQuestion(); 
    }
}

function goBack() {     
    enforceFullscreen();     
    if (historyIndex > 0) {         
        historyIndex--;         
        displayQuestion(historyArray[historyIndex]);     
    } 
}

function generateQuestion() {     
    if (!activeDeck || activeDeck.length === 0) {         
        exitToDashboard();         
        return;     
    }     
    canAnswer = false;      
    currentQuestionTarget = activeDeck.pop();           
    
    let qMode = 0;      
    let badgeText = "Definition";     
    
    if (typeof activeDatasetId !== 'undefined' && activeDatasetId === 'idioms') {         
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
    
    if (typeof master !== 'undefined') {
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
        if (typeof activeDatasetId !== 'undefined' && activeDatasetId === 'idioms') {             
            badge.style.display = 'inline-block';             
            badge.innerText = qObj.badgeText;         
        } else {             
            badge.style.display = 'none';         
        }     
    }     
    
    const wordDisplay = document.getElementById('word-display');
    if (wordDisplay) wordDisplay.innerText = qObj.displayPrompt;
    
    const wordDef = document.getElementById('word-def');
    if (wordDef) wordDef.innerText = qObj.target.def || '';
    
    const wordContext = document.getElementById('word-context');
    if (wordContext) wordContext.innerText = qObj.target.context || '';
    
    const defDisplay = document.getElementById('definition-display');
    if (defDisplay) defDisplay.classList.add('hidden');
    
    // ==========================================
    // DEVICE-NATIVE GOOGLE IMAGE SEARCH (API-LESS)
    // ==========================================
    var hintBox = document.getElementById('hint-box');
    
    if (hintBox) {
        hintBox.style.display = 'flex';
        hintBox.style.justifyContent = 'center';
        hintBox.style.alignItems = 'center';
        hintBox.style.border = 'none';
        hintBox.style.background = 'rgba(0,0,0,0.03)';
        hintBox.style.boxShadow = 'none';
        hintBox.style.cursor = 'pointer';
        
        hintBox.innerHTML = `<div style="padding: 15px; background: var(--primary); color: white; border-radius: 8px; font-weight: bold; text-align: center;">🔍 Search Google Images<br><small>for context</small></div>`;
        
        hintBox.onclick = function() {
            if (!canAnswer) return;
            // Provide context via the device's native browser opening a search tab
            let query = qObj.wordRef + " " + qObj.target.def.split(' ').slice(0, 3).join(' ');
            window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`, '_blank');
        };
    }
    
    // ==========================================     
    // OPTIONS & ANSWER HANDLING (If using Quiz UI)
    // ==========================================     
    var list = document.getElementById('options-list');     
    if (list) {
        list.innerHTML = '';           
        let pData = typeof appData !== 'undefined' ? appData.progress[activeDatasetId] : null;     
        
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
                    if (pData) {
                        pData.score += 10; pData.streak++;                 
                        if(!pData.mastered.includes(qObj.wordRef)) pData.mastered.push(qObj.wordRef);                                  
                        
                        var mIndex = pData.mistakes.indexOf(qObj.wordRef);                 
                        if(mIndex > -1) pData.mistakes.splice(mIndex, 1);                 
                        if (currentMode === 'normal') {                     
                            pData.deckStates[currentDeckLabel] = activeDeck.map(function(w){return w.word;});                 
                        }                 
                    }
                    setTimeout(goNext, 800);             
                } else {                 
                    b.classList.add('wrong');                 
                    if (pData) {
                        pData.streak = 0;                                  
                        if(!pData.mistakes.includes(qObj.wordRef)) pData.mistakes.push(qObj.wordRef);                 
                        var mIndex = pData.mastered.indexOf(qObj.wordRef);                 
                        if(mIndex > -1) pData.mastered.splice(mIndex, 1);                 
                        if (currentMode === 'normal') {                     
                            pData.deckStates[currentDeckLabel] = activeDeck.map(function(w){return w.word;});                 
                        }                 
                    }
                    var allBtns = document.querySelectorAll('.option-btn');                 
                    for(var j=0; j<allBtns.length; j++) {                     
                        if(allBtns[j].innerText === qObj.options.find(function(o){return o.isCorrect}).text) allBtns[j].classList.add('correct');                 
                    }             
                }             
                if (typeof saveData === 'function') saveData();          
            };         
            list.appendChild(b);     
        }); 
    }
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

// ==========================================
// DICTIONARY / SEARCH MODE
// ==========================================
function initSearchControls() {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    if (searchInput && searchResults) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            searchResults.innerHTML = '';
            
            if (query.length < 2 || typeof master === 'undefined') return;

            const results = master.filter(item => {
                const word = (item.word || item.answer || '').toLowerCase();
                const def = (item.def || item.definition || '').toLowerCase();
                return word.includes(query) || def.includes(query);
            }).slice(0, 50);

            results.forEach(item => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>${item.word || item.answer}</strong>: ${item.def || item.definition || ''}`;
                searchResults.appendChild(li);
            });
        });
    }
}

// ==========================================
// CROSSWORD PARSER & GENERATOR
// ==========================================
function parseCSV(text) {
    const lines = text.split('\n');
    const result = [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        let obj = {};
        let currentline = [];
        let inQuotes = false;
        let value = "";
        
        for (let char of lines[i]) {
            if (char === '"' && !inQuotes) {
                inQuotes = true;
            } else if (char === '"' && inQuotes) {
                inQuotes = false;
            } else if (char === ',' && !inQuotes) {
                currentline.push(value);
                value = "";
            } else {
                value += char;
            }
        }
        currentline.push(value);

        for (let j = 0; j < headers.length; j++) {
            if (currentline[j] !== undefined) {
                obj[headers[j]] = currentline[j].trim();
            }
        }
        result.push(obj);
    }
    return result;
}

function initCrosswordControls() {
    const loadBtn = document.getElementById('btn-load-crossword');
    if (loadBtn) {
        loadBtn.addEventListener('click', async () => {
            const statusEl = document.getElementById('crossword-status');
            statusEl.innerText = "Fetching dataset from GitHub...";
            
            try {
                const response = await fetch(CROSSWORD_CSV_URL);
                if (!response.ok) throw new Error("Network response was not ok");
                const csvText = await response.text();
                
                crosswordData = parseCSV(csvText).filter(item => item.answer && item.clue);
                
                statusEl.innerText = `Loaded ${crosswordData.length} clues. Generating grid...`;
                
                // Randomly select a subset to ensure speedy grid generation
                const shuffled = crosswordData.sort(() => 0.5 - Math.random());
                const selectedWords = shuffled.slice(0, 20);
                
                buildCrosswordGrid(selectedWords);
                statusEl.innerText = "Crossword Ready!";
                
            } catch (error) {
                console.error(error);
                statusEl.innerText = "Error loading crossword. Check URL and CORS.";
            }
        });
    }
}

function buildCrosswordGrid(wordsList) {
    // Sort words by length descending to start with longest words
    wordsList.sort((a, b) => b.answer.length - a.answer.length);
    
    const GRID_SIZE = 40; // Oversized working grid
    let grid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null));
    placedCrosswordWords = [];
    
    function placeWord(wordObj, r, c, isAcross) {
        const ans = wordObj.answer.toUpperCase();
        for (let i = 0; i < ans.length; i++) {
            if (isAcross) grid[r][c + i] = ans[i];
            else grid[r + i][c] = ans[i];
        }
        placedCrosswordWords.push({
            ...wordObj,
            row: r,
            col: c,
            isAcross: isAcross,
            number: placedCrosswordWords.length + 1
        });
    }

    function canPlaceWord(word, r, c, isAcross) {
        if (isAcross && c + word.length > GRID_SIZE) return false;
        if (!isAcross && r + word.length > GRID_SIZE) return false;

        let intersections = 0;
        
        for (let i = 0; i < word.length; i++) {
            let currR = isAcross ? r : r + i;
            let currC = isAcross ? c + i : c;
            let cell = grid[currR][currC];
            
            // Conflict
            if (cell !== null && cell !== word[i]) return false;
            
            // Intersection
            if (cell === word[i]) {
                intersections++;
            } else {
                // Check adjacent cells to prevent touching parallel words
                if (isAcross) {
                    if (currR > 0 && grid[currR - 1][currC] !== null) return false;
                    if (currR < GRID_SIZE - 1 && grid[currR + 1][currC] !== null) return false;
                } else {
                    if (currC > 0 && grid[currR][currC - 1] !== null) return false;
                    if (currC < GRID_SIZE - 1 && grid[currR][currC + 1] !== null) return false;
                }
            }
        }
        
        // Check cells immediately before and after the word to ensure separation
        if (isAcross) {
            if (c > 0 && grid[r][c - 1] !== null) return false;
            if (c + word.length < GRID_SIZE && grid[r][c + word.length] !== null) return false;
        } else {
            if (r > 0 && grid[r - 1][c] !== null) return false;
            if (r + word.length < GRID_SIZE && grid[r + word.length][c] !== null) return false;
        }

        return intersections > 0 || placedCrosswordWords.length === 0;
    }

    if (wordsList.length > 0) {
        placeWord(wordsList[0], Math.floor(GRID_SIZE/2), Math.floor(GRID_SIZE/2) - Math.floor(wordsList[0].answer.length/2), true);
    }

    for (let i = 1; i < wordsList.length; i++) {
        let wordObj = wordsList[i];
        let ans = wordObj.answer.toUpperCase();
        let placed = false;
        
        for (let p = 0; p < placedCrosswordWords.length && !placed; p++) {
            let pWord = placedCrosswordWords[p];
            let pAns = pWord.answer.toUpperCase();
            
            for (let j = 0; j < ans.length && !placed; j++) {
                for (let k = 0; k < pAns.length && !placed; k++) {
                    if (ans[j] === pAns[k]) {
                        // Attempt to intersect
                        let isAcross = !pWord.isAcross;
                        let startR = isAcross ? pWord.row + k : pWord.row - j;
                        let startC = isAcross ? pWord.col - j : pWord.col + k;
                        
                        if (startR >= 0 && startC >= 0 && canPlaceWord(ans, startR, startC, isAcross)) {
                            placeWord(wordObj, startR, startC, isAcross);
                            placed = true;
                        }
                    }
                }
            }
        }
    }

    let minR = GRID_SIZE, maxR = 0, minC = GRID_SIZE, maxC = 0;
    placedCrosswordWords.forEach(w => {
        minR = Math.min(minR, w.row);
        minC = Math.min(minC, w.col);
        maxR = Math.max(maxR, w.isAcross ? w.row : w.row + w.answer.length - 1);
        maxC = Math.max(maxC, w.isAcross ? w.col + w.answer.length - 1 : w.col);
    });
    
    minR = Math.max(0, minR - 1);
    maxR = Math.min(GRID_SIZE - 1, maxR + 1);
    minC = Math.max(0, minC - 1);
    maxC = Math.min(GRID_SIZE - 1, maxC + 1);

    const trimmedGrid = [];
    for (let r = minR; r <= maxR; r++) {
        trimmedGrid.push(grid[r].slice(minC, maxC + 1));
    }
    
    placedCrosswordWords.forEach(w => {
        w.row -= minR;
        w.col -= minC;
    });

    renderCrosswordDOM(trimmedGrid);
}

function renderCrosswordDOM(grid) {
    const container = document.getElementById('crossword-grid');
    if(!container) return;
    
    container.innerHTML = '';
    const table = document.createElement('table');
    
    for (let r = 0; r < grid.length; r++) {
        const tr = document.createElement('tr');
        for (let c = 0; c < grid[r].length; c++) {
            const td = document.createElement('td');
            
            if (grid[r][c] !== null) {
                td.classList.add('letter-cell');
                td.dataset.row = r;
                td.dataset.col = c;
                
                const input = document.createElement('input');
                input.type = 'text';
                input.maxLength = 1;
                input.dataset.answer = grid[r][c]; 
                
                let cellNumber = null;
                placedCrosswordWords.forEach(w => {
                    if (w.row === r && w.col === c) {
                        cellNumber = w.number;
                    }
                });
                
                if (cellNumber !== null) {
                    const span = document.createElement('span');
                    span.classList.add('cell-number');
                    span.innerText = cellNumber;
                    td.appendChild(span);
                }
                
                input.addEventListener('focus', () => handleCellFocus(r, c));
                input.addEventListener('input', (e) => handleCellInput(e, r, c));
                
                td.appendChild(input);
            } else {
                td.classList.add('empty');
            }
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
    container.appendChild(table);
    
    renderCluesList();
}

function renderCluesList() {
    const listAcross = document.getElementById('clues-across');
    const listDown = document.getElementById('clues-down');
    
    if (!listAcross || !listDown) return;
    
    listAcross.innerHTML = '';
    listDown.innerHTML = '';
    
    placedCrosswordWords.sort((a, b) => a.number - b.number);
    
    placedCrosswordWords.forEach(w => {
        const li = document.createElement('li');
        li.innerText = `${w.number}. ${w.clue}`;
        li.dataset.wordId = w.number;
        li.dataset.isAcross = w.isAcross;
        
        li.addEventListener('click', () => selectWord(w));
        
        if (w.isAcross) {
            listAcross.appendChild(li);
        } else {
            listDown.appendChild(li);
        }
    });
}

function handleCellFocus(r, c) {
    const intersectingWords = placedCrosswordWords.filter(w => {
        if (w.isAcross) {
            return w.row === r && c >= w.col && c < w.col + w.answer.length;
        } else {
            return w.col === c && r >= w.row && r < w.row + w.answer.length;
        }
    });
    
    if (intersectingWords.length > 0) {
        if (activeCrosswordWord && intersectingWords.includes(activeCrosswordWord) && intersectingWords.length > 1) {
            const nextWord = intersectingWords.find(w => w !== activeCrosswordWord);
            selectWord(nextWord);
        } else {
            selectWord(intersectingWords[0]);
        }
    }
}

function handleCellInput(e, r, c) {
    if (e.target.value !== '' && activeCrosswordWord) {
        let nextR = r;
        let nextC = c;
        
        if (activeCrosswordWord.isAcross) nextC++;
        else nextR++;
        
        const nextTd = document.querySelector(`td[data-row="${nextR}"][data-col="${nextC}"]`);
        if (nextTd) {
            const input = nextTd.querySelector('input');
            if (input) input.focus();
        }
    }
}

function selectWord(wordObj) {
    activeCrosswordWord = wordObj;
    
    // Highlight Clue List Item
    document.querySelectorAll('.clue-lists li').forEach(li => li.classList.remove('active-clue'));
    const clueItem = document.querySelector(`li[data-word-id="${wordObj.number}"][data-is-across="${wordObj.isAcross}"]`);
    if (clueItem) clueItem.classList.add('active-clue');
    
    // Highlight Grid
    document.querySelectorAll('#crossword-grid td').forEach(td => td.classList.remove('highlight-word'));
    
    for (let i = 0; i < wordObj.answer.length; i++) {
        let currR = wordObj.isAcross ? wordObj.row : wordObj.row + i;
        let currC = wordObj.isAcross ? wordObj.col + i : wordObj.col;
        
        const td = document.querySelector(`td[data-row="${currR}"][data-col="${currC}"]`);
        if (td) td.classList.add('highlight-word');
    }
    
    // Update Active Clue Display
    const clueText = document.getElementById('current-clue-text');
    if (clueText) {
        clueText.innerText = `${wordObj.number} ${wordObj.isAcross ? 'Across' : 'Down'}: ${wordObj.clue}`;
    }
    
    // ==========================================
    // API-LESS GOOGLE IMAGE SEARCH FOR CROSSWORD
    // ==========================================
    const imgElement = document.getElementById('current-clue-image');
    if (imgElement) {
        const parent = imgElement.parentElement;
        let searchBtn = document.getElementById('google-img-search-btn');
        
        if (!searchBtn) {
            searchBtn = document.createElement('div');
            searchBtn.id = 'google-img-search-btn';
            searchBtn.style.cssText = 'margin-top:15px; padding: 10px 15px; background: var(--primary); color: white; border-radius: 8px; font-weight: bold; text-align: center; cursor: pointer; display: inline-block; width: 100%;';
            parent.appendChild(searchBtn);
        }
        
        imgElement.style.display = 'none'; // Hide the raw image tag
        
        searchBtn.innerHTML = `🔍 Search Google Images<br><small>${wordObj.answer}</small>`;
        searchBtn.onclick = () => {
            const def = wordObj.definition || '';
            const query = `${wordObj.answer} ${wordObj.clue} ${def}`.substring(0, 150);
            window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`, '_blank');
        };
    }
}