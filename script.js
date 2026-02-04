// Configure PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Global state
let currentPDF = null;
let currentSettings = {
    length: 'medium',
    style: 'bullets',
    focus: 'overview'
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupUpload();
    setupControls();
});

// Setup upload functionality
function setupUpload() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');

    uploadZone.addEventListener('click', () => fileInput.click());

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === 'application/pdf') {
            processFile(files[0]);
        } else {
            showToast('Please upload a PDF file', 'error');
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            processFile(e.target.files[0]);
        }
    });
}

// Setup control buttons
function setupControls() {
    const controlBtns = document.querySelectorAll('.btn-control');
    controlBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const group = btn.closest('.control-group');
            group.querySelectorAll('.btn-control').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (btn.dataset.length) currentSettings.length = btn.dataset.length;
            if (btn.dataset.style) currentSettings.style = btn.dataset.style;
            if (btn.dataset.focus) currentSettings.focus = btn.dataset.focus;
        });
    });
}

// Process uploaded file
async function processFile(file) {
    if (file.size > 30 * 1024 * 1024) {
        showToast('File must be under 30MB', 'error');
        return;
    }

    showProgress(true);
    hideElement('demoSection');

    try {
        updateProgress(10, 'Loading PDF...');
        const arrayBuffer = await file.arrayBuffer();
        
        updateProgress(30, 'Extracting text...');
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;

        if (pdf.numPages > 100) {
            showToast('PDF must be under 100 pages', 'error');
            showProgress(false);
            return;
        }

        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            updateProgress(30 + (i / pdf.numPages) * 40, `Processing page ${i}/${pdf.numPages}...`);
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            pages.push({ pageNumber: i, text: pageText });
        }

        updateProgress(80, 'Preparing document...');
        
        currentPDF = {
            filename: file.name,
            pages: pdf.numPages,
            wordCount: pages.map(p => p.text).join(' ').split(/\s+/).length,
            pageData: pages
        };

        updateProgress(100, 'Complete!');
        
        setTimeout(() => {
            showProgress(false);
            showElement('controlsCard');
        }, 500);

    } catch (error) {
        console.error('Processing error:', error);
        showToast('Failed to process PDF. Make sure it\'s a valid text-based PDF.', 'error');
        showProgress(false);
    }
}

// Generate summary with current settings
async function generateSummary() {
    if (!currentPDF) return;

    showProgress(true);
    hideElement('controlsCard');

    try {
        updateProgress(20, 'Analyzing content...');
        
        const summary = createSummary(currentPDF.pageData, currentSettings);
        
        updateProgress(80, 'Formatting output...');
        
        displaySummary(summary);
        
        updateProgress(100, 'Done!');
        
        setTimeout(() => {
            showProgress(false);
            showElement('summaryCard');
        }, 500);

    } catch (error) {
        console.error('Summary error:', error);
        showToast('Failed to generate summary', 'error');
        showProgress(false);
    }
}

// Create summary based on settings
function createSummary(pages, settings) {
    let targetPoints;
    switch(settings.length) {
        case 'short': targetPoints = 7; break;
        case 'medium': targetPoints = 14; break;
        case 'detailed': targetPoints = 22; break;
    }

    const candidates = extractCandidates(pages, settings.focus);
    const selected = selectBestPoints(candidates, targetPoints, pages.length);
    
    return formatOutput(selected, settings.style);
}

// Extract candidate sentences
function extractCandidates(pages, focus) {
    const allCandidates = [];

    const focusKeywords = {
        overview: ['important', 'significant', 'key', 'main', 'primary', 'conclude', 'result', 'finding'],
        data: ['result', 'data', 'found', 'showed', 'demonstrated', 'percent', 'increase', 'decrease', 'significant'],
        methods: ['method', 'methodology', 'approach', 'procedure', 'technique', 'protocol', 'measured', 'analyzed']
    };

    const keywords = focusKeywords[focus] || focusKeywords.overview;

    pages.forEach((page, pageIdx) => {
        const sentences = page.text
            .replace(/\s+/g, ' ')
            .split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length >= 40 && s.split(' ').length >= 8 && s.split(' ').length <= 50);

        sentences.forEach((sentence, sentIdx) => {
            const score = scoreSentence(sentence, pageIdx, pages.length, keywords);
            
            if (score > 20) {
                allCandidates.push({
                    sentence: sentence,
                    score: score,
                    page: page.pageNumber,
                    position: sentIdx
                });
            }
        });
    });

    return allCandidates;
}

