import joplin from 'api';
import { MenuItemLocation, ContentScriptType } from 'api/types';
import { SettingsService } from './services/SettingsService';
import { FolderService } from './services/FolderService';
import { ExpenseService } from './services/ExpenseService';
import { SummaryService } from './services/SummaryService';
import { TableEditorService } from './services/TableEditorService';
import { CSVImportService } from './services/CSVImportService';
import { RecurringExpenseHandler } from './recurringHandler';
import { createNewExpenseEntry } from './expenseParser';
import { getCurrentDateTime } from './utils/dateUtils';
import { escapeHtml, sanitizeExpenseEntry } from './utils/sanitization';

// Service instances
let settingsService: SettingsService;
let folderService: FolderService;
let expenseService: ExpenseService;
let summaryService: SummaryService;
let tableEditorService: TableEditorService;
let csvImportService: CSVImportService;
let recurringHandler: RecurringExpenseHandler;


joplin.plugins.register({
	onStart: async function () {
		console.info("Expense plugin started - initializing services...");
		
		try {
			
			// Initialize services
			settingsService = SettingsService.getInstance();
			folderService = FolderService.getInstance();
			expenseService = ExpenseService.getInstance();
			summaryService = SummaryService.getInstance();
			tableEditorService = TableEditorService.getInstance();
			csvImportService = CSVImportService.getInstance();
			recurringHandler = RecurringExpenseHandler.getInstance();
			
			// Initialize settings first
			await settingsService.initialize();
			
			// Initialize folder structure
			await folderService.initializeFolderStructure();
			
			console.info("Services initialized successfully");
			
			// Register commands
			await registerCommands();
			
			// Register menu items
			await registerMenuItems();
			
			// Register event handlers
			await registerEventHandlers();
			
			// Register content scripts for autocomplete
			await registerContentScripts();
			
			console.info("Expense plugin fully initialized");
		} catch (error) {
			console.error("Failed to initialize expense plugin:", error);
		}
	},
});

/**
 * Register all plugin commands
 */
async function registerCommands() {
	// Add new expense command
	await joplin.commands.register({
		name: 'addNewExpense',
		label: 'Add New Expense',
		execute: async () => {
			await addNewExpenseCommand();
		},
	});

	// Edit current month expenses command
	await joplin.commands.register({
		name: 'editCurrentMonthExpenses',
		label: 'Edit Current Month Expenses',
		execute: async () => {
			await editCurrentMonthExpensesCommand();
		},
	});

	// Edit expense table command
	await joplin.commands.register({
		name: 'editExpenseTable',
		label: 'Edit Expense Table',
		execute: async () => {
			await editExpenseTableCommand();
		},
	});

	// Process new expenses command
	await joplin.commands.register({
		name: 'processNewExpenses',
		label: 'Process New Expenses',
		execute: async () => {
			await processNewExpensesCommand();
		},
	});

	// Generate summaries command
	await joplin.commands.register({
		name: 'generateSummaries',
		label: 'Generate Expense Summaries',
		execute: async () => {
			await generateSummariesCommand();
		},
	});

	// Open new-expenses document command
	await joplin.commands.register({
		name: 'openNewExpensesDocument',
		label: 'Open New-Expenses Document',
		execute: async () => {
			await openNewExpensesDocumentCommand();
		},
	});

	// Initialize folder structure command
	await joplin.commands.register({
		name: 'initializeFolderStructure',
		label: 'Initialize Expense Folder Structure',
		execute: async () => {
			await initializeFolderStructureCommand();
		},
	});

	// Manage categories command
	await joplin.commands.register({
		name: 'manageCategories',
		label: 'Manage Expense Categories',
		execute: async () => {
			await manageCategoriesCommand();
		},
	});

	// Process recurring expenses command
	await joplin.commands.register({
		name: 'processRecurringExpenses',
		label: 'Process Recurring Expenses',
		execute: async () => {
			await processRecurringExpensesCommand();
		},
	});

	// Open recurring expenses document command
	await joplin.commands.register({
		name: 'openRecurringExpensesDocument',
		label: 'Open Recurring Expenses Document',
		execute: async () => {
			await openRecurringExpensesDocumentCommand();
		},
	});

	// Import MoneyWallet CSV command
	await joplin.commands.register({
		name: 'importMoneyWalletCSV',
		label: 'Import MoneyWallet CSV',
		execute: async () => {
			await importMoneyWalletCSVCommand();
		},
	});
}

