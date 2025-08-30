import joplin from 'api';
import { CSVImportResult, MoneyWalletCSVRow, ExpenseEntry } from '../types';
import { validateMoneyWalletCSV, parseMoneyWalletCSV } from '../utils/csvParser';
import { mapMoneyWalletRowsToExpenseEntries, getCurrencySymbol } from '../utils/dataMapper';
import { ExpenseService } from './ExpenseService';
import { FolderService } from './FolderService';
import { SettingsService } from './SettingsService';
import { logger, safeErrorMessage } from '../utils/logger';
import { serializeExpenseTable, parseExpenseTables } from '../expenseParser';

export class CSVImportService {
    private static instance: CSVImportService;
    private expenseService: ExpenseService;
    private folderService: FolderService;
    private settingsService: SettingsService;

    private constructor() {
        this.expenseService = ExpenseService.getInstance();
        this.folderService = FolderService.getInstance();
        this.settingsService = SettingsService.getInstance();
    }

    public static getInstance(): CSVImportService {
        if (!CSVImportService.instance) {
            CSVImportService.instance = new CSVImportService();
        }
        return CSVImportService.instance;
    }

    /**
     * Import MoneyWallet CSV data into Joplin expenses
     */
    async importMoneyWalletCSV(csvContent: string, targetLocation: 'new-expenses' | 'direct-to-monthly' = 'new-expenses'): Promise<CSVImportResult> {
        const result: CSVImportResult = {
            success: false,
            imported: 0,
            failed: 0,
            errors: [],
            warnings: []
        };

        try {
            console.log('CSVImportService: Starting MoneyWallet CSV import process');
            console.log('CSVImportService: CSV content length:', csvContent.length);
            console.log('CSVImportService: Target location:', targetLocation);
            
            logger.info('Starting MoneyWallet CSV import process');

            // Step 1: Validate CSV format
            const validation = validateMoneyWalletCSV(csvContent);
            if (!validation.valid) {
                result.errors.push(...validation.errors);
                return result;
            }

            logger.info(`CSV validation passed: ${validation.rowCount} rows found`);

            // Step 2: Parse CSV data
            let csvRows: MoneyWalletCSVRow[];
            try {
                csvRows = parseMoneyWalletCSV(csvContent);
            } catch (error) {
                result.errors.push(`Failed to parse CSV: ${safeErrorMessage(error)}`);
                return result;
            }

            if (csvRows.length === 0) {
                result.errors.push('No valid data rows found in CSV file');
                return result;
            }

            logger.info(`Successfully parsed ${csvRows.length} CSV rows`);

            // Step 3: Map CSV data to expense entries
            const mappingResult = mapMoneyWalletRowsToExpenseEntries(csvRows);
            
            if (mappingResult.failed.length > 0) {
                mappingResult.failed.forEach(failure => {
                    result.warnings.push(`Row with description "${failure.row.description}": ${failure.error}`);
                });
            }

            if (mappingResult.success.length === 0) {
                result.errors.push('No valid expense entries could be created from CSV data');
                return result;
            }

            logger.info(`Successfully mapped ${mappingResult.success.length} expense entries`);

            // Step 4: Update categories if needed
            await this.updateCategoriesFromImport(mappingResult.success);

            // Step 5: Import expenses based on target location
            if (targetLocation === 'new-expenses') {
                await this.importToNewExpensesDocument(mappingResult.success, result);
            } else {
                await this.importDirectlyToMonthlyDocuments(mappingResult.success, result);
            }

            result.success = result.imported > 0;
            result.failed = mappingResult.failed.length;

            logger.info(`CSV import completed: ${result.imported} imported, ${result.failed} failed`);
            return result;

        } catch (error) {
            logger.error('CSV import failed', error);
            result.errors.push(`Import failed: ${safeErrorMessage(error)}`);
            return result;
        }
    }