// Score sentence
function scoreSentence(sentence, pageIdx, totalPages, focusKeywords) {
    const lower = sentence.toLowerCase();
    let score = 0;

    // Focus keywords
    focusKeywords.forEach(keyword => {
        if (lower.includes(keyword)) score += 15;
    });

    // Numbers and data
    const numbers = sentence.match(/\d+([.,]\d+)?%?|\$[\d,]+/g) || [];
    score += numbers.length * 10;

    // Statistical significance
    if (lower.match(/p\s*[<>=]\s*0?\.\d+|significant/)) score += 12;

    // Proper nouns
    const properNouns = sentence.match(/\b[A-Z][a-z]+\b/g) || [];
    score += properNouns.length * 3;

    // Structure indicators
    if (sentence.match(/[:,;]/)) score += 5;
    
    // Position bonuses
    if (pageIdx === 0 || pageIdx === totalPages - 1) score *= 1.1;

    return score;
}

// Select best points ensuring page coverage
function selectBestPoints(candidates, targetPoints, totalPages) {
    candidates.sort((a, b) => b.score - a.score);

    const selected = [];
    const pagesUsed = new Set();

    // First pass: one per page
    for (const candidate of candidates) {
        if (!pagesUsed.has(candidate.page) && selected.length < totalPages) {
            if (!isDuplicate(candidate.sentence, selected)) {
                selected.push(candidate);
                pagesUsed.add(candidate.page);
            }
        }
    }

    // Second pass: fill remaining
    for (const candidate of candidates) {
        if (selected.length >= targetPoints) break;
        if (!selected.includes(candidate) && !isDuplicate(candidate.sentence, selected)) {
            selected.push(candidate);
        }
    }

    selected.sort((a, b) => a.page - b.page || a.position - b.position);
    return selected;
}

// Check for duplicates
function isDuplicate(sentence, existingList) {
    const words1 = new Set(sentence.toLowerCase().split(/\s+/));
    return existingList.some(item => {
        const words2 = new Set(item.sentence.toLowerCase().split(/\s+/));
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        return intersection.size / Math.max(words1.size, words2.size) > 0.7;
    });
}

// Format output based on style
function formatOutput(selected, style) {
    const points = selected.map(item => {
        let text = item.sentence.trim();
        if (!/[.!?]$/.test(text)) text += '.';
        
        // Highlight numbers
        text = text.replace(/(\d+([.,]\d+)?%?|\$[\d,]+)/g, '<span class="highlight">$1</span>');
        // Highlight p-values
        text = text.replace(/(p\s*[<>=]\s*0?\.\d+)/gi, '<span class="highlight">$1</span>');
        
        return { text, page: item.page };
    });

    switch(style) {
        case 'bullets':
            return formatBullets(points);
        case 'paragraphs':
            return formatParagraphs(points);
        case 'outline':
            return formatOutline(points, selected.length);
        default:
            return formatBullets(points);
    }
}

// Format as bullets
function formatBullets(points) {
    return points.map(p => 
        `<div class="summary-point">${p.text} <span class="page-ref">p.${p.page}</span></div>`
    ).join('');
}

// Format as paragraphs
function formatParagraphs(points) {
    const sections = groupByPage(points, 3);
    return sections.map((section, idx) => {
        const text = section.map(p => p.text.replace(/<[^>]*>/g, '')).join(' ');
        const pages = [...new Set(section.map(p => p.page))];
        return `<p><strong>Section ${idx + 1}:</strong> ${text} <span class="page-ref">p.${pages.join(',')}</span></p>`;
    }).join('');
}

// Format as outline
function formatOutline(points, total) {
    const sections = Math.ceil(total / 4);
    const perSection = Math.ceil(total / sections);
    let html = '';
    
    for (let i = 0; i < sections; i++) {
        const sectionPoints = points.slice(i * perSection, (i + 1) * perSection);
        html += `<h3>Part ${i + 1}</h3>`;
        html += formatBullets(sectionPoints);
    }
    
    return html;
}

