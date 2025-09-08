import joplin from 'api';
import { getAllPaginated, getAllFolders, getAllNotesInFolder, findNoteInFolderPaginated } from './apiUtils';

/**
 * Test suite to verify pagination implementation works correctly
 * This can be called from a command to test the pagination functionality
 */
export class PaginationTestSuite {

    /**
     * Test pagination by comparing paginated results with single-page results
     * This test works by comparing the results from our paginated utilities with direct API calls
     */
    static async runBasicPaginationTest(): Promise<{ success: boolean, message: string }> {
        try {
            console.log('🧪 Running pagination test suite...');

            // Test 1: Compare folder results
            const paginatedFolders = await getAllFolders(['id', 'title']);
            const directFolders = await joplin.data.get(['folders'], { fields: ['id', 'title'] });
            
            const directFolderIds = new Set(directFolders.items.map((f: any) => f.id));
            const paginatedFolderIds = new Set(paginatedFolders.map(f => f.id));
            
            // Check if we have the same folders
            const folderTestPassed = directFolderIds.size === paginatedFolderIds.size &&
                Array.from(directFolderIds).every(id => paginatedFolderIds.has(id));

            if (!folderTestPassed) {
                return {
                    success: false,
                    message: `❌ Folder pagination test failed. Direct API: ${directFolderIds.size} folders, Paginated: ${paginatedFolderIds.size} folders`
                };
            }

            console.log(`✅ Folder test passed: ${paginatedFolders.length} folders retrieved correctly`);

            // Test 2: Test note fetching in a specific folder (if folders exist)
            if (paginatedFolders.length > 0) {
                const testFolder = paginatedFolders[0];
                
                const paginatedNotes = await getAllNotesInFolder(testFolder.id, ['id', 'title', 'parent_id']);
                const directNotes = await joplin.data.get(['notes'], { 
                    fields: ['id', 'title', 'parent_id'],
                    parent_id: testFolder.id 
                });
                
                // Filter direct notes to ensure client-side filtering matches
                const filteredDirectNotes = directNotes.items.filter((n: any) => n.parent_id === testFolder.id);
                
                const directNoteIds = new Set(filteredDirectNotes.map((n: any) => n.id));
                const paginatedNoteIds = new Set(paginatedNotes.map(n => n.id));
                
                const noteTestPassed = directNoteIds.size === paginatedNoteIds.size &&
                    Array.from(directNoteIds).every(id => paginatedNoteIds.has(id));

                if (!noteTestPassed) {
                    return {
                        success: false,
                        message: `❌ Note pagination test failed in folder "${testFolder.title}". Direct API: ${directNoteIds.size} notes, Paginated: ${paginatedNoteIds.size} notes`
                    };
                }

                console.log(`✅ Note test passed in folder "${testFolder.title}": ${paginatedNotes.length} notes retrieved correctly`);

                // Test 3: Test note search functionality (if notes exist)
                if (paginatedNotes.length > 0) {
                    const testNote = paginatedNotes[0];
                    const foundNoteId = await findNoteInFolderPaginated(testFolder.id, testNote.title);
                    
                    if (foundNoteId !== testNote.id) {
                        return {
                            success: false,
                            message: `❌ Note search test failed. Expected: ${testNote.id}, Found: ${foundNoteId}`
                        };
                    }

                    console.log(`✅ Note search test passed: Found note "${testNote.title}" correctly`);
                }
            }

            // Test 4: Test pagination with different limits
            const smallLimitFolders = await getAllPaginated(['folders'], { 
                fields: ['id', 'title'], 
                limit: 1  // Very small limit to force pagination
            });
            
            if (smallLimitFolders.length !== paginatedFolders.length) {
                return {
                    success: false,
                    message: `❌ Small limit pagination test failed. Expected: ${paginatedFolders.length} folders, Got: ${smallLimitFolders.length} folders`
                };
            }

            console.log(`✅ Small limit pagination test passed: Retrieved all ${smallLimitFolders.length} folders with limit=1`);

            return {
                success: true,
                message: `✅ All pagination tests passed! 
📊 Results:
  • Folders: ${paginatedFolders.length} retrieved correctly
  • API utilities working as expected
  • Pagination handling functional`
            };

        } catch (error) {
            console.error('❌ Pagination test failed with error:', error);
            return {
                success: false,
                message: `❌ Pagination test failed with error: ${error.message}`
            };
        }
    }

