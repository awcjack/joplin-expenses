import joplin from 'api';
import { FolderStructure, FOLDER_NAMES } from '../types';
import { getCurrentYear, getAllMonths, getMonthName } from '../utils/dateUtils';
import { SettingsService } from './SettingsService';

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
            
            console.info('Folder structure initialized successfully');
        } catch (error) {
            console.error('Failed to initialize folder structure:', error);
            throw error;
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
                const folders = await joplin.data.get(['folders'], { fields: ['id', 'title'] });
                const existingFolder = folders.items.find((f: any) => f.title === folderName);
                
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
            const childFolders = await joplin.data.get(['folders'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: parentFolderId 
            });
            
            // Filter client-side to ensure we only get folders from the correct parent
            const foldersInParent = childFolders.items.filter((f: any) => f.parent_id === parentFolderId);
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
            // Note: Joplin API parent_id filter may not work correctly, so we filter client-side
            const notes = await joplin.data.get(['notes'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: yearFolderId
            });
            
            // Filter client-side to ensure we only get notes from the correct parent folder
            const notesInFolder = notes.items.filter((n: any) => n.parent_id === yearFolderId);
            
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
            const notes = await joplin.data.get(['notes'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: yearFolderId
            });
            
            // Filter client-side to ensure we only get notes from the correct parent folder
            const notesInFolder = notes.items.filter((n: any) => n.parent_id === yearFolderId);
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
        const notes = await joplin.data.get(['notes'], {
            fields: ['id', 'title', 'parent_id'],
            parent_id: yearFolderId
        });
        
        // Filter to only notes from the correct parent folder
        const notesInFolder = notes.items.filter((n: any) => n.parent_id === yearFolderId);
        
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
            const notes = await joplin.data.get(['notes'], {
                fields: ['id', 'title', 'parent_id', 'body'],
                parent_id: yearFolderId
            });
            
            const notesInFolder = notes.items.filter((n: any) => n.parent_id === yearFolderId);
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
        
        try {
            // Check if new-expenses document already exists
            const notes = await joplin.data.get(['notes'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: expensesFolderId
            });
            
            // Filter client-side to ensure we only get notes from the correct parent folder
            const notesInFolder = notes.items.filter((n: any) => n.parent_id === expensesFolderId);
            const existingNote = notesInFolder.find((n: any) => n.title === noteTitle);
            
            if (existingNote) {
                console.info('Found existing new-expenses document');
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
            
            // Invalidate caches when creating new note
            this.invalidateExpenseStructureCache();
            this.invalidateNoteFindCache(expensesFolderId);
            
            return newNote.id;
        } catch (error) {
            console.error('Failed to ensure new-expenses document exists:', error);
            throw error;
        }
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
            const notes = await joplin.data.get(['notes'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: folderId
            });
            
            // Filter client-side to ensure we only get notes from the correct parent folder
            const notesInFolder = notes.items.filter((n: any) => n.parent_id === folderId);
            const note = notesInFolder.find((n: any) => n.title === title);
            const noteId = note ? note.id : null;
            
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
            const yearFolders = await joplin.data.get(['folders'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: expensesFolderId 
            });
            
            // Filter client-side to ensure we only get folders from the correct parent
            const validYearFolders = yearFolders.items.filter((f: any) => f.parent_id === expensesFolderId);
            
            const allNotes = [];
            
            // Get all notes in expense folders
            const expenseNotes = await joplin.data.get(['notes'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: expensesFolderId
            });
            // Filter client-side to ensure we only get notes from the correct parent folder
            const validExpenseNotes = expenseNotes.items.filter((n: any) => n.parent_id === expensesFolderId);
            allNotes.push(...validExpenseNotes);
            
            // Get all notes in year folders
            for (const yearFolder of validYearFolders) {
                const yearNotes = await joplin.data.get(['notes'], { 
                    fields: ['id', 'title', 'parent_id'],
                    parent_id: yearFolder.id
                });
                // Filter client-side to ensure we only get notes from the correct parent folder
                const validYearNotes = yearNotes.items.filter((n: any) => n.parent_id === yearFolder.id);
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
        
        try {
            // Check if recurring-expenses document already exists
            const notes = await joplin.data.get(['notes'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: expensesFolderId
            });
            
            // Filter client-side to ensure we only get notes from the correct parent folder
            const notesInFolder = notes.items.filter((n: any) => n.parent_id === expensesFolderId);
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