// Group points by page proximity
function groupByPage(points, maxPerGroup) {
    const groups = [];
    let current = [];
    
    points.forEach((point, idx) => {
        current.push(point);
        if (current.length >= maxPerGroup || idx === points.length - 1) {
            groups.push([...current]);
            current = [];
        }
    });
    
    return groups;
}

// Display summary
function displaySummary(summaryHTML) {
    const docMeta = document.getElementById('docMeta');
    const summaryContent = document.getElementById('summaryContent');
    const pageReferences = document.getElementById('pageReferences');

    docMeta.innerHTML = `
        <div class="meta-item">📄 ${currentPDF.filename}</div>
        <div class="meta-item">📃 ${currentPDF.pages} pages</div>
        <div class="meta-item">📊 ${currentPDF.wordCount.toLocaleString()} words</div>
    `;

    summaryContent.innerHTML = summaryHTML;

    // Extract unique page numbers
    const pageMatches = summaryHTML.match(/p\.(\d+)/g) || [];
    const uniquePages = [...new Set(pageMatches.map(p => p.replace('p.', '')))].sort((a, b) => a - b);
    
    pageReferences.innerHTML = uniquePages.map(p => 
        `<span class="page-badge">Page ${p}</span>`
    ).join('');
}

// Copy summary
async function copySummary() {
    const content = document.getElementById('summaryContent');
    const text = content.innerText;
    
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!', 'success');
    } catch (error) {
        showToast('Failed to copy', 'error');
    }
}

// Download as TXT
function downloadTXT() {
    const content = document.getElementById('summaryContent');
    const text = content.innerText;
    
    const header = `SUMMARY: ${currentPDF.filename}\n${'='.repeat(60)}\nPages: ${currentPDF.pages} | Words: ${currentPDF.wordCount}\n\n`;
    const fullText = header + text;
    
    download(fullText, `${currentPDF.filename}_summary.txt`, 'text/plain');
    showToast('Downloaded TXT!', 'success');
}

// Download as DOCX
function downloadDOCX() {
    const content = document.getElementById('summaryContent');
    const text = content.innerText;
    
    const { Document, Paragraph, TextRun, HeadingLevel, Packer } = docx;
    
    const doc = new Document({
        sections: [{
            properties: {},
            children: [
                new Paragraph({
                    text: `Summary: ${currentPDF.filename}`,
                    heading: HeadingLevel.HEADING_1,
                }),
                new Paragraph({
                    text: `Pages: ${currentPDF.pages} | Words: ${currentPDF.wordCount}`,
                }),
                new Paragraph({ text: "" }),
                ...text.split('\n').filter(line => line.trim()).map(line => 
                    new Paragraph({ text: line })
                )
            ],
        }],
    });
    
    Packer.toBlob(doc).then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentPDF.filename}_summary.docx`;
        a.click();
        window.URL.revokeObjectURL(url);
        showToast('Downloaded DOCX!', 'success');
    });
}

// Helper download function
function download(content, filename, type) {
    const blob = new Blob([content], { type: type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
}

// Start over
function startOver() {
    currentPDF = null;
    hideElement('summaryCard');
    hideElement('controlsCard');
    showElement('demoSection');
    document.getElementById('fileInput').value = '';
}

// Load demo
function loadDemo() {
    showToast('Demo feature - Upload your own PDF to try!', 'success');
}

// Progress helpers
function showProgress(show) {
    const card = document.getElementById('processingCard');
    if (show) {
        card.classList.remove('hidden');
    } else {
        card.classList.add('hidden');
    }
}

function updateProgress(percent, status) {
    document.getElementById('progressFill').style.width = percent + '%';
    document.getElementById('progressPercent').textContent = Math.round(percent) + '%';
    document.getElementById('progressStatus').textContent = status;
}

// UI helpers
function showElement(id) {
    document.getElementById(id)?.classList.remove('hidden');
}

function hideElement(id) {
    document.getElementById(id)?.classList.add('hidden');
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
