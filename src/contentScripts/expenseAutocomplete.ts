/**
 * CodeMirror content script for expense category autocomplete
 * Provides autocomplete suggestions for expense categories in markdown tables
 */

console.log('[ExpenseAutocomplete] Content script loaded');

module.exports = {
    default: function(context: any) {
        console.log('[ExpenseAutocomplete] Content script default function called with context:', context);
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
                    context.postMessage('getCategories').then((categories: string[]) => {
                        console.log('[ExpenseAutocomplete] Received categories:', categories);
                        if (!categories || !Array.isArray(categories)) {
                            console.log('[ExpenseAutocomplete] Invalid categories response, aborting');
                            callback(null);
                            return;
                        }
                        
                        // Filter categories based on current input
                        const suggestions = categories
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
                    // This is a fallback approach if CodeMirror showHint is not available
                    // For now, just log what would be shown
                    const suggestions = result.list.map((item: any) => item.text).join(', ');
                    console.log('[ExpenseAutocomplete] Available suggestions:', suggestions);
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
