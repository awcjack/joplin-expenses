// Recurring expense processing logic

import joplin from 'api';
import { ExpenseEntry, RecurrenceType } from './types';
import { FolderService } from './services/FolderService';
import { ExpenseService } from './services/ExpenseService';
import { SettingsService } from './services/SettingsService';
import { SummaryService } from './services/SummaryService';
import { getCurrentDateTime, parseDate } from './utils/dateUtils';
import { getTargetYearMonth } from './expenseParser';
import { logger, safeErrorMessage } from './utils/logger';

export type Recurrence = 'daily' | 'weekly' | 'monthly' | 'yearly' | '';

export interface RecurringExpenseEntry extends ExpenseEntry {
    lastProcessed: string;     // ISO date of last processing
    nextDue: string;          // ISO date when next occurrence is due
    enabled: boolean;         // Whether this recurring expense is active
    sourceNoteId?: string;    // Note where the original recurring expense was defined
}

export interface RecurringProcessingResult {
    processed: number;
    created: number;
    errors: string[];
    newExpenses: ExpenseEntry[];
}

export class RecurringExpenseHandler {
    private static instance: RecurringExpenseHandler;
    private folderService: FolderService;
    private expenseService: ExpenseService;
    private settingsService: SettingsService;
    private summaryService: SummaryService;

    private constructor() {
        this.folderService = FolderService.getInstance();
        this.settingsService = SettingsService.getInstance();
        this.summaryService = SummaryService.getInstance();
        // Initialize expenseService lazily to avoid circular dependency
        this.expenseService = null as any;
    }

    private getExpenseService(): ExpenseService {
        if (!this.expenseService) {
            this.expenseService = ExpenseService.getInstance();
        }
        return this.expenseService;
    }

    public static getInstance(): RecurringExpenseHandler {
        if (!RecurringExpenseHandler.instance) {
            RecurringExpenseHandler.instance = new RecurringExpenseHandler();
        }
        return RecurringExpenseHandler.instance;
    }

    /**
     * Get timezone preference from settings
     */
    private getTimezonePreference(): string {
        return this.settingsService.getSettings().defaultTimezone;
    }

    /**
     * Parse recurrence value from cell text
     */
    parseRecurrence(cell: string): Recurrence {
        const normalized = cell.trim().toLowerCase();
        const validRecurrences: Recurrence[] = ['daily', 'weekly', 'monthly', 'yearly', ''];
        
        if (validRecurrences.includes(normalized as Recurrence)) {
            return normalized as Recurrence;
        }
        return '';
    }

    /**
     * Calculate the next occurrence date based on recurrence type
     */
    calculateNextOccurrence(baseDate: Date, recurrence: Recurrence): Date {
        const nextDate = new Date(baseDate);
        
        // Normalize to lowercase for consistent matching
        const normalizedRecurrence = recurrence.toLowerCase();
        console.log(`🔄 CALC: calculateNextOccurrence called with recurrence: "${recurrence}" -> "${normalizedRecurrence}"`);
        
        switch (normalizedRecurrence) {
            case 'daily':
                nextDate.setDate(nextDate.getDate() + 1);
                console.log('🔄 CALC: Daily recurrence - added 1 day');
                break;
            case 'weekly':
                nextDate.setDate(nextDate.getDate() + 7);
                console.log('🔄 CALC: Weekly recurrence - added 7 days');
                break;
            case 'monthly':
                nextDate.setMonth(nextDate.getMonth() + 1);
                console.log('🔄 CALC: Monthly recurrence - added 1 month');
                break;
            case 'yearly':
                nextDate.setFullYear(nextDate.getFullYear() + 1);
                console.log('🔄 CALC: Yearly recurrence - added 1 year');
                break;
            default:
                console.log('🔄 CALC: Unknown recurrence type, no change applied');
                return nextDate; // No change for empty recurrence
        }
        
        return nextDate;
    }

    /**
     * Check if a recurring expense is due for processing
     */
    isDue(recurringEntry: RecurringExpenseEntry): boolean {
        if (!recurringEntry.enabled || !recurringEntry.recurring) {
            return false;
        }

        const now = new Date();
        const dueDate = parseDate(recurringEntry.nextDue, this.getTimezonePreference());
        
        return now >= dueDate;
    }

