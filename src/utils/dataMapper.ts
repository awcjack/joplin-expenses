import { MoneyWalletCSVRow, ExpenseEntry } from '../types';
import { getCurrentDateTime } from './dateUtils';
import { logger } from './logger';

/**
 * Convert MoneyWallet datetime format to ISO8601 format
 * MoneyWallet format: YYYY-MM-DD HH:mm:ss OR ISO8601 format (already valid)
 * Target format: ISO8601 string
 */
function convertDateTime(moneyWalletDateTime: string): string {
    try {
        const trimmed = moneyWalletDateTime.trim();
        
        // Check if it's already in ISO8601 format
        const iso8601Regex = /^((\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\d|3[01])|(0[469]|11)-(0[1-9]|[12]\d|30)|(02)-(0[1-9]|1\d|2[0-8])))T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}([+-]([01]\d|2[0-3]):[0-5]\d|Z)$/;
        if (iso8601Regex.test(trimmed)) {
            // Already in ISO format, validate and return
            const date = new Date(trimmed);
            if (isNaN(date.getTime())) {
                logger.warn(`Invalid ISO datetime value: ${trimmed}, using current date`);
                return getCurrentDateTime();
            }
            return trimmed;
        }
        
        // Check for MoneyWallet format: YYYY-MM-DD HH:mm:ss
        const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
        if (dateTimeRegex.test(trimmed)) {
            // Convert to ISO8601 by replacing space with 'T' and adding timezone
            const isoDateTime = trimmed.replace(' ', 'T') + '.000Z';
            
            // Validate by creating Date object
            const date = new Date(isoDateTime);
            if (isNaN(date.getTime())) {
                logger.warn(`Invalid converted datetime value: ${trimmed}, using current date`);
                return getCurrentDateTime();
            }
            
            return isoDateTime;
        }
        
        // Neither format matched
        logger.warn(`Unsupported datetime format: ${trimmed}, using current date`);
        return getCurrentDateTime();
        
    } catch (error) {
        logger.warn(`Error converting datetime ${moneyWalletDateTime}: ${error.message}, using current date`);
        return getCurrentDateTime();
    }
}

/**
 * Convert MoneyWallet money string to number
 * MoneyWallet format: "45.89" or "-23.56" (can include commas)
 * MoneyWallet convention: negative values = expenses, positive values = income
 * Joplin convention: positive values = expenses, negative values = income
 * So we need to invert the sign for proper mapping
 */
function convertMoney(moneyString: string): number {
    try {
        const trimmed = moneyString.trim();
        
        // Remove any currency symbols and commas
        const cleaned = trimmed.replace(/[^\d.-]/g, '');
        
        const parsed = parseFloat(cleaned);
        
        if (isNaN(parsed)) {
            logger.warn(`Invalid money value: ${moneyString}, using 0`);
            return 0;
        }
        
        // Invert the sign to match Joplin's convention:
        // MoneyWallet: negative = expenses, positive = income
        // Joplin: positive = expenses, negative = income
        return -parsed;
        
    } catch (error) {
        logger.warn(`Error converting money ${moneyString}: ${error.message}, using 0`);
        return 0;
    }
}

/**
 * Map MoneyWallet category to Joplin expense category
 * This function can be extended to handle category mappings
 */
function mapCategory(moneyWalletCategory: string): string {
    const trimmed = moneyWalletCategory.trim().toLowerCase();
    
    // Category mapping dictionary (can be extended)
    const categoryMap: Record<string, string> = {
        'car expenses': 'transport',
        'car': 'transport',
        'vehicle': 'transport',
        'fuel': 'transport',
        'gas': 'transport',
        'grocery': 'food',
        'groceries': 'food',
        'restaurant': 'food',
        'dining': 'food',
        'eating': 'food',
        'supermarket': 'food',
        'electricity': 'utilities',
        'water': 'utilities',
        'internet': 'utilities',
        'phone': 'utilities',
        'mobile': 'utilities',
        'rent': 'utilities',
        'movie': 'entertainment',
        'movies': 'entertainment',
        'cinema': 'entertainment',
        'games': 'entertainment',
        'gaming': 'entertainment',
        'music': 'entertainment',
        'books': 'entertainment',
        'clothes': 'shopping',
        'clothing': 'shopping',
        'shoes': 'shopping',
        'electronics': 'shopping',
        'salary': 'income',
        'wage': 'income',
        'bonus': 'income',
        'freelance': 'income',
        'investment': 'income'
    };
    
    // Check if we have a mapping for this category
    if (categoryMap[trimmed]) {
        return categoryMap[trimmed];
    }
    
    // Return the original category if no mapping found
    return moneyWalletCategory.trim();
}

