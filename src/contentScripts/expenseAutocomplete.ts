/**
 * CodeMirror content script for expense category autocomplete
 * Provides autocomplete suggestions for expense categories in markdown tables
 */

// HTML escape utility for content script security
function escapeHtml(str: string): string {
    if (typeof str !== 'string') {
        return String(str);
    }
    
    return str.replace(/[&<>"']/g, (match) => {
        const escapeMap: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return escapeMap[match] || match;
    });
}

// Sanitize category name for security
function sanitizeCategory(category: string): string {
    if (typeof category !== 'string') {
        return '';
    }
    
    // Remove potentially dangerous content and limit length
    return category
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/[<>"'&]/g, '') // Remove dangerous characters
        .trim()
        .substring(0, 50); // Limit length
}

console.log('[ExpenseAutocomplete] Content script loaded');

// Global variable to store the autocomplete keybind
let autocompleteKeybind = 'Ctrl+Enter'; // Default value

module.exports = {
    default: function(context: any) {
        console.log('[ExpenseAutocomplete] Content script default function called with context:', context);
        
        // Fetch the autocomplete keybind setting with proper error handling
        if (context && context.postMessage) {
            try {
                console.log('[ExpenseAutocomplete] Fetching autocomplete keybind setting...');
                const keybindPromise = context.postMessage('getAutocompleteKeybind');
                if (keybindPromise && typeof keybindPromise.then === 'function') {
                    keybindPromise.then((keybind: string) => {
                        if (keybind) {
                            autocompleteKeybind = keybind;
                            console.log('[ExpenseAutocomplete] Successfully loaded autocomplete keybind:', keybind);
                        } else {
                            console.warn('[ExpenseAutocomplete] Received empty keybind, using default:', autocompleteKeybind);
                        }
                    }).catch((error: any) => {
                        console.warn('[ExpenseAutocomplete] Failed to load keybind setting:', error);
                        console.log('[ExpenseAutocomplete] Using default keybind:', autocompleteKeybind);
                    });
                } else {
                    console.warn('[ExpenseAutocomplete] postMessage did not return a promise, using default keybind:', autocompleteKeybind);
                }
            } catch (error) {
                console.warn('[ExpenseAutocomplete] Error calling postMessage for keybind:', error);
                console.log('[ExpenseAutocomplete] Using default keybind:', autocompleteKeybind);
            }
        } else {
            console.warn('[ExpenseAutocomplete] Context or postMessage not available, using default keybind:', autocompleteKeybind);
        }
        
        return {
            plugin: function(cm: any) {
                console.log('[ExpenseAutocomplete] Plugin function called with CodeMirror instance:', cm);
                
                // Register autocomplete for expense categories
                function expenseAutocomplete(cm: any, options: any, callback: any) {
                    console.log('[ExpenseAutocomplete] Starting autocomplete...');
                    
                    // Check if required CodeMirror methods are available
                    if (!cm.getCursor || !cm.getLine) {
                        console.error('[ExpenseAutocomplete] Required CodeMirror methods not available');
                        callback(null);
                        return;
                    }
                    
                    const cursor = cm.getCursor();
                    const line = cm.getLine(cursor.line);
                    
                    console.log('[ExpenseAutocomplete] Cursor position:', cursor);
                    console.log('[ExpenseAutocomplete] Current line:', line);
                    
                    // Check if we're in an expense table by looking for the header pattern
                    const isInExpenseTable = isInExpenseTableContext(cm, cursor.line);
                    console.log('[ExpenseAutocomplete] Is in expense table:', isInExpenseTable);
                    if (!isInExpenseTable) {
                        console.log('[ExpenseAutocomplete] Not in expense table, aborting');
                        callback(null);
                        return;
                    }
                    
                    // Get current word/token (simplified approach without getTokenAt)
                    const currentWord = getCurrentWord(cm, cursor);
                    console.log('[ExpenseAutocomplete] Current word:', currentWord);
                    // Note: Skipping getTokenAt since it's not available in Joplin's CodeMirror
                    
                    // Check if we're in the category column
                    const columnIndex = getCategoryColumnIndex(line, cursor.ch);
                    console.log('[ExpenseAutocomplete] Column index:', columnIndex, '(should be 2 for category)');
                    if (columnIndex !== 2) { // Category is the 3rd column (0-indexed = 2)
                        console.log('[ExpenseAutocomplete] Not in category column, aborting');
                        callback(null);
                        return;
                    }
                    
                    // Get categories from plugin settings
                    console.log('[ExpenseAutocomplete] Requesting categories from plugin...');
                    
                    // Defensive check for context and postMessage
                    if (!context || !context.postMessage) {
                        console.error('[ExpenseAutocomplete] Context or postMessage not available');
                        callback(null);
                        return;
                    }
                    
                    try {
                        const categoriesPromise = context.postMessage('getCategories');
                        if (!categoriesPromise || typeof categoriesPromise.then !== 'function') {
                            console.error('[ExpenseAutocomplete] postMessage did not return a promise');
                            callback(null);
                            return;
                        }
                        
                        categoriesPromise.then((categories: string[]) => {
                            console.log('[ExpenseAutocomplete] Received categories:', categories);
                            if (!categories || !Array.isArray(categories)) {
                                console.log('[ExpenseAutocomplete] Invalid categories response, aborting');
                                callback(null);
                                return;
                            }
                        
                        // Sanitize and filter categories based on current input
                        const sanitizedCategories = categories
                            .map(cat => sanitizeCategory(cat))
                            .filter(cat => cat.length > 0);
                            
                        const suggestions = sanitizedCategories
                            .filter((cat: string) => 
                                cat.toLowerCase().startsWith(currentWord.toLowerCase())
                            )
                            .map((cat: string) => ({
                                text: cat,
                                displayText: cat,
                                className: 'expense-category-hint'
                            }));
                        
                        console.log('[ExpenseAutocomplete] Generated suggestions:', suggestions);
                        
                        if (suggestions.length === 0) {
                            console.log('[ExpenseAutocomplete] No matching suggestions, aborting');
                            callback(null);
                            return;
                        }
                        
                        const result = {
                            list: suggestions,
                            from: {line: cursor.line, ch: cursor.ch - currentWord.length},
                            to: cursor
                        };
                        console.log('[ExpenseAutocomplete] Returning autocomplete result:', result);
                        callback(result);
                        }).catch((error: any) => {
                            console.error('[ExpenseAutocomplete] Failed to get categories for autocomplete:', error);
                            callback(null);
                        });
                    } catch (error) {
                        console.error('[ExpenseAutocomplete] Error in categories request:', error);
                        callback(null);
                    }
                }
                
                // Helper function to check if cursor is in expense table context
                function isInExpenseTableContext(cm: any, lineNum: number): boolean {
                    console.log('[ExpenseAutocomplete] Checking table context for line', lineNum);
                    // Look for expense table header within a reasonable range
                    const searchRange = Math.min(10, lineNum);
                    for (let i = Math.max(0, lineNum - searchRange); i <= lineNum; i++) {
                        const line = cm.getLine(i);
                        console.log(`[ExpenseAutocomplete] Checking line ${i}:`, line);
                        if (line && line.includes('| price | description | category |')) {
                            console.log('[ExpenseAutocomplete] Found expense table header at line', i);
                            return true;
                        }
                    }
                    console.log('[ExpenseAutocomplete] No expense table header found');
                    return false;
                }
                
                // Helper function to get current word being typed
                function getCurrentWord(cm: any, cursor: any): string {
                    const line = cm.getLine(cursor.line);
                    let start = cursor.ch;
                    let end = cursor.ch;
                    
                    // Find word boundaries within the table cell
                    while (start > 0 && line[start - 1] !== '|' && /\S/.test(line[start - 1])) {
                        start--;
                    }
                    while (end < line.length && line[end] !== '|' && /\S/.test(line[end])) {
                        end++;
                    }
                    
                    const word = line.slice(start, end).trim();
                    console.log('[ExpenseAutocomplete] getCurrentWord - line:', line, 'start:', start, 'end:', end, 'word:', word);
                    return word;
                }
                
                // Helper function to determine which column the cursor is in
                function getCategoryColumnIndex(line: string, cursorCh: number): number {
                    let columnIndex = 0;
                    let inCell = false;
                    
                    for (let i = 0; i < cursorCh && i < line.length; i++) {
                        if (line[i] === '|') {
                            if (inCell) {
                                columnIndex++;
                            }
                            inCell = true;
                        }
                    }
                    
                    console.log('[ExpenseAutocomplete] getCategoryColumnIndex - line:', line, 'cursorCh:', cursorCh, 'columnIndex:', columnIndex);
                    return columnIndex;
                }
                
                // Register the autocomplete functionality
                console.log('[ExpenseAutocomplete] Setting up keyboard event handlers...');
                
                // Enable autocomplete on typing
                cm.on('inputRead', function(cm: any, changeObj: any) {
                    try {
                        console.log('[ExpenseAutocomplete] inputRead event triggered:', changeObj);
                        if (changeObj.text.length === 1 && /[a-zA-Z]/.test(changeObj.text[0])) {
                            console.log('[ExpenseAutocomplete] Text input detected:', changeObj.text[0]);
                            
                            // Check if required methods are available
                            if (!cm.getCursor || !cm.getLine) {
                                console.error('[ExpenseAutocomplete] Required CodeMirror methods not available in input handler');
                                return;
                            }
                            
                            const cursor = cm.getCursor();
                            const line = cm.getLine(cursor.line);
                            
                            console.log('[ExpenseAutocomplete] Input check - cursor:', cursor, 'line:', line);
                            
                            // Check if we're in an expense table and category column
                            if (isInExpenseTableContext(cm, cursor.line)) {
                                console.log('[ExpenseAutocomplete] In expense table context');
                                const columnIndex = getCategoryColumnIndex(line, cursor.ch);
                                console.log('[ExpenseAutocomplete] Column index from input event:', columnIndex);
                                if (columnIndex === 2) { // Category column
                                    console.log('[ExpenseAutocomplete] Triggering autocomplete hint...');
                                    
                                    // Trigger autocomplete using CodeMirror's showHint
                                    if (cm.showHint) {
                                        cm.showHint({
                                            hint: expenseAutocomplete,
                                            completeSingle: false,
                                            closeOnUnfocus: true
                                        });
                                    } else {
                                        console.log('[ExpenseAutocomplete] showHint not available, trying manual autocomplete');
                                        // Try manual autocomplete
                                        expenseAutocomplete(cm, {}, function(result: any) {
                                            if (result && result.list && result.list.length > 0) {
                                                console.log('[ExpenseAutocomplete] Manual autocomplete result:', result);
                                                // Create a simple popup with suggestions
                                                showManualAutocomplete(cm, result);
                                            }
                                        });
                                    }
                                } else {
                                    console.log('[ExpenseAutocomplete] Not in category column, no autocomplete');
                                }
                            } else {
                                console.log('[ExpenseAutocomplete] Not in expense table context');
                            }
                        } else {
                            console.log('[ExpenseAutocomplete] Not a letter input, ignoring');
                        }
                    } catch (error) {
                        console.error('[ExpenseAutocomplete] Error in inputRead handler:', error);
                    }
                });
                
                // Manual autocomplete popup function
                function showManualAutocomplete(cm: any, result: any) {
                    console.log('[ExpenseAutocomplete] Showing manual autocomplete popup');
                    
                    // Remove any existing suggestion popup
                    const existingPopup = document.getElementById('expense-autocomplete-popup');
                    if (existingPopup) {
                        existingPopup.remove();
                    }
                    
                    // Create suggestion popup
                    const popup = document.createElement('div');
                    popup.id = 'expense-autocomplete-popup';
                    popup.style.cssText = `
                        position: absolute;
                        background: var(--joplin-background-color, #2d2d2d);
                        color: var(--joplin-color, #ffffff);
                        border: 1px solid var(--joplin-divider-color, #555);
                        border-radius: 6px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                        z-index: 10000;
                        font-family: var(--joplin-font-family, 'Monaco', 'Menlo', monospace);
                        font-size: 13px;
                        max-height: 200px;
                        overflow-y: auto;
                        min-width: 180px;
                        backdrop-filter: blur(8px);
                    `;
                    
                    let selectedIndex = 0;
                    
                    // Add suggestions to popup
                    result.list.forEach((suggestion: any, index: number) => {
                        const item = document.createElement('div');
                        // Safely set text content with additional sanitization
                        const sanitizedText = sanitizeCategory(suggestion.text || '');
                        item.textContent = sanitizedText;
                        item.className = `expense-autocomplete-item ${index === selectedIndex ? 'selected' : ''}`;
                        item.style.cssText = `
                            padding: 10px 15px;
                            cursor: pointer;
                            border-bottom: 1px solid var(--joplin-divider-color, #444);
                            background: ${index === selectedIndex ? 'var(--joplin-selected-color, #0066cc)' : 'transparent'};
                            transition: background-color 0.2s ease;
                        `;
                        
                        // Hover effect
                        item.addEventListener('mouseenter', () => {
                            // Remove selection from all items
                            popup.querySelectorAll('.expense-autocomplete-item').forEach((el: any) => {
                                el.classList.remove('selected');
                                el.style.background = 'transparent';
                            });
                            // Select hovered item
                            item.classList.add('selected');
                            item.style.background = 'var(--joplin-selected-color, #0066cc)';
                            selectedIndex = index;
                        });
                        
                        // Click to insert suggestion
                        item.addEventListener('click', () => {
                            const sanitizedSuggestion = sanitizeCategory(suggestion.text || '');
                            insertSuggestion(cm, result, sanitizedSuggestion);
                            popup.remove();
                        });
                        
                        popup.appendChild(item);
                    });
                    
                    // Position popup below the current cursor position
                    try {
                        const cursor = cm.getCursor();
                        let coords = null;
                        
                        // Try multiple methods to get cursor coordinates
                        if (cm.cursorCoords) {
                            coords = cm.cursorCoords(cursor, 'page');
                        } else if (cm.charCoords) {
                            coords = cm.charCoords(cursor, 'page');
                        } else {
                            // Fallback: try to get editor element and estimate position
                            const editorElement = cm.getWrapperElement ? cm.getWrapperElement() : cm.getScrollerElement();
                            if (editorElement) {
                                const rect = editorElement.getBoundingClientRect();
                                const lineHeight = 20; // Estimated line height
                                coords = {
                                    left: rect.left + 50, // Estimated left offset
                                    bottom: rect.top + (cursor.line + 1) * lineHeight,
                                    top: rect.top + cursor.line * lineHeight
                                };
                            }
                        }
                        
                        console.log('[ExpenseAutocomplete] Raw cursor coordinates:', coords);
                        
                        if (coords && coords.left !== undefined && coords.bottom !== undefined) {
                            // Get absolute positioning by accounting for Joplin's layout
                            const absoluteCoords = getAbsoluteCoordinates(coords);
                            
                            // Position popup directly below the cursor with some offset
                            popup.style.left = absoluteCoords.left + 'px';
                            popup.style.top = (absoluteCoords.bottom + 5) + 'px';
                            
                            console.log('[ExpenseAutocomplete] Popup positioned at:', {
                                left: absoluteCoords.left,
                                top: absoluteCoords.bottom + 5,
                                originalCoords: coords,
                                adjustedCoords: absoluteCoords
                            });
                        } else {
                            throw new Error('No valid coordinates available');
                        }
                        
                    } catch (e) {
                        console.warn('[ExpenseAutocomplete] Positioning fallback:', e);
                        // Ultimate fallback positioning - position relative to editor or fixed position
                        try {
                            const editorElement = cm.getWrapperElement ? cm.getWrapperElement() : 
                                                 cm.getScrollerElement ? cm.getScrollerElement() : 
                                                 document.querySelector('.CodeMirror');
                            
                            if (editorElement) {
                                const rect = editorElement.getBoundingClientRect();
                                const absoluteCoords = getAbsoluteCoordinates({
                                    left: rect.left + 100,
                                    bottom: rect.top + 100
                                });
                                popup.style.left = absoluteCoords.left + 'px';
                                popup.style.top = absoluteCoords.bottom + 'px';
                                console.log('[ExpenseAutocomplete] Positioned relative to editor at:', {
                                    left: absoluteCoords.left,
                                    top: absoluteCoords.bottom
                                });
                            } else {
                                // Last resort: fixed position
                                popup.style.left = '300px';
                                popup.style.top = '100px';
                                console.log('[ExpenseAutocomplete] Using fixed positioning');
                            }
                        } catch (fallbackError) {
                            console.error('[ExpenseAutocomplete] Complete positioning failure:', fallbackError);
                            popup.style.left = '300px';
                            popup.style.top = '100px';
                        }
                    }
                    
                    // Helper function to convert editor coordinates to absolute screen coordinates
                    function getAbsoluteCoordinates(editorCoords: any) {
                        try {
                            console.log('[ExpenseAutocomplete] Starting absolute coordinate calculation...');
                            
                            // Method 1: Find all elements to the left of the editor
                            let totalLeftOffset = 0;
                            let totalTopOffset = 0;
                            
                            // Find the main editor element
                            const editorElement = document.querySelector('.rli-editor') || 
                                                 document.querySelector('.CodeMirror') ||
                                                 cm.getWrapperElement();
                            
                            if (editorElement) {
                                console.log('[ExpenseAutocomplete] Found editor element:', editorElement.className);
                                
                                // Get all elements that might be to the left of the editor
                                const leftSidebar = document.querySelector('.rli-sideBar');
                                const noteList = document.querySelector('.rli-noteList');
                                
                                // Calculate total width of left elements
                                if (leftSidebar) {
                                    const sidebarRect = leftSidebar.getBoundingClientRect();
                                    totalLeftOffset += sidebarRect.width;
                                    console.log('[ExpenseAutocomplete] Left sidebar width:', sidebarRect.width);
                                }
                                
                                if (noteList) {
                                    const noteListRect = noteList.getBoundingClientRect();
                                    totalLeftOffset += noteListRect.width;
                                    console.log('[ExpenseAutocomplete] Note list width:', noteListRect.width);
                                }
                                
                                // Find elements at the top of the note/editor
                                const noteTitleWrapper = document.querySelector('.note-title-wrapper');
                                const editorToolbar = document.querySelector('#CodeMirrorToolbar') || 
                                                    document.querySelector('.editor-toolbar');
                                
                                // Calculate total height of top elements
                                if (noteTitleWrapper) {
                                    const titleRect = noteTitleWrapper.getBoundingClientRect();
                                    totalTopOffset += titleRect.height;
                                    console.log('[ExpenseAutocomplete] Note title height:', titleRect.height);
                                }
                                
                                if (editorToolbar) {
                                    const toolbarRect = editorToolbar.getBoundingClientRect();
                                    totalTopOffset += toolbarRect.height;
                                    console.log('[ExpenseAutocomplete] Editor toolbar height:', toolbarRect.height);
                                }
                                
                                console.log('[ExpenseAutocomplete] Calculated offsets - Left:', totalLeftOffset, 'Top:', totalTopOffset);
                            } else {
                                console.warn('[ExpenseAutocomplete] Editor element not found, using fallback calculations');
                                // Fallback: try to find any sidebar-like elements
                                const possibleSidebars = document.querySelectorAll('.sidebar, .side-panel, [class*="side"]');
                                possibleSidebars.forEach((sidebar: any) => {
                                    const rect = sidebar.getBoundingClientRect();
                                    if (rect.left < window.innerWidth / 2) { // Likely on the left side
                                        totalLeftOffset += rect.width;
                                        console.log('[ExpenseAutocomplete] Found sidebar-like element:', sidebar.className, 'width:', rect.width);
                                    }
                                });
                                
                                totalTopOffset = 60; // Fallback top offset
                            }
                            
                            // Method 2: Check if we're in an iframe and get parent window offsets
                            let iframeOffset = { left: 0, top: 0 };
                            if (window !== window.parent) {
                                try {
                                    // We're in an iframe (editor), try to get iframe position relative to parent
                                    const iframe = window.parent.document.querySelector('iframe');
                                    if (iframe) {
                                        const iframeRect = iframe.getBoundingClientRect();
                                        iframeOffset.left = iframeRect.left;
                                        iframeOffset.top = iframeRect.top;
                                        console.log('[ExpenseAutocomplete] Iframe offset detected:', iframeOffset);
                                    }
                                } catch (e) {
                                    console.warn('[ExpenseAutocomplete] Could not access parent window, using calculated offsets');
                                    // Cross-origin iframe, use calculated offsets
                                    iframeOffset.left = totalLeftOffset;
                                    iframeOffset.top = totalTopOffset;
                                }
                            }
                            
                            // Method 3: Use viewport offset detection
                            const viewportOffset = getViewportOffset();
                            
                            // Combine all offsets for accurate positioning
                            // Use the maximum of calculated offsets vs iframe/viewport offsets
                            const finalLeftOffset = Math.max(totalLeftOffset, iframeOffset.left, viewportOffset.left);
                            const finalTopOffset = Math.max(totalTopOffset, iframeOffset.top, viewportOffset.top);
                            
                            const absoluteCoords = {
                                left: editorCoords.left + finalLeftOffset,
                                bottom: editorCoords.bottom + finalTopOffset,
                                top: (editorCoords.top || editorCoords.bottom - 20) + finalTopOffset
                            };
                            
                            console.log('[ExpenseAutocomplete] Final absolute coordinate calculation:', {
                                original: editorCoords,
                                totalLeftOffset,
                                totalTopOffset,
                                iframeOffset,
                                viewportOffset,
                                finalLeftOffset,
                                finalTopOffset,
                                absoluteCoords
                            });
                            
                            return absoluteCoords;
                            
                        } catch (error) {
                            console.warn('[ExpenseAutocomplete] Error calculating absolute coordinates:', error);
                            // Fallback: add reasonable default offsets for Joplin
                            return {
                                left: editorCoords.left + 400, // Estimated total left sidebar width
                                bottom: editorCoords.bottom + 100, // Estimated total top offset
                                top: (editorCoords.top || editorCoords.bottom - 20) + 100
                            };
                        }
                    }
                    
                    // Helper function to detect viewport offset
                    function getViewportOffset() {
                        try {
                            // Check if content is offset from viewport
                            const body = document.body;
                            const html = document.documentElement;
                            
                            const scrollLeft = window.pageXOffset || html.scrollLeft || body.scrollLeft || 0;
                            const scrollTop = window.pageYOffset || html.scrollTop || body.scrollTop || 0;
                            
                            const clientLeft = html.clientLeft || body.clientLeft || 0;
                            const clientTop = html.clientTop || body.clientTop || 0;
                            
                            return {
                                left: scrollLeft + clientLeft,
                                top: scrollTop + clientTop
                            };
                        } catch (error) {
                            console.warn('[ExpenseAutocomplete] Error detecting viewport offset:', error);
                            return { left: 0, top: 0 };
                        }
                    }
                    
                    // Add to document
                    document.body.appendChild(popup);
                    
                    // Keyboard event handler for the popup
                    const handleKeyDown = (e: KeyboardEvent) => {
                        if (!popup.parentNode) return;
                        
                        switch (e.key) {
                            case 'ArrowDown':
                                e.preventDefault();
                                selectedIndex = Math.min(selectedIndex + 1, result.list.length - 1);
                                updateSelection();
                                break;
                            case 'ArrowUp':
                                e.preventDefault();
                                selectedIndex = Math.max(selectedIndex - 1, 0);
                                updateSelection();
                                break;
                            case 'Enter':
                                console.log('[ExpenseAutocomplete] Enter key pressed, checking keybind...');
                                // Check if this matches the configured keybind OR if it's a simple Enter
                                const isConfiguredKeybind = shouldApplyAutocomplete(e);
                                const isSimpleEnter = !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'Enter';
                                
                                if (isConfiguredKeybind || isSimpleEnter) {
                                    console.log('[ExpenseAutocomplete] Keybind matched or simple Enter, inserting suggestion...');
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const sanitizedSuggestion = sanitizeCategory(result.list[selectedIndex]?.text || '');
                                    insertSuggestion(cm, result, sanitizedSuggestion);
                                    popup.remove();
                                    document.removeEventListener('keydown', handleKeyDown);
                                } else {
                                    console.log('[ExpenseAutocomplete] Keybind not matched, ignoring Enter');
                                }
                                break;
                            case 'Escape':
                                e.preventDefault();
                                popup.remove();
                                document.removeEventListener('keydown', handleKeyDown);
                                break;
                        }
                    };
                    
                    // Function to update visual selection
                    function updateSelection() {
                        popup.querySelectorAll('.expense-autocomplete-item').forEach((el: any, index: number) => {
                            el.classList.toggle('selected', index === selectedIndex);
                            el.style.background = index === selectedIndex ? 
                                'var(--joplin-selected-color, #0066cc)' : 'transparent';
                        });
                    }
                    
                    // Function to check if the keybind matches
                    function shouldApplyAutocomplete(e: KeyboardEvent): boolean {
                        // Use the globally fetched keybind setting
                        const keybind = autocompleteKeybind || 'Ctrl+Enter';
                        const parts = keybind.split('+').map(p => p.trim());
                        
                        let requiresCtrl = false, requiresAlt = false, requiresShift = false;
                        let keyRequired = 'Enter';
                        
                        parts.forEach(part => {
                            const lowerPart = part.toLowerCase();
                            if (lowerPart === 'ctrl' || lowerPart === 'control') requiresCtrl = true;
                            else if (lowerPart === 'alt') requiresAlt = true;
                            else if (lowerPart === 'shift') requiresShift = true;
                            else keyRequired = part;
                        });
                        
                        console.log('[ExpenseAutocomplete] Keybind check:', {
                            keybind: keybind,
                            eventKey: e.key,
                            eventCtrl: e.ctrlKey,
                            eventAlt: e.altKey,
                            eventShift: e.shiftKey,
                            requiresCtrl: requiresCtrl,
                            requiresAlt: requiresAlt,
                            requiresShift: requiresShift,
                            keyRequired: keyRequired
                        });
                        
                        const matches = e.ctrlKey === requiresCtrl && 
                               e.altKey === requiresAlt && 
                               e.shiftKey === requiresShift && 
                               e.key === keyRequired;
                        
                        console.log('[ExpenseAutocomplete] Keybind matches:', matches);
                        return matches;
                    }
                    
                    // Add keyboard listener
                    document.addEventListener('keydown', handleKeyDown);
                    
                    // Auto-close popup after 15 seconds or on click outside
                    setTimeout(() => {
                        if (popup.parentNode) {
                            popup.remove();
                            document.removeEventListener('keydown', handleKeyDown);
                        }
                    }, 15000);
                    
                    // Close on click outside
                    const closeOnClickOutside = (e: any) => {
                        if (!popup.contains(e.target)) {
                            popup.remove();
                            document.removeEventListener('click', closeOnClickOutside);
                            document.removeEventListener('keydown', handleKeyDown);
                        }
                    };
                    setTimeout(() => {
                        document.addEventListener('click', closeOnClickOutside);
                    }, 100);
                    
                    const suggestions = result.list.map((item: any) => item.text).join(', ');
                    console.log('[ExpenseAutocomplete] Dark mode compatible popup created with keybind [' + autocompleteKeybind + ']:', suggestions);
                }
                
                // Function to insert selected suggestion
                function insertSuggestion(cm: any, result: any, suggestionText: string) {
                    try {
                        console.log('[ExpenseAutocomplete] Inserting suggestion:', suggestionText);
                        
                        // Replace the current word with the suggestion
                        cm.replaceRange(suggestionText, result.from, result.to);
                        
                        // Position cursor after the inserted text
                        const newCursor = {
                            line: result.from.line,
                            ch: result.from.ch + suggestionText.length
                        };
                        cm.setCursor(newCursor);
                        
                        console.log('[ExpenseAutocomplete] Suggestion inserted successfully');
                    } catch (error) {
                        console.error('[ExpenseAutocomplete] Error inserting suggestion:', error);
                    }
                }
            },
            codeMirrorResources: [],
            codeMirrorOptions: {
                // Additional CodeMirror options if needed
            },
            assets: function() {
                return [
                    {
                        name: 'expense-autocomplete.css',
                        mime: 'text/css',
                        inline: true,
                        text: `
                            .expense-category-hint {
                                color: #0066cc !important;
                                font-weight: bold;
                            }
                            
                            .CodeMirror-hints {
                                max-height: 200px;
                            }
                            
                            .CodeMirror-hint {
                                padding: 4px 8px;
                            }
                            
                            .CodeMirror-hint-active {
                                background: #3366cc !important;
                                color: white !important;
                            }
                        `
                    }
                ];
            }
        };
    }
};