    /**
     * Calculate all missed occurrences between a start date and now
     */
    calculateMissedOccurrences(startDate: Date, recurrence: Recurrence, maxBackfill: number = 24): Date[] {
        const occurrences: Date[] = [];
        const now = new Date();
        let currentDate = new Date(startDate);
        let count = 0;

        console.log(`🔄 BACKFILL: Calculating missed occurrences from ${startDate.toISOString()} with ${recurrence} recurrence`);

        while (currentDate <= now && count < maxBackfill) {
            if (currentDate < now) {
                occurrences.push(new Date(currentDate));
                console.log(`🔄 BACKFILL: Added occurrence: ${currentDate.toISOString()}`);
            }
            
            currentDate = this.calculateNextOccurrence(currentDate, recurrence);
            count++;
        }

        console.log(`🔄 BACKFILL: Found ${occurrences.length} missed occurrences (max ${maxBackfill})`);
        return occurrences;
    }

    /**
     * Create a new expense entry from a recurring template
     */
    createExpenseFromRecurring(recurringEntry: RecurringExpenseEntry, specificDate?: Date): ExpenseEntry {
        let useDate: string;
        
        if (specificDate) {
            // Preserve the local date/time instead of converting to UTC
            // Format as YYYY-MM-DDTHH:mm:ss to maintain the intended local date
            const year = specificDate.getFullYear();
            const month = String(specificDate.getMonth() + 1).padStart(2, '0');
            const day = String(specificDate.getDate()).padStart(2, '0');
            const hours = String(specificDate.getHours()).padStart(2, '0');
            const minutes = String(specificDate.getMinutes()).padStart(2, '0');
            const seconds = String(specificDate.getSeconds()).padStart(2, '0');
            
            useDate = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
        } else {
            useDate = getCurrentDateTime();
        }
        
        return {
            price: recurringEntry.price,
            description: recurringEntry.description,
            category: recurringEntry.category,
            date: useDate,
            shop: recurringEntry.shop,
            attachment: recurringEntry.attachment,
            recurring: '' // New entries don't inherit recurring behavior
        };
    }

    /**
     * Update the recurring entry's last processed and next due dates
     */
    updateRecurringEntry(recurringEntry: RecurringExpenseEntry): RecurringExpenseEntry {
        const now = new Date();
        // Calculate next occurrence from the current nextDue date, not from now
        // This ensures consistent scheduling even if processing is delayed
        const currentDue = parseDate(recurringEntry.nextDue, this.getTimezonePreference());
        const nextDue = this.calculateNextOccurrence(currentDue, recurringEntry.recurring as Recurrence);
        
        console.log(`🔄 CALC: Updating recurring expense "${recurringEntry.description}": ${recurringEntry.nextDue} -> ${nextDue.toISOString()}`);
        
        return {
            ...recurringEntry,
            lastProcessed: now.toISOString(),
            nextDue: nextDue.toISOString()
        };
    }

