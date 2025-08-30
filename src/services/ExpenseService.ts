import joplin from 'api';
import { ExpenseEntry, ExpenseProcessingResult } from '../types';
import { parseExpenseTables, serializeExpenseTable, validateExpenseEntry, getTargetYearMonth, getTargetYear, getTargetMonth } from '../expenseParser';
import { FolderService } from './FolderService';
import { SettingsService } from './SettingsService';
import { RecurringExpenseHandler } from '../recurringHandler';
import { getCurrentDateTime } from '../utils/dateUtils';
import { sanitizeExpenseEntry } from '../utils/sanitization';
import { logger, safeErrorMessage } from '../utils/logger';

export class ExpenseService {
    private static instance: ExpenseService;
    private folderService: FolderService;
    private settingsService: SettingsService;
    private recurringHandler: RecurringExpenseHandler;

    private constructor() {
        this.folderService = FolderService.getInstance();
        this.settingsService = SettingsService.getInstance();
        // Initialize recurringHandler lazily to avoid circular dependency
        this.recurringHandler = null as any;
    }

    private getRecurringHandler(): RecurringExpenseHandler {
        if (!this.recurringHandler) {
            this.recurringHandler = RecurringExpenseHandler.getInstance();
        }
        return this.recurringHandler;
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
            // First sanitize and validate the input
            const sanitizationResult = sanitizeExpenseEntry(expense);
            if (sanitizationResult.errors.length > 0) {
                return { success: false, errors: sanitizationResult.errors };
            }

            // Use the sanitized expense entry
            const newExpense: ExpenseEntry = sanitizationResult.sanitized;

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

            logger.info('Successfully added new expense to new-expenses document');
            return { success: true, errors: [] };
        } catch (error) {
            logger.error('Failed to add new expense', error);
            return { success: false, errors: [`Failed to add expense: ${safeErrorMessage(error)}`] };
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
                logger.info('No expenses found in new-expenses document');
                return result;
            }

            // Track which expenses were processed successfully
            const processedExpenses = new Set<ExpenseEntry>();
            
            // Separate recurring and non-recurring expenses
            const recurringExpenses: ExpenseEntry[] = [];
            const regularExpenses: ExpenseEntry[] = [];
            
            for (const expense of allExpenses) {
                const validation = validateExpenseEntry(expense);
                if (!validation.valid) {
                    result.failed++;
                    result.errors.push(`Invalid expense "${expense.description}": ${validation.errors.join(', ')}`);
                    continue;
                }

                if (expense.recurring && expense.recurring !== '') {
                    recurringExpenses.push(expense);
                } else {
                    regularExpenses.push(expense);
                }
            }

            // Process recurring expenses first
            for (const expense of recurringExpenses) {
                try {
                    // Convert to recurring expense and add to tracking table
                    const recurringEntry = this.getRecurringHandler().convertToRecurringExpense(expense, expense.recurring as any, newExpensesNoteId);
                    await this.getRecurringHandler().updateRecurringExpense(recurringEntry);
                    
                    result.processed++;
                    processedExpenses.add(expense);
                    logger.info(`Created recurring expense: ${expense.description} (${expense.recurring})`);
                } catch (error) {
                    result.failed++;
                    result.errors.push(`Failed to create recurring expense "${expense.description}": ${error.message}`);
                }
            }

            // Group regular expenses by year-month for efficient processing
            const expensesByYearMonth = new Map<string, ExpenseEntry[]>();
            
            for (const expense of regularExpenses) {
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

            logger.info(`Processed ${result.processed} expenses, ${result.failed} failed`);
            return result;
        } catch (error) {
            logger.error('Failed to process new expenses', error);
            result.errors.push(`Processing failed: ${safeErrorMessage(error)}`);
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
        
        logger.info(`Moved ${expenses.length} expenses to ${yearMonth}`);
    }

