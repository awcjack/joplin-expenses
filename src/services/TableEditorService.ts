import joplin from 'api';
import { ExpenseEntry } from '../types';
import { parseExpenseTables, serializeExpenseTable, createNewExpenseEntry, validateExpenseEntry } from '../expenseParser';
import { SettingsService } from '../services/SettingsService';
import { getCurrentDateTime } from '../utils/dateUtils';
import { escapeHtml } from '../utils/sanitization';

export class TableEditorService {
    private static instance: TableEditorService;
    private settingsService: SettingsService;

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

            const dialogId = await joplin.views.dialogs.create('expense-table-editor');
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
        let formHtml = `<form id="expense-table-form" name="expense-table-form">`;
        formHtml += `<div style="width:900px; height:600px; overflow:auto;">`;
        formHtml += `<h2>Edit Expense Table</h2>`;
        formHtml += `<table border="1" style="width:100%; border-collapse: collapse;"><tr style="background-color: #f0f0f0;">
            <th style="padding: 8px;">Price</th>
            <th style="padding: 8px;">Description</th>
            <th style="padding: 8px;">Category</th>
            <th style="padding: 8px;">Date</th>
            <th style="padding: 8px;">Shop</th>
            <th style="padding: 8px;">Attachment</th>
            <th style="padding: 8px;">Recurring</th>
            <th style="padding: 8px;">Actions</th>
        </tr>`;
        
        entries.forEach((e, idx) => {
            const categoryOptions = categories.map(cat => {
                const escapedCat = escapeHtml(cat);
                return `<option value="${escapedCat}" ${escapeHtml(e.category) === escapedCat ? 'selected' : ''}>${escapedCat}</option>`;
            }).join('');
            
            const dateValue = e.date ? escapeHtml(e.date.slice(0, 16)) : ''; // Format for datetime-local
            
            formHtml += `<tr>
                <td><input name="price_${idx}" value="${escapeHtml(String(e.price))}" type="number" step="0.01" style="width:80px; padding:4px;"></td>
                <td><input name="description_${idx}" value="${escapeHtml(e.description)}" style="width:150px; padding:4px;"></td>
                <td><select name="category_${idx}" style="width:100px; padding:4px;">${categoryOptions}</select></td>
                <td><input name="date_${idx}" value="${dateValue}" type="datetime-local" style="width:150px; padding:4px;"></td>
                <td><input name="shop_${idx}" value="${escapeHtml(e.shop)}" style="width:120px; padding:4px;"></td>
                <td><input name="attachment_${idx}" value="${escapeHtml(e.attachment ?? "")}" style="width:120px; padding:4px;"></td>
                <td><select name="recurring_${idx}" style="width:80px; padding:4px;">
                    <option value="" ${e.recurring === "" ? 'selected' : ''}>None</option>
                    <option value="daily" ${e.recurring === "daily" ? 'selected' : ''}>Daily</option>
                    <option value="weekly" ${e.recurring === "weekly" ? 'selected' : ''}>Weekly</option>
                    <option value="monthly" ${e.recurring === "monthly" ? 'selected' : ''}>Monthly</option>
                    <option value="yearly" ${e.recurring === "yearly" ? 'selected' : ''}>Yearly</option>
                </select></td>
                <td><button type="button" onclick="deleteRow(${idx})" style="background:red;color:white;border:none;padding:4px 8px;cursor:pointer;">Delete</button></td>
            </tr>`;
        });
        
        // Row for adding new entry
        const newIdx = entries.length;
        const currentDateTime = getCurrentDateTime().slice(0, 16);
        const defaultCategoryOptions = categories.map(cat => {
            const escapedCat = escapeHtml(cat);
            return `<option value="${escapedCat}">${escapedCat}</option>`;
        }).join('');
        
        formHtml += `<tr style="background-color: #e8f5e8;">
            <td><input name="price_${newIdx}" value="" type="number" step="0.01" style="width:80px; padding:4px;" placeholder="0.00"></td>
            <td><input name="description_${newIdx}" value="" style="width:150px; padding:4px;" placeholder="Description"></td>
            <td><select name="category_${newIdx}" style="width:100px; padding:4px;">${defaultCategoryOptions}</select></td>
            <td><input name="date_${newIdx}" value="${currentDateTime}" type="datetime-local" style="width:150px; padding:4px;"></td>
            <td><input name="shop_${newIdx}" value="" style="width:120px; padding:4px;" placeholder="Shop"></td>
            <td><input name="attachment_${newIdx}" value="" style="width:120px; padding:4px;" placeholder="Link/File"></td>
            <td><select name="recurring_${newIdx}" style="width:80px; padding:4px;">
                <option value="">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
            </select></td>
            <td><span style="color:green; font-weight:bold; padding:4px;">NEW</span></td>
        </tr>`;
        
        formHtml += `</table><br>
        <div style="margin-top: 10px; padding: 10px; background-color: #f9f9f9; border-radius: 4px;">
            <p><strong>Instructions:</strong></p>
            <ul>
                <li>Use positive values for expenses, negative for income</li>
                <li>Click "Delete" to remove a row (it will be hidden)</li>
                <li>Green row at bottom is for adding new entries</li>
                <li>Date format is automatically handled</li>
                <li>Select category from dropdown</li>
            </ul>
        </div>
        </div></form>
        
        <script>
            function deleteRow(idx) {
                document.querySelector('input[name="price_' + idx + '"]').value = 'DELETE_ROW';
                document.querySelector('input[name="description_' + idx + '"]').value = 'DELETE_ROW';
                document.querySelector('input[name="price_' + idx + '"]').closest('tr').style.display = 'none';
            }
        </script>`;
        
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