    /**
     * Process all recurring expenses and generate new entries
     */
    async processAllRecurringExpenses(): Promise<RecurringProcessingResult> {
        const result: RecurringProcessingResult = {
            processed: 0,
            created: 0,
            errors: [],
            newExpenses: []
        };

        try {
            logger.info('Starting recurring expense processing...');

            // Get all recurring expenses from the tracking table
            const recurringExpenses = await this.getRecurringExpenses();
            
            if (recurringExpenses.length === 0) {
                logger.info('No recurring expenses found');
                return result;
            }

            logger.info(`Found ${recurringExpenses.length} recurring expenses to check`);

            for (const recurringEntry of recurringExpenses) {
                try {
                    if (this.isDue(recurringEntry)) {
                        logger.info(`Processing due recurring expense: ${recurringEntry.description}`);
                        
                        // Check if this is the first time processing this recurring expense
                        const isFirstProcessing = !recurringEntry.lastProcessed || recurringEntry.lastProcessed === '';
                        const originalDate = parseDate(recurringEntry.date, this.getTimezonePreference());
                        const nextDueDate = parseDate(recurringEntry.nextDue, this.getTimezonePreference());
                        
                        let expensesToCreate: { expense: ExpenseEntry, date: Date }[] = [];
                        
                        if (isFirstProcessing) {
                            // For first-time processing, check for missed occurrences
                            logger.info(`First-time processing for ${recurringEntry.description}, checking for backfill from ${originalDate.toISOString()}`);
                            
                            const missedOccurrences = this.calculateMissedOccurrences(
                                originalDate, 
                                recurringEntry.recurring as Recurrence,
                                24 // Max 24 backfill entries to prevent overwhelming
                            );
                            
                            // Create expenses for all missed occurrences
                            for (const missedDate of missedOccurrences) {
                                const expenseForDate = this.createExpenseFromRecurring(recurringEntry, missedDate);
                                expensesToCreate.push({ expense: expenseForDate, date: missedDate });
                            }
                            
                            // Also create one for the current due date if it's different from the last missed occurrence
                            const now = new Date();
                            if (nextDueDate <= now && !missedOccurrences.some(d => Math.abs(d.getTime() - nextDueDate.getTime()) < 86400000)) {
                                const currentExpense = this.createExpenseFromRecurring(recurringEntry, nextDueDate);
                                expensesToCreate.push({ expense: currentExpense, date: nextDueDate });
                            }
                        } else {
                            // Regular processing - just create one for the current due date
                            const newExpense = this.createExpenseFromRecurring(recurringEntry, nextDueDate);
                            expensesToCreate.push({ expense: newExpense, date: nextDueDate });
                        }
                        
                        logger.info(`Creating ${expensesToCreate.length} expense entries for ${recurringEntry.description}`);
                        
                        let successCount = 0;
                        let lastSuccessDate = nextDueDate;
                        
                        // Group expenses by year-month for efficient processing
                        const expensesByYearMonth = new Map<string, { expense: ExpenseEntry, date: Date }[]>();
                        
                        for (const expenseEntry of expensesToCreate) {
                            const yearMonth = getTargetYearMonth(expenseEntry.expense);
                            if (!expensesByYearMonth.has(yearMonth)) {
                                expensesByYearMonth.set(yearMonth, []);
                            }
                            expensesByYearMonth.get(yearMonth)!.push(expenseEntry);
                        }
                        
                        // Process each group by moving directly to monthly documents (skip summary generation)
                        for (const [yearMonth, groupExpenses] of expensesByYearMonth) {
                            try {
                                const expenses = groupExpenses.map(g => g.expense);
                                await this.getExpenseService().moveExpensesToMonth(expenses, yearMonth, true); // Skip summary generation
                                
                                // Track success
                                for (const { expense, date } of groupExpenses) {
                                    result.newExpenses.push(expense);
                                    result.created++;
                                    successCount++;
                                    lastSuccessDate = date;
                                    logger.info(`Successfully created expense for ${date.toISOString()}: ${expense.description} in ${yearMonth}`);
                                }
                            } catch (error) {
                                // Track failures for this group
                                for (const { date } of groupExpenses) {
                                    result.errors.push(`Failed to create expense for ${date.toISOString()} from recurring "${recurringEntry.description}" in ${yearMonth}: ${error.message}`);
                                }
                            }
                        }
                        
                        // Update the recurring entry's next due date
                        if (successCount > 0) {
                            console.log('🔄 PROCESS: About to update recurring entry:', recurringEntry.description);
                            console.log('🔄 PROCESS: Last success date:', lastSuccessDate.toISOString());
                            
                            const now = new Date();
                            let nextOccurrence: Date;
                            
                            if (isFirstProcessing) {
                                // For first-time processing with backfill, calculate next due from current time
                                // Find the next occurrence that would be after now
                                const originalDate = parseDate(recurringEntry.date, this.getTimezonePreference());
                                let candidateDate = new Date(originalDate);
                                
                                // Keep advancing until we get a future date
                                while (candidateDate <= now) {
                                    candidateDate = this.calculateNextOccurrence(candidateDate, recurringEntry.recurring as Recurrence);
                                }
                                nextOccurrence = candidateDate;
                                console.log('🔄 PROCESS: First-time processing - next due calculated from current time:', nextOccurrence.toISOString());
                            } else {
                                // Regular processing - calculate from the last success date
                                nextOccurrence = this.calculateNextOccurrence(lastSuccessDate, recurringEntry.recurring as Recurrence);
                                console.log('🔄 PROCESS: Regular processing - next due calculated from last success:', nextOccurrence.toISOString());
                            }
                            
                            const updatedRecurring: RecurringExpenseEntry = {
                                ...recurringEntry,
                                lastProcessed: now.toISOString(),
                                nextDue: nextOccurrence.toISOString()
                            };
                            
                            console.log('🔄 PROCESS: Final nextDue calculated:', updatedRecurring.nextDue);

                            // Critical: Update recurring expense with retry logic
                            // This prevents nextDue from getting out of sync if the update fails
                            let updateSuccess = false;
                            let updateAttempts = 0;
                            const maxUpdateAttempts = 3;

                            while (!updateSuccess && updateAttempts < maxUpdateAttempts) {
                                try {
                                    updateAttempts++;
                                    await this.updateRecurringExpense(updatedRecurring);
                                    updateSuccess = true;
                                    logger.info(`Successfully processed ${successCount} expenses and updated recurring entry: ${recurringEntry.description}`);
                                } catch (updateError) {
                                    logger.error(`Failed to update recurring expense (attempt ${updateAttempts}/${maxUpdateAttempts}):`, updateError);

                                    if (updateAttempts < maxUpdateAttempts) {
                                        // Wait briefly before retrying (exponential backoff: 100ms, 200ms)
                                        await new Promise(resolve => setTimeout(resolve, 100 * updateAttempts));
                                    } else {
                                        // Final attempt failed - log critical error
                                        // The deduplication logic will prevent actual duplicates on next run
                                        const criticalError = `CRITICAL: Created ${successCount} expenses but failed to update nextDue for "${recurringEntry.description}". Deduplication will prevent duplicates on next run.`;
                                        logger.error(criticalError);
                                        result.errors.push(criticalError);
                                    }
                                }
                            }
                        }
                        
                        result.processed++;
                    }
                } catch (error) {
                    result.errors.push(`Error processing recurring expense "${recurringEntry.description}": ${safeErrorMessage(error)}`);
                    logger.error('Error processing individual recurring expense', error);
                }
            }

            // Generate summaries for all affected months/years after all recurring expenses are processed
            if (result.created > 0) {
                logger.info('Generating summaries for all affected documents after recurring expense processing...');
                await this.refreshSummariesAfterRecurringProcessing(result.newExpenses);
            }

            logger.info(`Recurring processing completed: ${result.created} created, ${result.processed} processed, ${result.errors.length} errors`);
            return result;

        } catch (error) {
            logger.error('Failed to process recurring expenses', error);
            result.errors.push(`Processing failed: ${safeErrorMessage(error)}`);
            return result;
        }
    }