/**
 * Register menu items
 */
async function registerMenuItems() {
	// Main expense menu items
	await joplin.views.menuItems.create('addNewExpenseMenu', 'addNewExpense', MenuItemLocation.Tools);
	await joplin.views.menuItems.create('editCurrentMonthMenu', 'editCurrentMonthExpenses', MenuItemLocation.Tools);
	await joplin.views.menuItems.create('editExpenseTableMenu', 'editExpenseTable', MenuItemLocation.EditorContextMenu);
	await joplin.views.menuItems.create('processNewExpensesMenu', 'processNewExpenses', MenuItemLocation.Tools);
	await joplin.views.menuItems.create('generateSummariesMenu', 'generateSummaries', MenuItemLocation.Tools);
	await joplin.views.menuItems.create('openNewExpensesMenu', 'openNewExpensesDocument', MenuItemLocation.Tools);
	
	// Settings and maintenance
	await joplin.views.menuItems.create('manageCategoriesMenu', 'manageCategories', MenuItemLocation.Tools);
	await joplin.views.menuItems.create('initializeFolderMenu', 'initializeFolderStructure', MenuItemLocation.Tools);
	
	// Import/Export
	await joplin.views.menuItems.create('importMoneyWalletCSVMenu', 'importMoneyWalletCSV', MenuItemLocation.Tools);
	
	// Recurring expenses
	await joplin.views.menuItems.create('processRecurringMenu', 'processRecurringExpenses', MenuItemLocation.Tools);
	await joplin.views.menuItems.create('openRecurringMenu', 'openRecurringExpensesDocument', MenuItemLocation.Tools);
}

/**
 * Register event handlers
 */
async function registerEventHandlers() {
	// Auto-process summaries and detect new expenses when notes are saved
	await joplin.workspace.onNoteChange(async () => {
		try {
			const note = await joplin.workspace.selectedNote();
			if (note && settingsService.getSettings().autoProcessing) {
				// Process summaries
				await summaryService.onNoteSaved(note.id);
				
				// Check if this is the new-expenses document and auto-process expenses
				if (settingsService.getSettings().autoProcessNewExpenses) {
					await autoProcessNewExpensesIfNeeded(note.id, note.title);
				}
			}
		} catch (error) {
			console.error('Error in note change handler:', error);
		}
	});

	// Auto-process recurring expenses on note selection (daily check)
	await joplin.workspace.onNoteSelectionChange(async () => {
		try {
			if (settingsService.getSettings().autoProcessing) {
				// Check if we should run recurring processing (max once per day)
				const storageKey = 'expense_plugin_last_check';
				const lastRecurringCheck = localStorage.getItem(storageKey);
				const today = new Date().toDateString();
				
				if (!lastRecurringCheck || lastRecurringCheck !== today) {
					console.info('Running daily recurring expense check...');
					await processRecurringExpensesInternal();
					localStorage.setItem(storageKey, today);
				}
			}
		} catch (error) {
			console.error('Error in recurring expense processing:', error);
		}
	});
}

/**
 * Register content scripts for autocomplete and other editor enhancements
 */
async function registerContentScripts() {
	try {
		// Register expense autocomplete content script
		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			'expenseAutocomplete',
			'./contentScripts/expenseAutocomplete.js'
		);
		
		// Handle messages from content script
		await joplin.contentScripts.onMessage('expenseAutocomplete', async (message) => {
			if (message === 'getCategories') {
				return settingsService.getCategories();
			} else if (message === 'getAutocompleteKeybind') {
				return settingsService.getAutocompleteKeybind();
			}
			return null;
		});
		
		console.info('Content scripts registered successfully');
	} catch (error) {
		console.error('Failed to register content scripts:', error);
	}
}

/**
 * Add new expense command implementation
 */
