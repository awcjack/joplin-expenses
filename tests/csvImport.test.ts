import { validateMoneyWalletCSV, parseMoneyWalletCSV } from '../src/utils/csvParser';
import { mapMoneyWalletRowsToExpenseEntries } from '../src/utils/dataMapper';

describe('CSV Import Functionality', () => {
    const sampleCSV = `wallet,currency,category,datetime,money,description,event,people
Bank account,EUR,food,2020-03-25 16:08:34,-45.89,Grocery shopping,Weekly shopping,John
Credit Card,EUR,transport,2020-03-26 09:15:22,-23.56,Bus ticket,,
Cash,EUR,entertainment,2020-03-27 20:30:00,-15.50,Movie theater,Date night,Alice
Bank account,EUR,income,2020-03-30 14:00:00,2500.00,Monthly salary,,`;

    test('should validate MoneyWallet CSV format correctly', () => {
        const validation = validateMoneyWalletCSV(sampleCSV);
        
        expect(validation.valid).toBe(true);
        expect(validation.rowCount).toBe(4);
        expect(validation.hasOptionalColumns).toBe(true);
        expect(validation.errors).toHaveLength(0);
    });

    test('should parse MoneyWallet CSV correctly', () => {
        const rows = parseMoneyWalletCSV(sampleCSV);
        
        expect(rows).toHaveLength(4);
        
        // Test first row (CSV parser returns raw values, no conversion yet)
        expect(rows[0]).toMatchObject({
            wallet: 'Bank account',
            currency: 'EUR',
            category: 'food',
            datetime: '2020-03-25 16:08:34',
            money: '-45.89', // Raw value from CSV (negative for expenses)
            description: 'Grocery shopping',
            event: 'Weekly shopping',
            people: 'John'
        });

        // Test row without optional fields
        expect(rows[1]).toMatchObject({
            wallet: 'Credit Card',
            currency: 'EUR',
            category: 'transport',
            datetime: '2020-03-26 09:15:22',
            money: '-23.56', // Raw value from CSV (negative for expenses)
            description: 'Bus ticket'
        });
    });

    test('should map MoneyWallet rows to expense entries correctly', () => {
        const rows = parseMoneyWalletCSV(sampleCSV);
        const mappingResult = mapMoneyWalletRowsToExpenseEntries(rows);
        
        expect(mappingResult.success).toHaveLength(4);
        expect(mappingResult.failed).toHaveLength(0);
        
        // Test first mapped expense (MoneyWallet negative becomes Joplin positive)
        const firstExpense = mappingResult.success[0];
        expect(firstExpense).toMatchObject({
            price: 45.89, // MoneyWallet -45.89 becomes Joplin +45.89 (expense)
            description: 'Grocery shopping',
            category: 'food',
            shop: 'Weekly shopping', // Mapped from event field
            attachment: '', // Always empty
            recurring: ''   // Always empty
        });
        
        // Test expense without event (should use wallet as shop)
        const secondExpense = mappingResult.success[1];
        expect(secondExpense).toMatchObject({
            price: 23.56, // MoneyWallet -23.56 becomes Joplin +23.56 (expense)
            description: 'Bus ticket',
            category: 'transport',
            shop: 'Credit Card', // Mapped from wallet since no event
            attachment: '',
            recurring: ''
        });
        
        // Test income (MoneyWallet positive becomes Joplin negative)
        const incomeExpense = mappingResult.success[3];
        expect(incomeExpense).toMatchObject({
            price: -2500.00, // MoneyWallet +2500.00 becomes Joplin -2500.00 (income)
            description: 'Monthly salary',
            category: 'income',
            shop: 'Bank account',
            attachment: '',
            recurring: ''
        });
    });

    test('should use description as shop when wallet and event are empty', () => {
        const csvWithEmptyPlace = `wallet,currency,category,datetime,money,description,event,people
,EUR,food,2020-03-25 16:08:34,-25.50,Coffee shop,,`;
        
        const rows = parseMoneyWalletCSV(csvWithEmptyPlace);
        const mappingResult = mapMoneyWalletRowsToExpenseEntries(rows);
        
        expect(mappingResult.success).toHaveLength(1);
        expect(mappingResult.failed).toHaveLength(0);
        
        // Should use description as shop when wallet is empty
        const expense = mappingResult.success[0];
        expect(expense).toMatchObject({
            price: 25.50, // MoneyWallet -25.50 becomes +25.50 in Joplin
            description: 'Coffee shop',
            category: 'food',
            shop: 'Coffee shop', // Description copied to shop since wallet and event are empty
            attachment: '',
            recurring: ''
        });
    });

    test('should handle invalid CSV format', () => {
        const invalidCSV = 'invalid,csv,format\ntest,data';
        
        const validation = validateMoneyWalletCSV(invalidCSV);
        
        expect(validation.valid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);
    });

    test('should handle empty CSV', () => {
        const validation = validateMoneyWalletCSV('');
        
        expect(validation.valid).toBe(false);
        expect(validation.errors).toContain('CSV content is empty');
    });

    test('should handle CSV with missing required columns', () => {
        const incompleteCSV = `wallet,currency,datetime
Bank account,EUR,2020-03-25 16:08:34`;
        
        const validation = validateMoneyWalletCSV(incompleteCSV);
        
        expect(validation.valid).toBe(false);
        expect(validation.errors.some(error => error.includes('Missing required columns'))).toBe(true);
    });

    test('should handle column aliases (place->event, note->people)', () => {
        const csvWithAliases = `wallet,currency,category,datetime,money,description,place,note
Bank account,USD,food,2020-03-25 16:08:34,-25.50,Lunch,Restaurant ABC,With colleagues`;
        
        const validation = validateMoneyWalletCSV(csvWithAliases);
        expect(validation.valid).toBe(true);
        expect(validation.hasOptionalColumns).toBe(true);
        
        const rows = parseMoneyWalletCSV(csvWithAliases);
        expect(rows).toHaveLength(1);
        
        const mappingResult = mapMoneyWalletRowsToExpenseEntries(rows);
        expect(mappingResult.success).toHaveLength(1);
        expect(mappingResult.failed).toHaveLength(0);
        
        // Verify that place is mapped to event and used as shop
        const expense = mappingResult.success[0];
        expect(expense).toMatchObject({
            price: 25.50, // MoneyWallet -25.50 becomes +25.50 in Joplin
            description: 'Lunch',
            category: 'food',
            shop: 'Restaurant ABC', // place field mapped to event and used as shop
            attachment: '',
            recurring: ''
        });
        
        // Verify that the original row has event field populated from place alias
        expect(rows[0].event).toBe('Restaurant ABC');
        expect(rows[0].people).toBe('With colleagues'); // note mapped to people
    });

    test('should handle ISO8601 dates with timezone correctly', () => {
        const csvWithTimezone = `wallet,currency,category,datetime,money,description
Bank account,USD,entertainment,2025-08-24T18:00:17.000Z,-555.00,Collision`;
        
        const rows = parseMoneyWalletCSV(csvWithTimezone);
        expect(rows).toHaveLength(1);
        
        const mappingResult = mapMoneyWalletRowsToExpenseEntries(rows);
        expect(mappingResult.success).toHaveLength(1);
        expect(mappingResult.failed).toHaveLength(0);
        
        // The date should be valid and the mapping should succeed
        const expense = mappingResult.success[0];
        expect(expense.date).toBe('2025-08-24T18:00:17.000Z');
        expect(expense.price).toBe(555.00); // MoneyWallet -555.00 becomes +555.00 in Joplin
        expect(expense.description).toBe('Collision');
    });
});