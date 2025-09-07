import joplin from 'api';
import { ExpenseEntry, ExpenseSummary, SummaryMarker, SummaryMarkerType, COMMENT_MARKERS } from '../types';
import { ExpenseService } from './ExpenseService';
import { SettingsService } from './SettingsService';
import { FolderService } from './FolderService';
import { filterEntriesByYearMonth, filterEntriesByCategory } from '../expenseParser';
import { formatMonthYear, getAllMonths } from '../utils/dateUtils';
import { escapeHtml, sanitizeCategory } from '../utils/sanitization';

export class SummaryService {
    private static instance: SummaryService;
    private expenseService: ExpenseService | null;
    private settingsService: SettingsService;
    private folderService: FolderService;
    
    // Cache for expensive expense data operations with size limits
    private yearlyExpensesCache: Map<string, { data: ExpenseEntry[], timestamp: number }> = new Map();
    private monthlyExpensesCache: Map<string, { data: ExpenseEntry[], timestamp: number }> = new Map();
    private summaryCache: Map<string, { data: ExpenseSummary, timestamp: number }> = new Map();
    private readonly CACHE_DURATION = 300000; // 5 minutes - same as FolderService
    
    // Memory management: Cache size limits to prevent unbounded growth
    private readonly MAX_CACHE_ENTRIES = 100; // Limit each cache to 100 entries
    private readonly MEMORY_CLEANUP_INTERVAL = 600000; // 10 minutes cleanup interval
    private memoryCleanupTimer: NodeJS.Timeout | null = null;

