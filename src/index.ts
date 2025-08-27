import joplin from 'api';
import { MenuItemLocation, ContentScriptType } from 'api/types';
import { SettingsService } from './services/SettingsService';
import { FolderService } from './services/FolderService';
import { ExpenseService } from './services/ExpenseService';
import { SummaryService } from './services/SummaryService';
import { TableEditorService } from './services/TableEditorService';
import { createNewExpenseEntry } from './expenseParser';
import { getCurrentDateTime } from './utils/dateUtils';

// Service instances
let settingsService: SettingsService;
let folderService: FolderService;
let expenseService: ExpenseService;
let summaryService: SummaryService;
let tableEditorService: TableEditorService;

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
}

/**
 * Register event handlers
 */
async function registerEventHandlers() {
	// Auto-process summaries when notes are saved
	await joplin.workspace.onNoteChange(async () => {
		try {
			const note = await joplin.workspace.selectedNote();
			if (note && settingsService.getSettings().autoProcessing) {
				await summaryService.onNoteSaved(note.id);
			}
		} catch (error) {
			console.error('Error in note change handler:', error);
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
		
		const formHtml = `
			<form id="quick-expense-form">
				<h2>Add New Expense</h2>
				<table>
					<tr>
						<td><label for="amount">Amount:</label></td>
						<td><input type="number" id="amount" name="amount" step="0.01" required style="width: 100px;"></td>
					</tr>
					<tr>
						<td><label for="description">Description:</label></td>
						<td><input type="text" id="description" name="description" required style="width: 200px;"></td>
					</tr>
					<tr>
						<td><label for="category">Category:</label></td>
						<td>
							<select id="category" name="category" style="width: 150px;">
								${categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
							</select>
						</td>
					</tr>
					<tr>
						<td><label for="shop">Shop:</label></td>
						<td><input type="text" id="shop" name="shop" style="width: 200px;"></td>
					</tr>
				</table>
				<p><small>Note: Expense will be added with current date/time and moved to the appropriate monthly document when processed.</small></p>
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
			
			const newExpense = createNewExpenseEntry({
				price: parseFloat(formData.amount) || 0,
				description: formData.description || '',
				category: formData.category || categories[0] || '',
				shop: formData.shop || '',
				date: getCurrentDateTime()
			});
			
			const addResult = await expenseService.addNewExpense(newExpense);
			
			if (addResult.success) {
				await joplin.views.dialogs.showMessageBox('Expense added successfully! Use "Process New Expenses" to move it to the monthly document.');
			} else {
				await joplin.views.dialogs.showMessageBox('Failed to add expense: ' + addResult.errors.join(', '));
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
		
		const formHtml = `
			<form id="categories-form">
				<h2>Manage Expense Categories</h2>
				<p>Current categories (one per line):</p>
				<textarea id="categories" name="categories" rows="10" cols="40">${categories.join('\n')}</textarea>
				<p><small>Add new categories or modify existing ones. Empty lines will be ignored.</small></p>
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
			const newCategories = result.formData['categories-form'].categories
				.split('\n')
				.map(c => c.trim())
				.filter(c => c.length > 0);
			
			await settingsService.updateCategories(newCategories);
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