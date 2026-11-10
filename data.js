// ========================================== 
// CONFIGURATION: YOUR DATASETS 
// ========================================== 
const DATASETS = [     
    { id: 'barron800', name: 'Barron\'s 800', file: 'barron800.csv' },     
    { id: 'barron1500', name: 'Barron\'s 1500', file: 'barron1500.csv' },     
    { id: 'gre3000', name: 'GRE 3000', file: 'gre3000.csv' },     
    { id: 'verbal418', name: 'Verbal Builder 418', file: 'The Ultimate Verbal and Vocabulary Builder 418.csv' },     
    { id: 'idioms', name: 'Master Idioms', file: 'Master_Idioms_Database.csv' } 
];

// ========================================== 
// GLOBAL STATE VARIABLES 
// ========================================== 
const DB_NAME = 'GRE_Elite_Database'; 
const DB_VERSION = 1; 
let dbInstance = null; 
let activeDatasetId = null;  
let appData = { progress: {}, caches: {} }; 
var master = [], decks = [], activeDeck = []; 
var historyArray = [], historyIndex = -1; 
var currentMode = 'normal';  
var canAnswer = true; 
var currentDeckLabel = ""; 
var currentQuestionTarget = null;  

// ========================================== 
// INDEXED-DB PERSISTENCE ENGINE 
// ========================================== 
function initDB() {     
    return new Promise((resolve, reject) => {         
        if (dbInstance) return resolve(dbInstance);         
        let request = indexedDB.open(DB_NAME, DB_VERSION);         
        request.onupgradeneeded = (e) => {             
            let db = e.target.result;             
            if (!db.objectStoreNames.contains('app_storage')) db.createObjectStore('app_storage');         
        };         
        request.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };         
        request.onerror = (e) => reject(e);     
    }); 
}

async function loadData() {     
    try {         
        let db = await initDB();         
        let tx = db.transaction('app_storage', 'readonly');         
        let request = tx.objectStore('app_storage').get('master_save');                  
        
        request.onsuccess = () => {             
            if (request.result) {                 
                appData = request.result;                 
                if (!appData.progress) appData.progress = {};                 
                if (!appData.caches) appData.caches = {};             
            }         
        };     
    } catch (e) { console.error("IDB Load Error:", e); } 
}

async function saveData() {     
    try {         
        let db = await initDB();         
        let tx = db.transaction('app_storage', 'readwrite');         
        tx.objectStore('app_storage').put(appData, 'master_save');         
        if (typeof updateDashStats === "function") updateDashStats();     
    } catch (e) { console.error("IDB Save Error:", e); } 
}

function exportData() {     
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData));     
    var dlAnchorElem = document.createElement('a');     
    dlAnchorElem.setAttribute("href", dataStr);     
    dlAnchorElem.setAttribute("download", "GRE_Master_Backup.json");     
    dlAnchorElem.click(); 
}

function importData(event) {     
    var file = event.target.files[0];     
    if (!file) return;     
    var reader = new FileReader();     
    reader.onload = async function(e) {         
        try {             
            var imported = JSON.parse(e.target.result);             
            if (imported.progress) {                 
                appData = imported;                 
                await saveData();                 
                alert("Backup Successfully Restored!");                 
                window.location.reload();             
            } else throw new Error("Invalid Format");         
        } catch(err) { alert("Invalid save file."); }     
    };     
    reader.readAsText(file); 
}

// ========================================== 
// DATASET DOWNLOADING & PARSING 
// ========================================== 
function selectDataset(id) {     
    enforceFullscreen();     
    activeDatasetId = id;          
    
    if (!appData.progress[activeDatasetId]) {         
        appData.progress[activeDatasetId] = { score: 0, streak: 0, mistakes: [], mastered: [], deckStates: {} };         
        saveData();     
    }     
    
    document.getElementById('dataset-list').style.display = 'none';     
    document.getElementById('btn-reload').style.display = 'inline-block';     
    
    if (appData.caches[activeDatasetId]) {         
        parseAndChunk(appData.caches[activeDatasetId]);         
        document.getElementById('dashboard').style.display = 'flex';         
        document.getElementById('entry-screen').style.display = 'none';     
    } else {         
        forceRefreshLibrary();      
    } 
}

