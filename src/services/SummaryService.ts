import joplin from 'api';
import { ExpenseEntry, ExpenseSummary, SummaryMarker, SummaryMarkerType, COMMENT_MARKERS } from '../types';
import { ExpenseService } from './ExpenseService';
import { SettingsService } from './SettingsService';
import { filterEntriesByYearMonth, filterEntriesByYear, filterEntriesByCategory } from '../expenseParser';
import { formatMonthYear, getAllMonths } from '../utils/dateUtils';
import { escapeHtml, sanitizeCategory } from '../utils/sanitization';

export class SummaryService {
    private static instance: SummaryService;
    private expenseService: ExpenseService;
    private settingsService: SettingsService;

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
        this.expenseService = ExpenseService.getInstance();
        this.settingsService = SettingsService.getInstance();
    }

    public static getInstance(): SummaryService {
        if (!SummaryService.instance) {
            SummaryService.instance = new SummaryService();
        }
        return SummaryService.instance;
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
            const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
            const markers = this.findSummaryMarkers(note.body);

            if (markers.length === 0) {
                return; // No summary markers found
            }

            let updatedContent = note.body;

            // Process markers in reverse order to maintain correct indices
            for (let i = markers.length - 1; i >= 0; i--) {
                const marker = markers[i];
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
        let match;
        
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
        const expenses = await this.expenseService.getMonthlyExpenses(year, monthNum);
        
        let filteredExpenses = expenses;
        if (category) {
            filteredExpenses = filterEntriesByCategory(expenses, category);
        }

        const summary = this.generateSummary(filteredExpenses);
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

        const expenses = await this.expenseService.getYearlyExpenses(year);
        const summary = this.generateSummary(expenses);
        const settings = this.settingsService.getSettings();
        const currency = settings.defaultCurrency;

        let content = `<div style="color: #ff7979">\n\n`;
        content += `**${year} Annual Summary**\n\n`;
        
        content += `- **Total Expenses:** ${currency}${summary.totalExpense.toFixed(2)}\n`;
        content += `- **Total Income:** ${currency}${summary.totalIncome.toFixed(2)}\n`;
        content += `- **Net Amount:** ${currency}${summary.netAmount.toFixed(2)}\n`;
        content += `- **Entry Count:** ${summary.entryCount}\n\n`;

        // Monthly breakdown
        content += `**Monthly Breakdown:**\n\n`;
        const months = getAllMonths();
        const monthlyData: Record<string, number> = {};
        
        for (const month of months) {
            const monthlyExpenses = filterEntriesByYearMonth(expenses, `${year}-${month}`);
            if (monthlyExpenses.length > 0) {
                const monthlySummary = this.generateSummary(monthlyExpenses);
                const monthName = formatMonthYear(`${year}-${month}`);
                const netAmount = monthlySummary.totalIncome - monthlySummary.totalExpense;
                const monthKey = formatMonthYear(`${year}-${month}`).replace(' ', ' '); // Format for display
                
                content += `- **${monthName}:** ${currency}${netAmount.toFixed(2)} (${monthlySummary.entryCount} entries)\n`;
                
                // Store monthly expense data for chart (only positive expenses, not income)
                if (monthlySummary.totalExpense > 0) {
                    monthlyData[month] = monthlySummary.totalExpense;
                }
            }
        }
        
        // Add monthly expense chart
        if (Object.keys(monthlyData).length > 0) {
            content += `\n**Monthly Expense Trends:**\n\n`;
            content += this.generateMonthlyBarChart(monthlyData, currency, year);
        }

        content += `\n**Category Breakdown:**\n\n`;
        for (const [category, amount] of Object.entries(summary.byCategory)) {
            content += `- **${category}:** ${currency}${amount.toFixed(2)}\n`;
        }

        // Add mermaid bar chart for annual category distribution
        if (Object.keys(summary.byCategory).length > 0) {
            content += `\n**Annual Expense Distribution:**\n\n`;
            content += this.generateMermaidBarChart(summary.byCategory, currency);
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
            expenses = await this.expenseService.getMonthlyExpenses(year, monthNum);
        } else if (marker.year) {
            expenses = await this.expenseService.getYearlyExpenses(marker.year);
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

        content += `\n**Entries:**\n\n`;

        if (expenses.length === 0) {
            content += '*No entries found*\n';
        } else {
            content += `| Date | Description | Amount | Shop |\n`;
            content += `|------|-------------|--------|------|\n`;
            
            for (const expense of expenses) {
                const date = expense.date.slice(0, 10); // YYYY-MM-DD
                const amount = expense.price >= 0 ? 
                    `${currency}${expense.price.toFixed(2)}` : 
                    `+${currency}${Math.abs(expense.price).toFixed(2)}`;
                content += `| ${date} | ${expense.description} | ${amount} | ${expense.shop} |\n`;
            }

            const summary = this.generateSummary(expenses);
            content += `\n**Summary:** ${currency}${(summary.totalIncome - summary.totalExpense).toFixed(2)} (${expenses.length} entries)\n`;
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
            
            const folderService = require('./FolderService').FolderService.getInstance();
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
            const folderService = require('./FolderService').FolderService.getInstance();
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
            .filter(month => monthlyData[month] && monthlyData[month] > 0)
            .map(month => ({
                month: month,
                name: formatMonthYear(`${year}-${month}`).split(' ')[0], // Get just the month name
                fullName: formatMonthYear(`${year}-${month}`), // Full month-year for table
                amount: monthlyData[month]
            }));

        if (sortedData.length === 0) {
            return '';
        }

        let chart = '```mermaid\n';
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