async function addNewExpenseCommand() {
	try {
		const categories = settingsService.getCategories();
		
		// Create simple dialog for quick expense entry
		const dialogId = await joplin.views.dialogs.create('quick-expense-dialog');
		
		// Sanitize categories to prevent HTML injection
		const safeCategories = categories.map(cat => escapeHtml(cat));
		
		// Mobile-friendly responsive form design
		const formHtml = `
			<form id="quick-expense-form" style="
				max-width: 100vw;
				padding: 10px;
				box-sizing: border-box;
			">
				<h2 style="margin-bottom: 15px; font-size: 1.2em;">Add New Expense</h2>
				<div style="display: flex; flex-direction: column; gap: 12px;">
					<div style="display: flex; flex-direction: column;">
						<label for="amount" style="font-weight: bold; margin-bottom: 4px;">Amount:</label>
						<input type="number" id="amount" name="amount" step="0.01" required 
							   style="width: 100%; padding: 8px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
					</div>
					<div style="display: flex; flex-direction: column;">
						<label for="description" style="font-weight: bold; margin-bottom: 4px;">Description:</label>
						<input type="text" id="description" name="description" required maxlength="200"
							   style="width: 100%; padding: 8px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
					</div>
					<div style="display: flex; flex-direction: column;">
						<label for="category" style="font-weight: bold; margin-bottom: 4px;">Category:</label>
						<select id="category" name="category" 
								style="width: 100%; padding: 8px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
							${safeCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
						</select>
					</div>
					<div style="display: flex; flex-direction: column;">
						<label for="shop" style="font-weight: bold; margin-bottom: 4px;">Shop:</label>
						<input type="text" id="shop" name="shop" maxlength="100"
							   style="width: 100%; padding: 8px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
					</div>
				</div>
				<p style="margin-top: 15px; font-size: 0.9em; color: #666;">
					<small>Note: Expense will be added with current date/time and moved to the appropriate monthly document when processed.</small>
				</p>
			</form>
		`;
		
		await joplin.views.dialogs.setHtml(dialogId, formHtml);
		await joplin.views.dialogs.setButtons(dialogId, [
			{ id: 'ok', title: 'Add Expense' },
			{ id: 'cancel', title: 'Cancel' }
		]);
		
		const result = await joplin.views.dialogs.open(dialogId);
		
		if (result.id === 'ok' && result.formData && result.formData['quick-expense-form']) {
			const formData = result.formData['quick-expense-form'];
			
			// Sanitize and validate all form inputs
			const expenseData = {
				price: formData.amount,
				description: formData.description || '',
				category: formData.category || categories[0] || '',
				shop: formData.shop || '',
				date: getCurrentDateTime()
			};
			
			const sanitizationResult = sanitizeExpenseEntry(expenseData);
			
			if (sanitizationResult.errors.length > 0) {
				await joplin.views.dialogs.showMessageBox('Invalid input:\n' + sanitizationResult.errors.join('\n'));
				return;
			}
			
			const newExpense = createNewExpenseEntry(sanitizationResult.sanitized);
			const addResult = await expenseService.addNewExpense(newExpense);
			
			if (addResult.success) {
				await joplin.views.dialogs.showMessageBox('Expense added successfully! Use "Process New Expenses" to move it to the monthly document.');
			} else {
				await joplin.views.dialogs.showMessageBox('Failed to add expense:\n' + addResult.errors.join('\n'));
			}
		}
	} catch (error) {
		console.error('Failed to add new expense:', error);
		await joplin.views.dialogs.showMessageBox('Error adding expense: ' + error.message);
	}
}

/**
 * Edit current month expenses command implementation
 */
async function editCurrentMonthExpensesCommand() {
	try {
		const now = new Date();
		const year = now.getFullYear().toString();
		const month = (now.getMonth() + 1).toString().padStart(2, '0');
		
		// Ensure the monthly document exists
		await folderService.ensureYearStructureExists(year);
		const folderStructure = await folderService.getFolderStructure(year);
		const monthlyNoteId = await folderService.findNoteInFolder(folderStructure.yearFolder, month);
		
		if (!monthlyNoteId) {
			await joplin.views.dialogs.showMessageBox(`Could not find monthly document for ${year}-${month}`);
			return;
		}
		
		// Open the table editor for the monthly document
		await tableEditorService.openTableEditor(monthlyNoteId);
		
	} catch (error) {
		console.error('Failed to edit current month expenses:', error);
		await joplin.views.dialogs.showMessageBox('Error opening monthly expenses: ' + error.message);
	}
}

/**
 * Edit expense table command implementation
 */
