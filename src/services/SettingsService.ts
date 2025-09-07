import joplin from 'api';
import { PluginSettings, DEFAULT_SETTINGS } from '../types';
import { SettingItemType } from 'api/types';
import { sanitizeCategory } from '../utils/sanitization';

export class SettingsService {
    private static instance: SettingsService;
    private settings: PluginSettings;

    private constructor() {
        this.settings = { ...DEFAULT_SETTINGS };
    }

    public static getInstance(): SettingsService {
        if (!SettingsService.instance) {
            SettingsService.instance = new SettingsService();
        }
        return SettingsService.instance;
    }

    /**
     * Initialize settings from storage or create defaults
     */
    async initialize(): Promise<void> {
        try {
            // Register settings with Joplin
            await this.registerSettings();
            
            // Load existing settings or use defaults
            await this.loadSettings();
        } catch (error) {
            console.error('Failed to initialize settings:', error);
            this.settings = { ...DEFAULT_SETTINGS };
        }
    }

    /**
     * Register plugin settings with Joplin
     */
    private async registerSettings(): Promise<void> {
        await joplin.settings.registerSection('expensesSettings', {
            label: 'Expenses Plugin',
            iconName: 'fas fa-calculator',
            description: 'Configure expense tracking settings'
        });

        await joplin.settings.registerSettings({
            'expenses.categories': {
                value: DEFAULT_SETTINGS.categories.join(','),
                type: SettingItemType.String,
                section: 'expensesSettings',
                public: true,
                label: 'Expense Categories',
                description: 'Comma-separated list of expense categories'
            },
            'expenses.autoProcessing': {
                value: DEFAULT_SETTINGS.autoProcessing,
                type: SettingItemType.Bool,
                section: 'expensesSettings',
                public: true,
                label: 'Auto-Processing (General)',
                description: 'Enable automatic processing for summaries and recurring expenses'
            },
            'expenses.autoProcessNewExpenses': {
                value: DEFAULT_SETTINGS.autoProcessNewExpenses,
                type: SettingItemType.Bool,
                section: 'expensesSettings',
                public: true,
                label: 'Auto-Process New Expenses',
                description: 'Automatically process expenses when new-expenses document is saved'
            },
            'expenses.folderPath': {
                value: DEFAULT_SETTINGS.expensesFolderPath,
                type: SettingItemType.String,
                section: 'expensesSettings',
                public: true,
                label: 'Expenses Folder Path',
                description: 'Path for the expenses folder structure'
            },
            'expenses.defaultCurrency': {
                value: DEFAULT_SETTINGS.defaultCurrency,
                type: SettingItemType.String,
                section: 'expensesSettings',
                public: true,
                label: 'Default Currency Symbol',
                description: 'Default currency symbol to display in summaries'
            },
            'expenses.autocompleteKeybind': {
                value: DEFAULT_SETTINGS.autocompleteKeybind,
                type: SettingItemType.String,
                section: 'expensesSettings',
                public: true,
                label: 'Autocomplete Keybind',
                description: 'Keyboard shortcut to apply autocomplete suggestion (e.g., Ctrl+Enter, Alt+Tab)'
            },
            'expenses.defaultTimezone': {
                value: DEFAULT_SETTINGS.defaultTimezone,
                type: SettingItemType.String,
                section: 'expensesSettings',
                public: true,
                label: 'Default Timezone Offset',
                description: 'Default timezone offset for dates without timezone info',
                options: {
                    'local': 'Local time (auto-detect)',
                    'UTC': 'UTC (GMT+0)',
                    '-12': 'UTC-12',
                    '-11': 'UTC-11',
                    '-10': 'UTC-10',
                    '-9': 'UTC-9',
                    '-8': 'UTC-8 (PST)',
                    '-7': 'UTC-7 (MST)',
                    '-6': 'UTC-6 (CST)', 
                    '-5': 'UTC-5 (EST)',
                    '-4': 'UTC-4',
                    '-3': 'UTC-3',
                    '-2': 'UTC-2',
                    '-1': 'UTC-1',
                    '+1': 'UTC+1 (CET)',
                    '+2': 'UTC+2 (EET)',
                    '+3': 'UTC+3',
                    '+4': 'UTC+4',
                    '+5': 'UTC+5',
                    '+6': 'UTC+6',
                    '+7': 'UTC+7',
                    '+8': 'UTC+8 (CST)',
                    '+9': 'UTC+9 (JST)',
                    '+10': 'UTC+10',
                    '+11': 'UTC+11',
                    '+12': 'UTC+12'
                }
            }
        });
    }

