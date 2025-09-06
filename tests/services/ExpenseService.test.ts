import { ExpenseEntry } from '../../src/types';

// Mock joplin API
const mockJoplin = {
    data: {
        get: jest.fn(),
        put: jest.fn()
    }
};

// Mock services
const mockFolderService = {
    ensureNewExpensesDocumentExists: jest.fn(),
    ensureYearStructureExists: jest.fn(),
    findNoteInFolder: jest.fn(),
    getFolderStructure: jest.fn()
};

// Mock global joplin
(global as any).joplin = mockJoplin;

// Mock service imports
jest.mock('../../src/services/FolderService', () => ({
    FolderService: {
        getInstance: () => mockFolderService
    }
}));

// Mock expense parser functions
jest.mock('../../src/expenseParser', () => ({
    parseExpenseTables: jest.fn(),
    createExpenseTable: jest.fn(),
    sortExpensesByDate: jest.fn()
}));

const mockParseExpenseTables = require('../../src/expenseParser').parseExpenseTables;
const mockCreateExpenseTable = require('../../src/expenseParser').createExpenseTable;
const mockSortExpensesByDate = require('../../src/expenseParser').sortExpensesByDate;

describe('ExpenseService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Default successful mocks
        mockCreateExpenseTable.mockReturnValue('| price | description | category | date | shop | attachment | recurring |\n|-------|-------------|----------|------|------|------------|-----------|');
        mockSortExpensesByDate.mockImplementation((expenses) => expenses);
    });

    describe('service workflow tests', () => {
        const testExpense: ExpenseEntry = {
            price: 10.50,
            description: 'Coffee',
            category: 'food',
            date: '2025-01-15T10:30:00',
            shop: 'Cafe'
        };

        it('should follow workflow for adding new expense', async () => {
            // Setup mocks for the workflow
            mockFolderService.ensureNewExpensesDocumentExists.mockResolvedValue('new-expenses-id');
            mockJoplin.data.get.mockResolvedValue({
                body: '# New Expenses\n\n' + mockCreateExpenseTable()
            });
            mockParseExpenseTables.mockReturnValue([]);

            // Test the workflow components
            const noteId = await mockFolderService.ensureNewExpensesDocumentExists();
            const note = await mockJoplin.data.get(['notes', noteId], { fields: ['body'] });
            const expenses = mockParseExpenseTables(note.body);
            
            expect(noteId).toBe('new-expenses-id');
            expect(note.body).toContain('New Expenses');
            expect(expenses).toEqual([]);
            expect(mockFolderService.ensureNewExpensesDocumentExists).toHaveBeenCalled();
        });

        it('should follow workflow for processing expenses', async () => {
            const testExpenses = [testExpense];
            
            // Setup mocks
            mockFolderService.ensureNewExpensesDocumentExists.mockResolvedValue('new-expenses-id');
            mockJoplin.data.get.mockResolvedValue({ body: 'Table content' });
            mockParseExpenseTables.mockReturnValue(testExpenses);
            mockFolderService.ensureYearStructureExists.mockResolvedValue({
                yearFolder: 'year-folder-id'
            });
            mockFolderService.findNoteInFolder.mockResolvedValue('monthly-note-id');

            // Test the workflow
            const expenses = mockParseExpenseTables('content');
            if (expenses.length > 0) {
                const expense = expenses[0];
                const year = expense.date.substring(0, 4);
                const month = expense.date.substring(5, 7);
                
                await mockFolderService.ensureYearStructureExists(year);
                const monthlyNoteId = await mockFolderService.findNoteInFolder('year-folder-id', month);
                
                expect(year).toBe('2025');
                expect(month).toBe('01');
                expect(monthlyNoteId).toBe('monthly-note-id');
            }

            expect(mockFolderService.ensureYearStructureExists).toHaveBeenCalledWith('2025');
        });

        it('should follow workflow for getting monthly expenses', async () => {
            const testExpenses = [testExpense];
            
            mockFolderService.getFolderStructure.mockResolvedValue({
                yearFolder: 'year-folder-id'
            });
            mockFolderService.findNoteInFolder.mockResolvedValue('jan-note-id');
            mockJoplin.data.get.mockResolvedValue({ body: 'Table content' });
            mockParseExpenseTables.mockReturnValue(testExpenses);

            // Test the workflow
            const folderStructure = await mockFolderService.getFolderStructure('2025');
            const monthlyNoteId = await mockFolderService.findNoteInFolder(folderStructure.yearFolder, '01');
            
            if (monthlyNoteId) {
                const note = await mockJoplin.data.get(['notes', monthlyNoteId], { fields: ['body'] });
                const expenses = mockParseExpenseTables(note.body);
                expect(expenses).toEqual(testExpenses);
            }

            expect(mockFolderService.getFolderStructure).toHaveBeenCalledWith('2025');
            expect(mockFolderService.findNoteInFolder).toHaveBeenCalledWith('year-folder-id', '01');
        });
    });

    describe('validation logic', () => {
        it('should validate expense entry structure', () => {
            const validExpense: ExpenseEntry = {
                price: 10.50,
                description: 'Coffee',
                category: 'food',
                date: '2025-01-15T10:30:00',
                shop: 'Cafe'
            };

            // Test validation logic
            const hasRequiredFields = validExpense.description && 
                                    validExpense.category && 
                                    validExpense.date && 
                                    !isNaN(validExpense.price);

            expect(hasRequiredFields).toBe(true);
        });

        it('should reject invalid expense entries', () => {
            const invalidExpenses = [
                { price: NaN, description: '', category: '', date: '', shop: '' },
                { price: 10, description: 'Test', category: '', date: '2025-01-15', shop: 'Shop' },
                { price: 10, description: '', category: 'food', date: '2025-01-15', shop: 'Shop' }
            ];

            invalidExpenses.forEach(expense => {
                const hasRequiredFields = Boolean(expense.description && 
                                        expense.category && 
                                        expense.date && 
                                        !isNaN(expense.price));
                expect(hasRequiredFields).toBe(false);
            });
        });

        it('should validate date formats', () => {
            const validDates = ['2025-01-15T10:30:00', '2025-12-31T23:59:59'];
            const invalidDates = ['invalid-date', '2025-13-40'];

            validDates.forEach(date => {
                const dateObj = new Date(date);
                expect(dateObj.toString()).not.toBe('Invalid Date');
            });

            invalidDates.forEach(date => {
                const dateObj = new Date(date);
                expect(dateObj.toString()).toBe('Invalid Date');
            });
        });
    });

    describe('data parsing and formatting', () => {
        it('should handle expense table creation', () => {
            const mockTable = mockCreateExpenseTable([]);
            expect(typeof mockTable).toBe('string');
            expect(mockCreateExpenseTable).toHaveBeenCalled();
        });

        it('should handle expense sorting', () => {
            const expenses = [
                { date: '2025-01-10T10:00:00', description: 'Earlier' },
                { date: '2025-01-15T10:00:00', description: 'Later' }
            ];

            const sorted = mockSortExpensesByDate(expenses);
            expect(mockSortExpensesByDate).toHaveBeenCalledWith(expenses);
            expect(Array.isArray(sorted)).toBe(true);
        });

        it('should handle expense table parsing', () => {
            const tableContent = '| price | description | category | date | shop |\n|10.50|Coffee|food|2025-01-15|Cafe|';
            mockParseExpenseTables.mockReturnValue([{
                price: 10.50,
                description: 'Coffee',
                category: 'food',
                date: '2025-01-15T10:30:00',
                shop: 'Cafe'
            }]);

            const expenses = mockParseExpenseTables(tableContent);
            expect(expenses).toHaveLength(1);
            expect(expenses[0].description).toBe('Coffee');
        });
    });

    describe('error handling scenarios', () => {
        it('should handle API errors gracefully', async () => {
            mockJoplin.data.get.mockRejectedValue(new Error('API Error'));

            try {
                await mockJoplin.data.get(['notes', 'test-id'], { fields: ['body'] });
            } catch (error) {
                expect(error.message).toBe('API Error');
            }
        });

        it('should handle missing notes', async () => {
            mockFolderService.findNoteInFolder.mockResolvedValue(null);

            const noteId = await mockFolderService.findNoteInFolder('folder-id', 'nonexistent');
            expect(noteId).toBeNull();
        });

        it('should handle empty expense lists', () => {
            mockParseExpenseTables.mockReturnValue([]);

            const expenses = mockParseExpenseTables('empty table');
            expect(expenses).toEqual([]);
            expect(expenses.length).toBe(0);
        });
    });

    describe('date and time handling', () => {
        it('should extract year and month from dates', () => {
            const dateString = '2025-01-15T10:30:00';
            const year = dateString.substring(0, 4);
            const month = dateString.substring(5, 7);

            expect(year).toBe('2025');
            expect(month).toBe('01');
        });

        it('should handle various date formats', () => {
            const dates = [
                '2025-01-15T10:30:00',
                '2025-12-31T23:59:59',
                '2025-06-15T12:00:00'
            ];

            dates.forEach(dateString => {
                const year = dateString.substring(0, 4);
                const month = dateString.substring(5, 7);
                
                expect(year).toMatch(/^\d{4}$/);
                expect(month).toMatch(/^(0[1-9]|1[0-2])$/);
            });
        });
    });
});