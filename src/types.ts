// Enhanced type definitions for the refactored expense plugin

export interface ExpenseEntry {
    price: number;            // can be negative for income
    description: string;
    category: string;
    date: string;             // ISO8601 with time
    shop: string;
    attachment?: string;      // markdown link or URL
    recurring?: string;       // daily, weekly, monthly, yearly, or blank
}

export interface ExpenseSummary {
    totalExpense: number;
    totalIncome: number;
    netAmount: number;
    byCategory: Record<string, number>;
    byMonth: Record<string, number>;
    entryCount: number;
}

export interface PluginSettings {
    categories: string[];
    autoProcessing: boolean;
    autoProcessNewExpenses: boolean;
    expensesFolderPath: string;
    defaultCurrency: string;
    autocompleteKeybind: string;
    defaultTimezone: string;
}

export interface FolderStructure {
    expensesFolder: string;
    yearFolder: string;
    monthlyNotes: string[];
    annualSummary: string;
    newExpensesNote: string;
}

export enum SummaryMarkerType {
    MONTHLY = 'monthly',
    ANNUAL = 'annual',
    BREAKDOWN = 'breakdown'
}

export interface SummaryMarker {
    type: SummaryMarkerType;
    category?: string;
    month?: string;
    year?: string;
    startIndex: number;
    endIndex: number;
    content: string;
}

export interface ExpenseProcessingResult {
    processed: number;
    failed: number;
    moved: ExpenseEntry[];
    errors: string[];
}

export type RecurrenceType = 'daily' | 'weekly' | 'monthly' | 'yearly' | '';

// MoneyWallet CSV import types
export interface MoneyWalletCSVRow {
    wallet: string;           // wallet name (will map to shop field)
    currency: string;         // ISO currency code
    category: string;         // category name
    datetime: string;         // YYYY-MM-DD HH:mm:ss format
    money: string;           // transaction amount as string
    description: string;      // transaction description
    event?: string;          // optional event name
    people?: string;         // optional people names (comma-separated)
}

export interface CSVImportResult {
    success: boolean;
    imported: number;
    failed: number;
    errors: string[];
    warnings: string[];
}

export interface CSVValidationResult {
    valid: boolean;
    errors: string[];
    rowCount: number;
    hasOptionalColumns: boolean;
}

// Default plugin settings
export const DEFAULT_SETTINGS: PluginSettings = {
    categories: [
        'food',
        'transport', 
        'utilities',
        'entertainment',
        'shopping',
        'income',
        'other'
    ],
    autoProcessing: true,
    autoProcessNewExpenses: true,
    expensesFolderPath: 'expenses',
    defaultCurrency: '$',
    autocompleteKeybind: 'Ctrl+Enter',
    defaultTimezone: 'local'
};

// Constants for folder structure
export const FOLDER_NAMES = {
    EXPENSES: 'expenses',
    NEW_EXPENSES: 'new-expenses'
} as const;

// Constants for comment markers
export const COMMENT_MARKERS = {
    MONTHLY_START: '<!-- expenses-summary-monthly',
    MONTHLY_END: '<!-- /expenses-summary-monthly -->',
    ANNUAL_START: '<!-- expenses-summary-annual', 
    ANNUAL_END: '<!-- /expenses-summary-annual -->',
    BREAKDOWN_START: '<!-- expenses-breakdown',
    BREAKDOWN_END: '<!-- /expenses-breakdown -->'
} as const;
