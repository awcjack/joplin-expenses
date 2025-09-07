import joplin from 'api';
import { ExpenseEntry } from '../types';
import { parseExpenseTables, serializeExpenseTable, createNewExpenseEntry, validateExpenseEntry } from '../expenseParser';
import { SettingsService } from '../services/SettingsService';
import { getCurrentDateTime } from '../utils/dateUtils';
import { escapeHtml } from '../utils/sanitization';

export class TableEditorService {
    private static instance: TableEditorService;
    private settingsService: SettingsService;
    private dialogCounter = 0; // Counter to ensure unique dialog IDs

    private constructor() {
        this.settingsService = SettingsService.getInstance();
    }

    public static getInstance(): TableEditorService {
        if (!TableEditorService.instance) {
            TableEditorService.instance = new TableEditorService();
        }
        return TableEditorService.instance;
    }

    /**
     * Open table editor for a specific note
     */
    async openTableEditor(noteId: string): Promise<void> {
        try {
            const note = await joplin.data.get(['notes', noteId], { fields: ['body', 'title'] });
            const entries = parseExpenseTables(note.body);
            const categories = this.settingsService.getCategories();

            // Generate unique dialog ID to prevent conflicts when opening multiple times
            this.dialogCounter++;
            const dialogId = await joplin.views.dialogs.create(`expense-table-editor-${this.dialogCounter}`);
            await joplin.views.dialogs.setHtml(dialogId, this.renderTableForm(entries, categories));
            await joplin.views.dialogs.setButtons(dialogId, [
                { id: "ok", title: "Save" },
                { id: "cancel", title: "Cancel" },
            ]);

            const result = await joplin.views.dialogs.open(dialogId);

            if (result && result.formData && result.formData['expense-table-form'] && result.id === "ok") {
                await this.saveTableChanges(noteId, note.body, result.formData['expense-table-form'], entries.length);
            }
        } catch (error) {
            console.error('Failed to open table editor:', error);
            await joplin.views.dialogs.showMessageBox('Error opening table editor: ' + error.message);
        }
    }

