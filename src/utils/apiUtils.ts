import joplin from 'api';

export interface PaginatedResponse<T> {
    items: T[];
    has_more: boolean;
}

export interface PaginationOptions {
    fields?: string[];
    parent_id?: string;
    order_by?: string;
    order_dir?: 'ASC' | 'DESC';
    limit?: number;
}

/**
 * Fetch all items from a paginated Joplin API endpoint
 * This utility handles pagination automatically by making multiple requests
 * until all data is retrieved
 */
export async function getAllPaginated<T>(
    endpoint: string[], 
    options: PaginationOptions = {}
): Promise<T[]> {
    const allItems: T[] = [];
    let page = 1;
    let hasMore = true;
    
    // Set default limit to maximum allowed (100) for efficiency
    const limit = options.limit || 100;
    
    while (hasMore) {
        try {
            const requestOptions = {
                ...options,
                page,
                limit
            };
            
            const response = await joplin.data.get(endpoint, requestOptions) as PaginatedResponse<T>;
            
            if (response.items && response.items.length > 0) {
                allItems.push(...response.items);
            }
            
            hasMore = response.has_more || false;
            page++;
            
            // Safety check to prevent infinite loops
            if (page > 1000) {
                console.warn(`API pagination safety limit reached for ${endpoint.join('/')}`);
                break;
            }
        } catch (error) {
            console.error(`Error fetching page ${page} from ${endpoint.join('/')}:`, error);
            throw error;
        }
    }
    
    return allItems;
}

/**
 * Fetch all notes from a specific parent folder with pagination
 * This is a specialized version for the common use case of getting notes from folders
 */
export async function getAllNotesInFolder(
    parentId: string, 
    fields: string[] = ['id', 'title', 'parent_id']
): Promise<any[]> {
    const allNotes = await getAllPaginated(['notes'], {
        fields,
        parent_id: parentId
    });
    
    // Client-side filter to ensure we only get notes from the correct parent
    // This is necessary because Joplin's parent_id filter may not work correctly in all cases
    return allNotes.filter((note: any) => note.parent_id === parentId);
}

/**
 * Fetch all folders with pagination
 */
export async function getAllFolders(fields: string[] = ['id', 'title', 'parent_id']): Promise<any[]> {
    return await getAllPaginated(['folders'], { fields });
}

/**
 * Batch process items in chunks to avoid memory issues
 * This is useful when processing large datasets retrieved through pagination
 */
export async function batchProcess<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    batchSize: number = 50
): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        try {
            const batchResults = await processor(batch);
            results.push(...batchResults);
        } catch (error) {
            console.error(`Error processing batch ${i / batchSize + 1}:`, error);
            throw error;
        }
    }
    
    return results;
}

/**
 * Find a specific note in a folder using pagination
 * This function is optimized to stop searching once the note is found
 */
export async function findNoteInFolderPaginated(
    parentId: string, 
    noteTitle: string
): Promise<string | null> {
    let page = 1;
    let hasMore = true;
    const limit = 100;
    
    while (hasMore) {
        try {
            const response = await joplin.data.get(['notes'], {
                fields: ['id', 'title', 'parent_id'],
                parent_id: parentId,
                page,
                limit
            }) as PaginatedResponse<any>;
            
            if (response.items && response.items.length > 0) {
                // Filter client-side and search for the note
                const notesInFolder = response.items.filter((note: any) => note.parent_id === parentId);
                const foundNote = notesInFolder.find((note: any) => note.title === noteTitle);
                
                if (foundNote) {
                    return foundNote.id;
                }
            }
            
            hasMore = response.has_more || false;
            page++;
            
            // Safety check
            if (page > 1000) {
                console.warn(`Note search pagination safety limit reached for ${noteTitle} in folder ${parentId}`);
                break;
            }
        } catch (error) {
            console.error(`Error searching for note ${noteTitle} on page ${page}:`, error);
            throw error;
        }
    }
    
    return null;
}