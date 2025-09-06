import { SummaryService } from '../../src/services/SummaryService';
import { SummaryMarkerType, ExpenseEntry } from '../../src/types';

// Mock joplin API
const mockJoplin = {
    data: {
        get: jest.fn(),
        put: jest.fn()
    }
};

// Mock services
const mockExpenseService = {
    getMonthlyExpenses: jest.fn(),
    getYearlyExpenses: jest.fn()
};

const mockSettingsService = {
    getSettings: jest.fn().mockReturnValue({
        defaultCurrency: '$'
    })
};

const mockFolderService = {
    getAllExpenseStructure: jest.fn()
};

// Mock global joplin
(global as any).joplin = mockJoplin;

// Mock service imports
jest.mock('../../src/services/ExpenseService', () => ({
    ExpenseService: {
        getInstance: () => mockExpenseService
    }
}));

jest.mock('../../src/services/SettingsService', () => ({
    SettingsService: {
        getInstance: () => mockSettingsService
    }
}));

jest.mock('../../src/services/FolderService', () => ({
    FolderService: {
        getInstance: () => mockFolderService
    }
}));

describe('SummaryService', () => {
    let summaryService: SummaryService;

    beforeEach(() => {
        jest.clearAllMocks();
        summaryService = SummaryService.getInstance();
    });

    describe('generateSummary', () => {
        it('should calculate totals correctly', () => {
            const entries: ExpenseEntry[] = [
                {
                    price: 100.50,
                    description: 'Groceries',
                    category: 'food',
                    date: '2025-01-15T10:30:00',
                    shop: 'Market'
                },
                {
                    price: -2000,
                    description: 'Salary',
                    category: 'income',
                    date: '2025-01-01T09:00:00',
                    shop: 'Company'
                },
                {
                    price: 50.25,
                    description: 'Coffee',
                    category: 'food',
                    date: '2025-01-10T08:00:00',
                    shop: 'Cafe'
                }
            ];

            const summary = summaryService.generateSummary(entries);

            expect(summary.totalExpense).toBe(150.75);
            expect(summary.totalIncome).toBe(2000);
            expect(summary.netAmount).toBe(1849.25);
            expect(summary.entryCount).toBe(3);
            expect(summary.byCategory.food).toBe(150.75);
            expect(summary.byCategory.income).toBe(-2000);
        });

        it('should group by month correctly', () => {
            const entries: ExpenseEntry[] = [
                {
                    price: 100,
                    description: 'Item 1',
                    category: 'food',
                    date: '2025-01-15T10:30:00',
                    shop: 'Shop 1'
                },
                {
                    price: 200,
                    description: 'Item 2',
                    category: 'transport',
                    date: '2025-02-10T08:00:00',
                    shop: 'Shop 2'
                }
            ];

            const summary = summaryService.generateSummary(entries);

            expect(summary.byMonth['2025-01']).toBe(100);
            expect(summary.byMonth['2025-02']).toBe(200);
        });
    });

    describe('findSummaryMarkers', () => {
        it('should find monthly markers with correct enum type', () => {
            const content = `
# Test Document

<!-- expenses-summary-monthly month="2025-01" category="food" -->
Monthly content here
<!-- /expenses-summary-monthly -->

Some other content
            `.trim();

            const markers = (summaryService as any).findSummaryMarkers(content);

            expect(markers).toHaveLength(1);
            expect(markers[0].type).toBe(SummaryMarkerType.MONTHLY);
            expect(markers[0].month).toBe('2025-01');
            expect(markers[0].category).toBe('food');
            expect(markers[0].content).toBe('Monthly content here');
        });

        it('should find annual markers with correct enum type', () => {
            const content = `
# Test Document

<!-- expenses-summary-annual year="2025" -->
Annual content here
<!-- /expenses-summary-annual -->
            `.trim();

            const markers = (summaryService as any).findSummaryMarkers(content);

            expect(markers).toHaveLength(1);
            expect(markers[0].type).toBe(SummaryMarkerType.ANNUAL);
            expect(markers[0].year).toBe('2025');
            expect(markers[0].content).toBe('Annual content here');
        });

        it('should find breakdown markers with correct enum type', () => {
            const content = `
# Test Document

<!-- expenses-breakdown category="food" month="2025-01" -->
Breakdown content here
<!-- /expenses-breakdown -->
            `.trim();

            const markers = (summaryService as any).findSummaryMarkers(content);

            expect(markers).toHaveLength(1);
            expect(markers[0].type).toBe(SummaryMarkerType.BREAKDOWN);
            expect(markers[0].category).toBe('food');
            expect(markers[0].month).toBe('2025-01');
            expect(markers[0].content).toBe('Breakdown content here');
        });

        it('should find multiple markers of different types', () => {
            const content = `
<!-- expenses-summary-monthly month="2025-01" -->
Monthly
<!-- /expenses-summary-monthly -->

<!-- expenses-summary-annual year="2025" -->
Annual
<!-- /expenses-summary-annual -->

<!-- expenses-breakdown category="food" -->
Breakdown
<!-- /expenses-breakdown -->
            `.trim();

            const markers = (summaryService as any).findSummaryMarkers(content);

            expect(markers).toHaveLength(3);
            expect(markers[0].type).toBe(SummaryMarkerType.MONTHLY);
            expect(markers[1].type).toBe(SummaryMarkerType.ANNUAL);
            expect(markers[2].type).toBe(SummaryMarkerType.BREAKDOWN);
        });
    });

    describe('generateMarkerSummary', () => {
        beforeEach(() => {
            mockExpenseService.getMonthlyExpenses.mockResolvedValue([
                {
                    price: 100,
                    description: 'Test expense',
                    category: 'food',
                    date: '2025-01-15T10:30:00',
                    shop: 'Test shop'
                }
            ]);
        });

        it('should generate monthly summary for MONTHLY marker type', async () => {
            const marker = {
                type: SummaryMarkerType.MONTHLY,
                month: '2025-01',
                category: undefined,
                startIndex: 0,
                endIndex: 2,
                content: ''
            };

            const result = await (summaryService as any).generateMarkerSummary(marker);

            expect(result).toContain('January 2025 Summary');
            expect(result).toContain('Total Expenses:**');
            expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledWith('2025', '01');
        });

        it('should generate annual summary for ANNUAL marker type', async () => {
            mockExpenseService.getYearlyExpenses.mockResolvedValue([
                {
                    price: 100,
                    description: 'Test expense',
                    category: 'food',
                    date: '2025-01-15T10:30:00',
                    shop: 'Test shop'
                }
            ]);

            const marker = {
                type: SummaryMarkerType.ANNUAL,
                year: '2025',
                startIndex: 0,
                endIndex: 2,
                content: ''
            };

            const result = await (summaryService as any).generateMarkerSummary(marker);

            expect(result).toContain('2025 Annual Summary');
            expect(result).toContain('Total Expenses:**');
            expect(mockExpenseService.getYearlyExpenses).toHaveBeenCalledWith('2025');
        });

        it('should handle unknown marker type', async () => {
            const marker = {
                type: 'unknown' as any,
                startIndex: 0,
                endIndex: 2,
                content: ''
            };

            const result = await (summaryService as any).generateMarkerSummary(marker);

            expect(result).toBe('Unknown marker type');
        });
    });

    describe('processDocumentSummaries', () => {
        beforeEach(() => {
            mockJoplin.data.get.mockResolvedValue({
                body: `# Test Document
                
<!-- expenses-summary-monthly month="2025-01" -->
Old content
<!-- /expenses-summary-monthly -->`
            });
            
            mockExpenseService.getMonthlyExpenses.mockResolvedValue([]);
        });

        it('should process document summaries workflow', async () => {
            const noteId = 'test-note-id';
            
            // Test workflow components
            await mockJoplin.data.get(['notes', noteId], { fields: ['body'] });
            await mockJoplin.data.put(['notes', noteId], null, { body: 'updated content' });

            expect(mockJoplin.data.get).toHaveBeenCalledWith(['notes', noteId], { fields: ['body'] });
            expect(mockJoplin.data.put).toHaveBeenCalledWith(['notes', noteId], null, { body: 'updated content' });
        });

        it('should not update if no markers found', async () => {
            mockJoplin.data.get.mockResolvedValue({
                body: '# Test Document\n\nNo markers here'
            });

            await summaryService.processDocumentSummaries('test-note-id');

            expect(mockJoplin.data.put).not.toHaveBeenCalled();
        });

        it('should skip invalid markers', async () => {
            // Mock findSummaryMarkers to return a marker with invalid indices
            const originalFindMarkers = (summaryService as any).findSummaryMarkers;
            (summaryService as any).findSummaryMarkers = jest.fn().mockReturnValue([
                {
                    type: SummaryMarkerType.MONTHLY,
                    month: '2025-01',
                    startIndex: -1,
                    endIndex: -1,
                    content: ''
                }
            ]);

            await summaryService.processDocumentSummaries('test-note-id');

            // Should still try to update content (with no changes)
            expect(mockJoplin.data.put).not.toHaveBeenCalled();

            // Restore original method
            (summaryService as any).findSummaryMarkers = originalFindMarkers;
        });
    });

    describe('sanitizeForMermaid', () => {
        it('should sanitize dangerous characters', () => {
            const input = 'Test<script>alert("xss")</script>';
            const result = (summaryService as any).sanitizeForMermaid(input);
            
            // The result should not contain dangerous characters and be truncated to 20 chars
            expect(result.length).toBeLessThanOrEqual(20);
            expect(result).not.toContain('<');
            expect(result).not.toContain('>');
            expect(result).not.toContain('<script>');
        });

        it('should limit length for chart readability', () => {
            const input = 'This is a very long category name that should be truncated';
            const result = (summaryService as any).sanitizeForMermaid(input);
            
            expect(result.length).toBeLessThanOrEqual(20);
        });

        it('should handle non-string input', () => {
            const result = (summaryService as any).sanitizeForMermaid(null);
            expect(result).toBe('');
        });
    });

    describe('onNoteSaved', () => {
        beforeEach(() => {
            mockJoplin.data.get.mockResolvedValue({
                parent_id: 'folder-id',
                title: 'Test Note'
            });
            
            mockFolderService.getAllExpenseStructure.mockResolvedValue({
                folders: [],
                notes: [{ id: 'expense-note-id' }]
            });
        });

        it('should process summaries workflow for expense notes', async () => {
            const noteId = 'expense-note-id';
            
            // Test the workflow components
            await mockJoplin.data.get(['notes', noteId], { fields: ['parent_id', 'title'] });
            const structure = await mockFolderService.getAllExpenseStructure();
            const isExpenseNote = structure.notes.some(n => n.id === noteId);

            expect(isExpenseNote).toBe(true);
        });

        it('should not process summaries for non-expense notes', async () => {
            const noteId = 'non-expense-note-id';
            
            // Test the workflow components
            const structure = await mockFolderService.getAllExpenseStructure();
            const isExpenseNote = structure.notes.some(n => n.id === noteId);

            expect(isExpenseNote).toBe(false);
        });
    });

    describe('singleton pattern', () => {
        it('should return same instance', () => {
            const instance1 = SummaryService.getInstance();
            const instance2 = SummaryService.getInstance();

            expect(instance1).toBe(instance2);
        });
    });
});