    /**
     * Render the table form HTML
     */
    private renderTableForm(entries: ExpenseEntry[], categories: string[]): string {
        let formHtml = `<style>
            * { box-sizing: border-box; }
            
            /* Detect theme and set CSS variables */
            :root {
                --bg-primary: #2d3748;
                --bg-secondary: #1a202c;
                --bg-input: #4a5568;
                --text-primary: #ffffff;
                --text-secondary: #e2e8f0;
                --border-primary: #4a5568;
                --border-secondary: #2d3748;
                --accent-color: #4299e1;
                --danger-color: #e53e3e;
                --success-color: #38a169;
                --header-bg: #1a202c;
                --new-row-bg: #2f855a;
            }
            
            /* Light theme detection - fallback if prefers-color-scheme not available */
            @media (prefers-color-scheme: light) {
                :root {
                    --bg-primary: #ffffff;
                    --bg-secondary: #f7fafc;
                    --bg-input: #ffffff;
                    --text-primary: #1a202c;
                    --text-secondary: #4a5568;
                    --border-primary: #e2e8f0;
                    --border-secondary: #cbd5e0;
                    --accent-color: #3182ce;
                    --danger-color: #e53e3e;
                    --success-color: #38a169;
                    --header-bg: #edf2f7;
                    --new-row-bg: #c6f6d5;
                }
            }
            
            html, body { 
                margin: 0 !important; 
                padding: 0 !important; 
                min-width: 1200px !important;
                min-height: 800px !important;
                width: 1300px !important; 
                height: 850px !important;
                max-height: none !important;
                max-width: none !important;
                overflow-x: auto; 
                overflow-y: auto;
                position: relative;
                background: var(--bg-primary) !important;
                color: var(--text-primary) !important;
            }
            
            /* Override any Joplin dialog constraints */
            .dialog-modal-layer, .modal-layer { 
                max-height: none !important;
                height: auto !important; 
            }
            
            .expense-table-container { 
                width: 1250px !important; 
                height: 800px !important; 
                min-width: 1250px !important;
                min-height: 750px !important;
                overflow: auto; 
                box-sizing: border-box;
                padding: 15px;
                position: relative;
                background: var(--bg-primary) !important;
                color: var(--text-primary) !important;
            }
            
            h2 {
                color: var(--text-primary) !important;
                margin-bottom: 20px;
                font-size: 18px;
                text-align: center;
            }
            
            .expense-table { 
                width: 1200px !important; 
                border-collapse: collapse; 
                min-width: 1200px !important;
                table-layout: fixed;
                border: 2px solid var(--border-primary) !important;
                background: var(--bg-secondary) !important;
            }
            
            .expense-table th {
                background: var(--header-bg) !important;
                color: var(--text-primary) !important;
                border: 1px solid var(--border-primary) !important;
                padding: 10px 8px !important;
                text-align: left;
                font-weight: bold;
                font-size: 14px;
            }
            
            .expense-table td {
                border: 1px solid var(--border-secondary) !important;
                padding: 8px !important;
                text-align: left;
                background: var(--bg-primary) !important;
            }
            
            .expense-table tr:nth-child(even) td {
                background: var(--bg-secondary) !important;
            }
            
            .expense-table tr:hover td {
                background: var(--accent-color) !important;
                color: white !important;
            }
            
            /* New row styling */
            .new-row {
                background: var(--new-row-bg) !important;
            }
            
            .new-row td {
                background: var(--new-row-bg) !important;
                color: var(--text-primary) !important;
            }
            
            /* Input styling */
            input, select {
                background: var(--bg-input) !important;
                color: var(--text-primary) !important;
                border: 1px solid var(--border-primary) !important;
                border-radius: 4px;
                outline: none;
            }
            
            input:focus, select:focus {
                border-color: var(--accent-color) !important;
                box-shadow: 0 0 0 2px rgba(66, 153, 225, 0.3) !important;
            }
            
            input::placeholder {
                color: var(--text-secondary) !important;
                opacity: 0.7;
            }
            
            .delete-btn {
                background: var(--danger-color) !important;
                color: white !important;
                border: none !important;
                padding: 6px 12px !important;
                cursor: pointer !important;
                border-radius: 4px !important;
                font-weight: bold;
                transition: background-color 0.2s;
            }
            
            .delete-btn:hover {
                background: #c53030 !important;
                transform: translateY(-1px);
            }
            
            /* Instructions styling */
            .instructions {
                background: var(--bg-secondary) !important;
                color: var(--text-secondary) !important;
                border: 1px solid var(--border-primary) !important;
                border-radius: 6px;
                padding: 15px;
                margin-top: 15px;
            }
            
            .instructions strong {
                color: var(--text-primary) !important;
            }
            
            .instructions ul {
                margin: 10px 0 0 20px;
                padding: 0;
            }
            
            .instructions li {
                margin: 5px 0;
                color: var(--text-secondary) !important;
            }
            
            /* New row indicator */
            .new-indicator {
                color: var(--success-color) !important;
                font-weight: bold;
                padding: 4px;
                font-size: 12px;
            }
            
            /* New row styling */
            .new-row {
                background: var(--success-bg) !important;
            }
        </style>`;
        formHtml += `<form id="expense-table-form" name="expense-table-form">`;
        formHtml += `<div class="expense-table-container">`;
        formHtml += `<h2>Edit Expense Table</h2>`;
        formHtml += `<table border="1" class="expense-table"><tr>
            <th style="width: 100px;">Price</th>
            <th style="width: 300px;">Description</th>
            <th style="width: 150px;">Category</th>
            <th style="width: 180px;">Date</th>
            <th style="width: 180px;">Shop</th>
            <th style="width: 180px;">Attachment</th>
            <th style="width: 110px;">Recurring</th>
            <th style="width: 100px;">Actions</th>
        </tr>`;
        
        entries.forEach((e, idx) => {
            const categoryOptions = categories.map(cat => {
                const escapedCat = escapeHtml(cat);
                return `<option value="${escapedCat}" ${escapeHtml(e.category) === escapedCat ? 'selected' : ''}>${escapedCat}</option>`;
            }).join('');
            
            const dateValue = e.date ? escapeHtml(e.date.slice(0, 16)) : ''; // Format for datetime-local
            
            formHtml += `<tr>
                <td><input class="table-input price-input" name="price_${idx}" value="${escapeHtml(String(e.price))}" type="number" step="0.01"></td>
                <td><input class="table-input description-input" name="description_${idx}" value="${escapeHtml(e.description)}"></td>
                <td><select class="table-select category-select" name="category_${idx}">${categoryOptions}</select></td>
                <td><input class="table-input date-input" name="date_${idx}" value="${dateValue}" type="datetime-local"></td>
                <td><input class="table-input shop-input" name="shop_${idx}" value="${escapeHtml(e.shop)}"></td>
                <td><input class="table-input attachment-input" name="attachment_${idx}" value="${escapeHtml(e.attachment ?? "")}"></td>
                <td><select class="table-select recurring-select" name="recurring_${idx}">
                    <option value="" ${e.recurring === "" ? 'selected' : ''}>None</option>
                    <option value="daily" ${e.recurring === "daily" ? 'selected' : ''}>Daily</option>
                    <option value="weekly" ${e.recurring === "weekly" ? 'selected' : ''}>Weekly</option>
                    <option value="monthly" ${e.recurring === "monthly" ? 'selected' : ''}>Monthly</option>
                    <option value="yearly" ${e.recurring === "yearly" ? 'selected' : ''}>Yearly</option>
                </select></td>
                <td><button type="button" class="delete-btn" onclick="
                    document.querySelector('input[name=\\'price_${idx}\\']').value = 'DELETE_ROW';
                    document.querySelector('input[name=\\'description_${idx}\\']').value = 'DELETE_ROW';
                    this.closest('tr').style.display = 'none';
                    return false;
                ">Delete</button></td>
            </tr>`;
        });
        
        // Row for adding new entry
        const newIdx = entries.length;
        const currentDateTime = getCurrentDateTime().slice(0, 16);
        const defaultCategoryOptions = categories.map(cat => {
            const escapedCat = escapeHtml(cat);
            return `<option value="${escapedCat}">${escapedCat}</option>`;
        }).join('');
        
        formHtml += `<tr class="new-row">
            <td><input class="table-input price-input" name="price_${newIdx}" value="" type="number" step="0.01" placeholder="0.00"></td>
            <td><input class="table-input description-input" name="description_${newIdx}" value="" placeholder="Description"></td>
            <td><select class="table-select category-select" name="category_${newIdx}">${defaultCategoryOptions}</select></td>
            <td><input class="table-input date-input" name="date_${newIdx}" value="${currentDateTime}" type="datetime-local"></td>
            <td><input class="table-input shop-input" name="shop_${newIdx}" value="" placeholder="Shop"></td>
            <td><input class="table-input attachment-input" name="attachment_${newIdx}" value="" placeholder="Link/File"></td>
            <td><select class="table-select recurring-select" name="recurring_${newIdx}">
                <option value="">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
            </select></td>
            <td><span class="new-indicator">NEW</span></td>
        </tr>`;
        
        formHtml += `</table><br>
        <div class="instructions">
            <p><strong>Instructions:</strong></p>
            <ul>
                <li>Use positive values for expenses, negative for income</li>
                <li>Click "Delete" to remove a row (it will be hidden)</li>
                <li>Green row at bottom is for adding new entries</li>
                <li>Date format is automatically handled</li>
                <li>Select category from dropdown</li>
            </ul>
        </div>
        </div></form>`;
        
        return formHtml;
    }

