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
        
        // In production, sanitize error messages to prevent information disclosure
        const message = error.message || '';
        
        // Remove potentially sensitive patterns from error messages
        const sanitizedMessage = message
            .replace(/\/[^\s]+/g, '[PATH]') // Remove file paths
            .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]') // Remove IP addresses
            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]') // Remove emails
            .replace(/[A-Za-z0-9+/=]{20,}/g, '[TOKEN]') // Remove potential tokens/keys
            .replace(/password=\S+/gi, 'password=[REDACTED]') // Remove password parameters
            .substring(0, 200); // Limit message length
        
        // Only show safe, generic messages for known error types
        const safeMessages = [
            'ValidationError',
            'NetworkError',
            'TimeoutError',
            'NotFoundError',
            'PermissionError',
            'RangeError',
            'TypeError'
        ];
        
        if (safeMessages.some(safe => error.name.includes(safe))) {
            return sanitizedMessage || 'Validation or network error occurred';
        }
        
        return 'An unexpected error occurred';
    }
    
    if (typeof error === 'string') {
        // Sanitize string errors as well
        return error.substring(0, 100).replace(/[<>"'&]/g, '');
    }
    
    return 'Unknown error';
}