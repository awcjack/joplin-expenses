import joplin from 'api';
import { FolderStructure, FOLDER_NAMES } from '../types';
import { getCurrentYear, getAllMonths, getMonthName } from '../utils/dateUtils';
import { SettingsService } from './SettingsService';

export class FolderService {
    private static instance: FolderService;
    private settingsService: SettingsService;

    private constructor() {
        this.settingsService = SettingsService.getInstance();
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
            // Ensure the main expenses folder exists
            await this.ensureExpensesFolderExists();
            
            // Create current year structure
            const currentYear = getCurrentYear();
            await this.ensureYearStructureExists(currentYear);
            
            // Create new-expenses document
            await this.ensureNewExpensesDocumentExists();
            
            console.info('Folder structure initialized successfully');
        } catch (error) {
            console.error('Failed to initialize folder structure:', error);
            throw error;
        }
    }

    /**
     * Ensure the main expenses folder exists
     */
    private async ensureExpensesFolderExists(): Promise<string> {
        const settings = this.settingsService.getSettings();
        const folderName = settings.expensesFolderPath;
        
        try {
            // Try to find existing folder
            const folders = await joplin.data.get(['folders'], { fields: ['id', 'title'] });
            const existingFolder = folders.items.find(f => f.title === folderName);
            
            if (existingFolder) {
                console.info(`Found existing expenses folder: ${existingFolder.id}`);
                return existingFolder.id;
            }
            
            // Create new folder
            const newFolder = await joplin.data.post(['folders'], null, { title: folderName });
            console.info(`Created new expenses folder: ${newFolder.id}`);
            return newFolder.id;
        } catch (error) {
            console.error('Failed to ensure expenses folder exists:', error);
            throw error;
        }
    }

    /**
     * Ensure year structure exists (year folder + monthly documents)
     */
    async ensureYearStructureExists(year: string): Promise<FolderStructure> {
        const expensesFolderId = await this.ensureExpensesFolderExists();
        
        // Create or find year folder
        const yearFolderId = await this.ensureYearFolderExists(expensesFolderId, year);
        
        // Create monthly documents
        const monthlyNotes = await this.ensureMonthlyDocumentsExist(yearFolderId, year);
        
        // Create annual summary document
        const annualSummary = await this.ensureAnnualSummaryExists(yearFolderId, year);
        
        return {
            expensesFolder: expensesFolderId,
            yearFolder: yearFolderId,
            monthlyNotes,
            annualSummary,
            newExpensesNote: '' // Will be set by ensureNewExpensesDocumentExists
        };
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
            
            const existingYearFolder = childFolders.items.find(f => f.title === year);
            
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
            const notes = await joplin.data.get(['notes'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: yearFolderId
            });
            
            const existingNote = notes.items.find(n => n.title === noteTitle);
            
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

## Expense Table

| price | description | category | date | shop | attachment | recurring |
|-------|-------------|----------|------|------|------------|-----------|

## Monthly Summary

<!-- expenses-summary-monthly month="${year}-${month}" -->
<!-- /expenses-summary-monthly -->

## Category Breakdown

<!-- expenses-breakdown month="${year}-${month}" -->
<!-- /expenses-breakdown -->
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
            
            const existingNote = notes.items.find(n => n.title === noteTitle);
            
            if (existingNote) {
                console.info(`Found existing annual summary: ${year}`);
                return existingNote.id;
            }
            
            // Create new annual summary document
            const body = this.generateAnnualSummaryTemplate(year);
            
            const newNote = await joplin.data.post(['notes'], null, {
                title: noteTitle,
                body: body,
                parent_id: yearFolderId
            });
            
            console.info(`Created new annual summary: ${year}`);
            return newNote.id;
        } catch (error) {
            console.error(`Failed to ensure annual summary exists: ${year}`, error);
            throw error;
        }
    }

    /**
     * Generate template for annual summary document
     */
    private generateAnnualSummaryTemplate(year: string): string {
        return `# ${year} Annual Expense Summary

## Annual Overview

<!-- expenses-summary-annual year="${year}" -->
<!-- /expenses-summary-annual -->

## Monthly Breakdown

<!-- expenses-breakdown year="${year}" type="monthly" -->
<!-- /expenses-breakdown -->

## Category Analysis

<!-- expenses-breakdown year="${year}" type="category" -->
<!-- /expenses-breakdown -->
`;
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
            
            const existingNote = notes.items.find(n => n.title === noteTitle);
            
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
     * Find note by title within a folder
     */
    async findNoteInFolder(folderId: string, title: string): Promise<string | null> {
        try {
            const notes = await joplin.data.get(['notes'], { 
                fields: ['id', 'title'],
                parent_id: folderId
            });
            
            const note = notes.items.find(n => n.title === title);
            return note ? note.id : null;
        } catch (error) {
            console.error(`Failed to find note "${title}" in folder:`, error);
            return null;
        }
    }

    /**
     * Get all expense-related folders and notes
     */
    async getAllExpenseStructure(): Promise<{ folders: any[], notes: any[] }> {
        try {
            const expensesFolderId = await this.ensureExpensesFolderExists();
            
            // Get all child folders (years)
            const yearFolders = await joplin.data.get(['folders'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: expensesFolderId 
            });
            
            const allNotes = [];
            
            // Get all notes in expense folders
            const expenseNotes = await joplin.data.get(['notes'], { 
                fields: ['id', 'title', 'parent_id'],
                parent_id: expensesFolderId
            });
            allNotes.push(...expenseNotes.items);
            
            // Get all notes in year folders
            for (const yearFolder of yearFolders.items) {
                const yearNotes = await joplin.data.get(['notes'], { 
                    fields: ['id', 'title', 'parent_id'],
                    parent_id: yearFolder.id
                });
                allNotes.push(...yearNotes.items);
            }
            
            return {
                folders: yearFolders.items,
                notes: allNotes
            };
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
            
            const existingNote = notes.items.find(n => n.title === noteTitle);
            
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
}