async function editExpenseTableCommand() {
	try {
		const note = await joplin.workspace.selectedNote();
		if (!note) {
			await joplin.views.dialogs.showMessageBox('No note is currently selected.');
			return;
		}
		
		// Check if this is an expense-related note
		const structure = await folderService.getAllExpenseStructure();
		const isExpenseNote = structure.notes.some(n => n.id === note.id);
		
		if (!isExpenseNote) {
			await joplin.views.dialogs.showMessageBox('The selected note is not in an expense folder. Please select a note from your expense documents.');
			return;
		}
		
		await tableEditorService.openTableEditor(note.id);
		
	} catch (error) {
		console.error('Failed to edit expense table:', error);
		await joplin.views.dialogs.showMessageBox('Error opening table editor: ' + error.message);
	}
}

/**
 * Process new expenses command implementation
 */
async function processNewExpensesCommand() {
	try {
		const result = await expenseService.processNewExpenses();
		
		let message = `Processing completed!\n\n`;
		message += `✅ Processed: ${result.processed} expenses\n`;
		
		if (result.failed > 0) {
			message += `❌ Failed: ${result.failed} expenses\n\n`;
			message += `Errors:\n${result.errors.join('\n')}`;
		}
		
		if (result.processed > 0) {
			message += `\nExpenses have been moved to their respective monthly documents.`;
		}
		
		await joplin.views.dialogs.showMessageBox(message);
		
		// Auto-generate summaries if processing was successful
		if (result.processed > 0 && settingsService.getSettings().autoProcessing) {
			await summaryService.processAllDocumentSummaries();
		}
		
	} catch (error) {
		console.error('Failed to process new expenses:', error);
		await joplin.views.dialogs.showMessageBox('Error processing expenses: ' + error.message);
	}
}

/**
 * Generate summaries command implementation
 */
async function generateSummariesCommand() {
	try {
		await joplin.views.dialogs.showMessageBox('Generating summaries for all expense documents...');
		
		await summaryService.processAllDocumentSummaries();
		
		await joplin.views.dialogs.showMessageBox('✅ All expense summaries have been updated!');
		
	} catch (error) {
		console.error('Failed to generate summaries:', error);
		await joplin.views.dialogs.showMessageBox('Error generating summaries: ' + error.message);
	}
}

/**
 * Open new-expenses document command implementation
 */
async function openNewExpensesDocumentCommand() {
	try {
		const newExpensesNoteId = await folderService.ensureNewExpensesDocumentExists();
		await joplin.commands.execute('openNote', newExpensesNoteId);
	} catch (error) {
		console.error('Failed to open new-expenses document:', error);
		await joplin.views.dialogs.showMessageBox('Error opening new-expenses document: ' + error.message);
	}
}

/**
 * Manage categories command implementation
 */
async function manageCategoriesCommand() {
	try {
		const categories = settingsService.getCategories();
		
		const dialogId = await joplin.views.dialogs.create('manage-categories-dialog');
		
		// Sanitize categories for display in textarea
		const safeCategories = categories.map(cat => escapeHtml(cat));
		
		const formHtml = `
			<form id="categories-form" style="
				max-width: 100vw;
				padding: 10px;
				box-sizing: border-box;
			">
				<h2 style="margin-bottom: 15px; font-size: 1.2em;">Manage Expense Categories</h2>
				<p style="margin-bottom: 10px; font-weight: bold;">Current categories (one per line):</p>
				<textarea id="categories" name="categories" maxlength="1000"
						  style="width: 100%; min-height: 200px; padding: 8px; font-size: 16px; 
								 border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; 
								 font-family: monospace; resize: vertical;"
						  placeholder="Enter categories, one per line...">${safeCategories.join('\n')}</textarea>
				<p style="margin-top: 10px; font-size: 0.9em; color: #666;">
					<small>Add new categories or modify existing ones. Empty lines will be ignored. Categories are limited to 50 characters each.</small>
				</p>
			</form>
		`;
		
		await joplin.views.dialogs.setHtml(dialogId, formHtml);
		await joplin.views.dialogs.setButtons(dialogId, [
			{ id: 'ok', title: 'Save Categories' },
			{ id: 'reset', title: 'Reset to Defaults' },
			{ id: 'cancel', title: 'Cancel' }
		]);
		
		const result = await joplin.views.dialogs.open(dialogId);
		
		if (result.id === 'ok' && result.formData && result.formData['categories-form']) {
			const rawCategories = result.formData['categories-form'].categories
				.split('\n')
				.map(c => c.trim())
				.filter(c => c.length > 0);
			
			// Sanitize categories before saving
			const sanitizedCategories = rawCategories
				.map(cat => sanitizeCategory(cat)) // Use comprehensive sanitization
				.filter(cat => cat.length > 0 && cat.length <= 50) // Length validation
				.filter((cat: string) => /^[a-zA-Z0-9\s\-_]+$/.test(cat)) // Only allow safe characters
				.slice(0, 20); // Limit total number of categories
			
			if (sanitizedCategories.length !== rawCategories.length) {
				const message = `Some categories were filtered out due to invalid characters or length limits.\n\nValid categories saved: ${sanitizedCategories.length}`;
				await joplin.views.dialogs.showMessageBox(message);
			}
			
			await settingsService.updateCategories(sanitizedCategories);
			await joplin.views.dialogs.showMessageBox('Categories updated successfully!');
		} else if (result.id === 'reset') {
			await settingsService.resetToDefaults();
			await joplin.views.dialogs.showMessageBox('Categories reset to defaults!');
		}
		
	} catch (error) {
		console.error('Failed to manage categories:', error);
		await joplin.views.dialogs.showMessageBox('Error managing categories: ' + error.message);
	}
}