    /**
     * Save table changes back to the note
     */
    private async saveTableChanges(noteId: string, originalBody: string, formData: any, originalEntryCount: number): Promise<void> {
        try {
            const updatedEntries: ExpenseEntry[] = [];
            
            // Process all possible entries (original + new)
            for (let idx = 0; idx <= originalEntryCount; idx++) {
                const price = formData[`price_${idx}`];
                const description = formData[`description_${idx}`];
                
                // Skip deleted rows
                if (price === 'DELETE_ROW' || description === 'DELETE_ROW') {
                    continue;
                }
                
                // Add entry if it has content
                if ((price ?? "") !== "" || (description ?? "") !== "") {
                    const newEntry = createNewExpenseEntry({
                        price: parseFloat(price) || 0,
                        description: description ?? "",
                        category: formData[`category_${idx}`] ?? "",
                        date: formData[`date_${idx}`] ?? getCurrentDateTime(),
                        shop: formData[`shop_${idx}`] ?? "",
                        attachment: formData[`attachment_${idx}`] ?? "",
                        recurring: formData[`recurring_${idx}`] ?? "",
                    });
                    
                    // Validate the entry
                    const validation = validateExpenseEntry(newEntry);
                    if (validation.valid) {
                        updatedEntries.push(newEntry);
                    } else {
                        console.warn(`Invalid entry skipped: ${validation.errors.join(', ')}`);
                    }
                }
            }
            
            // Update the note body with new table
            const updatedBody = this.updateExpenseTableInContent(originalBody, updatedEntries);
            await joplin.data.put(['notes', noteId], null, { body: updatedBody });
            
            console.info(`Updated note with ${updatedEntries.length} expense entries`);
            
        } catch (error) {
            console.error('Failed to save table changes:', error);
            throw error;
        }
    }

    /**
     * Update expense table in document content
     */
    private updateExpenseTableInContent(content: string, expenses: ExpenseEntry[]): string {
        const lines = content.split('\n');
        let headerIdx = -1;
        
        // Find the expense table header
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && line.includes('price') && line.includes('description')) {
                headerIdx = i;
                break;
            }
        }
        
        if (headerIdx === -1) {
            // No existing table found, append new table
            return content + '\n\n## Expenses\n\n' + serializeExpenseTable(expenses);
        }
        
        // Find the end of the existing table
        let endIdx = headerIdx + 1;
        // Skip separator line
        if (endIdx < lines.length && lines[endIdx].includes('---')) {
            endIdx++;
        }
        // Skip existing data rows
        while (endIdx < lines.length && lines[endIdx].trim().startsWith('|') && !lines[endIdx].includes('---')) {
            endIdx++;
        }
        
        // Replace the table section
        const newTable = serializeExpenseTable(expenses).split('\n');
        const newContent = [
            ...lines.slice(0, headerIdx),
            ...newTable,
            ...lines.slice(endIdx)
        ].join('\n');
        
        return newContent;
    }
}
