import joplin from 'api';
import { FolderStructure, FOLDER_NAMES } from '../types';
import { getCurrentYear, getAllMonths, getMonthName } from '../utils/dateUtils';
import { SettingsService } from './SettingsService';
import { getAllFolders, getAllNotesInFolder, findNoteInFolderPaginated } from '../utils/apiUtils';

export class FolderService {
    private static instance: FolderService;
    private settingsService: SettingsService;
    
    // Simple mutex to prevent race conditions in folder/note creation
    private operationLocks: Map<string, Promise<any>> = new Map();
    
    // Cache for expensive folder structure operations
    private expenseStructureCache: { folders: any[], notes: any[] } | null = null;
    private expenseStructureCacheTime: number = 0;
    private readonly CACHE_DURATION = 300000; // 300 seconds
    
    // Cache for folder ID lookups
    private expensesFolderIdCache: string | null = null;
    private expensesFolderIdCacheTime: number = 0;
    
    // Cache for year structure operations
    private yearStructureCache: Map<string, { structure: FolderStructure, timestamp: number }> = new Map();
    
    // Cache for note finding operations
    private noteFindCache: Map<string, { noteId: string | null, timestamp: number }> = new Map();
    
    // Memory management: Cache size limits and cleanup
    private readonly MAX_YEAR_CACHE_ENTRIES = 50; // Limit year structure cache
    private readonly MAX_NOTE_FIND_CACHE_ENTRIES = 200; // Limit note find cache
    private readonly MAX_OPERATION_LOCKS = 100; // Limit operation locks
    private readonly LOCK_CLEANUP_INTERVAL = 300000; // 5 minutes
    private lockCleanupTimer: NodeJS.Timeout | null = null;

    private constructor() {
        this.settingsService = SettingsService.getInstance();
        this.startLockCleanup();
    }

    /**
     * Execute an operation with a lock to prevent race conditions
     */
    private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
        // If there's already an operation for this key, wait for it
        const existingLock = this.operationLocks.get(key);
        if (existingLock) {
            await existingLock.catch(() => {}); // Ignore errors from previous operations
        }

        // Create a new lock for this operation
        const lockPromise = operation();
        this.operationLocks.set(key, lockPromise);