    /**
     * Sanitize text for Mermaid chart usage to prevent injection attacks
     */
    private sanitizeForMermaid(text: string): string {
        if (typeof text !== 'string') {
            return '';
        }
        
        // Remove potentially dangerous characters and limit length
        return text
            .replace(/[<>"'&\[\]{}()\\|`~!@#$%^&*+=]/g, '') // Remove dangerous characters
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim()
            .substring(0, 20); // Limit length for chart readability
    }

    private constructor() {
        // Initialize expenseService as null to avoid circular dependency
        this.expenseService = null;
        this.settingsService = SettingsService.getInstance();
        this.folderService = FolderService.getInstance();
        
        // Initialize memory management timer
        this.startMemoryCleanup();
    }

    private getExpenseService(): ExpenseService {
        if (!this.expenseService) {
            this.expenseService = ExpenseService.getInstance();
        }
        return this.expenseService;
    }

    public static getInstance(): SummaryService {
        if (!SummaryService.instance) {
            SummaryService.instance = new SummaryService();
        }
        return SummaryService.instance;
    }

    /**
     * Check if cached data is still valid
     */
    private isCacheValid(timestamp: number): boolean {
        return Date.now() - timestamp < this.CACHE_DURATION;
    }
    
    /**
     * Start periodic memory cleanup to prevent cache growth
     */
    private startMemoryCleanup(): void {
        this.memoryCleanupTimer = setInterval(() => {
            this.cleanupExpiredCacheEntries();
            this.enforceCacheSizeLimits();
        }, this.MEMORY_CLEANUP_INTERVAL);
    }
    
    /**
     * Stop periodic memory cleanup and clear timer
     */
    public stopMemoryCleanup(): void {
        if (this.memoryCleanupTimer) {
            clearInterval(this.memoryCleanupTimer);
            this.memoryCleanupTimer = null;
        }
    }
    
    /**
     * Clean up expired cache entries to free memory
     */
    private cleanupExpiredCacheEntries(): void {
        const now = Date.now();
        let totalCleaned = 0;
        
        // Clean yearly expenses cache
        for (const [key, entry] of this.yearlyExpensesCache.entries()) {
            if (now - entry.timestamp > this.CACHE_DURATION) {
                this.yearlyExpensesCache.delete(key);
                totalCleaned++;
            }
        }
        
        // Clean monthly expenses cache
        for (const [key, entry] of this.monthlyExpensesCache.entries()) {
            if (now - entry.timestamp > this.CACHE_DURATION) {
                this.monthlyExpensesCache.delete(key);
                totalCleaned++;
            }
        }
        
        // Clean summary cache
        for (const [key, entry] of this.summaryCache.entries()) {
            if (now - entry.timestamp > this.CACHE_DURATION) {
                this.summaryCache.delete(key);
                totalCleaned++;
            }
        }
        
        if (totalCleaned > 0) {
            console.info(`SummaryService: Cleaned ${totalCleaned} expired cache entries`);
        }
    }
    
    /**
     * Enforce cache size limits using LRU eviction
     */
    private enforceCacheSizeLimits(): void {
        this.enforceCacheLimit(this.yearlyExpensesCache, 'yearly');
        this.enforceCacheLimit(this.monthlyExpensesCache, 'monthly');
        this.enforceCacheLimit(this.summaryCache, 'summary');
    }
    
    /**
     * Enforce size limit on a specific cache using LRU eviction
     */
    private enforceCacheLimit<T>(cache: Map<string, T>, cacheName: string): void {
        if (cache.size > this.MAX_CACHE_ENTRIES) {
            const entriesToRemove = cache.size - this.MAX_CACHE_ENTRIES;
            const keysToDelete = Array.from(cache.keys()).slice(0, entriesToRemove);
            
            keysToDelete.forEach(key => cache.delete(key));
            console.info(`SummaryService: Evicted ${entriesToRemove} entries from ${cacheName} cache (LRU)`);
        }
    }

    /**
     * Get cached yearly expenses or fetch if not cached/expired
     */
    private async getCachedYearlyExpenses(year: string): Promise<ExpenseEntry[]> {
        const cacheKey = year;
        const cached = this.yearlyExpensesCache.get(cacheKey);
        
        if (cached && this.isCacheValid(cached.timestamp)) {
            return cached.data;
        }
        
        console.info(`Loading yearly expenses for ${year} from ExpenseService...`);
        const data = await this.getExpenseService().getYearlyExpenses(year);
        this.yearlyExpensesCache.set(cacheKey, { data, timestamp: Date.now() });
        console.info(`Cached yearly expenses for ${year}: ${data.length} entries`);
        
        return data;
    }

    /**
     * Get cached monthly expenses or fetch if not cached/expired
     */
    private async getCachedMonthlyExpenses(year: string, month: string): Promise<ExpenseEntry[]> {
        const cacheKey = `${year}-${month}`;
        const cached = this.monthlyExpensesCache.get(cacheKey);
        
        if (cached && this.isCacheValid(cached.timestamp)) {
            return cached.data;
        }
        
        console.info(`Loading monthly expenses for ${year}-${month} from ExpenseService...`);
        const data = await this.getExpenseService().getMonthlyExpenses(year, month);
        this.monthlyExpensesCache.set(cacheKey, { data, timestamp: Date.now() });
        console.info(`Cached monthly expenses for ${year}-${month}: ${data.length} entries`);
        
        return data;
    }

    /**
     * Get cached summary or generate if not cached/expired
     */
    private getCachedSummary(entries: ExpenseEntry[], cacheKey: string): ExpenseSummary {
        const cached = this.summaryCache.get(cacheKey);
        
        if (cached && this.isCacheValid(cached.timestamp)) {
            return cached.data;
        }
        
        console.info(`Generating summary for ${cacheKey}...`);
        const data = this.generateSummary(entries);
        this.summaryCache.set(cacheKey, { data, timestamp: Date.now() });
        console.info(`Cached summary for ${cacheKey}: ${data.entryCount} entries processed`);
        
        return data;
    }

    /**
     * Invalidate all caches
     */
    public invalidateAllCaches(): void {
        this.yearlyExpensesCache.clear();
        this.monthlyExpensesCache.clear();
        this.summaryCache.clear();
        console.info('SummaryService: All caches invalidated');
    }
    
    /**
     * Get memory usage statistics for monitoring
     */
    public getMemoryStats(): { yearlyCache: number; monthlyCache: number; summaryCache: number; totalEntries: number } {
        const stats = {
            yearlyCache: this.yearlyExpensesCache.size,
            monthlyCache: this.monthlyExpensesCache.size,
            summaryCache: this.summaryCache.size,
            totalEntries: this.yearlyExpensesCache.size + this.monthlyExpensesCache.size + this.summaryCache.size
        };
        console.info('SummaryService memory stats:', stats);
        return stats;
    }
    
    /**
     * Force memory cleanup - useful for testing or manual cleanup
     */
    public forceMemoryCleanup(): void {
        this.cleanupExpiredCacheEntries();
        this.enforceCacheSizeLimits();
        console.info('SummaryService: Forced memory cleanup completed');
    }
    
    /**
     * Cleanup resources on service shutdown
     */
    public destroy(): void {
        if (this.memoryCleanupTimer) {
            clearInterval(this.memoryCleanupTimer);
            this.memoryCleanupTimer = null;
        }
        this.invalidateAllCaches();
        console.info('SummaryService: Destroyed and cleaned up resources');
    }

    /**
     * Invalidate caches for a specific year
     */
    public invalidateYearCaches(year: string): void {
        // Remove yearly cache
        this.yearlyExpensesCache.delete(year);
        
        // Remove monthly caches for this year
        const monthsToDelete = [];
        for (const key of this.monthlyExpensesCache.keys()) {
            if (key.startsWith(`${year}-`)) {
                monthsToDelete.push(key);
            }
        }
        monthsToDelete.forEach(key => this.monthlyExpensesCache.delete(key));
        
        // Remove summary caches related to this year
        const summariesToDelete = [];
        for (const key of this.summaryCache.keys()) {
            if (key.includes(year)) {
                summariesToDelete.push(key);
            }
        }
        summariesToDelete.forEach(key => this.summaryCache.delete(key));
        
        console.info(`SummaryService: Invalidated caches for year ${year}`);
    }

    /**
     * Invalidate caches for a specific month
     */
    public invalidateMonthCaches(year: string, month: string): void {
        const monthKey = `${year}-${month}`;
        
        // Remove monthly cache
        this.monthlyExpensesCache.delete(monthKey);
        
        // Remove related yearly cache (since it includes this month)
        this.yearlyExpensesCache.delete(year);
        
        // Remove summary caches related to this month/year
        const summariesToDelete = [];
        for (const key of this.summaryCache.keys()) {
            if (key.includes(monthKey) || key.includes(year)) {
                summariesToDelete.push(key);
            }
        }
        summariesToDelete.forEach(key => this.summaryCache.delete(key));
        
        console.info(`SummaryService: Invalidated caches for ${monthKey}`);
    }

    /**
     * Called when expenses are added, updated, or deleted
     * This should be called by other services when they modify expense data
     */
    public onExpenseDataChanged(year?: string, month?: string): void {
        if (year && month) {
            // Specific month changed - invalidate month and year caches
            this.invalidateMonthCaches(year, month);
        } else if (year) {
            // Specific year changed - invalidate year caches
            this.invalidateYearCaches(year);
        } else {
            // Unknown scope - invalidate all caches to be safe
            this.invalidateAllCaches();
        }
        
        // Also invalidate folder service caches as structure might have changed
        this.folderService.invalidateExpenseStructureCache();
        if (year) {
            this.folderService.invalidateYearStructureCache(year);
        } else {
            this.folderService.invalidateYearStructureCache(); // Invalidate all year caches
        }
    }

    /**
     * Generate summary for a list of expense entries
     */
    generateSummary(entries: ExpenseEntry[]): ExpenseSummary {
        let totalExpense = 0;
        let totalIncome = 0;
        const byCategory: Record<string, number> = {};
        const byMonth: Record<string, number> = {};

        for (const entry of entries) {
            const price = Number(entry.price) || 0;
            
            if (price < 0) {
                totalIncome += Math.abs(price);
            } else {
                totalExpense += price;
            }

            // Group by category
            if (entry.category) {
                byCategory[entry.category] = (byCategory[entry.category] || 0) + price;
            }

            // Group by month (YYYY-MM from date)
            const month = (entry.date || '').slice(0, 7);
            if (month) {
                byMonth[month] = (byMonth[month] || 0) + price;
            }
        }

        const netAmount = totalIncome - totalExpense;

        return {
            totalExpense,
            totalIncome,
            netAmount,
            byCategory,
            byMonth,
            entryCount: entries.length
        };
    }

    /**
     * Process all summary markers in a document
     */
    async processDocumentSummaries(noteId: string): Promise<void> {
        try {
            const note = await joplin.data.get(['notes', noteId], { fields: ['body', 'title', 'parent_id'] });
            const markers = this.findSummaryMarkers(note.body);

            if (markers.length === 0) {
                return; // No summary markers found
            }

            // Check if this is a monthly document and invalidate caches before processing
            await this.invalidateCachesForNote(note);

            let updatedContent = note.body;

            // Process markers in reverse order to maintain correct indices
            for (let i = markers.length - 1; i >= 0; i--) {
                const marker = markers[i];
                if (marker.startIndex === -1 || marker.endIndex === -1) {
                    continue; // Invalid marker
                }
                const summaryContent = await this.generateMarkerSummary(marker);
                updatedContent = this.replaceSummaryContent(updatedContent, marker, summaryContent);
            }

            // Update the note if content changed
            if (updatedContent !== note.body) {
                await joplin.data.put(['notes', noteId], null, { body: updatedContent });
                console.info(`Updated ${markers.length} summary markers in note ${noteId}`);
            }
        } catch (error) {
            console.error(`Failed to process document summaries for note ${noteId}:`, error);
        }
    }

    /**
     * Invalidate caches based on the type of note being processed
     */
    private async invalidateCachesForNote(note: any): Promise<void> {
        try {
            // Check if this is a monthly document (format: "YYYY-MM")
            const monthlyMatch = note.title.match(/^(\d{4})-(\d{2})$/);
            if (monthlyMatch) {
                const year = monthlyMatch[1];
                const month = monthlyMatch[2];
                console.info(`Invalidating caches for monthly document: ${year}-${month}`);
                this.invalidateMonthCaches(year, month);
                return;
            }

            // Check if this is an annual summary document (format: "YYYY" or "Annual Summary YYYY")
            const annualMatch = note.title.match(/(?:Annual Summary )?(\d{4})$/);
            if (annualMatch) {
                const year = annualMatch[1];
                console.info(`Invalidating caches for annual document: ${year}`);
                this.invalidateYearCaches(year);
                return;
            }

            // Check if this is the main "new-expenses" document
            if (note.title === 'new-expenses') {
                console.info('Invalidating all caches for new-expenses document');
                this.invalidateAllCaches();
                return;
            }

            // Check if this is the "recurring-expenses" document
            if (note.title === 'recurring-expenses') {
                console.info('Invalidating all caches for recurring-expenses document');
                this.invalidateAllCaches();
                return;
            }

            // For any other expense-related document, do a targeted invalidation
            // by checking if the note is in the expense structure
            const folderService = FolderService.getInstance();
            const structure = await folderService.getAllExpenseStructure();
            
            const isExpenseNote = structure.notes.some(n => n.id === note.id);
            if (isExpenseNote) {
                console.info(`Invalidating all caches for unknown expense document: ${note.title}`);
                this.invalidateAllCaches();
            }
        } catch (error) {
            console.error('Error in invalidateCachesForNote:', error);
            // Safe fallback - invalidate all caches if we can't determine the note type
            this.invalidateAllCaches();
        }
    }

    /**
     * Find all summary markers in content
     */
    private findSummaryMarkers(content: string): SummaryMarker[] {
        const markers: SummaryMarker[] = [];
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Check for monthly summary markers
            if (line.startsWith(COMMENT_MARKERS.MONTHLY_START)) {
                const endIndex = this.findEndMarker(lines, i, COMMENT_MARKERS.MONTHLY_END);
                if (endIndex !== -1) {
                    const params = this.parseMarkerParams(line);
                    markers.push({
                        type: SummaryMarkerType.MONTHLY,
                        month: params.month,
                        category: params.category,
                        startIndex: i,
                        endIndex: endIndex,
                        content: lines.slice(i + 1, endIndex).join('\n')
                    });
                }
            }

            // Check for annual summary markers
            else if (line.startsWith(COMMENT_MARKERS.ANNUAL_START)) {
                const endIndex = this.findEndMarker(lines, i, COMMENT_MARKERS.ANNUAL_END);
                if (endIndex !== -1) {
                    const params = this.parseMarkerParams(line);
                    markers.push({
                        type: SummaryMarkerType.ANNUAL,
                        year: params.year,
                        startIndex: i,
                        endIndex: endIndex,
                        content: lines.slice(i + 1, endIndex).join('\n')
                    });
                }
            }

            // Check for breakdown markers
            else if (line.startsWith(COMMENT_MARKERS.BREAKDOWN_START)) {
                const endIndex = this.findEndMarker(lines, i, COMMENT_MARKERS.BREAKDOWN_END);
                if (endIndex !== -1) {
                    const params = this.parseMarkerParams(line);
                    markers.push({
                        type: SummaryMarkerType.BREAKDOWN,
                        category: params.category,
                        month: params.month,
                        year: params.year,
                        startIndex: i,
                        endIndex: endIndex,
                        content: lines.slice(i + 1, endIndex).join('\n')
                    });
                }
            }
        }

        return markers;
    }

    /**
     * Find the end marker index
     */
    private findEndMarker(lines: string[], startIndex: number, endMarker: string): number {
        for (let i = startIndex + 1; i < lines.length; i++) {
            if (lines[i].trim() === endMarker) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Parse parameters from marker comment
     */
    private parseMarkerParams(markerLine: string): Record<string, string> {
        const params: Record<string, string> = {};
        
        // Extract parameters using regex
        const paramRegex = /(\w+)="([^"]+)"/g;
        let match: RegExpExecArray | null;
        
        while ((match = paramRegex.exec(markerLine)) !== null) {
            params[match[1]] = match[2];
        }
        
        return params;
    }

    /**
     * Generate summary content for a specific marker
     */
    private async generateMarkerSummary(marker: SummaryMarker): Promise<string> {
        try {
            switch (marker.type) {
                case SummaryMarkerType.MONTHLY:
                    return await this.generateMonthlySummary(marker.month, marker.category);
                case SummaryMarkerType.ANNUAL:
                    return await this.generateAnnualSummary(marker.year);
                case SummaryMarkerType.BREAKDOWN:
                    return await this.generateBreakdownSummary(marker);
                default:
                    return 'Unknown marker type';
            }
        } catch (error) {
            console.error(`Failed to generate summary for marker:`, error);
            return `Error generating summary: ${error.message}`;
        }
    }

    /**
     * Generate monthly summary content
     */
    private async generateMonthlySummary(month?: string, category?: string): Promise<string> {
        if (!month) {
            return 'Month parameter is required for monthly summary';
        }

        const [year, monthNum] = month.split('-');
        const expenses = await this.getCachedMonthlyExpenses(year, monthNum);
        
        let filteredExpenses = expenses;
        if (category) {
            filteredExpenses = filterEntriesByCategory(expenses, category);
        }

        const summaryKey = `monthly-${month}${category ? `-${category}` : ''}`;
        const summary = this.getCachedSummary(filteredExpenses, summaryKey);
        const settings = this.settingsService.getSettings();
        const currency = settings.defaultCurrency;

        let content = `<div style="color: #ff7979">\n\n`;
        content += `**${formatMonthYear(month)} Summary**\n\n`;
        
        if (category) {
            content += `**Category:** ${category}\n\n`;
        }

        content += `- **Total Expenses:** ${currency}${summary.totalExpense.toFixed(2)}\n`;
        content += `- **Total Income:** ${currency}${summary.totalIncome.toFixed(2)}\n`;
        content += `- **Net Amount:** ${currency}${summary.netAmount.toFixed(2)}\n`;
        content += `- **Entry Count:** ${summary.entryCount}\n\n`;

        if (!category && Object.keys(summary.byCategory).length > 0) {
            content += `**By Category:**\n\n`;
            for (const [cat, amount] of Object.entries(summary.byCategory)) {
                content += `- ${cat}: ${currency}${amount.toFixed(2)}\n`;
            }
            content += `\n`;

            // Add mermaid bar chart
            content += `**Expense Distribution:**\n\n`;
            content += this.generateMermaidBarChart(summary.byCategory, currency);
        }

        content += `\n</div>`;
        return content;
    }

    /**
     * Generate annual summary content
     */
    private async generateAnnualSummary(year?: string): Promise<string> {
        if (!year) {
            return 'Year parameter is required for annual summary';
        }

        const expenses = await this.getCachedYearlyExpenses(year);
        const summaryKey = `annual-${year}`;
        const summary = this.getCachedSummary(expenses, summaryKey);
        const settings = this.settingsService.getSettings();
        const currency = settings.defaultCurrency;

        let content = `<div style="color: #ff7979">\n\n`;
        content += `**${year} Annual Summary**\n\n`;
        
        content += `- **Total Expenses:** ${currency}${summary.totalExpense.toFixed(2)}\n`;
        content += `- **Total Income:** ${currency}${summary.totalIncome.toFixed(2)}\n`;
        content += `- **Net Amount:** ${currency}${summary.netAmount.toFixed(2)}\n`;
        content += `- **Entry Count:** ${summary.entryCount}\n\n`;

        // Simplified Monthly Overview (only show months with activity)
        content += `**Monthly Overview (Active Months Only):**\n\n`;
        const months = getAllMonths();
        const monthlyData: Record<string, number> = {};
        let activeMonthCount = 0;
        
        for (const month of months) {
            const monthlyExpenses = filterEntriesByYearMonth(expenses, `${year}-${month}`);
            const monthlySummaryKey = `monthly-${year}-${month}-breakdown`;
            const monthlySummary = this.getCachedSummary(monthlyExpenses, monthlySummaryKey);
            const monthName = formatMonthYear(`${year}-${month}`);
            const netAmount = monthlySummary.totalIncome - monthlySummary.totalExpense;
            
            // Only show months with activity to reduce clutter
            if (monthlyExpenses.length > 0) {
                content += `- **${monthName}:** ${currency}${netAmount.toFixed(2)} (${monthlySummary.entryCount} entries)\n`;
                activeMonthCount++;
            }
            
            // Store monthly expense data for chart - include all months (0 for empty months)
            monthlyData[month] = monthlySummary.totalExpense;
        }
        
        if (activeMonthCount === 0) {
            content += `*No expense activity recorded for ${year}*\n`;
        } else {
            content += `\n*${activeMonthCount} out of 12 months had expense activity*\n`;
        }
        
        // Add simplified monthly expense chart (only show active months)
        if (activeMonthCount > 0) {
            content += `\n**Monthly Expense Trends:**\n\n`;
            // Filter monthlyData to only include months with activity for cleaner chart
            const activeMonthlyData: Record<string, number> = {};
            for (const [month, amount] of Object.entries(monthlyData)) {
                if (amount > 0) {
                    activeMonthlyData[month] = amount;
                }
            }
            content += this.generateMonthlyBarChart(activeMonthlyData, currency, year);
        }

        content += `\n**Top Expense Categories:**\n\n`;
        // Sort categories by amount (descending) and show only top 10 to avoid clutter
        const sortedCategories = Object.entries(summary.byCategory)
            .filter(([category, amount]) => category !== 'income' && amount > 0) // Exclude income and zero amounts
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10); // Show only top 10 categories
            
        if (sortedCategories.length === 0) {
            content += `*No expense categories found*\n`;
        } else {
            for (const [category, amount] of sortedCategories) {
                const percentage = ((amount / summary.totalExpense) * 100).toFixed(1);
                content += `- **${category}:** ${currency}${amount.toFixed(2)} (${percentage}%)\n`;
            }
            
            const totalCategories = Object.keys(summary.byCategory).filter(cat => 
                cat !== 'income' && summary.byCategory[cat] > 0
            ).length;
            
            if (totalCategories > 10) {
                content += `\n*Showing top 10 of ${totalCategories} expense categories*\n`;
            }
        }

        // Add simplified mermaid bar chart for annual category distribution (top categories only)
        if (sortedCategories.length > 0) {
            content += `\n**Top Categories Distribution:**\n\n`;
            // Create a reduced dataset with only the top categories for the chart
            const topCategoriesData: Record<string, number> = {};
            sortedCategories.slice(0, 8).forEach(([category, amount]) => { // Show only top 8 in chart
                topCategoriesData[category] = amount;
            });
            content += this.generateMermaidBarChart(topCategoriesData, currency);
        }

        content += `\n</div>`;
        return content;
    }

