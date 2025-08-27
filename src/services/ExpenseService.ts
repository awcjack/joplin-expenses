import joplin from 'api';
import { ExpenseEntry, ExpenseProcessingResult } from '../types';
import { parseExpenseTables, serializeExpenseTable, validateExpenseEntry, getTargetYearMonth, getTargetYear, getTargetMonth } from '../expenseParser';
import { FolderService } from './FolderService';
import { SettingsService } from './SettingsService';
import { getCurrentDateTime } from '../utils/dateUtils';

export class ExpenseService {
    private static instance: ExpenseService;
    private folderService: FolderService;
    private settingsService: SettingsService;

    private constructor() {
        this.folderService = FolderService.getInstance();
        this.settingsService = SettingsService.getInstance();
    }

    public static getInstance(): ExpenseService {
        if (!ExpenseService.instance) {
            ExpenseService.instance = new ExpenseService();
        }
        return ExpenseService.instance;
    }

    /**
     * Add a new expense entry to the new-expenses document
     */
    async addNewExpense(expense: Partial<ExpenseEntry>): Promise<{ success: boolean; errors: string[] }> {
        try {
            // Validate the expense entry
            const validation = validateExpenseEntry(expense);
            if (!validation.valid) {
                return { success: false, errors: validation.errors };
            }

            // Create complete expense entry with defaults
            const newExpense: ExpenseEntry = {
                price: expense.price || 0,
                description: expense.description || '',
                category: expense.category || '',
                date: expense.date || getCurrentDateTime(),
                shop: expense.shop || '',
                attachment: expense.attachment || '',
                recurring: expense.recurring || ''
            };

            // Get the new-expenses document
            const newExpensesNoteId = await this.folderService.ensureNewExpensesDocumentExists();
            const note = await joplin.data.get(['notes', newExpensesNoteId], { fields: ['body'] });

            // Parse existing expenses
            const existingEntries = parseExpenseTables(note.body);

            // Add the new expense
            existingEntries.push(newExpense);

            // Update the document
            const updatedBody = this.updateExpenseTableInContent(note.body, existingEntries);
            await joplin.data.put(['notes', newExpensesNoteId], null, { body: updatedBody });

            console.info('Successfully added new expense to new-expenses document');
            return { success: true, errors: [] };
        } catch (error) {
            console.error('Failed to add new expense:', error);
            return { success: false, errors: [`Failed to add expense: ${error.message}`] };
        }
    }

    /**
     * Process expenses from new-expenses document and move them to appropriate monthly documents
     */
    async processNewExpenses(): Promise<ExpenseProcessingResult> {
        const result: ExpenseProcessingResult = {
            processed: 0,
            failed: 0,
            moved: [],
            errors: []
        };

        try {
            // Get the new-expenses document
            const newExpensesNoteId = await this.folderService.ensureNewExpensesDocumentExists();
            const note = await joplin.data.get(['notes', newExpensesNoteId], { fields: ['body'] });

            // Parse expenses from the document
            const allExpenses = parseExpenseTables(note.body);

            if (allExpenses.length === 0) {
                console.info('No expenses found in new-expenses document');
                return result;
            }

            // Track which expenses were processed successfully
            const processedExpenses = new Set<ExpenseEntry>();
            
            // Group expenses by year-month for efficient processing
            const expensesByYearMonth = new Map<string, ExpenseEntry[]>();
            
            for (const expense of allExpenses) {
                const validation = validateExpenseEntry(expense);
                if (!validation.valid) {
                    result.failed++;
                    result.errors.push(`Invalid expense "${expense.description}": ${validation.errors.join(', ')}`);
                    continue;
                }

                const yearMonth = getTargetYearMonth(expense);
                if (!expensesByYearMonth.has(yearMonth)) {
                    expensesByYearMonth.set(yearMonth, []);
                }
                expensesByYearMonth.get(yearMonth)!.push(expense);
            }

            // Process each group
            for (const [yearMonth, groupExpenses] of expensesByYearMonth) {
                try {
                    await this.moveExpensesToMonth(groupExpenses, yearMonth);
                    result.processed += groupExpenses.length;
                    result.moved.push(...groupExpenses);
                    // Mark these expenses as successfully processed
                    groupExpenses.forEach(expense => processedExpenses.add(expense));
                } catch (error) {
                    result.failed += groupExpenses.length;
                    result.errors.push(`Failed to move expenses for ${yearMonth}: ${error.message}`);
                }
            }

            // Remove only the successfully processed expenses from new-expenses document
            if (processedExpenses.size > 0) {
                const remainingExpenses = allExpenses.filter(expense => !processedExpenses.has(expense));
                await this.updateNewExpensesDocument(newExpensesNoteId, remainingExpenses);
            }

            console.info(`Processed ${result.processed} expenses, ${result.failed} failed`);
            return result;
        } catch (error) {
            console.error('Failed to process new expenses:', error);
            result.errors.push(`Processing failed: ${error.message}`);
            return result;
        }
    }

