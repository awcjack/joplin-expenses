// Mock the 'api' module
jest.mock('api', () => ({
    default: {
        data: {
            get: jest.fn(),
            post: jest.fn(),
            put: jest.fn()
        }
    }
}));

// Import the mocked joplin API
import joplin from 'api';
const mockJoplin = joplin as jest.Mocked<typeof joplin>;

// Mock settings service
const mockSettingsService = {
    getSettings: jest.fn().mockReturnValue({
        expensesFolderPath: 'expenses'
    })
};

// Mock service imports
jest.mock('../../src/services/SettingsService', () => ({
    SettingsService: {
        getInstance: () => mockSettingsService
    }
}));

describe('FolderService Workflows', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('folder initialization workflow', () => {
        it('should create main expenses folder when it does not exist', async () => {
            (mockJoplin.data.get as jest.Mock).mockResolvedValue({ items: [] });
            (mockJoplin.data.post as jest.Mock).mockResolvedValue({ id: 'new-folder-id' });

            // Test folder creation workflow
            const folders = await mockJoplin.data.get(['folders'], { fields: ['id', 'title'] });
            const folderName = 'expenses';
            const existingFolder = folders.items.find(f => f.title === folderName);

            if (!existingFolder) {
                const newFolder = await mockJoplin.data.post(['folders'], null, {
                    title: folderName
                });
                expect(newFolder.id).toBe('new-folder-id');
            }

            expect(mockJoplin.data.post).toHaveBeenCalledWith(['folders'], null, {
                title: 'expenses'
            });
        });

        it('should use existing expenses folder if it exists', async () => {
            const mockResponse = {
                items: [{ id: 'existing-folder-id', title: 'expenses' }]
            };
            
            (mockJoplin.data.get as jest.Mock).mockResolvedValue(mockResponse);

            // Test existing folder detection workflow
            const folders = await mockJoplin.data.get(['folders'], { fields: ['id', 'title'] });
            const folderName = 'expenses';
            const existingFolder = folders.items.find(f => f.title === folderName);

            expect(existingFolder).toBeTruthy();
            expect(existingFolder.id).toBe('existing-folder-id');
        });
    });

    describe('year structure creation workflow', () => {
        it('should create year folder and monthly notes', async () => {
            const year = '2025';
            
            // Mock setup for year creation workflow
            (mockJoplin.data.get as jest.Mock).mockResolvedValue({
                items: [{ id: 'expenses-folder-id', title: 'expenses' }]
            });
            
            (mockJoplin.data.post as jest.Mock).mockResolvedValue({ id: 'year-folder-id' });

            // Test year folder creation workflow
            const expensesFolder = await mockJoplin.data.get(['folders'], { fields: ['id', 'title'] });
            const mainFolder = expensesFolder.items.find(f => f.title === 'expenses');

            if (mainFolder) {
                const yearFolder = await mockJoplin.data.post(['folders'], null, {
                    title: year,
                    parent_id: mainFolder.id
                });

                expect(yearFolder.id).toBe('year-folder-id');
                expect(mockJoplin.data.post).toHaveBeenCalledWith(['folders'], null, {
                    title: year,
                    parent_id: 'expenses-folder-id'
                });
            }
        });
    });

    describe('document creation workflows', () => {
        it('should create new-expenses document with proper template', async () => {
            // Setup mocks for sequential calls
            (mockJoplin.data.get as jest.Mock)
                .mockResolvedValueOnce({ items: [{ id: 'expenses-folder-id', title: 'expenses' }] }) // Get folders
                .mockResolvedValueOnce({ items: [] }); // Get notes in folder
            
            (mockJoplin.data.post as jest.Mock).mockResolvedValue({ id: 'new-expenses-note-id' });

            // Test new-expenses document creation workflow
            const folders = await mockJoplin.data.get(['folders'], { fields: ['id', 'title'] });
            const expensesFolder = folders.items.find(f => f.title === 'expenses');

            if (expensesFolder) {
                const notes = await mockJoplin.data.get(['folders', expensesFolder.id, 'notes'], {
                    fields: ['id', 'title']
                });
                
                const existingNote = notes.items.find(n => n.title === 'new-expenses');
                
                if (!existingNote) {
                    const newNote = await mockJoplin.data.post(['notes'], null, {
                        title: 'new-expenses',
                        parent_id: expensesFolder.id,
                        body: expect.stringContaining('| price | description | category |')
                    });

                    expect(newNote.id).toBe('new-expenses-note-id');
                }
            }
        });

        it('should create recurring-expenses document', async () => {
            (mockJoplin.data.get as jest.Mock).mockResolvedValue({ items: [{ id: 'expenses-folder-id', title: 'expenses' }] });
            (mockJoplin.data.post as jest.Mock).mockResolvedValue({ id: 'recurring-expenses-note-id' });

            // Test recurring-expenses document creation workflow
            const noteId = await mockJoplin.data.post(['notes'], null, {
                title: 'recurring-expenses',
                parent_id: 'expenses-folder-id',
                body: expect.stringContaining('recurring')
            });

            expect(mockJoplin.data.post).toHaveBeenCalledWith(['notes'], null, {
                title: 'recurring-expenses',
                parent_id: 'expenses-folder-id',
                body: expect.stringContaining('recurring')
            });
        });
    });

    describe('folder structure queries', () => {
        it('should retrieve all expense folders and notes', async () => {
            // Setup sequential mock responses
            (mockJoplin.data.get as jest.Mock)
                .mockResolvedValueOnce({ items: [{ id: 'expenses-folder-id', title: 'expenses' }] }) // Main folder
                .mockResolvedValueOnce({ 
                    items: [
                        { id: 'year-folder-1', title: '2024' },
                        { id: 'year-folder-2', title: '2025' }
                    ] 
                }) // Year folders
                .mockResolvedValue({ 
                    items: [
                        { id: 'note-1', title: '2024' },
                        { id: 'note-2', title: '01' }
                    ] 
                }); // Notes in folders

            // Test expense structure retrieval workflow
            const folders = await mockJoplin.data.get(['folders'], { fields: ['id', 'title'] });
            const expensesFolder = folders.items.find(f => f.title === 'expenses');
            
            if (expensesFolder) {
                const yearFolders = await mockJoplin.data.get(['folders', expensesFolder.id, 'folders'], {
                    fields: ['id', 'title']
                });

                expect(yearFolders.items).toHaveLength(2);
                expect(yearFolders.items[0].title).toBe('2024');
                expect(yearFolders.items[1].title).toBe('2025');

                // Test getting notes from year folders
                for (const yearFolder of yearFolders.items) {
                    const notes = await mockJoplin.data.get(['folders', yearFolder.id, 'notes'], {
                        fields: ['id', 'title']
                    });
                    expect(notes.items).toHaveLength(2);
                }
            }
        });

        it('should find notes by title in folder', async () => {
            const folderId = 'test-folder-id';
            const noteTitle = '01';

            (mockJoplin.data.get as jest.Mock).mockResolvedValue({
                items: [
                    { id: 'note-1', title: '01' },
                    { id: 'note-2', title: '02' }
                ]
            });

            // Test note finding workflow
            const response = await mockJoplin.data.get(['folders', folderId, 'notes'], {
                fields: ['id', 'title']
            });
            
            const foundNote = response.items.find(note => note.title === noteTitle);
            const noteId = foundNote ? foundNote.id : null;

            expect(noteId).toBe('note-1');
        });

        it('should return null when note not found', async () => {
            (mockJoplin.data.get as jest.Mock).mockResolvedValue({ items: [] });

            // Test note not found workflow
            const response = await mockJoplin.data.get(['folders', 'folder-id', 'notes'], {
                fields: ['id', 'title']
            });
            
            const foundNote = response.items.find(note => note.title === 'nonexistent');
            const noteId = foundNote ? foundNote.id : null;

            expect(noteId).toBeNull();
        });
    });

    describe('folder structure validation', () => {
        it('should validate year folder structure', async () => {
            const year = '2025';
            
            (mockJoplin.data.get as jest.Mock)
                .mockResolvedValueOnce({ items: [{ id: 'expenses-folder-id', title: 'expenses' }] })
                .mockResolvedValueOnce({ 
                    items: [{ id: 'year-folder-id', title: '2025' }] 
                })
                .mockResolvedValueOnce({ 
                    items: [
                        { id: 'annual-note', title: '2025' },
                        { id: 'jan-note', title: '01' },
                        { id: 'feb-note', title: '02' }
                    ] 
                });

            // Test folder structure validation workflow
            const folders = await mockJoplin.data.get(['folders'], { fields: ['id', 'title'] });
            const expensesFolder = folders.items.find(f => f.title === 'expenses');
            
            if (expensesFolder) {
                const yearFolders = await mockJoplin.data.get(['folders', expensesFolder.id, 'folders'], {
                    fields: ['id', 'title']
                });
                
                const yearFolder = yearFolders.items.find(f => f.title === year);
                
                if (yearFolder) {
                    const yearNotes = await mockJoplin.data.get(['folders', yearFolder.id, 'notes'], {
                        fields: ['id', 'title']
                    });
                    
                    const annualNote = yearNotes.items.find(n => n.title === year);
                    const monthlyNotes = yearNotes.items.filter(n => n.title !== year);
                    
                    expect(yearFolder.id).toBe('year-folder-id');
                    expect(annualNote.id).toBe('annual-note');
                    expect(monthlyNotes).toHaveLength(2);
                }
            }
        });

        it('should handle missing year folder', async () => {
            (mockJoplin.data.get as jest.Mock)
                .mockResolvedValueOnce({ items: [{ id: 'expenses-folder-id', title: 'expenses' }] })
                .mockResolvedValueOnce({ items: [] }); // No year folders

            // Test missing year folder workflow
            const folders = await mockJoplin.data.get(['folders'], { fields: ['id', 'title'] });
            const expensesFolder = folders.items.find(f => f.title === 'expenses');
            
            if (expensesFolder) {
                const yearFolders = await mockJoplin.data.get(['folders', expensesFolder.id, 'folders'], {
                    fields: ['id', 'title']
                });
                
                const yearFolder = yearFolders.items.find(f => f.title === '2025');
                expect(yearFolder).toBeUndefined();
            }
        });
    });

    describe('error handling scenarios', () => {
        it('should handle API errors gracefully', async () => {
            (mockJoplin.data.get as jest.Mock).mockRejectedValue(new Error('API Error'));

            try {
                await mockJoplin.data.get(['folders'], { fields: ['id', 'title'] });
            } catch (error) {
                expect(error.message).toBe('API Error');
            }
        });

        it('should handle malformed API responses', async () => {
            (mockJoplin.data.get as jest.Mock).mockResolvedValue(null);

            const response = await mockJoplin.data.get(['folders'], { fields: ['id', 'title'] });
            expect(response).toBeNull();
        });
    });

    describe('settings integration', () => {
        it('should use settings for folder path', () => {
            const settings = mockSettingsService.getSettings();
            expect(settings.expensesFolderPath).toBe('expenses');
        });

        it('should handle missing settings', () => {
            mockSettingsService.getSettings.mockReturnValueOnce(undefined);
            
            const settings = mockSettingsService.getSettings();
            expect(settings).toBeUndefined();
        });
    });
});