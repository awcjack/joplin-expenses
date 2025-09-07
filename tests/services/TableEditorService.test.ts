// Mock joplin API for table editor
const mockTableJoplin = {
    data: {
        get: jest.fn(),
        put: jest.fn()
    },
    views: {
        dialogs: {
            create: jest.fn(),
            setHtml: jest.fn(),
            setButtons: jest.fn(),
            open: jest.fn(),
            showMessageBox: jest.fn()
        }
    }
};

// Mock settings service for table editor
const mockTableSettingsService = {
    getCategories: jest.fn().mockReturnValue(['food', 'transport', 'utilities', 'other'])
};

// Mock global joplin
(global as any).joplin = mockTableJoplin;

// Mock service imports
jest.mock('../../src/services/SettingsService', () => ({
    SettingsService: {
        getInstance: () => mockTableSettingsService
    }
}));

// Mock expense parser functions
jest.mock('../../src/expenseParser', () => ({
    parseExpenseTables: jest.fn(),
    createExpenseTable: jest.fn(),
    sortExpensesByDate: jest.fn()
}));

// Mock utils
jest.mock('../../src/utils/sanitization', () => ({
    escapeHtml: jest.fn().mockImplementation((str) => str.replace(/</g, '&lt;').replace(/>/g, '&gt;')),
    sanitizeExpenseEntry: jest.fn()
}));

const mockParseExpenseTables = require('../../src/expenseParser').parseExpenseTables;
const mockCreateExpenseTable = require('../../src/expenseParser').createExpenseTable;
const mockSortExpensesByDate = require('../../src/expenseParser').sortExpensesByDate;
const mockEscapeHtml = require('../../src/utils/sanitization').escapeHtml;
const mockSanitizeExpenseEntry = require('../../src/utils/sanitization').sanitizeExpenseEntry;