    /**
     * Move a group of expenses to the appropriate monthly document
     */
    private async moveExpensesToMonth(expenses: ExpenseEntry[], yearMonth: string): Promise<void> {
        const [year, month] = yearMonth.split('-');
        
        // Ensure year structure exists
        const folderStructure = await this.folderService.ensureYearStructureExists(year);
        
        // Find the monthly document
        const monthlyNoteId = await this.folderService.findNoteInFolder(folderStructure.yearFolder, month);
        if (!monthlyNoteId) {
            throw new Error(`Monthly document not found for ${yearMonth}`);
        }

        // Get the monthly document
        const monthlyNote = await joplin.data.get(['notes', monthlyNoteId], { fields: ['body'] });
        
        // Parse existing expenses in the monthly document
        const existingExpenses = parseExpenseTables(monthlyNote.body);
        
        // Auto-fill dates for expenses that don't have one
        const expensesWithDates = expenses.map(expense => ({
            ...expense,
            date: expense.date || getCurrentDateTime()
        }));
        
        // Add new expenses
        existingExpenses.push(...expensesWithDates);
        
        // Update the monthly document
        const updatedBody = this.updateExpenseTableInContent(monthlyNote.body, existingExpenses);
        await joplin.data.put(['notes', monthlyNoteId], null, { body: updatedBody });
        
        console.info(`Moved ${expenses.length} expenses to ${yearMonth}`);
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
            return content + '\n\n' + serializeExpenseTable(expenses);
        }
        
