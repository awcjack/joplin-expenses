/**
 * Unit tests for SettingsService
 */

import { SettingsService } from '../../src/services/SettingsService';
import { DEFAULT_SETTINGS } from '../../src/types';

// Mock the 'api' module
jest.mock('api', () => ({
    default: {
        settings: {
            value: jest.fn(),
            setValue: jest.fn(),
            values: jest.fn(),
            registerSection: jest.fn(),
            registerSettings: jest.fn()
        }
    }
}));

// Import the mocked joplin API
import joplin from 'api';
const mockJoplin = joplin as jest.Mocked<typeof joplin>;

describe('SettingsService', () => {
  let settingsService: SettingsService;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset the singleton instance
    (SettingsService as any).instance = undefined;
    settingsService = SettingsService.getInstance();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = SettingsService.getInstance();
      const instance2 = SettingsService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      // Mock Joplin settings responses
      (mockJoplin.settings.values as jest.Mock).mockResolvedValue({
        'expenses.categories': 'food,transport,utilities',
        'expenses.autoProcessing': true,
        'expenses.autoProcessNewExpenses': true,
        'expenses.folderPath': 'expenses',
        'expenses.defaultCurrency': '$',
        'expenses.autocompleteKeybind': 'Ctrl+Enter'
      });
    });

    it('should register settings section', async () => {
      await settingsService.initialize();
      
      expect(mockJoplin.settings.registerSection).toHaveBeenCalledWith(
        'expensesSettings',
        expect.objectContaining({
          label: 'Expenses Plugin',
          iconName: 'fas fa-calculator',
        })
      );
    });

    it('should register individual settings', async () => {
      await settingsService.initialize();
      
      expect(mockJoplin.settings.registerSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          'expenses.categories': expect.objectContaining({
            value: DEFAULT_SETTINGS.categories.join(','),
            label: 'Expense Categories',
          }),
          'expenses.autoProcessing': expect.objectContaining({
            value: DEFAULT_SETTINGS.autoProcessing,
            label: 'Auto-Processing (General)',
          }),
          'expenses.autoProcessNewExpenses': expect.objectContaining({
            value: DEFAULT_SETTINGS.autoProcessNewExpenses,
            label: 'Auto-Process New Expenses',
          }),
        })
      );
    });

    it('should load settings from storage', async () => {
      await settingsService.initialize();
      
      const settings = settingsService.getSettings();
      expect(settings.categories).toEqual(['food', 'transport', 'utilities']);
      expect(settings.autoProcessing).toBe(true);
      expect(settings.autoProcessNewExpenses).toBe(true);
      expect(settings.expensesFolderPath).toBe('expenses');
    });

    it('should handle initialization errors gracefully', async () => {
      (mockJoplin.settings.registerSection as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      
      await settingsService.initialize();
      
      // Should fall back to defaults
      const settings = settingsService.getSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('getSettings', () => {
    it('should return current settings', async () => {
      await settingsService.initialize();
      const settings = settingsService.getSettings();
      
      expect(settings).toHaveProperty('categories');
      expect(settings).toHaveProperty('autoProcessing');
      expect(settings).toHaveProperty('expensesFolderPath');
      expect(settings).toHaveProperty('defaultCurrency');
    });

    it('should return copy of settings (not reference)', async () => {
      await settingsService.initialize();
      const settings1 = settingsService.getSettings();
      const settings2 = settingsService.getSettings();
      
      expect(settings1).not.toBe(settings2); // Different objects
      expect(settings1).toEqual(settings2); // But same content
    });
  });

  describe('getCategories', () => {
    it('should return copy of categories array', async () => {
      (mockJoplin.settings.values as jest.Mock).mockResolvedValueOnce({
        'expenses.categories': 'food,transport'
      });
      await settingsService.initialize();
      
      const categories1 = settingsService.getCategories();
      const categories2 = settingsService.getCategories();
      
      expect(categories1).not.toBe(categories2); // Different arrays
      expect(categories1).toEqual(categories2); // Same content
    });
  });

  describe('addCategory', () => {
    beforeEach(async () => {
      (mockJoplin.settings.values as jest.Mock).mockResolvedValue({
        'expenses.categories': 'food,transport',
        'expenses.autoProcessing': true,
        'expenses.autoProcessNewExpenses': true,
        'expenses.folderPath': 'expenses',
        'expenses.defaultCurrency': '$',
        'expenses.autocompleteKeybind': 'Ctrl+Enter'
      });
      await settingsService.initialize();
    });

    it('should add new category', async () => {
      await settingsService.addCategory('utilities');
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.categories',
        'food,transport,utilities'
      );
    });

    it('should not add duplicate category', async () => {
      await settingsService.addCategory('food'); // Already exists
      
      expect(mockJoplin.settings.setValue).not.toHaveBeenCalled();
    });

    it('should trim whitespace', async () => {
      await settingsService.addCategory('  utilities  ');
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.categories',
        'food,transport,utilities'
      );
    });

    it('should not add empty category', async () => {
      await settingsService.addCategory('');
      await settingsService.addCategory('   ');
      
      expect(mockJoplin.settings.setValue).not.toHaveBeenCalled();
    });
  });

  describe('removeCategory', () => {
    beforeEach(async () => {
      (mockJoplin.settings.values as jest.Mock).mockResolvedValue({
        'expenses.categories': 'food,transport,utilities',
        'expenses.autoProcessing': true,
        'expenses.autoProcessNewExpenses': true,
        'expenses.folderPath': 'expenses',
        'expenses.defaultCurrency': '$',
        'expenses.autocompleteKeybind': 'Ctrl+Enter'
      });
      await settingsService.initialize();
    });

    it('should remove existing category', async () => {
      await settingsService.removeCategory('transport');
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.categories',
        'food,utilities'
      );
    });

    it('should do nothing for non-existing category', async () => {
      await settingsService.removeCategory('nonexistent');
      
      expect(mockJoplin.settings.setValue).not.toHaveBeenCalled();
    });
  });

  describe('updateCategories', () => {
    beforeEach(async () => {
      await settingsService.initialize();
    });

    it('should update categories list', async () => {
      const newCategories = ['food', 'transport', 'utilities', 'entertainment'];
      await settingsService.updateCategories(newCategories);
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.categories',
        'food,transport,utilities,entertainment'
      );
    });

    it('should filter out empty categories', async () => {
      const categories = ['food', '', '  ', 'transport', 'utilities'];
      await settingsService.updateCategories(categories);
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.categories',
        'food,transport,utilities'
      );
    });

    it('should handle empty array', async () => {
      await settingsService.updateCategories([]);
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.categories',
        ''
      );
    });
  });

  describe('setAutoProcessing', () => {
    beforeEach(async () => {
      await settingsService.initialize();
    });

    it('should update auto-processing setting', async () => {
      await settingsService.setAutoProcessing(false);
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.autoProcessing',
        false
      );
      
      const settings = settingsService.getSettings();
      expect(settings.autoProcessing).toBe(false);
    });
  });

  describe('setFolderPath', () => {
    beforeEach(async () => {
      await settingsService.initialize();
    });

    it('should update folder path', async () => {
      await settingsService.setFolderPath('my-expenses');
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.folderPath',
        'my-expenses'
      );
    });

    it('should trim whitespace', async () => {
      await settingsService.setFolderPath('  my-expenses  ');
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.folderPath',
        'my-expenses'
      );
    });

    it('should use default for empty path', async () => {
      await settingsService.setFolderPath('');
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.folderPath',
        DEFAULT_SETTINGS.expensesFolderPath
      );
    });
  });

  describe('setDefaultCurrency', () => {
    beforeEach(async () => {
      await settingsService.initialize();
    });

    it('should update default currency', async () => {
      await settingsService.setDefaultCurrency('€');
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.defaultCurrency',
        '€'
      );
    });

    it('should use default for empty currency', async () => {
      await settingsService.setDefaultCurrency('');
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.defaultCurrency',
        DEFAULT_SETTINGS.defaultCurrency
      );
    });
  });

  describe('resetToDefaults', () => {
    beforeEach(async () => {
      // Initialize with custom settings
      (mockJoplin.settings.values as jest.Mock).mockResolvedValue({
        'expenses.categories': 'custom1,custom2',
        'expenses.autoProcessing': false,
        'expenses.autoProcessNewExpenses': false,
        'expenses.folderPath': 'custom-folder',
        'expenses.defaultCurrency': '€',
        'expenses.autocompleteKeybind': 'Alt+Tab'
      });
      
      await settingsService.initialize();
    });

    it('should reset all settings to defaults', async () => {
      await settingsService.resetToDefaults();
      
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.categories',
        DEFAULT_SETTINGS.categories.join(',')
      );
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.autoProcessing',
        DEFAULT_SETTINGS.autoProcessing
      );
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.folderPath',
        DEFAULT_SETTINGS.expensesFolderPath
      );
      expect(mockJoplin.settings.setValue).toHaveBeenCalledWith(
        'expenses.defaultCurrency',
        DEFAULT_SETTINGS.defaultCurrency
      );
    });

    it('should update internal settings', async () => {
      await settingsService.resetToDefaults();
      
      const settings = settingsService.getSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });
  });
});