        try {
            const result = await lockPromise;
            return result;
        } finally {
            // Clean up the lock only if it's still the current one
            if (this.operationLocks.get(key) === lockPromise) {
                this.operationLocks.delete(key);
            }
            // Prevent locks map from growing too large
            this.enforceOperationLockLimit();
        }
    }

    public static getInstance(): FolderService {
        if (!FolderService.instance) {
            FolderService.instance = new FolderService();
        }
        return FolderService.instance;
    }

    /**
     * Initialize the plugin by reading existing folder structure or creating it if needed
     */
    async initializePlugin(): Promise<void> {
        console.info('Initializing plugin folder services...');
        
        try {
            // Reload settings to ensure we have the latest configuration
            await this.settingsService.reloadSettings();
            
            // Check if folder structure already exists
            const structureExists = await this.isStructureInitialized();
            
            if (structureExists) {
                console.info('Existing folder structure found, reading and caching...');
                await this.loadExistingStructure();
            } else {
                console.info('No existing folder structure found, creating new structure...');
                await this.initializeFolderStructure();
            }
            
            console.info('Plugin folder services initialized successfully');
        } catch (error) {
            console.error('Failed to initialize plugin folder services:', error);
            throw error;
        }
    }

    /**
     * Load existing folder structure and populate caches
     */
    private async loadExistingStructure(): Promise<void> {
        console.info('Loading existing folder structure...');
        
        try {
            // Clear all caches first to ensure fresh data
            this.invalidateAllCaches();
            
            // Validate structure integrity before proceeding
            const structureValid = await this.validateExistingStructure();
            if (!structureValid) {
                console.warn('Existing structure validation failed, will re-initialize');
                await this.initializeFolderStructure();
                return;
            }
            
            // Refresh all caches with existing structure
            await this.refreshCachesAfterInitialization();
            
            console.info('Existing folder structure loaded successfully');
        } catch (error) {
            console.error('Failed to load existing folder structure:', error);
            // Fallback to initialization if loading fails
            console.info('Attempting to re-initialize folder structure as fallback...');
            await this.initializeFolderStructure();
        }
    }

    /**
     * Validate existing folder structure integrity (READ-ONLY - does not create anything)
     */
    private async validateExistingStructure(): Promise<boolean> {
        try {
            const settings = this.settingsService.getSettings();
            const folderName = settings.expensesFolderPath;
            
            // 1. Check if main expenses folder exists (read-only)
            const folders = await getAllFolders(['id', 'title']);
            const expensesFolder = folders.find((f: any) => f.title === folderName);
            
            if (!expensesFolder) {
                console.warn('Expenses folder not found during validation');
                return false;
            }
            
            // 2. Check if current year folder exists (read-only)
            const currentYear = getCurrentYear();
            const yearFolder = folders.find((f: any) => 
                f.title === currentYear && f.parent_id === expensesFolder.id
            );
            
            if (!yearFolder) {
                console.warn('Year folder not found during validation');
                return false;
            }
            
            // 3. Check if new-expenses document exists (read-only)
            const notesInFolder = await getAllNotesInFolder(expensesFolder.id, ['id', 'title', 'parent_id']);
            const newExpensesNote = notesInFolder.find((n: any) => n.title === FOLDER_NAMES.NEW_EXPENSES);
            
            if (!newExpensesNote) {
                console.warn('New-expenses document not found during validation');
                return false;
            }
            
            // 4. Validate document accessibility (read-only check)
            const testNote = await joplin.data.get(['notes', newExpensesNote.id], { fields: ['id', 'title'] });
            if (!testNote || !testNote.id) {
                console.warn('New-expenses document not accessible during validation');
                return false;
            }
            
            console.info('Existing structure validation passed - all components found and accessible');
            return true;
        } catch (error) {
            console.error('Structure validation failed:', error);
            return false;
        }
    }

    /**
     * Initialize the folder structure for expenses
     */
    async initializeFolderStructure(): Promise<void> {
        console.info('Initializing expense folder structure...');
        
        try {
            // Clear all caches before initialization - folder structure may have been deleted/recreated
            console.info('Clearing folder caches before initialization...');
            this.invalidateAllCaches();
            
            // Ensure the main expenses folder exists
            await this.ensureExpensesFolderExists();
            
            // Create current year structure
            const currentYear = getCurrentYear();
            await this.ensureYearStructureExists(currentYear);
            
            // Create new-expenses document
            await this.ensureNewExpensesDocumentExists();
            
            // Create recurring-expenses document
            await this.ensureRecurringExpensesDocumentExists();
            
            // Update caches after successful initialization
            console.info('Updating caches after successful initialization...');
            await this.refreshCachesAfterInitialization();
            
            console.info('Folder structure initialized successfully');
        } catch (error) {
            console.error('Failed to initialize folder structure:', error);
            throw error;
        }
    }

    /**
     * Refresh caches after successful initialization
     */
    private async refreshCachesAfterInitialization(): Promise<void> {
        try {
            console.info('Refreshing all caches after initialization...');
            
            // 1. Refresh folder structure cache (folders and notes)
            await this.refreshExpenseStructureCache();
            
            // 2. Pre-warm expenses folder cache (read-only)
            await this.preWarmExpensesFolderCache();
            
            // 3. Pre-warm year structure cache for current year (read-only)
            const currentYear = getCurrentYear();
            await this.preWarmYearStructureCache(currentYear);
            
            // 4. Pre-warm monthly document caches for current year
            await this.preWarmMonthlyDocumentCaches(currentYear);
            
            // 5. Pre-warm new-expenses document cache
            await this.preWarmNewExpensesCache();
            
            // 6. Pre-warm recurring-expenses document cache
            await this.preWarmRecurringExpensesCache();
            
            console.info('All caches refreshed successfully after initialization');
        } catch (error) {
            console.error('Failed to refresh caches after initialization:', error);
            // Don't throw - initialization was successful, cache warming is optional
        }
    }

    /**
     * Pre-warm the new-expenses document cache by finding and caching the document ID (READ-ONLY)
     */
    private async preWarmNewExpensesCache(): Promise<void> {
        try {
            const settings = this.settingsService.getSettings();
            const folderName = settings.expensesFolderPath;
            
            // Find expenses folder without creating it
            const folders = await getAllFolders(['id', 'title']);
            const expensesFolder = folders.find((f: any) => f.title === folderName);
            
            if (!expensesFolder) {
                console.warn('Cannot pre-warm new-expenses cache - expenses folder not found');
                return;
            }
            
            const noteTitle = FOLDER_NAMES.NEW_EXPENSES;
            const cacheKey = `${expensesFolder.id}-${noteTitle}`;
            
            // Only query if not already cached
            const cached = this.noteFindCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
                return; // Already cached
            }
            
            // Find the document (read-only)
            const notesInFolder = await getAllNotesInFolder(expensesFolder.id, ['id', 'title', 'parent_id']);
            const newExpensesNote = notesInFolder.find((n: any) => n.title === noteTitle);
            
            if (newExpensesNote) {
                // Cache the document ID
                this.noteFindCache.set(cacheKey, { noteId: newExpensesNote.id, timestamp: Date.now() });
                this.enforceCacheSizeLimits();
                console.info('Pre-warmed new-expenses document cache (read-only)');
            } else {
                console.warn('New-expenses document not found during cache pre-warming');
            }
        } catch (error) {
            console.error('Failed to pre-warm new-expenses cache:', error);
            // Don't throw - this is just cache optimization
        }
    }

    /**
     * Pre-warm expenses folder cache (READ-ONLY)
     */
    private async preWarmExpensesFolderCache(): Promise<void> {
        try {
            const settings = this.settingsService.getSettings();
            const folderName = settings.expensesFolderPath;
            
            // Find expenses folder without creating it
            const folders = await getAllFolders(['id', 'title']);
            const expensesFolder = folders.find((f: any) => f.title === folderName);
            
            if (expensesFolder) {
                // Cache the folder ID
                this.expensesFolderIdCache = expensesFolder.id;
                this.expensesFolderIdCacheTime = Date.now();
                console.info('Pre-warmed expenses folder cache (read-only)');
            } else {
                console.warn('Expenses folder not found during cache pre-warming');
            }
        } catch (error) {
            console.error('Failed to pre-warm expenses folder cache:', error);
        }
    }

    /**
     * Pre-warm year structure cache (READ-ONLY)
     */
    private async preWarmYearStructureCache(year: string): Promise<void> {
        try {
            const settings = this.settingsService.getSettings();
            const folderName = settings.expensesFolderPath;
            
            // Find expenses folder and year folder without creating them
            const folders = await getAllFolders(['id', 'title', 'parent_id']);
            const expensesFolder = folders.find((f: any) => f.title === folderName);
            
            if (!expensesFolder) {
                console.warn('Cannot pre-warm year structure cache - expenses folder not found');
                return;
            }
            
            const yearFolder = folders.find((f: any) => 
                f.title === year && f.parent_id === expensesFolder.id
            );
            
            if (yearFolder) {
                // Find monthly notes for this year
                const yearNotes = await getAllNotesInFolder(yearFolder.id, ['id', 'title', 'parent_id']);
                const monthlyNotes = yearNotes.map((n: any) => n.id);
                
                // Find annual summary note
                const expenseNotes = await getAllNotesInFolder(expensesFolder.id, ['id', 'title', 'parent_id']);
                const annualSummaryNote = expenseNotes.find((n: any) => 
                    n.title === `${year} Summary`
                );
                
                // Cache the year structure
                const structure = {
                    expensesFolder: expensesFolder.id,
                    yearFolder: yearFolder.id,
                    monthlyNotes: monthlyNotes,
                    annualSummary: annualSummaryNote?.id || '',
                    newExpensesNote: '' // Will be set separately
                };
                
                this.yearStructureCache.set(year, { structure, timestamp: Date.now() });
                console.info(`Pre-warmed year structure cache for ${year} (read-only)`);
            } else {
                console.warn(`Year folder ${year} not found during cache pre-warming`);
            }
        } catch (error) {
            console.error(`Failed to pre-warm year structure cache for ${year}:`, error);
        }
    }

    /**
     * Pre-warm monthly document caches for the specified year
     */
    private async preWarmMonthlyDocumentCaches(year: string): Promise<void> {
        try {
            // Get year structure from cache (should be populated by preWarmYearStructureCache)
            const cached = this.yearStructureCache.get(year);
            if (!cached) {
                console.warn(`Cannot pre-warm monthly caches - year structure for ${year} not cached`);
                return;
            }
            const yearStructure = cached.structure;
            
            // Pre-warm cache for all monthly documents
            const months = getAllMonths();
            for (const month of months) {
                const monthName = getMonthName(month);
                const cacheKey = `${yearStructure.yearFolder}-${monthName}`;
                
                // Only query if not already cached
                const cached = this.noteFindCache.get(cacheKey);
                if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
                    continue; // Already cached
                }
                
                // Find monthly document  
                const monthlyNoteId = await findNoteInFolderPaginated(yearStructure.yearFolder, monthName);
                if (monthlyNoteId) {
                    this.noteFindCache.set(cacheKey, { noteId: monthlyNoteId, timestamp: Date.now() });
                }
            }
            
            this.enforceCacheSizeLimits();
            console.info(`Monthly document caches pre-warmed for ${year}`);
        } catch (error) {
            console.error(`Failed to pre-warm monthly document caches for ${year}:`, error);
        }
    }

    /**
     * Pre-warm the recurring-expenses document cache (READ-ONLY)
     */
    private async preWarmRecurringExpensesCache(): Promise<void> {
        try {
            const settings = this.settingsService.getSettings();
            const folderName = settings.expensesFolderPath;
            
            // Find expenses folder without creating it
            const folders = await getAllFolders(['id', 'title']);
            const expensesFolder = folders.find((f: any) => f.title === folderName);
            
            if (!expensesFolder) {
                console.warn('Cannot pre-warm recurring-expenses cache - expenses folder not found');
                return;
            }
            
            const noteTitle = 'recurring-expenses';
            const cacheKey = `${expensesFolder.id}-${noteTitle}`;
            
            // Only query if not already cached
            const cached = this.noteFindCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
                return; // Already cached
            }
            
            // Find the document (read-only)
            const notesInFolder = await getAllNotesInFolder(expensesFolder.id, ['id', 'title', 'parent_id']);
            const recurringExpensesNote = notesInFolder.find((n: any) => n.title === noteTitle);
            
            if (recurringExpensesNote) {
                // Cache the document ID
                this.noteFindCache.set(cacheKey, { noteId: recurringExpensesNote.id, timestamp: Date.now() });
                this.enforceCacheSizeLimits();
                console.info('Pre-warmed recurring-expenses document cache (read-only)');
            } else {
                console.info('Recurring-expenses document not found during cache pre-warming (this is normal for older installations)');
            }
        } catch (error) {
            console.error('Failed to pre-warm recurring-expenses cache:', error);
        }
    }

    /**
     * Handle cache invalidation when expenses folder is deleted
     */
    async handleExpensesFolderDeletion(): Promise<void> {
        console.info('Handling expenses folder deletion - invalidating all caches...');
        
        // Clear all folder-related caches
        this.invalidateAllCaches();
        
        // Also notify summary service to clear its caches
        // since it depends on folder structure
        console.info('Expenses folder deleted - all caches cleared');
    }

    /**
     * Check if the expense folder structure is already initialized
     */
    async isStructureInitialized(): Promise<boolean> {
        try {
            const settings = this.settingsService.getSettings();
            const folderName = settings.expensesFolderPath;
            
            // Check if main expenses folder exists
            const folders = await getAllFolders(['id', 'title']);
            const expensesFolder = folders.find((f: any) => f.title === folderName);
            
            if (!expensesFolder) {
                return false;
            }
            
            // Check if current year structure exists
            const currentYear = getCurrentYear();
            const yearFolders = await getAllFolders(['id', 'title', 'parent_id']);
            const yearFolder = yearFolders.find((f: any) => 
                f.title === currentYear && f.parent_id === expensesFolder.id
            );
            
            if (!yearFolder) {
                return false;
            }
            
            // Check if new-expenses document exists
            const notesInFolder = await getAllNotesInFolder(expensesFolder.id, ['id', 'title', 'parent_id']);
            const newExpensesNote = notesInFolder.find((n: any) => n.title === FOLDER_NAMES.NEW_EXPENSES);
            const recurringExpensesNote = notesInFolder.find((n: any) => n.title === 'recurring-expenses');
            
            // Structure is considered initialized if we have:
            // 1. Main expenses folder
            // 2. Current year folder 
            // 3. new-expenses document
            // Note: recurring-expenses is optional for backwards compatibility
            const isInitialized = !!(newExpensesNote);
            
            if (isInitialized) {
                console.info('Found existing folder structure:', {
                    expensesFolder: expensesFolder.title,
                    yearFolder: currentYear,
                    newExpensesNote: !!newExpensesNote,
                    recurringExpensesNote: !!recurringExpensesNote
                });
            }
            
            return isInitialized;
        } catch (error) {
            console.error('Failed to check structure initialization:', error);
            return false;
        }
    }

    /**
     * Ensure the main expenses folder exists (with caching)
     */
    private async ensureExpensesFolderExists(): Promise<string> {
        const settings = this.settingsService.getSettings();
        const folderName = settings.expensesFolderPath;
        
        // Check cache first
        const now = Date.now();
        if (this.expensesFolderIdCache && 
            (now - this.expensesFolderIdCacheTime) < this.CACHE_DURATION) {
            return this.expensesFolderIdCache;
        }
        
        return this.withLock(`expense-folder-${folderName}`, async () => {
            try {
                // Check cache again inside lock (double-checked locking pattern)
                const now = Date.now();
                if (this.expensesFolderIdCache && 
                    (now - this.expensesFolderIdCacheTime) < this.CACHE_DURATION) {
                    return this.expensesFolderIdCache;
                }
                
                // Try to find existing folder
                const folders = await getAllFolders(['id', 'title']);
                const existingFolder = folders.find((f: any) => f.title === folderName);
                
                let folderId: string;
                if (existingFolder) {
                    console.info(`Found existing expenses folder: ${existingFolder.id}`);
                    folderId = existingFolder.id;
                } else {
                    // Create new folder
                    const newFolder = await joplin.data.post(['folders'], null, { title: folderName });
                    console.info(`Created new expenses folder: ${newFolder.id}`);
                    folderId = newFolder.id;
                    
                    // Invalidate expense structure cache when creating new folder
                    this.invalidateExpenseStructureCache();
                }
                
                // Update cache
                this.expensesFolderIdCache = folderId;
                this.expensesFolderIdCacheTime = Date.now();
                
                return folderId;
            } catch (error) {
                console.error('Failed to ensure expenses folder exists:', error);
                throw error;
            }
        });
    }

    /**
     * Ensure year structure exists (year folder + monthly documents) with caching
     */
    async ensureYearStructureExists(year: string): Promise<FolderStructure> {
        // Check cache first
        const now = Date.now();
        const cached = this.yearStructureCache.get(year);
        if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
            return cached.structure;
        }
        const expensesFolderId = await this.ensureExpensesFolderExists();
        
        // Create or find year folder
        const yearFolderId = await this.ensureYearFolderExists(expensesFolderId, year);
        
        // Create monthly documents
        const monthlyNotes = await this.ensureMonthlyDocumentsExist(yearFolderId, year);
        
        // Create annual summary document
        const annualSummary = await this.ensureAnnualSummaryExists(yearFolderId, year);
        
        // Update annual summary links with actual note IDs (for existing documents)
        await this.updateAnnualSummaryLinks(yearFolderId, year);
        
        const structure: FolderStructure = {
            expensesFolder: expensesFolderId,
            yearFolder: yearFolderId,
            monthlyNotes,
            annualSummary,
            newExpensesNote: '' // Will be set by ensureNewExpensesDocumentExists
        };
        
        // Cache the result
        this.yearStructureCache.set(year, { structure, timestamp: Date.now() });
        console.info(`Cached year structure for ${year}`);
        
        return structure;
    }

    /**
     * Ensure year folder exists
     */
    private async ensureYearFolderExists(parentFolderId: string, year: string): Promise<string> {
        try {
            // Get child folders of expenses folder
            const allFolders = await getAllFolders(['id', 'title', 'parent_id']);
            
            // Filter to get only folders from the correct parent
            const foldersInParent = allFolders.filter((f: any) => f.parent_id === parentFolderId);
            const existingYearFolder = foldersInParent.find((f: any) => f.title === year);
            
            if (existingYearFolder) {
                console.info(`Found existing year folder: ${year}`);
                return existingYearFolder.id;
            }
            
            // Create new year folder
            const newYearFolder = await joplin.data.post(['folders'], null, { 
                title: year, 
                parent_id: parentFolderId 
            });
            console.info(`Created new year folder: ${year}`);
            
            // Invalidate caches when creating new folder
            this.invalidateExpenseStructureCache();
            this.invalidateYearStructureCache(year);
            
            return newYearFolder.id;
        } catch (error) {
            console.error(`Failed to ensure year folder exists: ${year}`, error);
            throw error;
        }
    }

    /**
     * Ensure all monthly documents exist for a year
     */
    private async ensureMonthlyDocumentsExist(yearFolderId: string, year: string): Promise<string[]> {
        const months = getAllMonths();
        const monthlyNoteIds: string[] = [];
        
        for (const month of months) {
            try {
                const noteId = await this.ensureMonthlyDocumentExists(yearFolderId, year, month);
                monthlyNoteIds.push(noteId);
            } catch (error) {
                console.error(`Failed to create monthly document for ${year}-${month}:`, error);
            }
        }
        
        return monthlyNoteIds;
    }

    /**
     * Ensure a specific monthly document exists
     */
    async ensureMonthlyDocumentExists(yearFolderId: string, year: string, month: string): Promise<string> {
        const noteTitle = month; // e.g., "01", "02", etc.
        
        try {
            // Check if note already exists
            const notesInFolder = await getAllNotesInFolder(yearFolderId, ['id', 'title', 'parent_id']);
            const existingNote = notesInFolder.find((n: any) => n.title === noteTitle);
            
            if (existingNote) {
                console.info(`Found existing monthly note: ${year}-${month}`);
                return existingNote.id;
            }
            
            // Create new monthly document
            const monthName = getMonthName(month);
            const body = this.generateMonthlyDocumentTemplate(year, month, monthName);
            
            const newNote = await joplin.data.post(['notes'], null, {
                title: noteTitle,
                body: body,
                parent_id: yearFolderId
            });
            
            console.info(`Created new monthly note: ${year}-${month}`);
            
            // Invalidate caches when creating new note
            this.invalidateExpenseStructureCache();
            this.invalidateYearStructureCache(year);
            this.invalidateNoteFindCache(yearFolderId);
            
            return newNote.id;
        } catch (error) {
            console.error(`Failed to ensure monthly document exists: ${year}-${month}`, error);
            throw error;
        }
    }

    /**
     * Generate template for monthly expense document
     */
    private generateMonthlyDocumentTemplate(year: string, month: string, monthName: string): string {
        return `# ${monthName} ${year} Expenses

<!-- expenses-summary-monthly month="${year}-${month}" -->
<!-- /expenses-summary-monthly -->

## Expense Table

| price | description | category | date | shop | attachment | recurring |
|-------|-------------|----------|------|------|------------|-----------|
`;
    }

    /**
     * Ensure annual summary document exists
     */
    private async ensureAnnualSummaryExists(yearFolderId: string, year: string): Promise<string> {
        const noteTitle = year;
        
        try {
            // Check if annual summary already exists
            const notesInFolder = await getAllNotesInFolder(yearFolderId, ['id', 'title', 'parent_id']);
            const existingNote = notesInFolder.find((n: any) => n.title === noteTitle);
            
            if (existingNote) {
                console.info(`Found existing annual summary: ${year}`);
                return existingNote.id;
            }
            
            // Create new annual summary document
            const body = await this.generateAnnualSummaryTemplate(year);
            
            const newNote = await joplin.data.post(['notes'], null, {
                title: noteTitle,
                body: body,
                parent_id: yearFolderId
            });
            
            console.info(`Created new annual summary: ${year}`);
            
            // Invalidate caches when creating new note
            this.invalidateExpenseStructureCache();
            this.invalidateYearStructureCache(year);
            this.invalidateNoteFindCache(yearFolderId);
            
            return newNote.id;
        } catch (error) {
            console.error(`Failed to ensure annual summary exists: ${year}`, error);
            throw error;
        }
    }

    /**
     * Generate template for annual summary document
     */
    private async generateAnnualSummaryTemplate(year: string): Promise<string> {
        const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                           'July', 'August', 'September', 'October', 'November', 'December'];
        
        // Get the year folder to find actual note IDs
        const expensesFolderId = await this.ensureExpensesFolderExists();
        const yearFolderId = await this.ensureYearFolderExists(expensesFolderId, year);
        
        // Get all notes in the year folder to create proper links
        const notesInFolder = await getAllNotesInFolder(yearFolderId, ['id', 'title', 'parent_id']);
        
        const monthlyLinks = months.map((month, index) => {
            // Find the note for this month
            const monthNote = notesInFolder.find((n: any) => n.title === month);
            if (monthNote) {
                return `- [${monthNames[index]} ${year}](:/${monthNote.id})`;
            } else {
                // Fallback to old format if note not found
                return `- [${monthNames[index]} ${year}](:/${month})`;
            }
        }).join('\n');
        
        return `# ${year} Annual Expenses

<!-- expenses-summary-annual year="${year}" -->
<!-- /expenses-summary-annual -->

## Monthly Documents

${monthlyLinks}

<!-- expenses-breakdown year="${year}" -->
<!-- /expenses-breakdown -->
`;
    }

    /**
     * Update an existing annual summary document with proper note ID links
     */
    async updateAnnualSummaryLinks(yearFolderId: string, year: string): Promise<void> {
        try {
            // Find the annual summary document
            const notesInFolder = await getAllNotesInFolder(yearFolderId, ['id', 'title', 'parent_id', 'body']);
            const annualSummaryNote = notesInFolder.find((n: any) => n.title === year);
            
            if (!annualSummaryNote) {
                console.warn(`Annual summary document not found for year: ${year}`);
                return;
            }

            // Generate updated links section
            const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                               'July', 'August', 'September', 'October', 'November', 'December'];
            
            const updatedLinks = months.map((month, index) => {
                const monthNote = notesInFolder.find((n: any) => n.title === month);
                if (monthNote) {
                    return `- [${monthNames[index]} ${year}](:/${monthNote.id})`;
                } else {
                    return `- [${monthNames[index]} ${year}](:/${month})`;
                }
            }).join('\n');

            // Update the body by replacing the Monthly Documents section
            let updatedBody = annualSummaryNote.body;
            const monthlyDocsStart = updatedBody.indexOf('## Monthly Documents');
            const breakdownStart = updatedBody.indexOf('<!-- expenses-breakdown');
            
            if (monthlyDocsStart !== -1 && breakdownStart !== -1) {
                const beforeLinks = updatedBody.substring(0, monthlyDocsStart);
                const afterLinks = updatedBody.substring(breakdownStart);
                
                updatedBody = `${beforeLinks}## Monthly Documents\n\n${updatedLinks}\n\n${afterLinks}`;
                
                // Update the document
                await joplin.data.put(['notes', annualSummaryNote.id], null, { body: updatedBody });
                console.info(`Updated annual summary links for ${year}`);
            }
        } catch (error) {
            console.error(`Failed to update annual summary links for ${year}:`, error);
        }
    }

    /**
     * Ensure new-expenses document exists
     */
    async ensureNewExpensesDocumentExists(): Promise<string> {
        const expensesFolderId = await this.ensureExpensesFolderExists();
        const noteTitle = FOLDER_NAMES.NEW_EXPENSES;
        const cacheKey = `${expensesFolderId}-${noteTitle}`;
        
        return this.withLock(`new-expenses-${expensesFolderId}`, async () => {
            try {
                // Check cache first
                const now = Date.now();
                const cached = this.noteFindCache.get(cacheKey);
                if (cached && (now - cached.timestamp) < this.CACHE_DURATION && cached.noteId) {
                    console.info('Found new-expenses document in cache');
                    return cached.noteId;
                }
                
                // Check if new-expenses document already exists
                const notesInFolder = await getAllNotesInFolder(expensesFolderId, ['id', 'title', 'parent_id']);
                const existingNote = notesInFolder.find((n: any) => n.title === noteTitle);
                
                if (existingNote) {
                    console.info('Found existing new-expenses document');
                    // Update cache
                    this.noteFindCache.set(cacheKey, { noteId: existingNote.id, timestamp: Date.now() });
                    this.enforceCacheSizeLimits();
                    return existingNote.id;
                }
                
                // Create new-expenses document
                const body = this.generateNewExpensesTemplate();
                
                const newNote = await joplin.data.post(['notes'], null, {
                    title: noteTitle,
                    body: body,
                    parent_id: expensesFolderId
                });
            
            console.info('Created new-expenses document');
            
            // Update cache with the new document
            this.noteFindCache.set(cacheKey, { noteId: newNote.id, timestamp: Date.now() });
            
            // Invalidate other caches when creating new note
            this.invalidateExpenseStructureCache();
            
                return newNote.id;
            } catch (error) {
                console.error('Failed to ensure new-expenses document exists:', error);
                throw error;
            }
        });
    }

    /**
     * Generate template for new-expenses document
     */
    private generateNewExpensesTemplate(): string {
        return `# New Expenses

Add your new expenses here. They will be automatically moved to the appropriate monthly documents.

## Quick Add

| price | description | category | date | shop | attachment | recurring |
|-------|-------------|----------|------|------|------------|-----------|

## Instructions

1. Add new expense rows to the table above
2. Use the "Process New Expenses" command to move them to monthly documents
3. Date format: YYYY-MM-DD (or leave empty for today)
4. Categories: Use the configured categories from plugin settings
5. Price: Positive for expenses, negative for income

## Processing Status

<!-- expenses-processing-status -->
<!-- /expenses-processing-status -->
`;
    }

    /**
     * Get folder structure for a specific year
     */
    async getFolderStructure(year: string): Promise<FolderStructure> {
        return await this.ensureYearStructureExists(year);
    }

    /**
     * Find note by title within a folder with caching
     */
    async findNoteInFolder(folderId: string, title: string): Promise<string | null> {
        const cacheKey = `${folderId}:${title}`;
        
        // Check cache first
        const now = Date.now();
        const cached = this.noteFindCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
            return cached.noteId;
        }
        try {
            // Use the paginated version that stops searching once found
            const noteId = await findNoteInFolderPaginated(folderId, title);
            
            // Cache the result
            this.noteFindCache.set(cacheKey, { noteId, timestamp: Date.now() });
            console.info(`Cached note lookup for ${title} in folder ${folderId}: ${noteId || 'not found'}`);
            
            return noteId;
        } catch (error) {
            console.error(`Failed to find note "${title}" in folder:`, error);
            return null;
        }
    }

    /**
     * Get all expense-related folders and notes (with caching)
     */
    async getAllExpenseStructure(): Promise<{ folders: any[], notes: any[] }> {
        // Check cache first
        const now = Date.now();
        if (this.expenseStructureCache && 
            (now - this.expenseStructureCacheTime) < this.CACHE_DURATION) {
            return this.expenseStructureCache;
        }
        
        try {
            console.info('Loading expense structure from API...');
            const expensesFolderId = await this.ensureExpensesFolderExists();
            
            // Get all child folders (years)
            const allFolders = await getAllFolders(['id', 'title', 'parent_id']);
            
            // Filter client-side to ensure we only get folders from the correct parent
            const validYearFolders = allFolders.filter((f: any) => f.parent_id === expensesFolderId);
            
            const allNotes = [];
            
            // Get all notes in expense folders
            const validExpenseNotes = await getAllNotesInFolder(expensesFolderId, ['id', 'title', 'parent_id']);
            allNotes.push(...validExpenseNotes);
            
            // Get all notes in year folders
            for (const yearFolder of validYearFolders) {
                const validYearNotes = await getAllNotesInFolder(yearFolder.id, ['id', 'title', 'parent_id']);
                allNotes.push(...validYearNotes);
            }
            
            const result = {
                folders: validYearFolders,
                notes: allNotes
            };
            
            // Update cache
            this.expenseStructureCache = result;
            this.expenseStructureCacheTime = Date.now();
            console.info(`Cached expense structure: ${result.folders.length} folders, ${result.notes.length} notes`);
            
            return result;
        } catch (error) {
            console.error('Failed to get expense structure:', error);
            throw error;
        }
    }

    /**
     * Ensure recurring-expenses document exists
     */
    async ensureRecurringExpensesDocumentExists(): Promise<string> {
        const expensesFolderId = await this.ensureExpensesFolderExists();
        const noteTitle = 'recurring-expenses';
        
        return this.withLock(`recurring-expenses-${expensesFolderId}`, async () => {
            try {
            // Check if recurring-expenses document already exists
            const notesInFolder = await getAllNotesInFolder(expensesFolderId, ['id', 'title', 'parent_id']);
            const existingNote = notesInFolder.find((n: any) => n.title === noteTitle);
            
            if (existingNote) {
                console.info('Found existing recurring-expenses document');
                return existingNote.id;
            }
            
            // Create recurring-expenses document
            const body = this.generateRecurringExpensesTemplate();
            
            const newNote = await joplin.data.post(['notes'], null, {
                title: noteTitle,
                body: body,
                parent_id: expensesFolderId
            });
            
            console.info('Created recurring-expenses document');
            
            // Invalidate caches when creating new note
            this.invalidateExpenseStructureCache();
            this.invalidateNoteFindCache(expensesFolderId);
            
                return newNote.id;
            } catch (error) {
                console.error('Failed to ensure recurring-expenses document exists:', error);
                throw error;
            }
        });
    }

    /**
     * Generate template for recurring-expenses document
     */
    private generateRecurringExpensesTemplate(): string {
        return `# Recurring Expenses

This document tracks recurring expense templates that automatically generate new expense entries.

## How it works:
- Expenses with recurring patterns (daily, weekly, monthly, yearly) are stored here
- The plugin automatically checks for due recurring expenses and creates new entries
- New entries are added to the "new-expenses" document for processing

## Recurring Expenses

| price | description | category | date | shop | attachment | recurring | lastProcessed | nextDue | enabled | sourceNoteId |
|-------|-------------|----------|------|------|------------|-----------|---------------|---------|---------|--------------|

## Instructions:
1. Use the table editor to manage recurring expenses
2. Set "enabled" to "true" to activate a recurring expense
3. Set "enabled" to "false" to temporarily disable without deleting
4. The system will automatically update "lastProcessed" and "nextDue" fields
`;
    }

    /**
     * Invalidate the expense structure cache
     */
    public invalidateExpenseStructureCache(): void {
        this.expenseStructureCache = null;
        this.expenseStructureCacheTime = 0;
        console.info('Expense structure cache invalidated');
    }

    /**
     * Invalidate year structure cache for a specific year
     */
    public invalidateYearStructureCache(year?: string): void {
        if (year) {
            this.yearStructureCache.delete(year);
            console.info(`Year structure cache invalidated for ${year}`);
        } else {
            this.yearStructureCache.clear();
            console.info('All year structure caches invalidated');
        }
    }

    /**
     * Invalidate note find cache for a specific folder or all
     */
    public invalidateNoteFindCache(folderId?: string): void {
        if (folderId) {
            const keysToDelete = [];
            for (const key of this.noteFindCache.keys()) {
                if (key.startsWith(`${folderId}:`)) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => this.noteFindCache.delete(key));
            console.info(`Note find cache invalidated for folder ${folderId}`);
        } else {
            this.noteFindCache.clear();
            console.info('All note find caches invalidated');
        }
    }

    /**
     * Invalidate all caches
     */
    public invalidateAllCaches(): void {
        this.invalidateExpenseStructureCache();
        this.expensesFolderIdCache = null;
        this.expensesFolderIdCacheTime = 0;
        this.invalidateYearStructureCache();
        this.invalidateNoteFindCache();
        console.info('All folder caches invalidated');
    }

    /**
     * Start periodic cleanup of stale operation locks
     */
    private startLockCleanup(): void {
        this.lockCleanupTimer = setInterval(() => {
            this.cleanupStaleOperationLocks();
            this.enforceCacheSizeLimits();
        }, this.LOCK_CLEANUP_INTERVAL);
    }
    
    /**
     * Stop periodic lock cleanup and clear timer
     */
    public stopLockCleanup(): void {
        if (this.lockCleanupTimer) {
            clearInterval(this.lockCleanupTimer);
            this.lockCleanupTimer = null;
        }
    }

    /**
     * Clean up completed or stale operation locks
     */
    private cleanupStaleOperationLocks(): void {
        if (this.operationLocks.size > this.MAX_OPERATION_LOCKS / 2) {
            // Keep only recent locks, clear older ones
            const recentKeys = Array.from(this.operationLocks.keys()).slice(-this.MAX_OPERATION_LOCKS / 2);
            const keysToDelete = Array.from(this.operationLocks.keys()).filter(key => !recentKeys.includes(key));
            
            keysToDelete.forEach(key => this.operationLocks.delete(key));
            
            if (keysToDelete.length > 0) {
                console.info(`FolderService: Cleaned ${keysToDelete.length} stale operation locks`);
            }
        }
    }

    /**
     * Enforce operation lock limit
     */
    private enforceOperationLockLimit(): void {
        if (this.operationLocks.size > this.MAX_OPERATION_LOCKS) {
            const excess = this.operationLocks.size - this.MAX_OPERATION_LOCKS;
            const keysToDelete = Array.from(this.operationLocks.keys()).slice(0, excess);
            keysToDelete.forEach(key => this.operationLocks.delete(key));
            console.info(`FolderService: Evicted ${excess} excess operation locks`);
        }
    }

    /**
     * Enforce cache size limits
     */
    private enforceCacheSizeLimits(): void {
        // Enforce year structure cache limit
        if (this.yearStructureCache.size > this.MAX_YEAR_CACHE_ENTRIES) {
            const excess = this.yearStructureCache.size - this.MAX_YEAR_CACHE_ENTRIES;
            const keysToDelete = Array.from(this.yearStructureCache.keys()).slice(0, excess);
            keysToDelete.forEach(key => this.yearStructureCache.delete(key));
            console.info(`FolderService: Evicted ${excess} year structure cache entries`);
        }

        // Enforce note find cache limit
        if (this.noteFindCache.size > this.MAX_NOTE_FIND_CACHE_ENTRIES) {
            const excess = this.noteFindCache.size - this.MAX_NOTE_FIND_CACHE_ENTRIES;
            const keysToDelete = Array.from(this.noteFindCache.keys()).slice(0, excess);
            keysToDelete.forEach(key => this.noteFindCache.delete(key));
            console.info(`FolderService: Evicted ${excess} note find cache entries`);
        }
    }

    /**
     * Get memory usage statistics
     */
    public getMemoryStats(): { 
        operationLocks: number; 
        yearStructureCache: number; 
        noteFindCache: number; 
        totalEntries: number 
    } {
        const stats = {
            operationLocks: this.operationLocks.size,
            yearStructureCache: this.yearStructureCache.size,
            noteFindCache: this.noteFindCache.size,
            totalEntries: this.operationLocks.size + this.yearStructureCache.size + this.noteFindCache.size
        };
        console.info('FolderService memory stats:', stats);
        return stats;
    }

    /**
     * Force memory cleanup
     */
    public forceMemoryCleanup(): void {
        this.cleanupStaleOperationLocks();
        this.enforceCacheSizeLimits();
        console.info('FolderService: Forced memory cleanup completed');
    }

    /**
     * Cleanup resources on service shutdown
     */
    public destroy(): void {
        if (this.lockCleanupTimer) {
            clearInterval(this.lockCleanupTimer);
            this.lockCleanupTimer = null;
        }
        this.invalidateAllCaches();
        console.info('FolderService: Destroyed and cleaned up resources');
    }

    /**
     * Force refresh of expense structure cache
     */
    public async refreshExpenseStructureCache(): Promise<{ folders: any[], notes: any[] }> {
        this.invalidateExpenseStructureCache();
        return await this.getAllExpenseStructure();
    }
}
