/**
 * Unit tests for sanitization utilities
 */

import {
  escapeHtml,
  sanitizeCategory,
  sanitizeDescription,
  sanitizeShopName,
  validatePrice,
  validateDateString,
  sanitizeExpenseEntry,
} from '../../src/utils/sanitization';

describe('Sanitization Utils', () => {
  describe('escapeHtml', () => {
    it('should escape HTML characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('should escape ampersands', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('should escape quotes', () => {
      expect(escapeHtml(`"Hello" & 'World'`)).toBe('&quot;Hello&quot; &amp; &#39;World&#39;');
    });

    it('should handle non-string input', () => {
      expect(escapeHtml(123 as any)).toBe('123');
      expect(escapeHtml(null as any)).toBe('null');
      expect(escapeHtml(undefined as any)).toBe('undefined');
    });

    it('should leave safe text unchanged', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('sanitizeCategory', () => {
    it('should remove HTML tags', () => {
      expect(sanitizeCategory('<script>food</script>')).toBe('food');
      expect(sanitizeCategory('<b>transport</b>')).toBe('transport');
    });

    it('should remove dangerous characters', () => {
      expect(sanitizeCategory('food"&<>')).toBe('food');
    });

    it('should trim whitespace', () => {
      expect(sanitizeCategory('  food  ')).toBe('food');
    });

    it('should limit length to 50 characters', () => {
      const longCategory = 'a'.repeat(100);
      expect(sanitizeCategory(longCategory)).toBe('a'.repeat(50));
    });

    it('should handle non-string input', () => {
      expect(sanitizeCategory(123 as any)).toBe('');
      expect(sanitizeCategory(null as any)).toBe('');
    });
  });

  describe('sanitizeDescription', () => {
    it('should remove script tags', () => {
      expect(sanitizeDescription('Buy coffee<script>alert("xss")</script>')).toBe('Buy coffee');
    });

    it('should remove HTML tags', () => {
      expect(sanitizeDescription('Buy <b>coffee</b> at store')).toBe('Buy coffee at store');
    });

    it('should limit length to 200 characters', () => {
      const longDesc = 'a'.repeat(300);
      expect(sanitizeDescription(longDesc)).toBe('a'.repeat(200));
    });

    it('should preserve readable text', () => {
      expect(sanitizeDescription('Coffee at Starbucks')).toBe('Coffee at Starbucks');
    });
  });

  describe('sanitizeShopName', () => {
    it('should remove dangerous characters', () => {
      expect(sanitizeShopName('Café & Bistro"<>')).toBe('Café  Bistro');
    });

    it('should limit length to 100 characters', () => {
      const longShop = 'a'.repeat(200);
      expect(sanitizeShopName(longShop)).toBe('a'.repeat(100));
    });

    it('should preserve normal shop names', () => {
      expect(sanitizeShopName('Starbucks Coffee')).toBe('Starbucks Coffee');
    });
  });

  describe('validatePrice', () => {
    it('should accept valid positive numbers', () => {
      const result = validatePrice(12.50);
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(12.50);
    });

    it('should accept negative numbers (for income)', () => {
      const result = validatePrice(-500);
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(-500);
    });

    it('should parse string numbers', () => {
      const result = validatePrice('25.99');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(25.99);
    });

    it('should reject empty strings', () => {
      const result = validatePrice('');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    it('should reject non-numeric strings', () => {
      const result = validatePrice('not-a-number');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('valid number');
    });

    it('should reject extreme values', () => {
      const result1 = validatePrice(2000000);
      expect(result1.isValid).toBe(false);
      expect(result1.error).toContain('between');

      const result2 = validatePrice(-2000000);
      expect(result2.isValid).toBe(false);
      expect(result2.error).toContain('between');
    });

    it('should round to 2 decimal places', () => {
      const result = validatePrice(12.999);
      expect(result.isValid).toBe(true);
      expect(result.value).toBe(13);
    });
  });

  describe('validateDateString', () => {
    it('should accept valid ISO dates', () => {
      const result = validateDateString('2025-01-15T10:30:00.000Z');
      expect(result.isValid).toBe(true);
    });

    it('should accept valid date strings', () => {
      const result = validateDateString('2025-01-15');
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid date formats', () => {
      const result = validateDateString('not-a-date');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid date format');
    });

    it('should reject empty strings', () => {
      const result = validateDateString('');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    it('should reject dates too far in the past', () => {
      const result = validateDateString('1990-01-01');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('between 2000');
    });

    it('should reject dates too far in the future', () => {
      const currentYear = new Date().getFullYear();
      const futureDate = `${currentYear + 15}-01-01`;
      const result = validateDateString(futureDate);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('10 years from now');
    });
  });

  describe('sanitizeExpenseEntry', () => {
    const validEntry = {
      price: 12.50,
      description: 'Coffee at Starbucks',
      category: 'food',
      date: '2025-01-15T10:30:00.000Z',
      shop: 'Starbucks',
      attachment: '',
      recurring: ''
    };

    it('should accept valid expense entry', () => {
      const result = sanitizeExpenseEntry(validEntry);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized.price).toBe(12.50);
      expect(result.sanitized.description).toBe('Coffee at Starbucks');
    });

    it('should sanitize malicious input', () => {
      const maliciousEntry = {
        price: '25.99',
        description: 'Buy coffee<script>alert("xss")</script>',
        category: 'food<img src=x onerror=alert(1)>',
        date: '2025-01-15',
        shop: 'Starbucks"&<>',
        attachment: '[link](javascript:alert(1))',
        recurring: 'invalid-recurring'
      };

      const result = sanitizeExpenseEntry(maliciousEntry);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized.description).toBe('Buy coffee');
      expect(result.sanitized.category).toBe('food');
      expect(result.sanitized.shop).toBe('Starbucks');
      expect(result.sanitized.attachment).toBe(''); // Invalid URL removed
      expect(result.sanitized.recurring).toBe(''); // Invalid value reset
    });

    it('should reject missing required fields', () => {
      const invalidEntry = {
        price: '',
        description: '',
        category: '',
      };

      const result = sanitizeExpenseEntry(invalidEntry);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Description is required'))).toBe(true);
      expect(result.errors.some(e => e.includes('Category is required'))).toBe(true);
    });

    it('should handle valid markdown links in attachment', () => {
      const entryWithAttachment = {
        ...validEntry,
        attachment: '[Receipt](https://example.com/receipt.pdf)'
      };

      const result = sanitizeExpenseEntry(entryWithAttachment);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized.attachment).toBe('[Receipt](https://example.com/receipt.pdf)');
    });

    it('should handle valid recurring values', () => {
      const recurringEntry = {
        ...validEntry,
        recurring: 'monthly'
      };

      const result = sanitizeExpenseEntry(recurringEntry);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized.recurring).toBe('monthly');
    });

    it('should auto-fill missing date', () => {
      const entryWithoutDate = {
        ...validEntry,
        date: undefined
      };

      const result = sanitizeExpenseEntry(entryWithoutDate);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized.date).toBeDefined();
      expect(new Date(result.sanitized.date).getTime()).toBeGreaterThan(0);
    });
  });
});