/**
 * Map MoneyWallet wallet name to shop field
 * Uses event field if available, otherwise wallet name, otherwise description
 */
function mapWalletToShop(wallet: string, event?: string, description?: string): string {
    // If event is provided and not empty, prefer it over wallet
    if (event && event.trim().length > 0) {
        return event.trim();
    }
    
    // If wallet is provided and not empty, use it
    if (wallet && wallet.trim().length > 0) {
        return wallet.trim();
    }
    
    // If both wallet and event are empty, use description as fallback
    if (description && description.trim().length > 0) {
        return description.trim();
    }
    
    // Final fallback
    return 'Unknown';
}

/**
 * Map a single MoneyWallet CSV row to Joplin ExpenseEntry
 */
export function mapMoneyWalletRowToExpenseEntry(csvRow: MoneyWalletCSVRow): ExpenseEntry {
    try {
        const expenseEntry: ExpenseEntry = {
            price: convertMoney(csvRow.money),
            description: csvRow.description.trim(),
            category: mapCategory(csvRow.category),
            date: convertDateTime(csvRow.datetime),
            shop: mapWalletToShop(csvRow.wallet, csvRow.event, csvRow.description),
            attachment: '', // Always empty as per requirements
            recurring: ''   // Always empty as per requirements (set to false equivalent)
        };
        
        // Validate required fields
        if (!expenseEntry.description) {
            throw new Error('Description cannot be empty');
        }
        
        if (!expenseEntry.category) {
            throw new Error('Category cannot be empty');
        }
        
        if (!expenseEntry.shop) {
            throw new Error('Shop/wallet cannot be empty');
        }
        
        return expenseEntry;
        
    } catch (error) {
        logger.error(`Error mapping CSV row to expense entry: ${error.message}`, csvRow);
        throw new Error(`Failed to map CSV row: ${error.message}`);
    }
}

/**
 * Map multiple MoneyWallet CSV rows to Joplin ExpenseEntry array
 */
export function mapMoneyWalletRowsToExpenseEntries(csvRows: MoneyWalletCSVRow[]): {
    success: ExpenseEntry[];
    failed: { row: MoneyWalletCSVRow; error: string }[];
} {
    const success: ExpenseEntry[] = [];
    const failed: { row: MoneyWalletCSVRow; error: string }[] = [];
    
    for (const csvRow of csvRows) {
        try {
            const expenseEntry = mapMoneyWalletRowToExpenseEntry(csvRow);
            success.push(expenseEntry);
        } catch (error) {
            failed.push({
                row: csvRow,
                error: error.message
            });
            logger.warn(`Failed to map CSV row: ${error.message}`, csvRow);
        }
    }
    
    logger.info(`Mapping completed: ${success.length} successful, ${failed.length} failed`);
    
    return { success, failed };
}

/**
 * Get currency symbol from currency code
 * Basic currency symbol mapping
 */
export function getCurrencySymbol(currencyCode: string): string {
    const currencyMap: Record<string, string> = {
        'USD': '$',
        'EUR': '€',
        'GBP': '£',
        'JPY': '¥',
        'CNY': '¥',
        'CAD': 'C$',
        'AUD': 'A$',
        'CHF': 'CHF',
        'SEK': 'kr',
        'NOK': 'kr',
        'DKK': 'kr'
    };
    
    const code = currencyCode.toUpperCase().trim();
    return currencyMap[code] || code;
}

/**
 * Validate if MoneyWallet CSV row has minimum required data
 */
export function isValidMoneyWalletRow(csvRow: MoneyWalletCSVRow): boolean {
    return !!(
        csvRow.wallet &&
        csvRow.category &&
        csvRow.datetime &&
        csvRow.money &&
        csvRow.description
    );
}