    /**
     * Generate breakdown summary content
     */
    private async generateBreakdownSummary(marker: SummaryMarker): Promise<string> {
        let expenses: ExpenseEntry[] = [];

        if (marker.month) {
            const [year, monthNum] = marker.month.split('-');
            expenses = await this.getCachedMonthlyExpenses(year, monthNum);
        } else if (marker.year) {
            expenses = await this.getCachedYearlyExpenses(marker.year);
        } else {
            return 'Month or year parameter is required for breakdown';
        }

        if (marker.category) {
            expenses = filterEntriesByCategory(expenses, marker.category);
        }

        const settings = this.settingsService.getSettings();
        const currency = settings.defaultCurrency;

        let content = `**Detailed Breakdown**\n\n`;

        if (marker.category) {
            content += `**Category:** ${marker.category}\n`;
        }
        if (marker.month) {
            content += `**Period:** ${formatMonthYear(marker.month)}\n`;
        } else if (marker.year) {
            content += `**Period:** ${marker.year}\n`;
        }

        // Provide summary stats instead of detailed entries to keep annual documents concise
        if (expenses.length === 0) {
            content += `*No entries found for the specified criteria*\n`;
        } else {
            const breakdownKey = `breakdown-${marker.month || marker.year}${marker.category ? `-${marker.category}` : ''}`;
            const summary = this.getCachedSummary(expenses, breakdownKey);
            
            // Check if this is likely for an annual document (has year but no month)
            const isAnnualBreakdown = marker.year && !marker.month;
            
            if (isAnnualBreakdown && expenses.length > 50) {
                // For annual documents with many entries, show only summary to avoid clutter
                content += `**Summary Statistics:**\n\n`;
                content += `- **Total Entries:** ${expenses.length}\n`;
                content += `- **Total Expenses:** ${currency}${summary.totalExpense.toFixed(2)}\n`;
                content += `- **Total Income:** ${currency}${summary.totalIncome.toFixed(2)}\n`;
                content += `- **Net Amount:** ${currency}${(summary.totalIncome - summary.totalExpense).toFixed(2)}\n`;
                
                // Show date range
                if (expenses.length > 0) {
                    const sortedExpenses = expenses.sort((a, b) => a.date.localeCompare(b.date));
                    const firstDate = sortedExpenses[0].date.slice(0, 10);
                    const lastDate = sortedExpenses[sortedExpenses.length - 1].date.slice(0, 10);
                    content += `- **Date Range:** ${firstDate} to ${lastDate}\n`;
                }
                
                // Show top categories if more than one
                if (Object.keys(summary.byCategory).length > 1) {
                    const topCategories = Object.entries(summary.byCategory)
                        .filter(([cat, amount]) => cat !== 'income' && amount > 0)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 5);
                        
                    if (topCategories.length > 0) {
                        content += `- **Top Categories:** ${topCategories.map(([cat, amount]) => 
                            `${cat} (${currency}${amount.toFixed(2)})`
                        ).join(', ')}\n`;
                    }
                }
                
                content += `\n*Individual entries hidden to keep document concise. View monthly documents for detailed breakdowns.*\n`;
            } else {
                // For monthly documents or small datasets, show detailed entries
                content += `**Entries:**\n\n`;
                content += `| Date | Description | Amount | Shop |\n`;
                content += `|------|-------------|--------|------|\n`;
                
                for (const expense of expenses) {
                    const date = expense.date.slice(0, 10); // YYYY-MM-DD
                    const amount = expense.price >= 0 ? 
                        `${currency}${expense.price.toFixed(2)}` : 
                        `+${currency}${Math.abs(expense.price).toFixed(2)}`;
                    content += `| ${date} | ${expense.description} | ${amount} | ${expense.shop} |\n`;
                }
                
                content += `\n**Summary:** ${currency}${(summary.totalIncome - summary.totalExpense).toFixed(2)} (${expenses.length} entries)\n`;
            }
        }

