// Mock the joplin API
jest.mock('api', () => ({
    default: {
        data: {
            get: jest.fn(),
            post: jest.fn(),
            put: jest.fn(),
        }
    }
}));

import { FolderService } from '../../src/services/FolderService';

// Create a local mock for this test file
const mockJoplin = {
    data: {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn()
    }
};

// Set global joplin for this test
(global as any).joplin = mockJoplin;

describe('FolderService Caching', () => {
    let folderService: FolderService;

    beforeEach(() => {
        folderService = FolderService.getInstance();
        
        // Reset all mocks
        jest.clearAllMocks();
        
        // Clear caches
        (folderService as any).invalidateAllCaches();
        
        // Mock SettingsService to return expected values
        const mockSettingsService = {
            getSettings: jest.fn().mockReturnValue({
                expensesFolderPath: 'expenses',
                defaultCurrency: '$'
            })
        };
        
        // Replace the settingsService in the folderService
        (folderService as any).settingsService = mockSettingsService;
    });

    afterEach(() => {
        // Stop timers to prevent Jest from hanging
        if (folderService) {
            folderService.stopLockCleanup();
        }
    });

    describe('getAllExpenseStructure caching', () => {
        beforeEach(() => {
            // Mock the main expenses folder lookup
            mockJoplin.data.get.mockImplementation((path: string[], options?: any) => {
                if (path[0] === 'folders' && path.length === 1 && !options.parent_id) {
                    // Main folder lookup
                    return Promise.resolve({
                        items: [{ id: 'main-folder-id', title: 'expenses' }]
                    });
                }
                if (path[0] === 'folders' && path.length === 1 && options.parent_id === 'main-folder-id') {
                    // Year folders under main expenses folder
                    return Promise.resolve({
                        items: [
                            { id: 'year-folder-2025', title: '2025', parent_id: 'main-folder-id' }
                        ]
                    });
                }
                if (path[0] === 'notes' && options.parent_id === 'main-folder-id') {
                    // Notes in main folder
                    return Promise.resolve({
                        items: [
                            { id: 'new-expenses-id', title: 'new-expenses', parent_id: 'main-folder-id' }
                        ]
                    });
                }
                if (path[0] === 'notes' && options.parent_id === 'year-folder-2025') {
                    // Notes in year folder
                    return Promise.resolve({
                        items: [
                            { id: 'monthly-note-01', title: '01', parent_id: 'year-folder-2025' }
                        ]
                    });
                }
                return Promise.resolve({ items: [] });
            });
        });

        it('should cache expense structure and avoid redundant API calls', async () => {
            // First call - should hit the API
            const result1 = await folderService.getAllExpenseStructure();
            
            expect(result1).toEqual({
                folders: [{ id: 'year-folder-2025', title: '2025', parent_id: 'main-folder-id' }],
                notes: [
                    { id: 'new-expenses-id', title: 'new-expenses', parent_id: 'main-folder-id' },
                    { id: 'monthly-note-01', title: '01', parent_id: 'year-folder-2025' }
                ]
            });
            
            // Count initial API calls
            const initialApiCalls = mockJoplin.data.get.mock.calls.length;
            expect(initialApiCalls).toBeGreaterThan(0);
            
            // Second call - should use cache
            const result2 = await folderService.getAllExpenseStructure();
            
            expect(result2).toEqual(result1);
            
            // Should not have made additional API calls
            expect(mockJoplin.data.get.mock.calls.length).toBe(initialApiCalls);
        });

        it('should invalidate cache when structure changes', async () => {
            // First call to populate cache
            await folderService.getAllExpenseStructure();
            const initialApiCalls = mockJoplin.data.get.mock.calls.length;
            
            // Invalidate cache
            folderService.invalidateExpenseStructureCache();
            
            // Second call should hit API again
            await folderService.getAllExpenseStructure();
            
            // Should have made additional API calls
            expect(mockJoplin.data.get.mock.calls.length).toBeGreaterThan(initialApiCalls);
        });

        it('should refresh cache with explicit refresh call', async () => {
            // First call to populate cache
            await folderService.getAllExpenseStructure();
            const initialApiCalls = mockJoplin.data.get.mock.calls.length;
            
            // Refresh cache
            await folderService.refreshExpenseStructureCache();
            
            // Should have made additional API calls
            expect(mockJoplin.data.get.mock.calls.length).toBeGreaterThan(initialApiCalls);
        });

        it('should expire cache after timeout', async () => {
            // Mock Date.now to control cache expiration
            const originalDateNow = Date.now;
            const baseTime = 1000000;
            
            Date.now = jest.fn().mockReturnValue(baseTime);
            
            try {
                // First call
                await folderService.getAllExpenseStructure();
                const initialApiCalls = mockJoplin.data.get.mock.calls.length;
                
                // Simulate time passing beyond cache duration (300 seconds)
                (Date.now as jest.Mock).mockReturnValue(baseTime + 301000);
                
                // Second call should hit API again due to expired cache
                await folderService.getAllExpenseStructure();
                
                expect(mockJoplin.data.get.mock.calls.length).toBeGreaterThan(initialApiCalls);
            } finally {
                Date.now = originalDateNow;
            }
        });
    });

    describe('ensureExpensesFolderExists caching', () => {
        beforeEach(() => {
            mockJoplin.data.get.mockResolvedValue({
                items: [{ id: 'main-folder-id', title: 'expenses' }]
            });
        });

        it('should cache expenses folder ID', async () => {
            // First call
            const folderId1 = await (folderService as any).ensureExpensesFolderExists();
            const initialApiCalls = mockJoplin.data.get.mock.calls.length;
            
            // Second call should use cache
            const folderId2 = await (folderService as any).ensureExpensesFolderExists();
            
            expect(folderId1).toBe('main-folder-id');
            expect(folderId2).toBe(folderId1);
            
            // Should not have made additional API calls
            expect(mockJoplin.data.get.mock.calls.length).toBe(initialApiCalls);
        });
    });

    describe('ensureYearStructureExists caching', () => {
        beforeEach(() => {
            // Mock the full chain for year structure creation
            mockJoplin.data.get.mockImplementation((path: string[], options?: any) => {
                if (path[0] === 'folders' && path.length === 1 && !options.parent_id) {
                    return Promise.resolve({
                        items: [{ id: 'main-folder-id', title: 'expenses' }]
                    });
                }
                if (path[0] === 'folders' && options.parent_id === 'main-folder-id') {
                    return Promise.resolve({
                        items: [{ id: 'year-folder-2025', title: '2025', parent_id: 'main-folder-id' }]
                    });
                }
                if (path[0] === 'notes' && options.parent_id === 'year-folder-2025') {
                    return Promise.resolve({
                        items: [
                            { id: 'monthly-01', title: '01', parent_id: 'year-folder-2025' },
                            { id: 'annual-2025', title: '2025', parent_id: 'year-folder-2025' }
                        ]
                    });
                }
                return Promise.resolve({ items: [] });
            });

            mockJoplin.data.put = jest.fn().mockResolvedValue({});
            mockJoplin.data.post = jest.fn().mockResolvedValue({ id: 'new-note-id' });
        });

        it('should cache year structure and avoid redundant API calls', async () => {
            // First call - should hit the API
            const structure1 = await folderService.ensureYearStructureExists('2025');
            
            expect(structure1.yearFolder).toBe('year-folder-2025');
            expect(structure1.expensesFolder).toBe('main-folder-id');
            
            // Count initial API calls
            const initialApiCalls = mockJoplin.data.get.mock.calls.length;
            expect(initialApiCalls).toBeGreaterThan(0);
            
            // Second call - should use cache
            const structure2 = await folderService.ensureYearStructureExists('2025');
            
            expect(structure2).toEqual(structure1);
            
            // Should not have made additional API calls
            expect(mockJoplin.data.get.mock.calls.length).toBe(initialApiCalls);
        });

        it('should invalidate year structure cache when called', async () => {
            // First call to populate cache
            await folderService.ensureYearStructureExists('2025');
            const initialApiCalls = mockJoplin.data.get.mock.calls.length;
            
            // Invalidate year structure cache
            folderService.invalidateYearStructureCache('2025');
            
            // Second call should hit API again
            await folderService.ensureYearStructureExists('2025');
            
            // Should have made additional API calls
            expect(mockJoplin.data.get.mock.calls.length).toBeGreaterThan(initialApiCalls);
        });
    });

    describe('findNoteInFolder caching', () => {
        beforeEach(() => {
            mockJoplin.data.get.mockImplementation((path: string[], options?: any) => {
                if (path[0] === 'notes' && options.parent_id === 'test-folder-id') {
                    return Promise.resolve({
                        items: [
                            { id: 'note-1', title: 'Test Note', parent_id: 'test-folder-id' },
                            { id: 'note-2', title: 'Another Note', parent_id: 'test-folder-id' }
                        ]
                    });
                }
                return Promise.resolve({ items: [] });
            });
        });

        it('should cache note lookup results', async () => {
            // First call - should hit the API
            const noteId1 = await folderService.findNoteInFolder('test-folder-id', 'Test Note');
            expect(noteId1).toBe('note-1');
            expect(mockJoplin.data.get).toHaveBeenCalledTimes(1);
            
            // Second call - should use cache
            const noteId2 = await folderService.findNoteInFolder('test-folder-id', 'Test Note');
            expect(noteId2).toBe('note-1');
            
            // Should not have made additional API calls
            expect(mockJoplin.data.get).toHaveBeenCalledTimes(1);
        });

        it('should cache negative results (note not found)', async () => {
            // First call - should hit the API and not find the note
            const noteId1 = await folderService.findNoteInFolder('test-folder-id', 'Nonexistent Note');
            expect(noteId1).toBeNull();
            expect(mockJoplin.data.get).toHaveBeenCalledTimes(1);
            
            // Second call - should use cached negative result
            const noteId2 = await folderService.findNoteInFolder('test-folder-id', 'Nonexistent Note');
            expect(noteId2).toBeNull();
            
            // Should not have made additional API calls
            expect(mockJoplin.data.get).toHaveBeenCalledTimes(1);
        });

        it('should invalidate note find cache for specific folder', async () => {
            // Populate cache
            await folderService.findNoteInFolder('test-folder-id', 'Test Note');
            expect(mockJoplin.data.get).toHaveBeenCalledTimes(1);
            
            // Invalidate cache for this folder
            folderService.invalidateNoteFindCache('test-folder-id');
            
            // Next call should hit API again
            await folderService.findNoteInFolder('test-folder-id', 'Test Note');
            expect(mockJoplin.data.get).toHaveBeenCalledTimes(2);
        });

        it('should not invalidate cache for different folder', async () => {
            // Populate cache for first folder
            await folderService.findNoteInFolder('test-folder-id', 'Test Note');
            expect(mockJoplin.data.get).toHaveBeenCalledTimes(1);
            
            // Invalidate cache for different folder
            folderService.invalidateNoteFindCache('other-folder-id');
            
            // Next call to original folder should still use cache
            await folderService.findNoteInFolder('test-folder-id', 'Test Note');
            expect(mockJoplin.data.get).toHaveBeenCalledTimes(1);
        });
    });

    describe('integrated cache invalidation', () => {
        it('should invalidate all related caches when calling invalidateAllCaches', async () => {
            // Mock complex scenario
            mockJoplin.data.get.mockImplementation((path: string[], options?: any) => {
                if (path[0] === 'folders' && !options?.parent_id) {
                    return Promise.resolve({ items: [{ id: 'main-folder-id', title: 'expenses' }] });
                }
                if (path[0] === 'notes' && options?.parent_id) {
                    return Promise.resolve({ items: [{ id: 'test-note', title: 'test', parent_id: options.parent_id }] });
                }
                return Promise.resolve({ items: [] });
            });
            
            // Populate various caches
            await folderService.getAllExpenseStructure();
            await (folderService as any).ensureExpensesFolderExists();
            await folderService.findNoteInFolder('test-folder', 'test');
            
            const initialCalls = mockJoplin.data.get.mock.calls.length;
            
            // Invalidate all caches
            folderService.invalidateAllCaches();
            
            // All subsequent calls should hit the API again
            await folderService.getAllExpenseStructure();
            await (folderService as any).ensureExpensesFolderExists();
            await folderService.findNoteInFolder('test-folder', 'test');
            
            expect(mockJoplin.data.get.mock.calls.length).toBeGreaterThan(initialCalls);
        });
    });
});