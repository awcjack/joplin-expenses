/**
 * Unit tests for date utilities
 */

import {
  getCurrentDate,
  getCurrentDateTime,
  getCurrentYear,
  getCurrentMonth,
  isValidDate,
  getYearFromDate,
  getMonthFromDate,
  getYearMonthFromDate,
  getMonthName,
  formatMonthYear,
  getAllMonths,
  getPreviousMonth,
  getNextMonth,
} from '../../src/utils/dateUtils';

describe('Date Utils', () => {
  beforeEach(() => {
    // Mock current date to ensure consistent tests
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-15T10:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getCurrentDate', () => {
    it('should return current date in YYYY-MM-DD format', () => {
      const result = getCurrentDate();
      expect(result).toBe('2025-01-15');
    });
  });

  describe('getCurrentDateTime', () => {
    it('should return current date in ISO format', () => {
      const result = getCurrentDateTime();
      expect(result).toBe('2025-01-15T10:30:00.000Z');
    });

    it('should return valid ISO string', () => {
      const result = getCurrentDateTime();
      const date = new Date(result);
      expect(date.toISOString()).toBe(result);
    });
  });

  describe('getCurrentYear', () => {
    it('should return current year as string', () => {
      const result = getCurrentYear();
      expect(result).toBe('2025');
    });
  });

  describe('getCurrentMonth', () => {
    it('should return current month in MM format', () => {
      const result = getCurrentMonth();
      expect(result).toBe('01');
    });
  });

  describe('isValidDate', () => {
    it('should return true for valid ISO date', () => {
      expect(isValidDate('2025-01-15T10:30:00.000Z')).toBe(true);
    });

    it('should return true for valid date string', () => {
      expect(isValidDate('2025-01-15')).toBe(true);
    });

    it('should return true for valid date with time', () => {
      expect(isValidDate('2025-01-15T10:30:00')).toBe(true);
    });

    it('should return false for invalid date string', () => {
      expect(isValidDate('not-a-date')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidDate('')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isValidDate(null as any)).toBe(false);
      expect(isValidDate(undefined as any)).toBe(false);
    });

    it('should return false for invalid month/day', () => {
      expect(isValidDate('2025-13-01')).toBe(false); // Invalid month
      expect(isValidDate('2025-02-30')).toBe(false); // Invalid day for February
    });
  });

  describe('getYearFromDate', () => {
    it('should extract year from ISO date', () => {
      expect(getYearFromDate('2025-01-15T10:30:00.000Z')).toBe('2025');
    });

    it('should extract year from date string', () => {
      expect(getYearFromDate('2024-12-31')).toBe('2024');
    });

    it('should return current year for empty string', () => {
      expect(getYearFromDate('')).toBe('2025'); // Based on mocked time
    });

    it('should handle short string gracefully', () => {
      expect(getYearFromDate('202')).toBe('202');
    });
  });

  describe('getMonthFromDate', () => {
    it('should extract month from ISO date', () => {
      expect(getMonthFromDate('2025-01-15T10:30:00.000Z')).toBe('01');
    });

    it('should extract month from date string', () => {
      expect(getMonthFromDate('2024-12-31')).toBe('12');
    });

    it('should return current month for empty string', () => {
      expect(getMonthFromDate('')).toBe('01'); // Based on mocked time
    });

    it('should handle date without month', () => {
      expect(getMonthFromDate('2025')).toBe('');
    });
  });

  describe('getYearMonthFromDate', () => {
    it('should extract year-month from ISO date', () => {
      expect(getYearMonthFromDate('2025-01-15T10:30:00.000Z')).toBe('2025-01');
    });

    it('should extract year-month from date string', () => {
      expect(getYearMonthFromDate('2024-12-31')).toBe('2024-12');
    });

    it('should return current year-month for empty string', () => {
      expect(getYearMonthFromDate('')).toBe('2025-01'); // Based on mocked time
    });

    it('should handle short date string', () => {
      expect(getYearMonthFromDate('2025-1')).toBe('2025-1');
    });
  });

  describe('getMonthName', () => {
    it('should return month name for valid month number', () => {
      expect(getMonthName('01')).toBe('January');
      expect(getMonthName('02')).toBe('February');
      expect(getMonthName('12')).toBe('December');
    });

    it('should handle single digit months', () => {
      expect(getMonthName('1')).toBe('January');
      expect(getMonthName('9')).toBe('September');
    });

    it('should return original string for invalid month', () => {
      expect(getMonthName('13')).toBe('13');
      expect(getMonthName('00')).toBe('00');
      expect(getMonthName('invalid')).toBe('invalid');
    });
  });

  describe('formatMonthYear', () => {
    it('should format year-month string', () => {
      expect(formatMonthYear('2025-01')).toBe('January 2025');
    });

    it('should format different months', () => {
      expect(formatMonthYear('2025-02')).toBe('February 2025');
      expect(formatMonthYear('2025-12')).toBe('December 2025');
    });

    it('should handle invalid month gracefully', () => {
      expect(formatMonthYear('2025-13')).toBe('13 2025');
    });

    it('should handle short string', () => {
      expect(formatMonthYear('2025')).toBe('2025');
      expect(formatMonthYear('202')).toBe('202');
    });

    it('should handle empty string', () => {
      expect(formatMonthYear('')).toBe('');
    });
  });

  describe('getAllMonths', () => {
    it('should return all months in order', () => {
      const months = getAllMonths();
      expect(months).toHaveLength(12);
      expect(months[0]).toBe('01');
      expect(months[11]).toBe('12');
    });

    it('should return array of strings', () => {
      const months = getAllMonths();
      months.forEach(month => {
        expect(typeof month).toBe('string');
        expect(month).toMatch(/^\d{2}$/); // Two digits
      });
    });

    it('should be zero-padded', () => {
      const months = getAllMonths();
      expect(months[0]).toBe('01');
      expect(months[8]).toBe('09');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle leap year February', () => {
      expect(isValidDate('2024-02-29')).toBe(true); // 2024 is leap year
      expect(isValidDate('2023-02-29')).toBe(false); // 2023 is not leap year
    });

    it('should handle end of month dates', () => {
      expect(isValidDate('2025-01-31')).toBe(true);
      expect(isValidDate('2025-04-31')).toBe(false); // April has only 30 days
      expect(isValidDate('2025-02-28')).toBe(true);
      expect(isValidDate('2025-02-29')).toBe(false); // 2025 is not leap year
    });

    it('should handle timezone information', () => {
      expect(isValidDate('2025-01-15T10:30:00+01:00')).toBe(true);
      expect(isValidDate('2025-01-15T10:30:00-05:00')).toBe(true);
    });

    it('should handle milliseconds', () => {
      expect(isValidDate('2025-01-15T10:30:00.123Z')).toBe(true);
    });
  });

  describe('getPreviousMonth', () => {
    it('should get previous month within same year', () => {
      expect(getPreviousMonth('2025-05')).toBe('2025-04');
    });

    it('should handle year rollover', () => {
      expect(getPreviousMonth('2025-01')).toBe('2024-12');
    });

    it('should handle February', () => {
      expect(getPreviousMonth('2025-03')).toBe('2025-02');
    });
  });

  describe('getNextMonth', () => {
    it('should get next month within same year', () => {
      expect(getNextMonth('2025-05')).toBe('2025-06');
    });

    it('should handle year rollover', () => {
      expect(getNextMonth('2025-12')).toBe('2026-01');
    });

    it('should handle January', () => {
      expect(getNextMonth('2025-01')).toBe('2025-02');
    });
  });

  describe('Current date functions with mocked time', () => {
    it('should use mocked current time consistently', () => {
      const currentDate = getCurrentDate();
      const currentDateTime = getCurrentDateTime();
      const currentYear = getCurrentYear();
      const currentMonth = getCurrentMonth();
      
      expect(currentDate).toBe('2025-01-15');
      expect(currentDateTime).toBe('2025-01-15T10:30:00.000Z');
      expect(currentYear).toBe('2025');
      expect(currentMonth).toBe('01');
      
      const year = getYearFromDate(currentDateTime);
      const month = getMonthFromDate(currentDateTime);
      const yearMonth = getYearMonthFromDate(currentDateTime);
      
      expect(year).toBe('2025');
      expect(month).toBe('01');
      expect(yearMonth).toBe('2025-01');
    });
  });
});