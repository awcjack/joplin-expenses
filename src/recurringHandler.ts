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
        
        switch (recurrence) {
            case 'daily':
                nextDate.setDate(nextDate.getDate() + 1);
                break;
            case 'weekly':
                nextDate.setDate(nextDate.getDate() + 7);
                break;
            case 'monthly':
                nextDate.setMonth(nextDate.getMonth() + 1);
                break;
            case 'yearly':
                nextDate.setFullYear(nextDate.getFullYear() + 1);
                break;
            default:
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
        const nextDue = this.calculateNextOccurrence(now, recurringEntry.recurring as Recurrence);
        
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
                        
                        // Create new expense entry
                        const newExpense = this.createExpenseFromRecurring(recurringEntry);
                        
                        // Add to new-expenses document
                        const addResult = await this.getExpenseService().addNewExpense(newExpense);
                        
                        if (addResult.success) {
                            result.newExpenses.push(newExpense);
                            result.created++;
                            
                            // Update the recurring entry's next due date
                            const updatedRecurring = this.updateRecurringEntry(recurringEntry);
                            await this.updateRecurringExpense(updatedRecurring);
                            
                            logger.info(`Successfully created recurring expense: ${newExpense.description}`);
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
            const recurringNoteId = await this.folderService.ensureRecurringExpensesDocumentExists();
            const note = await joplin.data.get(['notes', recurringNoteId], { fields: ['body'] });
            
            const existingEntries = this.parseRecurringExpensesTable(note.body);
            
            // Find and update existing entry or add new one
            const existingIndex = existingEntries.findIndex(e => 
                e.description === recurringEntry.description &&
                e.category === recurringEntry.category &&
                e.price === recurringEntry.price &&
                e.shop === recurringEntry.shop
            );
            
            if (existingIndex !== -1) {
                existingEntries[existingIndex] = recurringEntry;
            } else {
                existingEntries.push(recurringEntry);
            }
            
            // Update the document
            const updatedBody = this.updateRecurringTableInContent(note.body, existingEntries);
            await joplin.data.put(['notes', recurringNoteId], null, { body: updatedBody });
            
        } catch (error) {
            logger.error('Failed to update recurring expense', error);
            throw error;
        }
    }

    /**
     * Update recurring expenses table in document content
     */
    private updateRecurringTableInContent(content: string, entries: RecurringExpenseEntry[]): string {
        const lines = content.split('\n');
        let headerIdx = -1;
        let separatorIdx = -1;
        
        // Find the recurring table header
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && line.includes('recurring') && line.includes('nextDue')) {
                headerIdx = i;
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1].trim();
                    if (nextLine.startsWith('|') && nextLine.includes('-')) {
                        separatorIdx = i + 1;
                    }
                }
                break;
            }
        }
        
        if (headerIdx === -1) {
            // No existing table found, append new table
            return content + '\n\n## Recurring Expenses\n\n' + this.serializeRecurringExpensesTable(entries);
        }
        
        // Find the end of the existing table
        let endIdx = separatorIdx !== -1 ? separatorIdx + 1 : headerIdx + 1;
        
        while (endIdx < lines.length) {
            const line = lines[endIdx].trim();
            if (line === '' || !line.startsWith('|') || line.startsWith('#')) {
                break;
            }
            endIdx++;
        }
        
        // Generate new table content
        const newTable = this.serializeRecurringExpensesTable(entries);
        
        // Replace the table section
        const beforeTable = lines.slice(0, headerIdx);
        const afterTable = lines.slice(endIdx);
        
        return [
            ...beforeTable,
            newTable,
            ...afterTable
        ].join('\n');
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