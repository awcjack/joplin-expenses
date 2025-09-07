import { SummaryService } from '../../src/services/SummaryService';
import { ExpenseEntry } from '../../src/types';

// Mock services
const mockExpenseService = {
    getYearlyExpenses: jest.fn(),
    getMonthlyExpenses: jest.fn()
};

const mockSettingsService = {
    getSettings: jest.fn().mockReturnValue({
        defaultCurrency: '$'
    })
};

const mockFolderService = {
    invalidateExpenseStructureCache: jest.fn(),
    invalidateYearStructureCache: jest.fn(),
    invalidateNoteFindCache: jest.fn()
};

describe('SummaryService Caching', () => {
    let summaryService: SummaryService;

    beforeEach(() => {
        summaryService = SummaryService.getInstance();
        
        // Reset all mocks
        jest.clearAllMocks();
        
        // Clear caches
        summaryService.invalidateAllCaches();
        
        // Replace the services in the summaryService
        (summaryService as any).expenseService = mockExpenseService;
        (summaryService as any).settingsService = mockSettingsService;
        (summaryService as any).folderService = mockFolderService;

        // Mock expense data
        const mockMonthlyExpenses: ExpenseEntry[] = [
            {
                price: 10.50,
                description: 'Coffee',
                category: 'food',
                date: '2025-01-15T10:30:00',
                shop: 'Cafe',
                attachment: '',
                recurring: 'false'
            },
            {
                price: 25.00,
                description: 'Groceries',
                category: 'food',
                date: '2025-01-20T14:00:00',
                shop: 'Market',
                attachment: '',
                recurring: 'false'
            }
        ];

        const mockYearlyExpenses: ExpenseEntry[] = [
            ...mockMonthlyExpenses,
            {
                price: 50.00,
                description: 'Gas',
                category: 'transport',
                date: '2025-02-01T08:00:00',
                shop: 'Station',
                attachment: '',
                recurring: 'false'
            }
        ];

        mockExpenseService.getMonthlyExpenses.mockResolvedValue(mockMonthlyExpenses);
        mockExpenseService.getYearlyExpenses.mockResolvedValue(mockYearlyExpenses);
    });

    describe('Monthly expenses caching', () => {
        it('should cache monthly expenses and avoid redundant calls', async () => {
            // First call - should hit the service
            await (summaryService as any).getCachedMonthlyExpenses('2025', '01');
            expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledTimes(1);
            expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledWith('2025', '01');

            // Second call - should use cache
            await (summaryService as any).getCachedMonthlyExpenses('2025', '01');
            expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledTimes(1); // No additional calls
        });

        it('should invalidate monthly cache when notified of expense changes', async () => {
            // Populate cache
            await (summaryService as any).getCachedMonthlyExpenses('2025', '01');
            expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledTimes(1);

            // Simulate expense data change
            summaryService.onExpenseDataChanged('2025', '01');

            // Next call should hit service again due to cache invalidation
            await (summaryService as any).getCachedMonthlyExpenses('2025', '01');
            expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledTimes(2);
        });
    });

    describe('Yearly expenses caching', () => {
        it('should cache yearly expenses and avoid redundant calls', async () => {
            // First call - should hit the service
            await (summaryService as any).getCachedYearlyExpenses('2025');
            expect(mockExpenseService.getYearlyExpenses).toHaveBeenCalledTimes(1);
            expect(mockExpenseService.getYearlyExpenses).toHaveBeenCalledWith('2025');

            // Second call - should use cache
            await (summaryService as any).getCachedYearlyExpenses('2025');
            expect(mockExpenseService.getYearlyExpenses).toHaveBeenCalledTimes(1); // No additional calls
        });

        it('should invalidate yearly cache when notified of expense changes', async () => {
            // Populate cache
            await (summaryService as any).getCachedYearlyExpenses('2025');
            expect(mockExpenseService.getYearlyExpenses).toHaveBeenCalledTimes(1);

            // Simulate expense data change
            summaryService.onExpenseDataChanged('2025');

            // Next call should hit service again due to cache invalidation
            await (summaryService as any).getCachedYearlyExpenses('2025');
            expect(mockExpenseService.getYearlyExpenses).toHaveBeenCalledTimes(2);
        });
    });

    describe('Summary caching', () => {
        it('should cache summary calculations and avoid redundant processing', async () => {
            const mockExpenses: ExpenseEntry[] = [
                {
                    price: 10.50,
                    description: 'Test',
                    category: 'test',
                    date: '2025-01-01T00:00:00',
                    shop: 'Test Shop',
                    attachment: '',
                    recurring: 'false'
                }
            ];

            // First call - should generate summary
            const summary1 = (summaryService as any).getCachedSummary(mockExpenses, 'test-key');
            expect(summary1.totalExpense).toBe(10.50);
            expect(summary1.entryCount).toBe(1);

            // Second call with same key - should use cache
            const summary2 = (summaryService as any).getCachedSummary(mockExpenses, 'test-key');
            expect(summary2).toBe(summary1); // Same object reference indicates cached result
        });

        it('should invalidate all caches correctly', async () => {
            // Populate caches
            await (summaryService as any).getCachedMonthlyExpenses('2025', '01');
            await (summaryService as any).getCachedYearlyExpenses('2025');

            // Invalidate all
            summaryService.invalidateAllCaches();

            // Next calls should hit services again
            await (summaryService as any).getCachedMonthlyExpenses('2025', '01');
            await (summaryService as any).getCachedYearlyExpenses('2025');

            expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledTimes(2);
            expect(mockExpenseService.getYearlyExpenses).toHaveBeenCalledTimes(2);
        });
    });

    describe('Cache expiration', () => {
        it('should expire cache after timeout', async () => {
            // Mock Date.now to control cache expiration
            const originalDateNow = Date.now;
            const baseTime = 1000000;
            
            Date.now = jest.fn().mockReturnValue(baseTime);
            
            try {
                // First call
                await (summaryService as any).getCachedMonthlyExpenses('2025', '01');
                expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledTimes(1);
                
                // Simulate time passing beyond cache duration (5 minutes = 300000ms)
                (Date.now as jest.Mock).mockReturnValue(baseTime + 301000);
                
                // Second call should hit service again due to expired cache
                await (summaryService as any).getCachedMonthlyExpenses('2025', '01');
                expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledTimes(2);
            } finally {
                Date.now = originalDateNow;
            }
        });
    });

    describe('Cross-service cache invalidation', () => {
        it('should call FolderService cache invalidation methods when expense data changes', () => {
            // Test year-specific invalidation
            summaryService.onExpenseDataChanged('2025', '01');
            
            expect(mockFolderService.invalidateExpenseStructureCache).toHaveBeenCalled();
            expect(mockFolderService.invalidateYearStructureCache).toHaveBeenCalledWith('2025');
        });

        it('should invalidate all year caches when year is provided but no month', () => {
            // Test year-only invalidation
            summaryService.onExpenseDataChanged('2025');
            
            expect(mockFolderService.invalidateExpenseStructureCache).toHaveBeenCalled();
            expect(mockFolderService.invalidateYearStructureCache).toHaveBeenCalledWith('2025');
        });

        it('should invalidate all year caches when no specific parameters provided', () => {
            // Test global invalidation
            summaryService.onExpenseDataChanged();
            
            expect(mockFolderService.invalidateExpenseStructureCache).toHaveBeenCalled();
            expect(mockFolderService.invalidateYearStructureCache).toHaveBeenCalledWith();
        });
    });

    describe('Document-based cache invalidation', () => {
        it('should invalidate monthly cache when monthly document title is detected', () => {
            const mockNote = { id: 'note1', title: '2024-03', body: '', parent_id: 'folder1' };
            
            // Test the private method through processDocumentSummaries
            jest.spyOn(summaryService, 'invalidateMonthCaches');
            
            // Call the private method directly for testing
            (summaryService as any).invalidateCachesForNote(mockNote);
            
            expect(summaryService.invalidateMonthCaches).toHaveBeenCalledWith('2024', '03');
        });

        it('should invalidate yearly cache when annual document title is detected', () => {
            const mockNote = { id: 'note1', title: '2024', body: '', parent_id: 'folder1' };
            
            jest.spyOn(summaryService, 'invalidateYearCaches');
            
            (summaryService as any).invalidateCachesForNote(mockNote);
            
            expect(summaryService.invalidateYearCaches).toHaveBeenCalledWith('2024');
        });

        it('should invalidate yearly cache when Annual Summary format is detected', () => {
            const mockNote = { id: 'note1', title: 'Annual Summary 2024', body: '', parent_id: 'folder1' };
            
            jest.spyOn(summaryService, 'invalidateYearCaches');
            
            (summaryService as any).invalidateCachesForNote(mockNote);
            
            expect(summaryService.invalidateYearCaches).toHaveBeenCalledWith('2024');
        });

        it('should invalidate all caches for new-expenses document', () => {
            const mockNote = { id: 'note1', title: 'new-expenses', body: '', parent_id: 'folder1' };
            
            jest.spyOn(summaryService, 'invalidateAllCaches');
            
            (summaryService as any).invalidateCachesForNote(mockNote);
            
            expect(summaryService.invalidateAllCaches).toHaveBeenCalled();
        });

        it('should invalidate all caches for recurring-expenses document', () => {
            const mockNote = { id: 'note1', title: 'recurring-expenses', body: '', parent_id: 'folder1' };
            
            jest.spyOn(summaryService, 'invalidateAllCaches');
            
            (summaryService as any).invalidateCachesForNote(mockNote);
            
            expect(summaryService.invalidateAllCaches).toHaveBeenCalled();
        });
    });

    describe('Monthly cache invalidation affecting yearly cache', () => {
        it('should invalidate yearly cache when monthly cache is invalidated', async () => {
            // Populate both caches
            await (summaryService as any).getCachedMonthlyExpenses('2024', '03');
            await (summaryService as any).getCachedYearlyExpenses('2024');
            
            expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledTimes(1);
            expect(mockExpenseService.getYearlyExpenses).toHaveBeenCalledTimes(1);
            
            // Invalidate monthly cache (which should also invalidate yearly)
            summaryService.invalidateMonthCaches('2024', '03');
            
            // Both caches should now be invalidated - next calls should hit services
            await (summaryService as any).getCachedMonthlyExpenses('2024', '03');
            await (summaryService as any).getCachedYearlyExpenses('2024');
            
            expect(mockExpenseService.getMonthlyExpenses).toHaveBeenCalledTimes(2);
            expect(mockExpenseService.getYearlyExpenses).toHaveBeenCalledTimes(2);
        });
    });
});