/**
 * Initialize folder structure command implementation
 */
async function initializeFolderStructureCommand() {
	try {
		await joplin.views.dialogs.showMessageBox('Initializing expense folder structure...');
		
		await folderService.initializeFolderStructure();
		
		await joplin.views.dialogs.showMessageBox('✅ Expense folder structure initialized successfully!');
		
	} catch (error) {
		console.error('Failed to initialize folder structure:', error);
		await joplin.views.dialogs.showMessageBox('Error initializing folder structure: ' + error.message);
	}
}

/**
 * Process recurring expenses command implementation
 */
async function processRecurringExpensesCommand() {
	try {
		console.log('🔄 MANUAL: Process Recurring Expenses command triggered');
		await joplin.views.dialogs.showMessageBox('Processing recurring expenses...');
		
		console.log('🔄 MANUAL: About to call processRecurringExpensesInternal()');
		const result = await processRecurringExpensesInternal();
		
		let message = `Recurring expense processing completed!\n\n`;
		message += `✅ Processed: ${result.processed} recurring entries\n`;
		message += `📝 Created: ${result.created} new expense entries\n`;
		
		if (result.errors.length > 0) {
			message += `❌ Errors: ${result.errors.length}\n\n`;
			message += `Error details:\n${result.errors.join('\n')}`;
		}
		
		if (result.created > 0) {
			message += `\nNew expenses have been added to the "new-expenses" document. Use "Process New Expenses" to move them to monthly documents.`;
		}
		
		await joplin.views.dialogs.showMessageBox(message);
		
	} catch (error) {
		console.error('Failed to process recurring expenses:', error);
		await joplin.views.dialogs.showMessageBox('Error processing recurring expenses: ' + error.message);
	}
}

/**
 * Open recurring expenses document command implementation
 */
async function openRecurringExpensesDocumentCommand() {
	try {
		const recurringNoteId = await folderService.ensureRecurringExpensesDocumentExists();
		await joplin.commands.execute('openNote', recurringNoteId);
	} catch (error) {
		console.error('Failed to open recurring expenses document:', error);
		await joplin.views.dialogs.showMessageBox('Error opening recurring expenses document: ' + error.message);
	}
}

/**
 * Internal recurring expense processing (used by both command and auto-processing)
 */
async function processRecurringExpensesInternal() {
	try {
		console.log('🔄 INTERNAL: processRecurringExpensesInternal() called');
		const result = await recurringHandler.processAllRecurringExpenses();
		console.log('🔄 INTERNAL: processAllRecurringExpenses() completed:', result);
		
		if (result.created > 0) {
			console.info(`Created ${result.created} new recurring expenses`);
			
			// Auto-process new expenses if enabled
			if (settingsService.getSettings().autoProcessing) {
				await expenseService.processNewExpenses();
			}
		}
		
		return result;
	} catch (error) {
		console.error('Internal recurring processing failed:', error);
		throw error;
	}
}

/**
 * Auto-process new expenses if the modified note is the new-expenses document
 */
