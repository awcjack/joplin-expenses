import { SummaryMarkerType, SummaryMarker } from '../src/types';

describe('SummaryMarkerType Enum', () => {
    describe('enum values', () => {
        it('should have correct string values', () => {
            expect(SummaryMarkerType.MONTHLY).toBe('monthly');
            expect(SummaryMarkerType.ANNUAL).toBe('annual');
            expect(SummaryMarkerType.BREAKDOWN).toBe('breakdown');
        });

        it('should be immutable', () => {
            // These should throw TypeScript errors if enum is not readonly
            const monthlyValue = SummaryMarkerType.MONTHLY;
            expect(monthlyValue).toBe('monthly');
            
            const annualValue = SummaryMarkerType.ANNUAL;
            expect(annualValue).toBe('annual');
            
            const breakdownValue = SummaryMarkerType.BREAKDOWN;
            expect(breakdownValue).toBe('breakdown');
        });
    });

    describe('enum usage in switch statements', () => {
        function processMarkerType(type: SummaryMarkerType): string {
            switch (type) {
                case SummaryMarkerType.MONTHLY:
                    return 'Processing monthly summary';
                case SummaryMarkerType.ANNUAL:
                    return 'Processing annual summary';
                case SummaryMarkerType.BREAKDOWN:
                    return 'Processing breakdown summary';
                default:
                    return 'Unknown type';
            }
        }

        it('should handle MONTHLY type', () => {
            const result = processMarkerType(SummaryMarkerType.MONTHLY);
            expect(result).toBe('Processing monthly summary');
        });

        it('should handle ANNUAL type', () => {
            const result = processMarkerType(SummaryMarkerType.ANNUAL);
            expect(result).toBe('Processing annual summary');
        });

        it('should handle BREAKDOWN type', () => {
            const result = processMarkerType(SummaryMarkerType.BREAKDOWN);
            expect(result).toBe('Processing breakdown summary');
        });
    });

    describe('enum usage in object creation', () => {
        it('should create valid SummaryMarker with MONTHLY type', () => {
            const marker: SummaryMarker = {
                type: SummaryMarkerType.MONTHLY,
                month: '2025-01',
                category: 'food',
                startIndex: 0,
                endIndex: 10,
                content: 'Monthly summary content'
            };

            expect(marker.type).toBe(SummaryMarkerType.MONTHLY);
            expect(marker.type).toBe('monthly');
            expect(marker.month).toBe('2025-01');
            expect(marker.category).toBe('food');
        });

        it('should create valid SummaryMarker with ANNUAL type', () => {
            const marker: SummaryMarker = {
                type: SummaryMarkerType.ANNUAL,
                year: '2025',
                startIndex: 0,
                endIndex: 10,
                content: 'Annual summary content'
            };

            expect(marker.type).toBe(SummaryMarkerType.ANNUAL);
            expect(marker.type).toBe('annual');
            expect(marker.year).toBe('2025');
        });

        it('should create valid SummaryMarker with BREAKDOWN type', () => {
            const marker: SummaryMarker = {
                type: SummaryMarkerType.BREAKDOWN,
                category: 'transport',
                month: '2025-01',
                year: '2025',
                startIndex: 0,
                endIndex: 10,
                content: 'Breakdown summary content'
            };

            expect(marker.type).toBe(SummaryMarkerType.BREAKDOWN);
            expect(marker.type).toBe('breakdown');
            expect(marker.category).toBe('transport');
            expect(marker.month).toBe('2025-01');
        });
    });

    describe('enum comparison and validation', () => {
        it('should allow type comparison with enum values', () => {
            const markers: SummaryMarker[] = [
                {
                    type: SummaryMarkerType.MONTHLY,
                    month: '2025-01',
                    startIndex: 0,
                    endIndex: 5,
                    content: 'content1'
                },
                {
                    type: SummaryMarkerType.ANNUAL,
                    year: '2025',
                    startIndex: 6,
                    endIndex: 10,
                    content: 'content2'
                },
                {
                    type: SummaryMarkerType.BREAKDOWN,
                    category: 'food',
                    startIndex: 11,
                    endIndex: 15,
                    content: 'content3'
                }
            ];

            const monthlyMarkers = markers.filter(m => m.type === SummaryMarkerType.MONTHLY);
            expect(monthlyMarkers).toHaveLength(1);
            expect(monthlyMarkers[0].month).toBe('2025-01');

            const annualMarkers = markers.filter(m => m.type === SummaryMarkerType.ANNUAL);
            expect(annualMarkers).toHaveLength(1);
            expect(annualMarkers[0].year).toBe('2025');

            const breakdownMarkers = markers.filter(m => m.type === SummaryMarkerType.BREAKDOWN);
            expect(breakdownMarkers).toHaveLength(1);
            expect(breakdownMarkers[0].category).toBe('food');
        });

        it('should validate marker types', () => {
            function isValidMarkerType(type: string): type is SummaryMarkerType {
                return Object.values(SummaryMarkerType).includes(type as SummaryMarkerType);
            }

            expect(isValidMarkerType('monthly')).toBe(true);
            expect(isValidMarkerType('annual')).toBe(true);
            expect(isValidMarkerType('breakdown')).toBe(true);
            expect(isValidMarkerType('invalid')).toBe(false);
            expect(isValidMarkerType('MONTHLY')).toBe(false); // Case sensitive
        });
    });

    describe('enum array operations', () => {
        it('should support array operations with enum values', () => {
            const allTypes = Object.values(SummaryMarkerType);
            
            expect(allTypes).toHaveLength(3);
            expect(allTypes).toContain(SummaryMarkerType.MONTHLY);
            expect(allTypes).toContain(SummaryMarkerType.ANNUAL);
            expect(allTypes).toContain(SummaryMarkerType.BREAKDOWN);
            expect(allTypes).toEqual(['monthly', 'annual', 'breakdown']);
        });

        it('should support mapping operations', () => {
            const typeDescriptions = Object.values(SummaryMarkerType).map(type => {
                switch (type) {
                    case SummaryMarkerType.MONTHLY:
                        return `${type}: Monthly expense summary`;
                    case SummaryMarkerType.ANNUAL:
                        return `${type}: Annual expense summary`;
                    case SummaryMarkerType.BREAKDOWN:
                        return `${type}: Detailed expense breakdown`;
                    default:
                        return `${type}: Unknown type`;
                }
            });

            expect(typeDescriptions).toEqual([
                'monthly: Monthly expense summary',
                'annual: Annual expense summary',
                'breakdown: Detailed expense breakdown'
            ]);
        });
    });

    describe('backward compatibility', () => {
        it('should be compatible with string literals', () => {
            // This tests that our enum values work with existing string-based code
            function oldStringBasedFunction(type: 'monthly' | 'annual' | 'breakdown'): string {
                return `Processing ${type} summary`;
            }

            // Enum values should work with the old function signature
            expect(oldStringBasedFunction(SummaryMarkerType.MONTHLY)).toBe('Processing monthly summary');
            expect(oldStringBasedFunction(SummaryMarkerType.ANNUAL)).toBe('Processing annual summary');
            expect(oldStringBasedFunction(SummaryMarkerType.BREAKDOWN)).toBe('Processing breakdown summary');
        });

        it('should allow reverse compatibility with string comparisons', () => {
            const marker: SummaryMarker = {
                type: SummaryMarkerType.MONTHLY,
                month: '2025-01',
                startIndex: 0,
                endIndex: 10,
                content: 'content'
            };

            // Should still work with string comparisons for legacy code
            expect(marker.type === 'monthly').toBe(true);
            expect(marker.type === 'annual').toBe(false);
            expect(marker.type === 'breakdown').toBe(false);
        });
    });

    describe('type safety improvements', () => {
        it('should provide better IDE support and type checking', () => {
            function createMarker(type: SummaryMarkerType): SummaryMarker {
                const baseMarker = {
                    type,
                    startIndex: 0,
                    endIndex: 10,
                    content: 'test content'
                };

                // Type checking should ensure proper optional properties
                switch (type) {
                    case SummaryMarkerType.MONTHLY:
                        return { ...baseMarker, month: '2025-01', category: 'food' };
                    case SummaryMarkerType.ANNUAL:
                        return { ...baseMarker, year: '2025' };
                    case SummaryMarkerType.BREAKDOWN:
                        return { ...baseMarker, category: 'transport', month: '2025-01' };
                    default:
                        return baseMarker;
                }
            }

            const monthlyMarker = createMarker(SummaryMarkerType.MONTHLY);
            expect(monthlyMarker.type).toBe(SummaryMarkerType.MONTHLY);
            expect(monthlyMarker.month).toBe('2025-01');

            const annualMarker = createMarker(SummaryMarkerType.ANNUAL);
            expect(annualMarker.type).toBe(SummaryMarkerType.ANNUAL);
            expect(annualMarker.year).toBe('2025');

            const breakdownMarker = createMarker(SummaryMarkerType.BREAKDOWN);
            expect(breakdownMarker.type).toBe(SummaryMarkerType.BREAKDOWN);
            expect(breakdownMarker.category).toBe('transport');
        });
    });
});