    /**
     * Import expenses to new-expenses document
     */
    private async importToNewExpensesDocument(expenses: ExpenseEntry[], result: CSVImportResult): Promise<void> {
        try {
            // Get new-expenses document
            const newExpensesNoteId = await this.folderService.ensureNewExpensesDocumentExists();
            const note = await joplin.data.get(['notes', newExpensesNoteId], { fields: ['body'] });

            // Parse existing expenses
            const existingEntries = parseExpenseTables(note.body);

            // Add imported expenses
            const allExpenses = [...existingEntries, ...expenses];

            // Update document with all expenses
            const updatedBody = this.updateExpenseTableInContent(note.body, allExpenses);
            await joplin.data.put(['notes', newExpensesNoteId], null, { body: updatedBody });

            result.imported = expenses.length;
            logger.info(`Successfully added ${expenses.length} expenses to new-expenses document`);
            
            // Trigger summary update for new-expenses document
            try {
                const { SummaryService } = await import('./SummaryService');
                const summaryService = SummaryService.getInstance();
                await summaryService.onNoteSaved(newExpensesNoteId);
                logger.info(`Updated summaries for new-expenses document`);
            } catch (summaryError) {
                logger.warn(`Failed to update summaries for new-expenses document:`, summaryError);
            }

        } catch (error) {
            logger.error('Failed to import to new-expenses document', error);
            result.errors.push(`Failed to add expenses to new-expenses document: ${safeErrorMessage(error)}`);
        }
    }

    /**
     * Import expenses directly to their respective monthly documents
     */
    private async importDirectlyToMonthlyDocuments(expenses: ExpenseEntry[], result: CSVImportResult): Promise<void> {
        // Group expenses by year-month
        const expensesByMonth = new Map<string, ExpenseEntry[]>();

        for (const expense of expenses) {
            const date = new Date(expense.date);
            const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            
            if (!expensesByMonth.has(yearMonth)) {
                expensesByMonth.set(yearMonth, []);
            }
            expensesByMonth.get(yearMonth)!.push(expense);
        }

        // Process each month's expenses
        for (const [yearMonth, monthlyExpenses] of expensesByMonth) {
            try {
                const [year, month] = yearMonth.split('-');
                
                // Ensure folder structure exists
                await this.folderService.ensureYearStructureExists(year);
                const folderStructure = await this.folderService.getFolderStructure(year);
                
                // Get or create monthly document
                let monthlyNoteId = await this.folderService.findNoteInFolder(folderStructure.yearFolder, month);
                
                if (!monthlyNoteId) {
                    monthlyNoteId = await this.folderService.ensureMonthlyDocumentExists(folderStructure.yearFolder, year, month);
                }

                // Get existing content
                const monthlyNote = await joplin.data.get(['notes', monthlyNoteId], { fields: ['body'] });
                const existingExpenses = parseExpenseTables(monthlyNote.body);

                // Add imported expenses
                const allExpenses = [...existingExpenses, ...monthlyExpenses];

                // Update document
                const updatedBody = this.updateExpenseTableInContent(monthlyNote.body, allExpenses);
                await joplin.data.put(['notes', monthlyNoteId], null, { body: updatedBody });

                result.imported += monthlyExpenses.length;
                logger.info(`Added ${monthlyExpenses.length} expenses to ${yearMonth} document`);
                
                // Trigger summary update for this specific document
                try {
                    const { SummaryService } = await import('./SummaryService');
                    const summaryService = SummaryService.getInstance();
                    await summaryService.onNoteSaved(monthlyNoteId);
                    logger.info(`Updated summaries for ${yearMonth} document`);
                } catch (summaryError) {
                    logger.warn(`Failed to update summaries for ${yearMonth}:`, summaryError);
                }

            } catch (error) {
                logger.error(`Failed to import expenses for ${yearMonth}`, error);
                result.errors.push(`Failed to import expenses for ${yearMonth}: ${safeErrorMessage(error)}`);
                result.failed += monthlyExpenses.length;
                result.imported = Math.max(0, result.imported - monthlyExpenses.length);
            }
        }
    }

