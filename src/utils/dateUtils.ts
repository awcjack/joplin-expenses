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
 * Validate date string format (accepts various common formats)
 */
export function isValidDate(dateStr: string): boolean {
    if (!dateStr || typeof dateStr !== 'string') return false;
    
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    
    // For YYYY-MM-DD format, verify the components match the input
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const parts = dateStr.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        
        return date.getFullYear() === year &&
               (date.getMonth() + 1) === month &&
               date.getDate() === day;
    }
    
    // For ISO-like formats with time (YYYY-MM-DDTHH:mm:ss or with timezone)
    if (/^\d{4}-\d{2}-\d{2}T/.test(dateStr)) {
        const datePart = dateStr.slice(0, 10);
        const parts = datePart.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        
        // Check if the date string has timezone info
        const hasTimezone = dateStr.includes('Z') || /[+-]\d{2}:\d{2}/.test(dateStr);
        
        if (hasTimezone) {
            // Use UTC methods for timezone-aware dates
            return date.getUTCFullYear() === year &&
                   (date.getUTCMonth() + 1) === month &&
                   date.getUTCDate() === day;
        } else {
            // Use local methods for simple datetime formats
            return date.getFullYear() === year &&
                   (date.getMonth() + 1) === month &&
                   date.getDate() === day;
        }
    }
    
    // For other formats, just check if Date object is valid
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
 * Parse date string and return Date object, treating dates without timezone according to the specified timezone preference
 */
export function parseDate(dateStr: string, timezonePreference: string = 'local'): Date {
    if (!dateStr) return new Date();
    
    // Check if the date string has timezone information
    const hasTimezone = dateStr.includes('Z') || /[+-]\d{2}:\d{2}/.test(dateStr);
    
    if (hasTimezone) {
        // Date has timezone info, parse normally
        return new Date(dateStr);
    }
    
    // Handle date without timezone based on preference
    if (timezonePreference === 'UTC') {
        // Force UTC interpretation by adding Z suffix
        let utcStr = dateStr;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            utcStr = dateStr + 'T00:00:00.000Z';
        } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateStr)) {
            utcStr = dateStr + '.000Z';
        }
        return new Date(utcStr);
    } else if (timezonePreference === 'local' || !timezonePreference) {
        // Date without timezone - treat as local time
        // For YYYY-MM-DD format, ensure it's treated as local date
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const [year, month, day] = dateStr.split('-').map(Number);
            return new Date(year, month - 1, day); // month is 0-based
        }
        
        // For YYYY-MM-DDTHH:mm:ss format without timezone, treat as local
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateStr)) {
            const [datePart, timePart] = dateStr.split('T');
            const [year, month, day] = datePart.split('-').map(Number);
            const [hour, minute, second] = timePart.split(':').map(Number);
            return new Date(year, month - 1, day, hour, minute, second || 0); // month is 0-based
        }
    } else if (/^[+-]\d{1,2}$/.test(timezonePreference)) {
        // Handle timezone offset format like '+8', '-5', etc.
        const offsetHours = parseInt(timezonePreference, 10);
        let utcStr = dateStr;
        
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            utcStr = dateStr + 'T00:00:00.000Z';
        } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateStr)) {
            utcStr = dateStr + '.000Z';
        }
        
        // Parse as UTC then adjust for the offset
        const utcDate = new Date(utcStr);
        utcDate.setHours(utcDate.getHours() - offsetHours); // Subtract offset to get the intended local time
        return utcDate;
    } else {
        // For other formats, fallback to local time
        console.warn(`Timezone '${timezonePreference}' not supported, using local time`);
        return parseDate(dateStr, 'local');
    }
    
    // Fallback to normal parsing for other formats
    return new Date(dateStr);
}