        return content;
    }

    /**
     * Replace summary content between markers
     */
    private replaceSummaryContent(content: string, marker: SummaryMarker, newSummary: string): string {
        const lines = content.split('\n');
        
        // Check if this is a monthly or annual summary that should be at the beginning
        const shouldBeAtBeginning = (marker.type === SummaryMarkerType.MONTHLY || marker.type === SummaryMarkerType.ANNUAL) && 
                                  marker.startIndex > 0;

        if (shouldBeAtBeginning) {
            // Find the document title (first non-empty line starting with #)
            let titleEndIndex = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#')) {
                    titleEndIndex = i + 1;
                    break;
                }
                if (line && !line.startsWith('#')) {
                    break;
                }
            }

            // Remove the old summary (including markers)
            const contentWithoutOldSummary = [
                ...lines.slice(0, marker.startIndex),
                ...lines.slice(marker.endIndex + 1)
            ].join('\n');

            // Create the proper marker start line
            let startMarker = '';
            if (marker.type === SummaryMarkerType.MONTHLY) {
                startMarker = `${COMMENT_MARKERS.MONTHLY_START}${marker.month ? ` month="${marker.month}"` : ''} -->`;
            } else if (marker.type === SummaryMarkerType.ANNUAL) {
                startMarker = `${COMMENT_MARKERS.ANNUAL_START}${marker.year ? ` year="${marker.year}"` : ''} -->`;
            }

            const endMarker = marker.type === SummaryMarkerType.MONTHLY ? COMMENT_MARKERS.MONTHLY_END : COMMENT_MARKERS.ANNUAL_END;

            // Insert new summary after title
            const newLines = contentWithoutOldSummary.split('\n');
            return [
                ...newLines.slice(0, titleEndIndex),
                startMarker,
                newSummary,
                endMarker,
                '',
                ...newLines.slice(titleEndIndex)
            ].join('\n');
        } else {
            // Standard replacement
            const beforeMarker = lines.slice(0, marker.startIndex + 1);
            const afterMarker = lines.slice(marker.endIndex);
            
            return [
                ...beforeMarker,
                newSummary,
                ...afterMarker
            ].join('\n');
        }
    }

    /**
     * Process all expense documents for summary updates
     */
    async processAllDocumentSummaries(): Promise<void> {
        try {
            console.info('Processing all document summaries...');
            
            const folderService = FolderService.getInstance();
            const structure = await folderService.getAllExpenseStructure();
            
            // Process all notes
            for (const note of structure.notes) {
                await this.processDocumentSummaries(note.id);
            }
            
            console.info('Completed processing all document summaries');
        } catch (error) {
            console.error('Failed to process all document summaries:', error);
        }
    }

    /**
     * Update summaries when note is saved
     */
    async onNoteSaved(noteId: string): Promise<void> {
        try {
            // Check if this is an expense-related note
            const note = await joplin.data.get(['notes', noteId], { fields: ['parent_id', 'title'] });
            
            // Get the folder structure to check if this note belongs to expenses
            const folderService = FolderService.getInstance();
            const structure = await folderService.getAllExpenseStructure();
            
            // Check if the note is in any expense folder
            const isExpenseNote = structure.notes.some(n => n.id === noteId);
            
            if (isExpenseNote) {
                console.info(`Processing summaries for saved expense note: ${note.title}`);
                await this.processDocumentSummaries(noteId);
            }
        } catch (error) {
            console.error(`Failed to process summaries on note save:`, error);
        }
    }

    /**
     * Generate a mermaid bar chart for category expenses
     */
    private generateMermaidBarChart(categoryData: Record<string, number>, currency: string): string {
        if (Object.keys(categoryData).length === 0) {
            return '';
        }

        // Filter out income and zero/negative amounts for the chart
        const expenseCategories = Object.entries(categoryData)
            .filter(([cat, amount]) => cat !== 'income' && amount > 0)
            .sort(([,a], [,b]) => b - a); // Sort by amount descending

        if (expenseCategories.length === 0) {
            return '';
        }

        let chart = '```mermaid\n';
        chart += '---\n';
        chart += 'config:\n';
        chart += '  responsive: true\n';
        chart += '  xyChart:\n';
        chart += '    width: 1000\n';           // Wider chart
        chart += '    height: 400\n';          // Taller chart  
        chart += '---\n';
        chart += 'xychart-beta\n';
        chart += '    title "Expenses by Category"\n';
        chart += '    x-axis [';
        chart += expenseCategories.map(([cat]) => `"${this.sanitizeForMermaid(cat)}"`).join(', ');
        chart += ']\n';
        chart += '    y-axis "Amount (' + this.sanitizeForMermaid(currency) + ')" 0 --> ';
        chart += Math.ceil(Math.max(...expenseCategories.map(([,amount]) => amount)));
        chart += '\n';
        chart += '    bar [';
        chart += expenseCategories.map(([,amount]) => amount.toFixed(2)).join(', ');
        chart += ']\n';
        chart += '```\n\n';

        // Add data labels table for exact values since mermaid xychart-beta doesn't support data labels directly
        chart += '**Category Details:**\n\n';
        chart += '| Category | Amount |\n';
        chart += '|----------|--------|\n';
        for (const [cat, amount] of expenseCategories) {
            const sanitizedCat = escapeHtml(sanitizeCategory(cat));
            const sanitizedCurrency = escapeHtml(currency);
            chart += `| ${sanitizedCat} | ${sanitizedCurrency}${amount.toFixed(2)} |\n`;
        }
        chart += '\n';

        return chart;
    }

    /**
     * Generate mermaid bar chart for monthly data
     */
    private generateMonthlyBarChart(monthlyData: Record<string, number>, currency: string, year: string): string {
        if (Object.keys(monthlyData).length === 0) {
            return '';
        }

        // Convert month numbers to month names and sort chronologically
        const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
        const sortedData = months
            .map(month => ({
                month: month,
                name: formatMonthYear(`${year}-${month}`).split(' ')[0], // Get just the month name
                fullName: formatMonthYear(`${year}-${month}`), // Full month-year for table
                amount: monthlyData[month] || 0 // Include all months, use 0 for empty months
            }));

        // sortedData should always have 12 months now, so this check is no longer needed
        // if (sortedData.length === 0) {
        //     return '';
        // }

        let chart = '```mermaid\n';
        chart += '---\n';
        chart += 'config:\n';
        chart += '  responsive: true\n';
        chart += '  xyChart:\n';
        chart += '    width: 1000\n';           // Wider chart
        chart += '    height: 400\n';          // Taller chart  
        chart += '---\n';
        chart += 'xychart-beta\n';
        chart += '    title "Monthly Expense Trends"\n';
        chart += '    x-axis [';
        chart += sortedData.map(data => `"${this.sanitizeForMermaid(data.name)}"`).join(', ');
        chart += ']\n';
        chart += '    y-axis "Amount (' + this.sanitizeForMermaid(currency) + ')" 0 --> ';
        chart += Math.ceil(Math.max(...sortedData.map(data => data.amount)));
        chart += '\n';
        chart += '    bar [';
        chart += sortedData.map(data => data.amount.toFixed(2)).join(', ');
        chart += ']\n';
        chart += '```\n\n';

        // Add data labels table for exact values
        chart += '**Monthly Details:**\n\n';
        chart += '| Month | Expense Amount |\n';
        chart += '|-------|----------------|\n';
        for (const data of sortedData) {
            chart += `| ${data.fullName} | ${currency}${data.amount.toFixed(2)} |\n`;
        }
        chart += '\n';

        return chart;
    }
}
