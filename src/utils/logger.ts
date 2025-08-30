/**
 * Secure logging utility with production-safe filtering
 */

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || 
                      typeof window !== 'undefined' && window.location?.hostname === 'localhost';

/**
 * Safe logger that filters sensitive information in production
 */
export const logger = {
    /**
     * Log informational messages (filtered in production)
     */
    info: (message: string, data?: any) => {
        if (isDevelopment) {
            if (data !== undefined) {
                console.info(`[ExpensePlugin] ${message}`, data);
            } else {
                console.info(`[ExpensePlugin] ${message}`);
            }
        }
    },

    /**
     * Log warning messages (shown in production but sanitized)
     */
    warn: (message: string, data?: any) => {
        if (isDevelopment) {
            if (data !== undefined) {
                console.warn(`[ExpensePlugin] ${message}`, data);
            } else {
                console.warn(`[ExpensePlugin] ${message}`);
            }
        } else {
            // In production, only show the message without sensitive data
            console.warn(`[ExpensePlugin] ${message}`);
        }
    },

    /**
     * Log error messages (always shown but sanitized in production)
     */
    error: (message: string, error?: any) => {
        if (isDevelopment) {
            if (error !== undefined) {
                console.error(`[ExpensePlugin] ${message}`, error);
            } else {
                console.error(`[ExpensePlugin] ${message}`);
            }
        } else {
            // In production, only show sanitized error information
            if (error instanceof Error) {
                console.error(`[ExpensePlugin] ${message}: ${error.message}`);
            } else {
                console.error(`[ExpensePlugin] ${message}`);
            }
        }
    },

    /**
     * Log debug messages (development only)
     */
    debug: (message: string, data?: any) => {
        if (isDevelopment) {
            if (data !== undefined) {
                console.debug(`[ExpensePlugin] DEBUG: ${message}`, data);
            } else {
                console.debug(`[ExpensePlugin] DEBUG: ${message}`);
            }
        }
    }
};

/**
 * Sanitize sensitive data for logging
 */
export function sanitizeForLogging(data: any): any {
    if (typeof data !== 'object' || data === null) {
        return data;
    }

    // Create a copy to avoid modifying original data
    const sanitized = Array.isArray(data) ? [...data] : { ...data };

    // Remove or mask sensitive fields
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'key', 'auth'];
    
    for (const key in sanitized) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
            sanitized[key] = '***REDACTED***';
        } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitizeForLogging(sanitized[key]);
        }
    }

    return sanitized;
}

/**
 * Safe error reporting that doesn't expose sensitive information
 */
export function safeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        // In development, show full error details
        if (isDevelopment) {
            return `${error.name}: ${error.message}`;
        }
        
        // In production, only show safe, generic messages
        const safeMessages = [
            'ValidationError',
            'NetworkError',
            'TimeoutError',
            'NotFoundError',
            'PermissionError'
        ];
        
        if (safeMessages.some(safe => error.name.includes(safe))) {
            return error.message;
        }
        
        return 'An unexpected error occurred';
    }
    
    return 'Unknown error';
}