    /**
     * Get all recurring expenses from the tracking table
     */
    async getRecurringExpenses(): Promise<RecurringExpenseEntry[]> {
        try {
            const recurringNoteId = await this.folderService.ensureRecurringExpensesDocumentExists();
            const note = await joplin.data.get(['notes', recurringNoteId], { fields: ['body'] });
            return this.parseRecurringExpensesTable(note.body);
        } catch (error) {
            logger.error('Failed to get recurring expenses', error);
            return [];
        }
    }

    /**
     * Parse the recurring expenses table from markdown
     */
    parseRecurringExpensesTable(markdown: string): RecurringExpenseEntry[] {
        const lines = markdown.split('\n');
        const entries: RecurringExpenseEntry[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && line.includes('recurring') && line.includes('nextDue')) {
                let dataIdx = i + 2; // Skip header and separator
                
                while (dataIdx < lines.length && lines[dataIdx].trim().startsWith('|')) {
                    const cells = lines[dataIdx].split('|').map(c => c.trim());
                    if (cells.length < 12) { dataIdx++; continue; } // Skip incomplete rows
                    
                    // Skip empty/placeholder rows
                    const description = cells[2];
                    if (!description || description === '---' || description === '') {
                        dataIdx++;
                        continue;
                    }
                    
                    const entry: RecurringExpenseEntry = {
                        price: parseFloat(cells[1]) || 0,
                        description: description,
                        category: cells[3],
                        date: cells[4],
                        shop: cells[5],
                        attachment: cells[6] || undefined,
                        recurring: cells[7],
                        lastProcessed: cells[8],
                        nextDue: cells[9],
                        enabled: cells[10].toLowerCase() === 'true',
                        sourceNoteId: cells[11] || undefined
                    };
                    entries.push(entry);
                    dataIdx++;
                }
                break;
            }
        }
        return entries;
    }

    /**
     * Serialize recurring expenses to markdown table
     */
    serializeRecurringExpensesTable(entries: RecurringExpenseEntry[]): string {
        const header = 
            "| price | description | category | date | shop | attachment | recurring | lastProcessed | nextDue | enabled | sourceNoteId |\n" +
            "|-------|-------------|----------|------|------|------------|-----------|---------------|---------|---------|--------------|";
        
        const rows = entries.map(e =>
            `| ${e.price} | ${e.description} | ${e.category} | ${e.date} | ${e.shop} | ${e.attachment ?? ""} | ${e.recurring} | ${e.lastProcessed} | ${e.nextDue} | ${e.enabled} | ${e.sourceNoteId ?? ""} |`
        );
        return [header, ...rows].join('\n');
    }

    /**
     * Add or update a recurring expense in the tracking table
     */
    async updateRecurringExpense(recurringEntry: RecurringExpenseEntry): Promise<void> {
        try {
            console.log('🔄 UPDATE: Starting updateRecurringExpense for:', recurringEntry.description);
            console.log('🔄 UPDATE: New nextDue value:', recurringEntry.nextDue);
            
            const recurringNoteId = await this.folderService.ensureRecurringExpensesDocumentExists();
            const note = await joplin.data.get(['notes', recurringNoteId], { fields: ['body'] });
            
            console.log('🔄 UPDATE: Retrieved note body length:', note.body.length);
            
            const existingEntries = this.parseRecurringExpensesTable(note.body);
            console.log('🔄 UPDATE: Parsed', existingEntries.length, 'existing entries');
            
            // Find and update existing entry or add new one
            // Use a more robust matching strategy
            const existingIndex = existingEntries.findIndex(e => {
                // First try to match by exact description, category, and price
                const exactMatch = 
                    e.description.trim() === recurringEntry.description.trim() &&
                    e.category.trim() === recurringEntry.category.trim() &&
                    Math.abs(e.price - recurringEntry.price) < 0.01; // Handle floating point precision

                // If exact match fails, try by description and category only (more lenient)
                const lenientMatch = exactMatch || (
                    e.description.trim().toLowerCase() === recurringEntry.description.trim().toLowerCase() &&
                    e.category.trim().toLowerCase() === recurringEntry.category.trim().toLowerCase() &&
                    e.recurring === recurringEntry.recurring
                );

                return lenientMatch;
            });
            
            if (existingIndex !== -1) {
                console.log('🔄 UPDATE: Found existing entry at index', existingIndex);
                console.log('🔄 UPDATE: Old nextDue:', existingEntries[existingIndex].nextDue);
                console.log('🔄 UPDATE: New nextDue:', recurringEntry.nextDue);
                existingEntries[existingIndex] = recurringEntry;
                console.log('🔄 UPDATE: Updated entry nextDue:', existingEntries[existingIndex].nextDue);
            } else {
                console.log('🔄 UPDATE: No existing entry found, adding new one');
                existingEntries.push(recurringEntry);
            }
            
            // Update the document
            console.log('🔄 UPDATE: About to update document body');
            const updatedBody = this.updateRecurringTableInContent(note.body, existingEntries);
            
            // Debug: Log the updated recurring entry
            if (existingIndex !== -1) {
                const updatedEntry = existingEntries[existingIndex];
                console.log('🔄 UPDATE: Final entry nextDue before save:', updatedEntry.nextDue);
            }
            
            console.log('🔄 UPDATE: About to save document with updated body length:', updatedBody.length);
            await joplin.data.put(['notes', recurringNoteId], null, { body: updatedBody });
            console.log('🔄 UPDATE: Document saved successfully');
            
        } catch (error) {
            logger.error('Failed to update recurring expense', error);
            throw error;
        }
    }

    /**
     * Update recurring expenses table in document content
     */
    private updateRecurringTableInContent(content: string, entries: RecurringExpenseEntry[]): string {
        console.log('🔄 TABLE: Updating recurring table with', entries.length, 'entries');
        console.log('🔄 TABLE: Entry nextDue values:', entries.map(e => `${e.description}: ${e.nextDue}`));
        
        const lines = content.split('\n');
        const newTable = this.serializeRecurringExpensesTable(entries);
        console.log('🔄 TABLE: Generated new table:', newTable);
        
        // Find ALL instances of recurring table headers (more robust approach)
        const tableRanges: { start: number, end: number }[] = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Look for recurring table header - must contain specific fields
            if (line.startsWith('|') && 
                line.includes('recurring') && 
                line.includes('nextDue') &&
                line.includes('lastProcessed') &&
                line.includes('enabled')) {
                
                let tableStart = i;
                let tableEnd = i + 1;
                
                // Skip the separator line if it exists
                if (tableEnd < lines.length && 
                    lines[tableEnd].trim().startsWith('|') && 
                    lines[tableEnd].trim().includes('-')) {
                    tableEnd++;
                }
                
                // Find all consecutive table rows
                while (tableEnd < lines.length) {
                    const currentLine = lines[tableEnd].trim();
                    
                    // Stop at: empty line, non-table line, headers, comments
                    if (currentLine === '') {
                        break;
                    } else if (!currentLine.startsWith('|')) {
                        break;
                    } else if (currentLine.startsWith('#')) {
                        break;
                    } else if (currentLine.startsWith('<!--')) {
                        break;
                    } else if (currentLine.includes('recurring') && 
                               currentLine.includes('nextDue') && 
                               tableEnd > tableStart) {
                        // Another table header - don't include it
                        break;
                    }
                    
                    tableEnd++;
                }
                
                // Record this table range
                tableRanges.push({ start: tableStart, end: tableEnd });
                
                logger.info(`Found recurring table at lines ${tableStart + 1}-${tableEnd}, ${tableEnd - tableStart} lines`);
                
                // Skip ahead to avoid overlapping ranges
                i = tableEnd;
            }
        }
        
        if (tableRanges.length === 0) {
            // No existing table found, append new table
            logger.info('No existing recurring table found, appending new table');
            return content + '\n\n## Recurring Expenses\n\n' + newTable;
        }
        
        // Remove all found tables (in reverse order to maintain indices)
        let modifiedLines = [...lines];
        
        for (let i = tableRanges.length - 1; i >= 0; i--) {
            const range = tableRanges[i];
            logger.info(`Removing recurring table range ${range.start + 1}-${range.end} (${range.end - range.start} lines)`);
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
        
        logger.info(`Inserted new recurring table with ${entries.length} entries at position ${insertPosition + 1}`);
        
        return result;
    }

    /**
     * Convert regular expense entry to recurring expense entry
     */
    convertToRecurringExpense(expense: ExpenseEntry, recurring: Recurrence, sourceNoteId?: string): RecurringExpenseEntry {
        const expenseDate = parseDate(expense.date, this.getTimezonePreference());
        
        // Set nextDue to the original expense date for first-time processing
        // This allows backfilling from the original date when first processed
        const nextDue = expenseDate;
        
        return {
            ...expense,
            recurring,
            lastProcessed: '', // Empty to indicate first-time processing needed
            nextDue: nextDue.toISOString(),
            enabled: true,
            sourceNoteId
        };
    }

    /**
     * Refresh summaries for all months/years affected by recurring expense processing
     */
    private async refreshSummariesAfterRecurringProcessing(newExpenses: ExpenseEntry[]): Promise<void> {
        try {
            // Group expenses by year-month to identify affected documents
            const affectedMonths = new Set<string>();
            const affectedYears = new Set<string>();
            
            for (const expense of newExpenses) {
                const yearMonth = getTargetYearMonth(expense);
                const year = yearMonth.split('-')[0];
                
                affectedMonths.add(yearMonth);
                affectedYears.add(year);
            }
            
            logger.info(`Refreshing summaries for ${affectedMonths.size} months across ${affectedYears.size} years`);
            
            // Refresh monthly summaries
            for (const yearMonth of affectedMonths) {
                try {
                    const [year, month] = yearMonth.split('-');
                    const folderStructure = await this.folderService.getFolderStructure(year);
                    const monthlyNoteId = await this.folderService.findNoteInFolder(folderStructure.yearFolder, month);
                    
                    if (monthlyNoteId) {
                        await this.summaryService.onNoteSaved(monthlyNoteId);
                        logger.info(`Updated monthly summary for ${yearMonth}`);
                    }
                } catch (error) {
                    logger.warn(`Failed to update monthly summary for ${yearMonth}:`, error);
                }
            }
            
            // Refresh annual summaries
            for (const year of affectedYears) {
                try {
                    const folderStructure = await this.folderService.getFolderStructure(year);
                    const annualSummaryId = folderStructure.annualSummary;
                    
                    if (annualSummaryId) {
                        await this.summaryService.onNoteSaved(annualSummaryId);
                        logger.info(`Updated annual summary for ${year}`);
                    }
                } catch (error) {
                    logger.warn(`Failed to update annual summary for ${year}:`, error);
                }
            }
            
            logger.info(`Summary refresh completed for recurring expense processing`);
        } catch (error) {
            logger.error('Failed to refresh summaries after recurring processing:', error);
        }
    }
}