    /**
     * Update expense table in document content
     */
    private updateExpenseTableInContent(content: string, expenses: ExpenseEntry[]): string {
        // Look for existing expense table
        const lines = content.split('\n');
        let tableStart = -1;
        let tableEnd = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Look for expense table header
            if (line.includes('price') && line.includes('description') && line.includes('category')) {
                tableStart = i;
                // Find end of table
                for (let j = i + 2; j < lines.length; j++) {
                    if (!lines[j].trim().startsWith('|') || lines[j].trim() === '') {
                        tableEnd = j;
                        break;
                    }
                }
                if (tableEnd === -1) tableEnd = lines.length;
                break;
            }
        }

        const newTable = serializeExpenseTable(expenses);

        if (tableStart !== -1) {
            // Replace existing table
            const beforeTable = lines.slice(0, tableStart);
            const afterTable = lines.slice(tableEnd);
            return [...beforeTable, newTable, ...afterTable].join('\n');
        } else {
            // Add new table at the end
            const separator = content.trim().length > 0 ? '\n\n## Expense Table\n' : '## Expense Table\n';
            return content + separator + newTable;
        }
    }

    /**
     * Update plugin categories based on imported expense categories
     */
    private async updateCategoriesFromImport(expenses: ExpenseEntry[]): Promise<void> {
        try {
            const existingCategories = new Set(this.settingsService.getCategories());
            const importedCategories = new Set(expenses.map(e => e.category));
            
            // Find new categories
            const newCategories = Array.from(importedCategories).filter(cat => !existingCategories.has(cat));
            
            if (newCategories.length > 0) {
                const allCategories = [...this.settingsService.getCategories(), ...newCategories];
                await this.settingsService.updateCategories(allCategories);
                logger.info(`Added new categories from import: ${newCategories.join(', ')}`);
            }
        } catch (error) {
            logger.warn('Failed to update categories from import', error);
        }
    }

    /**
     * Get currency information from CSV data (for reporting purposes)
     */
    getCurrencyInfo(csvRows: MoneyWalletCSVRow[]): { currencies: string[]; symbols: string[] } {
        const uniqueCurrencies = Array.from(new Set(csvRows.map(row => row.currency.toUpperCase())));
        const symbols = uniqueCurrencies.map(getCurrencySymbol);
        
        return { currencies: uniqueCurrencies, symbols };
    }

    /**
     * Preview CSV data before import (returns first few rows for user verification)
     */
    async previewCSVData(csvContent: string, maxRows: number = 5): Promise<{
        valid: boolean;
        preview: ExpenseEntry[];
        errors: string[];
        totalRows: number;
        currencies: string[];
    }> {
        const result = {
            valid: false,
            preview: [] as ExpenseEntry[],
            errors: [] as string[],
            totalRows: 0,
            currencies: [] as string[]
        };

        try {
            // Validate CSV
            const validation = validateMoneyWalletCSV(csvContent);
            if (!validation.valid) {
                result.errors = validation.errors;
                return result;
            }

            // Parse CSV
            const csvRows = parseMoneyWalletCSV(csvContent);
            result.totalRows = csvRows.length;

            // Get currency info
            const currencyInfo = this.getCurrencyInfo(csvRows);
            result.currencies = currencyInfo.currencies;

            // Map preview rows
            const previewRows = csvRows.slice(0, maxRows);
            const mappingResult = mapMoneyWalletRowsToExpenseEntries(previewRows);
            
            result.preview = mappingResult.success;
            result.valid = true;

            if (mappingResult.failed.length > 0) {
                mappingResult.failed.forEach(failure => {
                    result.errors.push(`Row "${failure.row.description}": ${failure.error}`);
                });
            }

        } catch (error) {
            result.errors.push(`Preview failed: ${safeErrorMessage(error)}`);
        }

        return result;
    }
}