    /**
     * Update expense table in document content - Completely rewritten to prevent duplication
     */
    private updateExpenseTableInContent(content: string, expenses: ExpenseEntry[]): string {
        // Strategy: Find and completely remove the old table, then insert the new one
        
        const lines = content.split('\n');
        const newTable = serializeExpenseTable(expenses);
        
        // Find ALL instances of expense table headers (in case there are multiple)
        const tableRanges: { start: number, end: number }[] = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Look for expense table header
            if (line.startsWith('|') && 
                line.includes('price') && 
                line.includes('description') &&
                line.includes('category') &&
                line.includes('date')) {
                
                let tableStart = i;
                let tableEnd = i + 1;
                
                // Skip the separator line if it exists
                if (tableEnd < lines.length && 
                    lines[tableEnd].trim().startsWith('|') && 
                    lines[tableEnd].trim().includes('-')) {
                    tableEnd++;
                }
                
                // Find all consecutive table rows (anything starting with |)
                while (tableEnd < lines.length) {
                    const currentLine = lines[tableEnd].trim();
                    
                    // Stop at:
                    // 1. Empty line
                    // 2. Non-table line (doesn't start with |)
                    // 3. Another table header
                    // 4. Markdown headers
                    // 5. HTML comments
                    if (currentLine === '') {
                        break;
                    } else if (!currentLine.startsWith('|')) {
                        break;
                    } else if (currentLine.startsWith('#')) {
                        break;
                    } else if (currentLine.startsWith('<!--')) {
                        break;
                    } else if (currentLine.includes('price') && 
                               currentLine.includes('description') && 
                               tableEnd > tableStart) {
                        // Another table header - don't include it
                        break;
                    }
                    
                    tableEnd++;
                }
                
                // Record this table range
                tableRanges.push({ start: tableStart, end: tableEnd });
                
                logger.info(`Found expense table at lines ${tableStart + 1}-${tableEnd}, ${tableEnd - tableStart} lines`);
                
                // Skip ahead to avoid finding overlapping ranges
                i = tableEnd;
            }
        }
        
        if (tableRanges.length === 0) {
            // No existing table found, append new table
            logger.info('No existing expense table found, appending new table');
            return content + '\n\n' + newTable;
        }
        
        // Remove all found tables (in reverse order to maintain indices)
        let modifiedLines = [...lines];
        
        for (let i = tableRanges.length - 1; i >= 0; i--) {
            const range = tableRanges[i];
            logger.info(`Removing table range ${range.start + 1}-${range.end} (${range.end - range.start} lines)`);
            modifiedLines.splice(range.start, range.end - range.start);
        }
        
        // Insert the new table at the position of the first table that was removed
        const insertPosition = tableRanges[0].start;
        const beforeTable = modifiedLines.slice(0, insertPosition);
        const afterTable = modifiedLines.slice(insertPosition);
        
        // Build the final result
        const result = [
            ...beforeTable,
            newTable,
            ...afterTable
        ].join('\n');
        
        logger.info(`Inserted new table with ${expenses.length} expenses at position ${insertPosition + 1}`);
        
        return result;
    }

    /**
     * Update the new-expenses document with remaining expenses
     */
    private async updateNewExpensesDocument(noteId: string, remainingExpenses: ExpenseEntry[]): Promise<void> {
        const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
        
        // Update table content with remaining expenses
        const updatedBody = this.updateExpenseTableInContent(note.body, remainingExpenses);
        await joplin.data.put(['notes', noteId], null, { body: updatedBody });
        
        logger.info(`Updated new-expenses document with ${remainingExpenses.length} remaining expenses`);
    }

    /**
     * Clear the new-expenses document
     */
    private async clearNewExpensesDocument(noteId: string): Promise<void> {
        const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
        
        // Replace table content but keep the structure
        const clearedBody = this.updateExpenseTableInContent(note.body, []);
        await joplin.data.put(['notes', noteId], null, { body: clearedBody });
        
        logger.info('Cleared new-expenses document');
    }

    /**
     * Get all expenses from a specific month
     */
    async getMonthlyExpenses(year: string, month: string): Promise<ExpenseEntry[]> {
        try {
            const folderStructure = await this.folderService.getFolderStructure(year);
            const monthlyNoteId = await this.folderService.findNoteInFolder(folderStructure.yearFolder, month);
            
            if (!monthlyNoteId) {
                logger.warn(`Monthly document not found for ${year}-${month}`);
                return [];
            }
            
            const note = await joplin.data.get(['notes', monthlyNoteId], { fields: ['body'] });
            return parseExpenseTables(note.body);
        } catch (error) {
            logger.error(`Failed to get monthly expenses for ${year}-${month}`, error);
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
            logger.error(`Failed to get yearly expenses for ${year}`, error);
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
            logger.error('Failed to update expense entry', error);
            return { success: false, errors: [`Failed to update expense: ${safeErrorMessage(error)}`] };
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
            logger.error('Failed to get new expenses', error);
            return [];
        }
    }
}