function forceRefreshLibrary() {     
    if(!activeDatasetId) return;     
    let dsInfo = DATASETS.find(d => d.id === activeDatasetId);          
    
    document.getElementById('entry-screen').style.display = 'none';     
    document.getElementById('loader').style.display = 'flex';     
    document.getElementById('loader-text').innerText = `DOWNLOADING ${dsInfo.name.toUpperCase()}...`;     
    
    fetch(dsInfo.file)         
        .then(response => {             
            if (!response.ok) throw new Error("File not found on server.");             
            return response.text();         
        })         
        .then(text => {             
            appData.caches[activeDatasetId] = text;             
            saveData();             
            parseAndChunk(text);             
            document.getElementById('loader').style.display = 'none';             
            document.getElementById('dashboard').style.display = 'flex';         
        })         
        .catch(err => {             
            document.getElementById('spinner-icon').style.display = 'none';             
            document.getElementById('loader-text').innerHTML = `<span style='color: var(--error);'>ERROR: ${err.message}. Ensure '${dsInfo.file}' is uploaded exactly as named.</span><br><br><button class="btn-data" onclick="buildDatasetMenu()">Return</button>`;         
        }); 
}

function parseAndChunk(raw) {     
    master = [];      
    let rows = [];     
    let row = [];     
    let current = '';     
    let inQuotes = false;          
    
    let delimiter = raw.indexOf('\t') !== -1 ? '\t' : ',';          
    
    for (let i = 0; i < raw.length; i++) {         
        let char = raw[i];         
        if (inQuotes) {             
            if (char === '"') {                 
                if (i + 1 < raw.length && raw[i + 1] === '"') { current += '"'; i++; }                  
                else { inQuotes = false; }             
            } else { current += char; }         
        } else {             
            if (char === '"') { inQuotes = true; }              
            else if (char === delimiter) { row.push(current.trim()); current = ''; }              
            else if (char === '\n' || char === '\r') {                 
                row.push(current.trim());                 
                if (row.length > 0 && row[0] !== '') rows.push(row);                 
                row = []; current = '';                 
                if (char === '\r' && i + 1 < raw.length && raw[i + 1] === '\n') i++;              
            } else { current += char; }         
        }     
    }     
    
    if (current !== '' || row.length > 0) {         
        row.push(current.trim());         
        if (row.length > 0 && row[0] !== '') rows.push(row);     
    }     
    
    for (let i = 0; i < rows.length; i++) {          
        let word = rows[i][0]; 
        let def = rows[i][1]; 
        let extraData = rows[i][2] || '';
        
        let extra = '';
        let customImage = null;
                 
        if(word && def) { 
            word = word.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').replace(/^"|"$/g, '').trim(); 
            def = def.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').replace(/^"|"$/g, '').trim(); 
            extraData = extraData.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').replace(/^"|"$/g, '').trim(); 
            
            // Detect URLs to safely separate custom images from standard textual contexts
            if (extraData.startsWith('http') || extraData.startsWith('data:image')) {
                customImage = extraData;
            } else {
                extra = extraData;
            }

            if (word.length > 1 && def.length > 1 && word.toLowerCase() !== "word" && word.toLowerCase() !== "idiom") { 
                master.push({ 
                    word: word, 
                    def: def, 
                    extra: extra, 
                    customImage: customImage 
                }); 
            } 
        } 
    }     
    
    let dsInfo = DATASETS.find(d => d.id === activeDatasetId);     
    document.getElementById('dash-dataset-name').innerText = dsInfo.name.toUpperCase();     
    document.getElementById('dash-total').innerText = master.length;     
    master.sort(function(a, b) { return a.word.localeCompare(b.word); });     
    
    var minSize = Math.max(10, Math.ceil(master.length * 0.005));      
    var targetMax = Math.max(60, minSize * 2);      
    
    var letterGroups = {};     
    master.forEach(function(item) {         
        var letter = item.word.charAt(0).toUpperCase();         
        if (!letter.match(/[A-Z]/)) letter = '#';         
        if (!letterGroups[letter]) letterGroups[letter] = [];         
        letterGroups[letter].push(item);     
    });     
    
    decks = [];     
    Object.keys(letterGroups).sort().forEach(function(l) {         
        var wordsInLetter = letterGroups[l];         
        if (wordsInLetter.length <= targetMax) {             
            var startWord = wordsInLetter[0].word.substring(0,3);             
            var endWord = wordsInLetter[wordsInLetter.length-1].word.substring(0,3);             
            decks.push({ label: `${startWord} - ${endWord}`, words: wordsInLetter });         
        } else {             
            var numChunks = Math.ceil(wordsInLetter.length / targetMax);             
            var exactSize = Math.ceil(wordsInLetter.length / numChunks);             
            for (var i = 0; i < numChunks; i++) {                 
                var chunk = wordsInLetter.slice(i * exactSize, (i + 1) * exactSize);                 
                if (chunk.length > 0) {                     
                    var startWord = chunk[0].word.substring(0,3);                     
                    var endWord = chunk[chunk.length-1].word.substring(0,3);                     
                    decks.push({ label: `${startWord} - ${endWord}`, words: chunk });                 
                }             
            }         
        }     
    });     
    
    updateDashStats();     
    renderDecks(); 
}