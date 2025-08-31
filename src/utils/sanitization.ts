/**
 * Input sanitization utilities for security
 */

/**
 * HTML escape utility to prevent XSS attacks
 */
export function escapeHtml(str: string): string {
    if (typeof str !== 'string') {
        return String(str);
    }
    
    return str.replace(/[&<>"']/g, (match) => {
        const escapeMap: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return escapeMap[match] || match;
    });
}

/**
 * Sanitize category name to prevent injection attacks
 */
export function sanitizeCategory(category: string): string {
    if (typeof category !== 'string') {
        return '';
    }
    
    // Remove HTML tags, limit length, and trim whitespace
    return category
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/[<>"'&]/g, '') // Remove potentially dangerous characters
        .trim()
        .substring(0, 50); // Limit length
}

/**
 * Sanitize description to prevent injection while preserving readability
 */
export function sanitizeDescription(description: string): string {
    if (typeof description !== 'string') {
        return '';
    }
    
    return description
        .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .trim()
        .substring(0, 200); // Limit length
}

/**
 * Sanitize shop name
 */
export function sanitizeShopName(shop: string): string {
    if (typeof shop !== 'string') {
        return '';
    }
    
    return shop
        .replace(/[<>"'&]/g, '') // Remove dangerous characters
        .trim()
        .substring(0, 100); // Limit length
}

/**
 * Validate and sanitize price input
 */
export function validatePrice(price: any): { isValid: boolean; value: number; error?: string } {
    // Handle string input
    if (typeof price === 'string') {
        price = price.trim();
        if (price === '') {
            return { isValid: false, value: 0, error: 'Price cannot be empty' };
        }
    }
    
    const numPrice = Number(price);
    
    // Check if it's a valid number
    if (isNaN(numPrice)) {
        return { isValid: false, value: 0, error: 'Price must be a valid number' };
    }
    
    // Check reasonable bounds (allow negative for income)
    if (numPrice < -1000000 || numPrice > 1000000) {
        return { isValid: false, value: 0, error: 'Price must be between -1,000,000 and 1,000,000' };
    }
    
    // Round to 2 decimal places
    const roundedPrice = Math.round(numPrice * 100) / 100;
    
    return { isValid: true, value: roundedPrice };
}

/**
 * Sanitize attachment URL/path with robust validation
 */
export function sanitizeAttachmentUrl(url: string): string {
    if (!url || typeof url !== 'string') {
        return '';
    }
    
    const trimmed = url.trim();
    
    // Check for markdown link format [text](url)
    const markdownLinkMatch = trimmed.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
    if (markdownLinkMatch) {
        const linkText = markdownLinkMatch[1];
        const linkUrl = markdownLinkMatch[2];
        
        // Validate the URL part
        if (isValidUrl(linkUrl)) {
            // Sanitize the text part and reconstruct
            const safeText = linkText.replace(/[<>"'&]/g, '');
            return `[${safeText}](${linkUrl})`;
        }
        return '';
    }
    
    // Check for plain URL
    if (isValidUrl(trimmed)) {
        return trimmed;
    }
    
    // Check for relative file paths (basic validation)
    if (trimmed.match(/^\.\/[\w\-_.\/]+$/) || trimmed.match(/^\/[\w\-_.\/]+$/)) {
        return trimmed.replace(/[<>"'&]/g, ''); // Remove dangerous characters
    }
    
    return ''; // Invalid format
}

/**
 * Validate URL format and protocol
 */
function isValidUrl(urlString: string): boolean {
    try {
        // Additional security checks before URL parsing
        if (urlString.length > 2048) { // RFC 2616 recommended limit
            return false;
        }
        
        // Block potentially dangerous URL patterns
        const dangerousPatterns = [
            /javascript:/i,
            /data:/i,
            /vbscript:/i,
            /about:/i,
            /chrome:/i,
            /chrome-extension:/i,
            /moz-extension:/i,
            /ms-appx:/i,
            /x-wmplayer:/i,
            /res:/i,
            /<script/i,
            /on\w+=/i
        ];
        
        if (dangerousPatterns.some(pattern => pattern.test(urlString))) {
            return false;
        }
        
        const url = new URL(urlString);
        
        // Only allow safe protocols
        const allowedProtocols = ['http:', 'https:', 'file:'];
        if (!allowedProtocols.includes(url.protocol)) {
            return false;
        }
        
        // Additional checks for file URLs (more restrictive)
        if (url.protocol === 'file:') {
            // Block file URLs that could access sensitive system files
            const path = url.pathname.toLowerCase();
            const blockedPaths = ['/etc/', '/proc/', '/sys/', '/dev/', '/root/', '/home/', '\\windows\\', '\\system32\\'];
            if (blockedPaths.some(blocked => path.includes(blocked))) {
                return false;
            }
        }
        
        return true;
    } catch {
        return false;
    }
}

/**
 * Validate date string
 */
export function validateDateString(dateStr: string): { isValid: boolean; value: string; error?: string } {
    if (typeof dateStr !== 'string' || dateStr.trim() === '') {
        return { isValid: false, value: '', error: 'Date cannot be empty' };
    }
    
    const date = new Date(dateStr.trim());
    
    if (isNaN(date.getTime())) {
        return { isValid: false, value: '', error: 'Invalid date format' };
    }
    
    // Check reasonable date range (not too far in past/future)
    const now = new Date();
    const minDate = new Date(2000, 0, 1); // Year 2000
    const maxDate = new Date(now.getFullYear() + 10, 11, 31); // 10 years in future
    
    if (date < minDate || date > maxDate) {
        return { isValid: false, value: '', error: 'Date must be between 2000 and 10 years from now' };
    }
    
    return { isValid: true, value: date.toISOString() };
}

/**
 * Comprehensive input sanitization for expense entries
 */
export function sanitizeExpenseEntry(entry: any): {
    sanitized: any;
    errors: string[];
} {
    const errors: string[] = [];
    const sanitized: any = {};
    
    // Validate and sanitize price
    const priceValidation = validatePrice(entry.price);
    if (priceValidation.isValid) {
        sanitized.price = priceValidation.value;
    } else {
        errors.push(priceValidation.error || 'Invalid price');
        sanitized.price = 0;
    }
    
    // Sanitize description
    if (!entry.description || typeof entry.description !== 'string' || entry.description.trim() === '') {
        errors.push('Description is required');
        sanitized.description = '';
    } else {
        sanitized.description = sanitizeDescription(entry.description);
        if (sanitized.description === '') {
            errors.push('Description cannot be empty after sanitization');
        }
    }
    
    // Sanitize category
    if (!entry.category || typeof entry.category !== 'string' || entry.category.trim() === '') {
        errors.push('Category is required');
        sanitized.category = '';
    } else {
        sanitized.category = sanitizeCategory(entry.category);
        if (sanitized.category === '') {
            errors.push('Category cannot be empty after sanitization');
        }
    }
    
    // Validate and sanitize date
    if (entry.date) {
        const dateValidation = validateDateString(entry.date);
        if (dateValidation.isValid) {
            sanitized.date = dateValidation.value;
        } else {
            errors.push(dateValidation.error || 'Invalid date');
            sanitized.date = new Date().toISOString();
        }
    } else {
        sanitized.date = new Date().toISOString();
    }
    
    // Sanitize shop
    sanitized.shop = entry.shop ? sanitizeShopName(entry.shop) : '';
    
    // Sanitize attachment with robust URL validation
    if (entry.attachment && typeof entry.attachment === 'string') {
        const attachment = entry.attachment.trim();
        if (attachment.length > 0 && attachment.length <= 500) {
            sanitized.attachment = sanitizeAttachmentUrl(attachment);
        } else {
            sanitized.attachment = '';
        }
    } else {
        sanitized.attachment = '';
    }
    
    // Sanitize recurring
    const validRecurring = ['daily', 'weekly', 'monthly', 'yearly', ''];
    if (entry.recurring && validRecurring.includes(entry.recurring)) {
        sanitized.recurring = entry.recurring;
    } else {
        sanitized.recurring = '';
    }
    
    return { sanitized, errors };
}