async function autoProcessNewExpensesIfNeeded(noteId: string, noteTitle?: string) {
	try {
		// Check if this is the new-expenses document
		const newExpensesNoteId = await folderService.ensureNewExpensesDocumentExists();
		const isNewExpensesDocument = noteId === newExpensesNoteId || 
			(noteTitle && noteTitle.toLowerCase() === 'new-expenses');
		
		if (!isNewExpensesDocument) {
			return; // Not the new-expenses document, nothing to do
		}

		// Add a small delay to ensure the save is complete
		await new Promise(resolve => setTimeout(resolve, 500));

		// Check if there are any expenses to process
		const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
		const expenseCount = await countExpensesInContent(note.body);
		
		if (expenseCount === 0) {
			console.info('No expenses found in new-expenses document, skipping auto-processing');
			return;
		}

		console.info(`Auto-processing detected: ${expenseCount} expenses in new-expenses document`);
		
		// Process the new expenses
		const result = await expenseService.processNewExpenses();
		
		if (result.processed > 0 || result.failed > 0) {
			console.info(`Auto-processing completed: ${result.processed} processed, ${result.failed} failed`);
			
			// Show a subtle notification (optional - can be disabled if too intrusive)
			if (result.processed > 0) {
				// Only show success notifications, not failures to avoid interrupting workflow
				console.info(`✅ Auto-processed ${result.processed} expenses`);
			}
		}

	} catch (error) {
		// Fail silently for auto-processing to avoid disrupting user workflow
		console.error('Auto-processing new expenses failed (silent):', error);
	}
}

/**
 * Count expenses in document content (helper function)
 */
async function countExpensesInContent(content: string): Promise<number> {
	try {
		const { parseExpenseTables } = await import('./expenseParser');
		const expenses = parseExpenseTables(content);
		
		// Filter out empty/placeholder expenses
		const validExpenses = expenses.filter(expense => 
			expense.description && 
			expense.description !== '---' && 
			expense.description.trim() !== '' &&
			expense.category &&
			expense.category !== '---' &&
			expense.category.trim() !== ''
		);
		
		return validExpenses.length;
	} catch (error) {
		console.error('Failed to count expenses:', error);
		return 0;
	}
}

/**
 * Import MoneyWallet CSV command implementation
 */
