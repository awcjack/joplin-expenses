/**
 * Unit tests for expense parser
 */

import {
  parseExpenseTables,
  serializeExpenseTable,
  validateExpenseEntry,
  getTargetYearMonth,
  getTargetYear,
  getTargetMonth,
  createNewExpenseEntry,
  filterEntriesByYearMonth,
  filterEntriesByYear,
  filterEntriesByCategory,
} from '../src/expenseParser';
import { ExpenseEntry } from '../src/types';

// Mock date utils to ensure consistent test results
jest.mock('../src/utils/dateUtils', () => ({
  getYearFromDate: jest.fn((date: string) => date?.slice(0, 4) || '2025'),
  getMonthFromDate: jest.fn((date: string) => date?.slice(5, 7) || '01'),
  getYearMonthFromDate: jest.fn((date: string) => date?.slice(0, 7) || '2025-01'),
  getCurrentDateTime: jest.fn(() => '2025-01-15T10:30:00.000Z'),
  isValidDate: jest.fn((date: string) => {
    const d = new Date(date);
    return !isNaN(d.getTime());
  }),
}));

describe('Expense Parser', () => {
  const sampleMarkdown = `
# Monthly Expenses

Some text before the table.

| price | description | category | date | shop | attachment | recurring |
|-------|-------------|----------|------|------|------------|-----------|
| 12.50 | Coffee | food | 2025-01-15T10:30:00 | Starbucks | | |
| -500 | Salary | income | 2025-01-01T09:00:00 | Company | | monthly |
| 25.99 | Gas | transport | 2025-01-14T18:45:00 | Shell | | |

Some text after the table.
`;

  const expectedEntries: ExpenseEntry[] = [
    {
      price: 12.50,
      description: 'Coffee',
      category: 'food',
      date: '2025-01-15T10:30:00',
      shop: 'Starbucks',
      attachment: undefined,
      recurring: undefined,
    },
    {
      price: -500,
      description: 'Salary',
      category: 'income',
      date: '2025-01-01T09:00:00',
      shop: 'Company',
      attachment: undefined,
      recurring: 'monthly',
    },
    {
      price: 25.99,
      description: 'Gas',
      category: 'transport',
      date: '2025-01-14T18:45:00',
      shop: 'Shell',
      attachment: undefined,
      recurring: undefined,
    },
  ];

  describe('parseExpenseTables', () => {
    it('should parse valid expense table', () => {
      const entries = parseExpenseTables(sampleMarkdown);
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual(expectedEntries[0]);
      expect(entries[1]).toEqual(expectedEntries[1]);
      expect(entries[2]).toEqual(expectedEntries[2]);
    });

    it('should return empty array for markdown without tables', () => {
      const entries = parseExpenseTables('# Just a heading\n\nSome text without tables.');
      expect(entries).toHaveLength(0);
    });

    it('should skip incomplete rows', () => {
      const markdownWithIncomplete = `
| price | description | category | date | shop | attachment | recurring |
|-------|-------------|----------|------|------|------------|-----------|
| 12.50 | Coffee | food | 2025-01-15 | Starbucks | | |
| incomplete row |
| 25.99 | Gas | transport | 2025-01-14 | Shell | | |
`;
      const entries = parseExpenseTables(markdownWithIncomplete);
      expect(entries).toHaveLength(2);
    });

    it('should skip empty/placeholder rows', () => {
      const markdownWithEmpty = `
| price | description | category | date | shop | attachment | recurring |
|-------|-------------|----------|------|------|------------|-----------|
| 12.50 | Coffee | food | 2025-01-15 | Starbucks | | |
| | --- | --- | --- | --- | --- | --- |
| | | | | | | |
| 25.99 | Gas | transport | 2025-01-14 | Shell | | |
`;
      const entries = parseExpenseTables(markdownWithEmpty);
      expect(entries).toHaveLength(2);
    });

    it('should handle table with different column order gracefully', () => {
      const wrongOrderMarkdown = `
| description | price | category | date | shop | attachment | recurring |
|-------------|-------|----------|------|------|------------|-----------|
| Coffee | 12.50 | food | 2025-01-15 | Starbucks | | |
`;
      // Should return empty since headers don't match expected order
      const entries = parseExpenseTables(wrongOrderMarkdown);
      expect(entries).toHaveLength(0);
    });
  });

  describe('serializeExpenseTable', () => {
    it('should serialize entries to markdown table', () => {
      const serialized = serializeExpenseTable(expectedEntries);
      const lines = serialized.split('\n');
      
      expect(lines[0]).toBe('| price | description | category | date | shop | attachment | recurring |');
      expect(lines[1]).toBe('|-------|-------------|----------|------|------|------------|-----------|');
      expect(lines.length).toBe(5); // header + separator + 3 data rows
    });

    it('should sort entries by date descending', () => {
      const unsortedEntries = [
        { ...expectedEntries[0], date: '2025-01-10T10:00:00' },
        { ...expectedEntries[1], date: '2025-01-15T10:00:00' },
        { ...expectedEntries[2], date: '2025-01-12T10:00:00' },
      ];
      
      const serialized = serializeExpenseTable(unsortedEntries);
      const lines = serialized.split('\n');
      
      // Should be sorted by date descending (newest first)
      expect(lines[2]).toContain('2025-01-15T10:00:00'); // newest
      expect(lines[3]).toContain('2025-01-12T10:00:00'); // middle
      expect(lines[4]).toContain('2025-01-10T10:00:00'); // oldest
    });

    it('should handle empty entries array', () => {
      const serialized = serializeExpenseTable([]);
      const lines = serialized.split('\n');
      
      expect(lines).toHaveLength(2); // header + separator only
      expect(lines[0]).toBe('| price | description | category | date | shop | attachment | recurring |');
    });

    it('should handle undefined/empty attachment and recurring fields', () => {
      const entryWithUndefined = {
        price: 10,
        description: 'Test',
        category: 'test',
        date: '2025-01-15',
        shop: 'Test Shop',
        attachment: undefined,
        recurring: undefined,
      };
      
      const serialized = serializeExpenseTable([entryWithUndefined]);
      expect(serialized).toContain('| 10 | Test | test | 2025-01-15 | Test Shop |  |  |');
    });
  });

  describe('validateExpenseEntry', () => {
    it('should validate complete valid entry', () => {
      const result = validateExpenseEntry(expectedEntries[0]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject entry without price', () => {
      const result = validateExpenseEntry({
        description: 'Coffee',
        category: 'food',
        date: '2025-01-15',
        shop: 'Starbucks',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Price'))).toBe(true);
    });

    it('should reject entry without description', () => {
      const result = validateExpenseEntry({
        price: 12.50,
        category: 'food',
        date: '2025-01-15',
        shop: 'Starbucks',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Description'))).toBe(true);
    });

    it('should reject entry without category', () => {
      const result = validateExpenseEntry({
        price: 12.50,
        description: 'Coffee',
        date: '2025-01-15',
        shop: 'Starbucks',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Category'))).toBe(true);
    });

    it('should reject entry with invalid date', () => {
      const result = validateExpenseEntry({
        price: 12.50,
        description: 'Coffee',
        category: 'food',
        date: 'not-a-date',
        shop: 'Starbucks',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Date'))).toBe(true);
    });

    it('should accept entry without date (optional)', () => {
      const result = validateExpenseEntry({
        price: 12.50,
        description: 'Coffee',
        category: 'food',
        shop: 'Starbucks',
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('getTargetYearMonth', () => {
    it('should extract year-month from date', () => {
      const result = getTargetYearMonth(expectedEntries[0]);
      expect(result).toBe('2025-01');
    });

    it('should handle entry without date', () => {
      const entryWithoutDate = { ...expectedEntries[0], date: undefined };
      const result = getTargetYearMonth(entryWithoutDate as any);
      expect(result).toBe('2025-01'); // Mock returns default
    });
  });

  describe('getTargetYear', () => {
    it('should extract year from date', () => {
      const result = getTargetYear(expectedEntries[0]);
      expect(result).toBe('2025');
    });
  });

  describe('getTargetMonth', () => {
    it('should extract month from date', () => {
      const result = getTargetMonth(expectedEntries[0]);
      expect(result).toBe('01');
    });
  });

  describe('createNewExpenseEntry', () => {
    it('should create entry with defaults', () => {
      const entry = createNewExpenseEntry();
      expect(entry.price).toBe(0);
      expect(entry.description).toBe('');
      expect(entry.category).toBe('');
      expect(entry.date).toBe('2025-01-15T10:30:00.000Z');
    });

    it('should create entry with overrides', () => {
      const entry = createNewExpenseEntry({
        price: 50,
        description: 'Custom description',
        category: 'custom',
      });
      expect(entry.price).toBe(50);
      expect(entry.description).toBe('Custom description');
      expect(entry.category).toBe('custom');
      expect(entry.date).toBe('2025-01-15T10:30:00.000Z'); // Default from mock
    });
  });

  describe('Filter functions', () => {
    describe('filterEntriesByYearMonth', () => {
      it('should filter entries by year-month', () => {
        const filtered = filterEntriesByYearMonth(expectedEntries, '2025-01');
        expect(filtered).toHaveLength(3); // All entries are from 2025-01
      });

      it('should return empty array for non-matching year-month', () => {
        const filtered = filterEntriesByYearMonth(expectedEntries, '2024-12');
        expect(filtered).toHaveLength(0);
      });
    });

    describe('filterEntriesByYear', () => {
      it('should filter entries by year', () => {
        const filtered = filterEntriesByYear(expectedEntries, '2025');
        expect(filtered).toHaveLength(3);
      });

      it('should return empty array for non-matching year', () => {
        const filtered = filterEntriesByYear(expectedEntries, '2024');
        expect(filtered).toHaveLength(0);
      });
    });

    describe('filterEntriesByCategory', () => {
      it('should filter entries by category', () => {
        const filtered = filterEntriesByCategory(expectedEntries, 'food');
        expect(filtered).toHaveLength(1);
        expect(filtered[0].description).toBe('Coffee');
      });

      it('should return empty array for non-matching category', () => {
        const filtered = filterEntriesByCategory(expectedEntries, 'nonexistent');
        expect(filtered).toHaveLength(0);
      });
    });
  });
});