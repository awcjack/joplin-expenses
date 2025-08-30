import { MoneyWalletCSVRow, CSVValidationResult } from '../types';
import { logger } from './logger';

// Required MoneyWallet CSV headers
const REQUIRED_HEADERS = ['wallet', 'currency', 'category', 'datetime', 'money', 'description'];

// Optional MoneyWallet CSV headers
const OPTIONAL_HEADERS = ['event', 'people'];

// Column aliases - alternative names that map to standard columns
const COLUMN_ALIASES: Record<string, string> = {
    'place': 'event',        // 'place' is an alias for 'event'
    'note': 'people',        // 'note' can be treated as 'people' field
    'notes': 'people',       // 'notes' plural form
    'location': 'event',     // 'location' is another alias for 'event'
    'shop': 'event',         // 'shop' can map to 'event'
    'store': 'event'         // 'store' can map to 'event'
};

// All valid headers (required + optional + aliases)
const ALL_VALID_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS, ...Object.keys(COLUMN_ALIASES)];

/**
 * Normalize header for case-insensitive matching
 */
function normalizeHeader(header: string): string {
    return header.trim().toLowerCase();
}

/**
 * Parse CSV content into array of objects
 * Simple CSV parser that handles basic CSV format
 */
function parseCSVContent(csvContent: string): { headers: string[]; rows: string[][] } {
    const lines = csvContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length === 0) {
        throw new Error('CSV file is empty');
    }
    
    // Parse header row
    const headerLine = lines[0];
    const headers = parseCSVRow(headerLine);
    
    // Parse data rows
    const rows: string[][] = [];
    for (let i = 1; i < lines.length; i++) {
        try {
            const row = parseCSVRow(lines[i]);
            if (row.length > 0) { // Skip empty rows
                rows.push(row);
            }
        } catch (error) {
            logger.warn(`Skipping malformed CSV row ${i + 1}: ${error.message}`);
        }
    }
    
    return { headers, rows };
}

/**
 * Parse a single CSV row, handling quoted values and commas
 */
function parseCSVRow(row: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;
    
    while (i < row.length) {
        const char = row[i];
        const nextChar = row[i + 1];
        
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i += 2;
                continue;
            } else {
                // Start or end of quoted section
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of field
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
        
        i++;
    }
    
    // Add the last field
    result.push(current.trim());
    
    return result;
}

/**
 * Validate CSV structure and headers for MoneyWallet format
 */
export function validateMoneyWalletCSV(csvContent: string): CSVValidationResult {
    const result: CSVValidationResult = {
        valid: false,
        errors: [],
        rowCount: 0,
        hasOptionalColumns: false
    };
    
    try {
        if (!csvContent || csvContent.trim().length === 0) {
            result.errors.push('CSV content is empty');
            return result;
        }
        
        const { headers, rows } = parseCSVContent(csvContent);
        result.rowCount = rows.length;
        
        if (headers.length === 0) {
            result.errors.push('No headers found in CSV');
            return result;
        }
        
        // Normalize headers for comparison
        const normalizedHeaders = headers.map(normalizeHeader);
        
        // Check for required headers
        const missingRequired = REQUIRED_HEADERS.filter(reqHeader => 
            !normalizedHeaders.includes(reqHeader.toLowerCase())
        );
        
        if (missingRequired.length > 0) {
            result.errors.push(`Missing required columns: ${missingRequired.join(', ')}`);
            return result;
        }
        
        // Check for optional headers (including aliases)
        const hasOptional = OPTIONAL_HEADERS.some(optHeader => {
            // Check direct match
            if (normalizedHeaders.includes(optHeader.toLowerCase())) {
                return true;
            }
            // Check if any header is an alias for this optional header
            return normalizedHeaders.some(header => 
                COLUMN_ALIASES[header] === optHeader
            );
        });
        result.hasOptionalColumns = hasOptional;
        
        // Check for invalid headers
        const invalidHeaders = normalizedHeaders.filter(header =>
            !ALL_VALID_HEADERS.includes(header)
        );
        
        if (invalidHeaders.length > 0) {
            result.errors.push(`Invalid columns found: ${invalidHeaders.join(', ')}. Valid columns are: ${ALL_VALID_HEADERS.join(', ')}`);
            return result;
        }
        
        // Validate row consistency
        for (let i = 0; i < Math.min(rows.length, 10); i++) { // Check first 10 rows
            if (rows[i].length !== headers.length) {
                result.errors.push(`Row ${i + 2} has ${rows[i].length} columns but header has ${headers.length} columns`);
                return result;
            }
        }
        
        result.valid = true;
        logger.info(`CSV validation successful: ${result.rowCount} rows, optional columns: ${result.hasOptionalColumns}`);
        
    } catch (error) {
        result.errors.push(`CSV parsing error: ${error.message}`);
    }
    
    return result;
}

/**
 * Parse MoneyWallet CSV content into array of MoneyWalletCSVRow objects
 */
export function parseMoneyWalletCSV(csvContent: string): MoneyWalletCSVRow[] {
    const validation = validateMoneyWalletCSV(csvContent);
    
    if (!validation.valid) {
        throw new Error(`Invalid CSV format: ${validation.errors.join(', ')}`);
    }
    
    const { headers, rows } = parseCSVContent(csvContent);
    const normalizedHeaders = headers.map(normalizeHeader);
    
    // Create header index mapping with alias support
    const headerMap: Record<string, number> = {};
    normalizedHeaders.forEach((header, index) => {
        // Map the original header
        headerMap[header] = index;
        
        // Map any aliases to the same index
        if (COLUMN_ALIASES[header]) {
            headerMap[COLUMN_ALIASES[header]] = index;
        }
    });
    
    // Parse each row into MoneyWalletCSVRow object
    const parsedRows: MoneyWalletCSVRow[] = [];
    
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
            // Skip empty rows or rows with all empty values
            if (row.every(cell => !cell || cell.trim().length === 0)) {
                continue;
            }
            
            const parsedRow: MoneyWalletCSVRow = {
                wallet: row[headerMap['wallet']] || '',
                currency: row[headerMap['currency']] || '',
                category: row[headerMap['category']] || '',
                datetime: row[headerMap['datetime']] || '',
                money: row[headerMap['money']] || '',
                description: row[headerMap['description']] || ''
            };
            
            // Add optional fields if present
            if (headerMap['event'] !== undefined) {
                parsedRow.event = row[headerMap['event']] || '';
            }
            
            if (headerMap['people'] !== undefined) {
                parsedRow.people = row[headerMap['people']] || '';
            }
            
            // Validate required fields are not empty
            // Note: wallet can be empty as we'll use description as fallback for shop
            if (!parsedRow.currency || !parsedRow.category || 
                !parsedRow.datetime || !parsedRow.money || !parsedRow.description) {
                logger.warn(`Skipping row ${i + 2}: missing required field values`);
                continue;
            }
            
            parsedRows.push(parsedRow);
            
        } catch (error) {
            logger.warn(`Skipping row ${i + 2}: ${error.message}`);
        }
    }
    
    logger.info(`Successfully parsed ${parsedRows.length} rows from CSV`);
    return parsedRows;
}