async function importMoneyWalletCSVCommand() {
	let dialogId: string | null = null;
	
	try {
		// Create file selection dialog with unique ID to avoid conflicts
		const timestamp = Date.now();
		dialogId = await joplin.views.dialogs.create(`csv-import-dialog-${timestamp}`);
		
		const formHtml = `
			<form id="csv-import-form" style="
				max-width: 100vw;
				padding: 10px;
				box-sizing: border-box;
			">
				<h2 style="margin-bottom: 15px; font-size: 1.2em;">Import MoneyWallet CSV</h2>
				<div style="display: flex; flex-direction: column; gap: 15px;">
					<div style="display: flex; flex-direction: column;">
						<label for="csvContent" style="font-weight: bold; margin-bottom: 8px;">Paste CSV Content:</label>
						<textarea id="csvContent" name="csvContent" required
								  style="width: 100%; min-height: 200px; padding: 8px; font-size: 14px; 
										 border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; 
										 font-family: monospace; resize: vertical;"
								  placeholder="Paste your MoneyWallet CSV content here...

Example format:
wallet,currency,category,datetime,money,description,event,people
Bank account,EUR,food,2020-03-25 16:08:34,45.89,Grocery shopping,Weekly shopping,John"></textarea>
						<small style="color: #666; margin-top: 4px;">
							Copy and paste the content of your MoneyWallet CSV export file
						</small>
					</div>
					<div style="display: flex; flex-direction: column;">
						<label for="importLocation" style="font-weight: bold; margin-bottom: 8px;">Import Location:</label>
						<select id="importLocation" name="importLocation" 
								style="width: 100%; padding: 8px; font-size: 16px; border: 1px solid #ccc; 
									   border-radius: 4px; box-sizing: border-box;">
							<option value="new-expenses">Add to New-Expenses document (recommended)</option>
							<option value="direct-to-monthly">Import directly to monthly documents</option>
						</select>
						<small style="color: #666; margin-top: 4px;">
							Choose whether to add to new-expenses for review or import directly to monthly documents
						</small>
					</div>
				</div>
				<div style="margin-top: 20px; padding: 15px; background-color: #f0f8ff; border-radius: 4px; border: 1px solid #bde0ff;">
					<h4 style="margin-top: 0; color: #0066cc;">Required CSV Format (MoneyWallet):</h4>
					<p style="margin: 8px 0; font-family: monospace; font-size: 0.9em;">
						<strong>Required columns:</strong> wallet, currency, category, datetime, money, description
					</p>
					<p style="margin: 8px 0; font-family: monospace; font-size: 0.9em;">
						<strong>Optional columns:</strong> event, people
					</p>
					<p style="margin: 8px 0; font-size: 0.9em;">
						<strong>Datetime format:</strong> YYYY-MM-DD HH:mm:ss (e.g., "2020-03-25 16:08:34")
					</p>
					<p style="margin: 8px 0; font-size: 0.9em;">
						<strong>Field mapping:</strong> wallet→shop, category→category, money→price, description→description
					</p>
				</div>
			</form>
		`;
		
		await joplin.views.dialogs.setHtml(dialogId, formHtml);
		await joplin.views.dialogs.setButtons(dialogId, [
			{ id: 'import', title: 'Import CSV' },
			{ id: 'preview', title: 'Preview First' },
			{ id: 'cancel', title: 'Cancel' }
		]);
		
		const result = await joplin.views.dialogs.open(dialogId);
		
		if (result.id === 'cancel' || !result.formData) {
			console.log('CSV import cancelled by user');
			return;
		}
		
		// Handle form data - Joplin sometimes uses 'null' as the key
		const formData = result.formData['csv-import-form'] || result.formData['null'] || result.formData;
		console.log('Form data received:', result.formData);
		console.log('Using form data:', formData);
		
		const csvContent = formData.csvContent;
		const importLocation = formData.importLocation || 'new-expenses';
		
		if (!csvContent || csvContent.trim().length === 0) {
			await joplin.views.dialogs.showMessageBox('Please paste CSV content to import.');
			console.log('CSV import cancelled - no content provided');
			return;
		}
		
		if (result.id === 'preview') {
			await showCSVPreview(csvContent);
			return;
		}
		
		// Perform import
		console.log('Starting CSV import process...');
		console.log('CSV Content length:', csvContent.length);
		console.log('Import location:', importLocation);
		
		try {
			const importResult = await csvImportService.importMoneyWalletCSV(csvContent, importLocation as any);
			console.log('CSV import completed:', importResult);
		
			// Show results
			let message = `CSV Import ${importResult.success ? 'Completed' : 'Failed'}!\n\n`;
			message += `✅ Successfully imported: ${importResult.imported} expenses\n`;
			
			if (importResult.failed > 0) {
				message += `❌ Failed to import: ${importResult.failed} expenses\n`;
			}
			
			if (importResult.warnings.length > 0) {
				message += `\n⚠️ Warnings:\n${importResult.warnings.slice(0, 5).join('\n')}`;
				if (importResult.warnings.length > 5) {
					message += `\n... and ${importResult.warnings.length - 5} more warnings`;
				}
			}
			
			if (importResult.errors.length > 0) {
				message += `\n❌ Errors:\n${importResult.errors.join('\n')}`;
			}
			
			if (importResult.success) {
				if (importLocation === 'new-expenses') {
					message += `\n\nExpenses have been added to the "new-expenses" document. Use "Process New Expenses" to move them to monthly documents.`;
				} else {
					message += `\n\nExpenses have been imported directly to their respective monthly documents.`;
				}
				
				// Auto-generate summaries if enabled
				if (settingsService.getSettings().autoProcessing) {
					console.log('CSV Import: Auto-processing enabled, generating summaries...');
					try {
						await summaryService.processAllDocumentSummaries();
						console.log('CSV Import: Summaries generated successfully');
						message += `\n\n📊 Expense summaries have been updated automatically.`;
					} catch (summaryError) {
						console.error('CSV Import: Failed to generate summaries:', summaryError);
						message += `\n\n⚠️ Import successful but summary generation failed: ${summaryError.message}`;
					}
				} else {
					console.log('CSV Import: Auto-processing disabled, summaries not updated');
					message += `\n\n💡 Tip: Use "Generate Expense Summaries" to update charts and summaries.`;
				}
			}
			
			await joplin.views.dialogs.showMessageBox(message);
		
		} catch (importError) {
			console.error('CSV import failed with exception:', importError);
			await joplin.views.dialogs.showMessageBox(`CSV Import failed with error:\n\n${importError.message}\n\nCheck console for details.`);
		}
		
	} catch (error) {
		console.error('Failed to import CSV:', error);
		await joplin.views.dialogs.showMessageBox('Error importing CSV: ' + error.message);
	}
	// Note: Joplin dialogs are automatically cleaned up after open() returns
}