    /**
     * Load settings from Joplin storage
     */
    private async loadSettings(): Promise<void> {
        const settings = await joplin.settings.values([
            'expenses.categories',
            'expenses.autoProcessing', 
            'expenses.autoProcessNewExpenses',
            'expenses.folderPath',
            'expenses.defaultCurrency',
            'expenses.autocompleteKeybind',
            'expenses.defaultTimezone'
        ]);
        
        const categoriesStr = (settings['expenses.categories'] as string) || DEFAULT_SETTINGS.categories.join(',');
        const autoProcessing = settings['expenses.autoProcessing'] as boolean;
        const autoProcessNewExpenses = settings['expenses.autoProcessNewExpenses'] as boolean;
        const folderPath = (settings['expenses.folderPath'] as string) || DEFAULT_SETTINGS.expensesFolderPath;
        const defaultCurrency = (settings['expenses.defaultCurrency'] as string) || DEFAULT_SETTINGS.defaultCurrency;
        const autocompleteKeybind = (settings['expenses.autocompleteKeybind'] as string) || DEFAULT_SETTINGS.autocompleteKeybind;
        const defaultTimezone = (settings['expenses.defaultTimezone'] as string) || DEFAULT_SETTINGS.defaultTimezone;

        // Sanitize loaded categories to prevent injection attacks
        const rawCategories = categoriesStr.split(',').map(c => c.trim()).filter(c => c.length > 0);
        const sanitizedCategories = rawCategories
            .map(cat => sanitizeCategory(cat))
            .filter(cat => cat.length > 0);

        this.settings = {
            categories: sanitizedCategories.length > 0 ? sanitizedCategories : DEFAULT_SETTINGS.categories,
            autoProcessing: autoProcessing !== undefined ? autoProcessing : DEFAULT_SETTINGS.autoProcessing,
            autoProcessNewExpenses: autoProcessNewExpenses !== undefined ? autoProcessNewExpenses : DEFAULT_SETTINGS.autoProcessNewExpenses,
            expensesFolderPath: folderPath,
            defaultCurrency: defaultCurrency,
            autocompleteKeybind: autocompleteKeybind,
            defaultTimezone: defaultTimezone
        };
    }

    /**
     * Get current settings
     */
    getSettings(): PluginSettings {
        return { ...this.settings };
    }

    /**
     * Get categories list
     */
    getCategories(): string[] {
        return [...this.settings.categories];
    }

    /**
     * Add a new category
     */
    async addCategory(category: string): Promise<void> {
        if (!category.trim() || this.settings.categories.includes(category.trim())) {
            return;
        }

        this.settings.categories.push(category.trim());
        await this.saveCategories();
    }

    /**
     * Remove a category
     */
    async removeCategory(category: string): Promise<void> {
        const index = this.settings.categories.indexOf(category);
        if (index > -1) {
            this.settings.categories.splice(index, 1);
            await this.saveCategories();
        }
    }

    /**
     * Update categories list
     */
    async updateCategories(categories: string[]): Promise<void> {
        this.settings.categories = categories.filter(c => c.trim().length > 0);
        await this.saveCategories();
    }

    /**
     * Save categories to storage
     */
    private async saveCategories(): Promise<void> {
        await joplin.settings.setValue('expenses.categories', this.settings.categories.join(','));
    }

    /**
     * Update auto-processing setting
     */
    async setAutoProcessing(enabled: boolean): Promise<void> {
        this.settings.autoProcessing = enabled;
        await joplin.settings.setValue('expenses.autoProcessing', enabled);
    }

    /**
     * Update folder path setting
     */
    async setFolderPath(path: string): Promise<void> {
        this.settings.expensesFolderPath = path.trim() || DEFAULT_SETTINGS.expensesFolderPath;
        await joplin.settings.setValue('expenses.folderPath', this.settings.expensesFolderPath);
    }

    /**
     * Update default currency setting
     */
    async setDefaultCurrency(currency: string): Promise<void> {
        this.settings.defaultCurrency = currency.trim() || DEFAULT_SETTINGS.defaultCurrency;
        await joplin.settings.setValue('expenses.defaultCurrency', this.settings.defaultCurrency);
    }

    /**
     * Set autocomplete keybind
     */
    async setAutocompleteKeybind(keybind: string): Promise<void> {
        this.settings.autocompleteKeybind = keybind.trim() || DEFAULT_SETTINGS.autocompleteKeybind;
        await joplin.settings.setValue('expenses.autocompleteKeybind', this.settings.autocompleteKeybind);
    }

    /**
     * Get autocomplete keybind
     */
    getAutocompleteKeybind(): string {
        return this.settings.autocompleteKeybind;
    }

    /**
     * Reset settings to defaults
     */
    async resetToDefaults(): Promise<void> {
        this.settings = { ...DEFAULT_SETTINGS };
        await joplin.settings.setValue('expenses.categories', this.settings.categories.join(','));
        await joplin.settings.setValue('expenses.autoProcessing', this.settings.autoProcessing);
        await joplin.settings.setValue('expenses.folderPath', this.settings.expensesFolderPath);
        await joplin.settings.setValue('expenses.defaultCurrency', this.settings.defaultCurrency);
        await joplin.settings.setValue('expenses.autocompleteKeybind', this.settings.autocompleteKeybind);
    }
}

export default SettingsService;
