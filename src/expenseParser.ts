import { ExpenseEntry } from './types';
import { getYearFromDate, getMonthFromDate, getYearMonthFromDate, getCurrentDateTime, isValidDate } from './utils/dateUtils';

// Expense table schema, header row (case-insensitive, flexible whitespace):
const EXPENSE_HEADERS = [
    "price",
    "description",
    "category",
    "date",
    "shop",
    "attachment",
    "recurring"
];

// Helper to normalize headers for matching
function normalizeHeader(header: string): string {
    return header.trim().toLowerCase();
}

// Parse markdown expense tables matching the schema
export function parseExpenseTables(markdown: string): ExpenseEntry[] {
    const lines = markdown.split('\n');
    const entries: ExpenseEntry[] = [];
    let headerIdx = -1;

    for (let i = 0; i < lines.length; ++i) {
        const line = lines[i].trim();
        if (line.startsWith('|') && line.endsWith('|')) {
            // Possible header row
            const headers = line.split('|').map(normalizeHeader).filter(Boolean);
            // Check if all required headers are present (in order)
            if (headers.length >= 7 && EXPENSE_HEADERS.every((h, idx) => headers[idx] === h)) {
                headerIdx = i;
                // Next line may be separator, then actual data
                let dataIdx = i + 2;
                while (dataIdx < lines.length && lines[dataIdx].trim().startsWith('|')) {
                    const cells = lines[dataIdx].split('|').map(c => c.trim());
                    if (cells.length < 8) { dataIdx++; continue; } // skip incomplete rows
                    
                    // Skip empty/placeholder rows (check for --- or empty description)
                    const description = cells[2];
                    const category = cells[3];
                    if (!description || description === '---' || description === '' ||
                        !category || category === '---' || category === '') {
                        dataIdx++;
                        continue;
                    }
                    
                    // Map cells to schema
                    const entry: ExpenseEntry = {
                        price: parseFloat(cells[1]) || 0,
                        description: description,
                        category: category,
                        date: cells[4],
                        shop: cells[5],
                        attachment: cells[6] || undefined,
                        recurring: cells[7] || undefined,
                    };
                    entries.push(entry);
                    dataIdx++;
                }
                break; // Only first matching table
            }
        }
    }
    return entries;
}

// Serialize entries back to markdown expense table
export function serializeExpenseTable(entries: ExpenseEntry[]): string {
    const header =
        "| price | description | category | date | shop | attachment | recurring |\n" +
        "|-------|-------------|----------|------|------|------------|-----------|";
    
    // Sort entries by date in descending order (newest first)
    const sortedEntries = [...entries].sort((a, b) => {
        const dateA = new Date(a.date || '1970-01-01');
        const dateB = new Date(b.date || '1970-01-01');
        return dateB.getTime() - dateA.getTime(); // Descending order
    });
    
    const rows = sortedEntries.map(e =>
        `| ${e.price} | ${e.description} | ${e.category} | ${e.date} | ${e.shop} | ${e.attachment ?? ""} | ${e.recurring ?? ""} |`
    );
    return [header, ...rows].join('\n');
}

/**
 * Enhanced expense entry validation
 */
export function validateExpenseEntry(entry: Partial<ExpenseEntry>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (entry.price === undefined || entry.price === null || isNaN(entry.price)) {
        errors.push('Price is required and must be a valid number');
    }
    
    if (!entry.description || entry.description.trim().length === 0) {
        errors.push('Description is required');
    }
    
    if (!entry.category || entry.category.trim().length === 0) {
        errors.push('Category is required');
    }
    
    if (entry.date && !isValidDate(entry.date)) {
        errors.push('Date must be in valid format (YYYY-MM-DD or ISO)');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Get target year-month for an expense entry
 */
export function getTargetYearMonth(entry: ExpenseEntry): string {
    return getYearMonthFromDate(entry.date || getCurrentDateTime());
}

/**
 * Get target year for an expense entry
 */
export function getTargetYear(entry: ExpenseEntry): string {
    return getYearFromDate(entry.date || getCurrentDateTime());
}

/**
 * Get target month for an expense entry
 */
export function getTargetMonth(entry: ExpenseEntry): string {
    return getMonthFromDate(entry.date || getCurrentDateTime());
}

/**
 * Create a new expense entry with default values
 */
export function createNewExpenseEntry(overrides: Partial<ExpenseEntry> = {}): ExpenseEntry {
    return {
        price: 0,
        description: '',
        category: '',
        date: getCurrentDateTime(),
        shop: '',
        attachment: '',
        recurring: '',
        ...overrides
    };
}

/**
 * Filter entries by year-month
 */
export function filterEntriesByYearMonth(entries: ExpenseEntry[], yearMonth: string): ExpenseEntry[] {
    return entries.filter(entry => getYearMonthFromDate(entry.date) === yearMonth);
}

/**
 * Filter entries by year
 */
export function filterEntriesByYear(entries: ExpenseEntry[], year: string): ExpenseEntry[] {
    return entries.filter(entry => getYearFromDate(entry.date) === year);
}

/**
 * Filter entries by category
 */
export function filterEntriesByCategory(entries: ExpenseEntry[], category: string): ExpenseEntry[] {
    return entries.filter(entry => entry.category === category);
}