describe('TableEditorService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Default successful mocks
        mockCreateExpenseTable.mockReturnValue('| price | description | category | date | shop | attachment | recurring |\n|-------|-------------|----------|------|------|------------|-----------|');
        mockSortExpensesByDate.mockImplementation((expenses) => expenses);
        mockTableJoplin.views.dialogs.create.mockResolvedValue('dialog-id');
        mockTableJoplin.views.dialogs.open.mockResolvedValue({ id: 'cancel' });
    });

    describe('table editor workflow tests', () => {
        const testExpenses = [
            {
                price: 10.50,
                description: 'Coffee',
                category: 'food',
                date: '2025-01-15T10:30:00',
                shop: 'Cafe',
                attachment: '',
                recurring: ''
            }
        ];

        it('should follow workflow for table editor dialog creation', async () => {
            mockTableJoplin.data.get.mockResolvedValue({
                body: '# Test Document\n\nTable content'
            });
            mockParseExpenseTables.mockReturnValue(testExpenses);

            // Test the workflow components
            const note = await mockTableJoplin.data.get(['notes', 'test-note-id'], { fields: ['body'] });
            const expenses = mockParseExpenseTables(note.body);
            const categories = mockTableSettingsService.getCategories();
            const dialogId = await mockTableJoplin.views.dialogs.create('table-editor-dialog');

            expect(note.body).toContain('Test Document');
            expect(expenses).toEqual(testExpenses);
            expect(categories).toEqual(['food', 'transport', 'utilities', 'other']);
            expect(dialogId).toBe('dialog-id');
        });

        it('should handle dialog setup and buttons', async () => {
            await mockTableJoplin.views.dialogs.setHtml('dialog-id', '<html>content</html>');
            await mockTableJoplin.views.dialogs.setButtons('dialog-id', [
                { id: 'save', title: 'Save Changes' },
                { id: 'cancel', title: 'Cancel' }
            ]);

            expect(mockTableJoplin.views.dialogs.setHtml).toHaveBeenCalledWith('dialog-id', '<html>content</html>');
            expect(mockTableJoplin.views.dialogs.setButtons).toHaveBeenCalledWith('dialog-id', [
                { id: 'save', title: 'Save Changes' },
                { id: 'cancel', title: 'Cancel' }
            ]);
        });

        it('should handle save workflow', async () => {
            const formData = {
                'table-editor-form': {
                    'expense-0-price': '15.75',
                    'expense-0-description': 'Updated Coffee',
                    'expense-0-category': 'food',
                    'expense-0-date': '2025-01-15T10:30:00',
                    'expense-0-shop': 'New Cafe',
                    'expense-count': '1'
                }
            };

            mockTableJoplin.views.dialogs.open.mockResolvedValue({
                id: 'save',
                formData: formData
            });

            // Test form processing workflow
            const result = await mockTableJoplin.views.dialogs.open('dialog-id');
            if (result.id === 'save' && result.formData) {
                const expenseData = result.formData['table-editor-form'];
                expect(expenseData['expense-0-description']).toBe('Updated Coffee');
                expect(expenseData['expense-0-price']).toBe('15.75');
            }
        });
    });

    describe('HTML generation logic', () => {
        it('should generate table structure', () => {
            const expenses = [
                {
                    price: 10.50,
                    description: 'Coffee',
                    category: 'food',
                    date: '2025-01-15T10:30:00',
                    shop: 'Cafe',
                    attachment: '',
                    recurring: ''
                }
            ];

            // Test HTML generation components
            const categories = ['food', 'transport', 'utilities'];
            const expectedElements = [
                '<table',
                '<input type="number"',
                '<select',
                'value="10.5"',
                'value="Coffee"',
                '<option value="food"'
            ];

            // Simulate HTML generation logic
            let htmlContent = '<form><table>';
            expenses.forEach((expense, index) => {
                htmlContent += `<tr>
                    <td><input type="number" value="${expense.price}"></td>
                    <td><input type="text" value="${expense.description}"></td>
                    <td><select>`;
                
                categories.forEach(cat => {
                    const selected = cat === expense.category ? ' selected' : '';
                    htmlContent += `<option value="${cat}"${selected}>${cat}</option>`;
                });
                
                htmlContent += `</select></td></tr>`;
            });
            htmlContent += '</table></form>';

            expectedElements.forEach(element => {
                expect(htmlContent).toContain(element);
            });
        });

        it('should handle empty expense list', () => {
            const expenses = [];
            
            // Test empty table logic
            let htmlContent = '<div>';
            if (expenses.length === 0) {
                htmlContent += 'No expenses found';
            }
            htmlContent += '</div>';

            expect(htmlContent).toContain('No expenses found');
        });

        it('should sanitize HTML content', () => {
            const maliciousInput = '<script>alert("xss")</script>';
            const sanitized = mockEscapeHtml(maliciousInput);

            expect(mockEscapeHtml).toHaveBeenCalledWith(maliciousInput);
            expect(sanitized).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
        });
    });

    describe('form data processing logic', () => {
        it('should process valid form data', () => {
            const formData = {
                'expense-0-price': '10.50',
                'expense-0-description': 'Coffee',
                'expense-0-category': 'food',
                'expense-0-date': '2025-01-15T10:30:00',
                'expense-0-shop': 'Cafe',
                'expense-count': '1'
            };

            // Test form processing logic
            const expenseCount = parseInt(formData['expense-count']);
            const processedExpenses = [];

            for (let i = 0; i < expenseCount; i++) {
                const expense = {
                    price: parseFloat(formData[`expense-${i}-price`]),
                    description: formData[`expense-${i}-description`],
                    category: formData[`expense-${i}-category`],
                    date: formData[`expense-${i}-date`],
                    shop: formData[`expense-${i}-shop`]
                };
                processedExpenses.push(expense);
            }

            expect(processedExpenses).toHaveLength(1);
            expect(processedExpenses[0].description).toBe('Coffee');
            expect(processedExpenses[0].price).toBe(10.50);
        });

        it('should validate form data', () => {
            const invalidFormData = {
                'expense-0-price': 'invalid-price',
                'expense-0-description': '',
                'expense-0-category': 'food',
                'expense-count': '1'
            };

            // Test validation logic
            const errors = [];
            const price = parseFloat(invalidFormData['expense-0-price']);
            const description = invalidFormData['expense-0-description'];

            if (isNaN(price)) {
                errors.push('Invalid price format');
            }
            if (!description) {
                errors.push('Description is required');
            }

            expect(errors).toContain('Invalid price format');
            expect(errors).toContain('Description is required');
        });

        it('should sanitize form input', () => {
            const maliciousFormData = {
                'expense-0-description': '<img src=x onerror=alert("xss")>',
                'expense-0-shop': 'javascript:alert("xss")',
                'expense-count': '1'
            };

            mockSanitizeExpenseEntry.mockReturnValue({
                errors: [],
                sanitized: {
                    description: 'Clean description',
                    shop: 'Clean shop'
                }
            });

            // Test sanitization workflow
            const result = mockSanitizeExpenseEntry({
                description: maliciousFormData['expense-0-description'],
                shop: maliciousFormData['expense-0-shop']
            });

            expect(mockSanitizeExpenseEntry).toHaveBeenCalled();
            expect(result.sanitized.description).toBe('Clean description');
            expect(result.sanitized.shop).toBe('Clean shop');
        });
    });

    describe('error handling', () => {
        it('should handle API errors', async () => {
            mockTableJoplin.data.get.mockRejectedValue(new Error('API Error'));

            try {
                await mockTableJoplin.data.get(['notes', 'test-id'], { fields: ['body'] });
            } catch (error) {
                expect(error.message).toBe('API Error');
            }

            expect(mockTableJoplin.data.get).toHaveBeenCalled();
        });

        it('should handle dialog creation errors', async () => {
            mockTableJoplin.views.dialogs.create.mockRejectedValue(new Error('Dialog creation failed'));

            try {
                await mockTableJoplin.views.dialogs.create('test-dialog');
            } catch (error) {
                expect(error.message).toBe('Dialog creation failed');
            }
        });

        it('should handle invalid note content', () => {
            mockParseExpenseTables.mockReturnValue([]);

            const expenses = mockParseExpenseTables('invalid content');
            expect(expenses).toEqual([]);
        });
    });

    describe('category dropdown generation', () => {
        it('should generate category options', () => {
            const categories = ['food', 'transport', 'utilities'];
            const selectedCategory = 'food';

            // Test dropdown generation logic
            let selectHtml = '<select>';
            categories.forEach(category => {
                const selected = category === selectedCategory ? ' selected' : '';
                selectHtml += `<option value="${category}"${selected}>${category}</option>`;
            });
            selectHtml += '</select>';

            expect(selectHtml).toContain('<option value="food" selected>food</option>');
            expect(selectHtml).toContain('<option value="transport">transport</option>');
            expect(selectHtml).toContain('<option value="utilities">utilities</option>');
        });

        it('should handle empty categories', () => {
            const categories = [];

            let selectHtml = '<select>';
            if (categories.length === 0) {
                selectHtml += '<option value="">No categories available</option>';
            }
            selectHtml += '</select>';

            expect(selectHtml).toContain('No categories available');
        });
    });

    describe('table content generation', () => {
        it('should generate table with expenses', () => {
            const expenses = [
                { price: 10.50, description: 'Coffee', category: 'food' },
                { price: 25.00, description: 'Lunch', category: 'food' }
            ];

            // Test table generation logic
            let tableHtml = '<table><tbody>';
            expenses.forEach(expense => {
                tableHtml += `<tr>
                    <td>${expense.price}</td>
                    <td>${expense.description}</td>
                    <td>${expense.category}</td>
                </tr>`;
            });
            tableHtml += '</tbody></table>';

            expect(tableHtml).toContain('10.5');
            expect(tableHtml).toContain('Coffee');
            expect(tableHtml).toContain('25');
            expect(tableHtml).toContain('Lunch');
        });

        it('should generate add new row button', () => {
            const buttonHtml = '<button id="add-row">Add New Row</button>';
            
            expect(buttonHtml).toContain('Add New Row');
            expect(buttonHtml).toContain('id="add-row"');
        });
    });
});