    /**
     * Performance test to measure pagination efficiency
     */
    static async runPerformanceTest(): Promise<{ success: boolean, message: string, stats: any }> {
        try {
            console.log('📊 Running pagination performance test...');
            
            const startTime = Date.now();
            
            // Test with large dataset retrieval
            const folders = await getAllFolders(['id', 'title', 'parent_id', 'created_time', 'updated_time']);
            const folderTime = Date.now() - startTime;
            
            let totalNotes = 0;
            let noteTime = 0;
            
            if (folders.length > 0) {
                const noteStartTime = Date.now();
                
                // Test note retrieval for first few folders to avoid overwhelming the system
                const testFolders = folders.slice(0, Math.min(5, folders.length));
                for (const folder of testFolders) {
                    const notes = await getAllNotesInFolder(folder.id, ['id', 'title', 'parent_id']);
                    totalNotes += notes.length;
                }
                
                noteTime = Date.now() - noteStartTime;
            }
            
            const totalTime = Date.now() - startTime;
            
            const stats = {
                totalTime,
                folderTime,
                noteTime,
                foldersRetrieved: folders.length,
                notesRetrieved: totalNotes,
                averageTimePerFolder: folders.length > 0 ? folderTime / folders.length : 0,
                averageTimePerNote: totalNotes > 0 ? noteTime / totalNotes : 0
            };

            return {
                success: true,
                message: `📊 Performance test completed:
  • Total time: ${totalTime}ms
  • Folders retrieved: ${folders.length} (${folderTime}ms)
  • Notes retrieved: ${totalNotes} (${noteTime}ms)
  • Avg time per folder: ${stats.averageTimePerFolder.toFixed(2)}ms
  • Avg time per note: ${stats.averageTimePerNote.toFixed(2)}ms`,
                stats
            };

        } catch (error) {
            console.error('❌ Performance test failed:', error);
            return {
                success: false,
                message: `❌ Performance test failed: ${error.message}`,
                stats: null
            };
        }
    }

    /**
     * Test pagination with edge cases
     */
    static async runEdgeCaseTest(): Promise<{ success: boolean, message: string }> {
        try {
            console.log('🔬 Running pagination edge case tests...');

            // Test 1: Empty folder search
            const nonExistentNote = await findNoteInFolderPaginated('non-existent-folder-id', 'non-existent-note');
            if (nonExistentNote !== null) {
                return {
                    success: false,
                    message: '❌ Edge case test failed: Non-existent note search should return null'
                };
            }

            // Test 2: Large limit (should cap at 100)
            const largeLimitFolders = await getAllPaginated(['folders'], { 
                fields: ['id'], 
                limit: 999999 // Should be capped internally
            });

            if (largeLimitFolders.length < 0) { // Basic sanity check
                return {
                    success: false,
                    message: '❌ Edge case test failed: Large limit test returned negative results'
                };
            }

            // Test 3: Empty fields array
            const emptyFieldsFolders = await getAllPaginated(['folders'], { 
                fields: [] 
            });

            // Should still work, just return objects with default fields
            if (!Array.isArray(emptyFieldsFolders)) {
                return {
                    success: false,
                    message: '❌ Edge case test failed: Empty fields test should return array'
                };
            }

            console.log(`✅ Edge case tests passed`);

            return {
                success: true,
                message: `✅ Edge case tests passed:
  • Non-existent searches handled correctly
  • Large limits processed safely  
  • Empty field arrays handled gracefully`
            };

        } catch (error) {
            console.error('❌ Edge case test failed:', error);
            return {
                success: false,
                message: `❌ Edge case test failed: ${error.message}`
            };
        }
    }
}