        // Find the end of the existing table
        let endIdx = headerIdx + 1;
        // Skip the separator line (|-------|)
        if (endIdx < lines.length && lines[endIdx].trim().startsWith('|') && lines[endIdx].includes('-')) {
            endIdx++;
        }
        // Skip existing data rows
        while (endIdx < lines.length && lines[endIdx].trim().startsWith('|') && !lines[endIdx].includes('-')) {
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

    /**
     * Update the new-expenses document with remaining expenses
     */
    private async updateNewExpensesDocument(noteId: string, remainingExpenses: ExpenseEntry[]): Promise<void> {
        const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
        
        // Update table content with remaining expenses
        const updatedBody = this.updateExpenseTableInContent(note.body, remainingExpenses);
        await joplin.data.put(['notes', noteId], null, { body: updatedBody });
        
        console.info(`Updated new-expenses document with ${remainingExpenses.length} remaining expenses`);
    }

    /**
     * Clear the new-expenses document
     */
    private async clearNewExpensesDocument(noteId: string): Promise<void> {
        const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
        
        // Replace table content but keep the structure
        const clearedBody = this.updateExpenseTableInContent(note.body, []);
        await joplin.data.put(['notes', noteId], null, { body: clearedBody });
        
        console.info('Cleared new-expenses document');
    }

    /**
     * Get all expenses from a specific month
     */
    async getMonthlyExpenses(year: string, month: string): Promise<ExpenseEntry[]> {
        try {
            const folderStructure = await this.folderService.getFolderStructure(year);
            const monthlyNoteId = await this.folderService.findNoteInFolder(folderStructure.yearFolder, month);
            
            if (!monthlyNoteId) {
                console.warn(`Monthly document not found for ${year}-${month}`);
                return [];
            }
            
            const note = await joplin.data.get(['notes', monthlyNoteId], { fields: ['body'] });
            return parseExpenseTables(note.body);
        } catch (error) {
            console.error(`Failed to get monthly expenses for ${year}-${month}:`, error);
            return [];
        }
    }

    /**
     * Get all expenses from a specific year
     */
    async getYearlyExpenses(year: string): Promise<ExpenseEntry[]> {
        try {
            const allExpenses: ExpenseEntry[] = [];
            const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
            
            for (const month of months) {
                const monthlyExpenses = await this.getMonthlyExpenses(year, month);
                allExpenses.push(...monthlyExpenses);
            }
            
            return allExpenses;
        } catch (error) {
            console.error(`Failed to get yearly expenses for ${year}:`, error);
            return [];
        }
    }

    /**
     * Update a specific expense entry in its monthly document
     */
    async updateExpenseEntry(originalEntry: ExpenseEntry, updatedEntry: ExpenseEntry): Promise<{ success: boolean; errors: string[] }> {
        try {
            // Validate the updated entry
            const validation = validateExpenseEntry(updatedEntry);
            if (!validation.valid) {
                return { success: false, errors: validation.errors };
            }

            const originalYearMonth = getTargetYearMonth(originalEntry);
            const updatedYearMonth = getTargetYearMonth(updatedEntry);

            if (originalYearMonth === updatedYearMonth) {
                // Same month, just update in place
                return await this.updateExpenseInMonth(originalEntry, updatedEntry, originalYearMonth);
            } else {
                // Different month, remove from original and add to new
                await this.removeExpenseFromMonth(originalEntry, originalYearMonth);
                await this.addExpenseToMonth(updatedEntry, updatedYearMonth);
                return { success: true, errors: [] };
            }
        } catch (error) {
            console.error('Failed to update expense entry:', error);
            return { success: false, errors: [`Failed to update expense: ${error.message}`] };
        }
    }

    /**
     * Update expense in the same month
     */
    private async updateExpenseInMonth(originalEntry: ExpenseEntry, updatedEntry: ExpenseEntry, yearMonth: string): Promise<{ success: boolean; errors: string[] }> {
        const [year, month] = yearMonth.split('-');
        const expenses = await this.getMonthlyExpenses(year, month);
        
        // Find and replace the entry
        const entryIndex = expenses.findIndex(e => 
            e.price === originalEntry.price &&
            e.description === originalEntry.description &&
            e.category === originalEntry.category &&
            e.date === originalEntry.date
        );
        
        if (entryIndex === -1) {
            return { success: false, errors: ['Original expense entry not found'] };
        }
        
        expenses[entryIndex] = updatedEntry;
        
        // Update the document
        const folderStructure = await this.folderService.getFolderStructure(year);
        const monthlyNoteId = await this.folderService.findNoteInFolder(folderStructure.yearFolder, month);
        
        if (!monthlyNoteId) {
            return { success: false, errors: [`Monthly document not found for ${yearMonth}`] };
        }
        
        const note = await joplin.data.get(['notes', monthlyNoteId], { fields: ['body'] });
        const updatedBody = this.updateExpenseTableInContent(note.body, expenses);
        await joplin.data.put(['notes', monthlyNoteId], null, { body: updatedBody });
        
        return { success: true, errors: [] };
    }

    /**
     * Remove expense from a month
     */
    private async removeExpenseFromMonth(entry: ExpenseEntry, yearMonth: string): Promise<void> {
        const [year, month] = yearMonth.split('-');
        const expenses = await this.getMonthlyExpenses(year, month);
        
        // Remove the entry
        const filteredExpenses = expenses.filter(e => 
            !(e.price === entry.price &&
              e.description === entry.description &&
              e.category === entry.category &&
              e.date === entry.date)
        );
        
        // Update the document
        const folderStructure = await this.folderService.getFolderStructure(year);
        const monthlyNoteId = await this.folderService.findNoteInFolder(folderStructure.yearFolder, month);
        
        if (monthlyNoteId) {
            const note = await joplin.data.get(['notes', monthlyNoteId], { fields: ['body'] });
            const updatedBody = this.updateExpenseTableInContent(note.body, filteredExpenses);
            await joplin.data.put(['notes', monthlyNoteId], null, { body: updatedBody });
        }
    }

    /**
     * Add expense to a month
     */
    private async addExpenseToMonth(entry: ExpenseEntry, yearMonth: string): Promise<void> {
        const [year, month] = yearMonth.split('-');
        const expenses = await this.getMonthlyExpenses(year, month);
        
        expenses.push(entry);
        
        // Update the document
        const folderStructure = await this.folderService.getFolderStructure(year);
        const monthlyNoteId = await this.folderService.findNoteInFolder(folderStructure.yearFolder, month);
        
        if (monthlyNoteId) {
            const note = await joplin.data.get(['notes', monthlyNoteId], { fields: ['body'] });
            const updatedBody = this.updateExpenseTableInContent(note.body, expenses);
            await joplin.data.put(['notes', monthlyNoteId], null, { body: updatedBody });
        }
    }

    /**
     * Get expenses from new-expenses document
     */
    async getNewExpenses(): Promise<ExpenseEntry[]> {
        try {
            const newExpensesNoteId = await this.folderService.ensureNewExpensesDocumentExists();
            const note = await joplin.data.get(['notes', newExpensesNoteId], { fields: ['body'] });
            return parseExpenseTables(note.body);
        } catch (error) {
            console.error('Failed to get new expenses:', error);
            return [];
        }
    }
}
