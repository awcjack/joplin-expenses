// Date utility functions for expense management

/**
 * Get current date in YYYY-MM-DD format
 */
export function getCurrentDate(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Get current datetime in ISO format
 */
export function getCurrentDateTime(): string {
    return new Date().toISOString();
}

/**
 * Extract year from date string (YYYY-MM-DD or ISO format)
 */
export function getYearFromDate(dateStr: string): string {
    if (!dateStr) return new Date().getFullYear().toString();
    return dateStr.slice(0, 4);
}

/**
 * Extract month from date string (YYYY-MM-DD or ISO format)
 * Returns MM format (01, 02, etc.)
 */
export function getMonthFromDate(dateStr: string): string {
    if (!dateStr) return String(new Date().getMonth() + 1).padStart(2, '0');
    return dateStr.slice(5, 7);
}

/**
 * Extract year-month from date string (YYYY-MM-DD or ISO format)
 * Returns YYYY-MM format
 */
export function getYearMonthFromDate(dateStr: string): string {
    if (!dateStr) {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    return dateStr.slice(0, 7);
}

/**
 * Get month name from month number (01-12)
 */
export function getMonthName(monthNum: string): string {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const num = parseInt(monthNum, 10);
    return months[num - 1] || monthNum;
}

/**
 * Generate all month numbers for a year (01-12)
 */
export function getAllMonths(): string[] {
    return Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
}

/**
 * Get current year as string
 */
export function getCurrentYear(): string {
    return new Date().getFullYear().toString();
}

/**
 * Get current month as MM string
 */
export function getCurrentMonth(): string {
    return String(new Date().getMonth() + 1).padStart(2, '0');
}

/**
 * Validate date string format (strict check)
 */
export function isValidDate(dateStr: string): boolean {
    if (!dateStr) return false;
    
    // Check basic format for YYYY-MM-DD or ISO format (with optional timezone)
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;
    if (!iso8601Regex.test(dateStr)) return false;
    
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    
    // For YYYY-MM-DD format, ensure the date wasn't auto-adjusted
    if (dateStr.length >= 10) {
        const parts = dateStr.slice(0, 10).split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        
        return date.getFullYear() === year &&
               (date.getMonth() + 1) === month &&
               date.getDate() === day;
    }
    
    return true;
}

/**
 * Format date for display (e.g., "2025-01" -> "January 2025")
 */
export function formatMonthYear(yearMonth: string): string {
    if (!yearMonth || yearMonth.length < 7) return yearMonth;
    const [year, month] = yearMonth.split('-');
    return `${getMonthName(month)} ${year}`;
}

/**
 * Get previous month in YYYY-MM format
 */
export function getPreviousMonth(yearMonth: string): string {
    const [year, month] = yearMonth.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    date.setMonth(date.getMonth() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get next month in YYYY-MM format
 */
export function getNextMonth(yearMonth: string): string {
    const [year, month] = yearMonth.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    date.setMonth(date.getMonth() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Parse date string and return Date object
 */
export function parseDate(dateStr: string): Date {
    if (!dateStr) return new Date();
    return new Date(dateStr);
}