/**
 * Show CSV preview before import
 */
async function showCSVPreview(csvContent: string) {
	let previewDialogId: string | null = null;
	
	try {
		const preview = await csvImportService.previewCSVData(csvContent, 3);
		
		if (!preview.valid) {
			await joplin.views.dialogs.showMessageBox('CSV Preview Failed:\n\n' + preview.errors.join('\n'));
			return;
		}
		
		const timestamp = Date.now();
		previewDialogId = await joplin.views.dialogs.create(`csv-preview-dialog-${timestamp}`);
		
		let previewHtml = `
			<div style="padding: 10px; max-width: 100vw; box-sizing: border-box;">
				<h2 style="margin-bottom: 15px;">CSV Import Preview</h2>
				<p><strong>Total rows:</strong> ${preview.totalRows}</p>
				<p><strong>Currencies found:</strong> ${preview.currencies.join(', ')}</p>
		`;
		
		if (preview.errors.length > 0) {
			previewHtml += `
				<div style="margin: 10px 0; padding: 10px; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px;">
					<strong>⚠️ Warnings:</strong><br>
					${preview.errors.slice(0, 3).join('<br>')}
				</div>
			`;
		}
		
		if (preview.preview.length > 0) {
			previewHtml += `
				<h3>Sample Data (first 3 rows):</h3>
				<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
					<thead>
						<tr style="background-color: #f8f9fa;">
							<th style="border: 1px solid #dee2e6; padding: 8px; text-align: left;">Price</th>
							<th style="border: 1px solid #dee2e6; padding: 8px; text-align: left;">Description</th>
							<th style="border: 1px solid #dee2e6; padding: 8px; text-align: left;">Category</th>
							<th style="border: 1px solid #dee2e6; padding: 8px; text-align: left;">Date</th>
							<th style="border: 1px solid #dee2e6; padding: 8px; text-align: left;">Shop</th>
						</tr>
					</thead>
					<tbody>
			`;
			
			preview.preview.forEach(expense => {
				const dateObj = new Date(expense.date);
				const formattedDate = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString();
				previewHtml += `
					<tr>
						<td style="border: 1px solid #dee2e6; padding: 8px;">${expense.price}</td>
						<td style="border: 1px solid #dee2e6; padding: 8px;">${escapeHtml(expense.description)}</td>
						<td style="border: 1px solid #dee2e6; padding: 8px;">${escapeHtml(expense.category)}</td>
						<td style="border: 1px solid #dee2e6; padding: 8px;">${formattedDate}</td>
						<td style="border: 1px solid #dee2e6; padding: 8px;">${escapeHtml(expense.shop)}</td>
					</tr>
				`;
			});
			
			previewHtml += `
					</tbody>
				</table>
			`;
		}
		
		previewHtml += '</div>';
		
		await joplin.views.dialogs.setHtml(previewDialogId, previewHtml);
		await joplin.views.dialogs.setButtons(previewDialogId, [
			{ id: 'ok', title: 'Looks Good - Start Import' },
			{ id: 'cancel', title: 'Cancel' }
		]);
		
		const previewResult = await joplin.views.dialogs.open(previewDialogId);
		
		if (previewResult.id === 'ok') {
			// Proceed with import
			const importResult = await csvImportService.importMoneyWalletCSV(csvContent, 'new-expenses');
			
			let message = `CSV Import ${importResult.success ? 'Completed' : 'Failed'}!\n\n`;
			message += `✅ Successfully imported: ${importResult.imported} expenses\n`;
			
			if (importResult.failed > 0) {
				message += `❌ Failed: ${importResult.failed} expenses\n`;
			}
			
			await joplin.views.dialogs.showMessageBox(message);
		}
		
	} catch (error) {
		await joplin.views.dialogs.showMessageBox('Preview failed: ' + error.message);
	}
	// Note: Joplin dialogs are automatically cleaned up after open() returns
}

