// Recurring expense processing logic

import joplin from 'api';
import { ExpenseEntry, RecurrenceType } from './types';
import { FolderService } from './services/FolderService';
import { ExpenseService } from './services/ExpenseService';
import { getCurrentDateTime, parseDate } from './utils/dateUtils';
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

    private constructor() {
        this.folderService = FolderService.getInstance();
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
        const dueDate = parseDate(recurringEntry.nextDue);
        
        return now >= dueDate;
    }

    /**
     * Create a new expense entry from a recurring template
     */
    createExpenseFromRecurring(recurringEntry: RecurringExpenseEntry): ExpenseEntry {
        return {
            price: recurringEntry.price,
            description: recurringEntry.description,
            category: recurringEntry.category,
            date: getCurrentDateTime(),
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
        const currentDue = parseDate(recurringEntry.nextDue);
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
                        
                        logger.info(`Processing recurring expense: ${recurringEntry.description}, current nextDue: ${recurringEntry.nextDue}`);
                        
                        // Create new expense entry
                        const newExpense = this.createExpenseFromRecurring(recurringEntry);
                        
                        // Add to new-expenses document
                        const addResult = await this.getExpenseService().addNewExpense(newExpense);
                        
                        if (addResult.success) {
                            result.newExpenses.push(newExpense);
                            result.created++;
                            
                            // Update the recurring entry's next due date
                            console.log('🔄 PROCESS: About to update recurring entry:', recurringEntry.description);
                            console.log('🔄 PROCESS: Current nextDue before update:', recurringEntry.nextDue);
                            const updatedRecurring = this.updateRecurringEntry(recurringEntry);
                            console.log('🔄 PROCESS: Updated recurring entry calculated, new nextDue:', updatedRecurring.nextDue);
                            
                            await this.updateRecurringExpense(updatedRecurring);
                            
                            logger.info(`Successfully created and updated recurring expense: ${newExpense.description}`);
                        } else {
                            result.errors.push(`Failed to create expense from recurring "${recurringEntry.description}": ${addResult.errors.join(', ')}`);
                        }
                        
                        result.processed++;
                    }
                } catch (error) {
                    result.errors.push(`Error processing recurring expense "${recurringEntry.description}": ${safeErrorMessage(error)}`);
                    logger.error('Error processing individual recurring expense', error);
                }
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
        let headerIdx = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && line.includes('recurring') && line.includes('nextDue')) {
                headerIdx = i;
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
        const now = new Date();
        const nextDue = this.calculateNextOccurrence(now, recurring);
        
        return {
            ...expense,
            recurring,
            lastProcessed: now.toISOString(),
            nextDue: nextDue.toISOString(),
            enabled: true,
            sourceNoteId
        };
    }
}