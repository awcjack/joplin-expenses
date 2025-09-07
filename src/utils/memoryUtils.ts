/**
 * Memory utility functions for monitoring and managing memory usage
 */

import { logger } from './logger';

export interface MemoryStats {
    totalCacheSize: number;
    activeCaches: string[];
    memoryUsage: {
        used: number;
        free: number;
        total: number;
    };
    recommendations: string[];
}

export interface CacheManager {
    getMemoryStats(): any;
    forceMemoryCleanup(): void;
    destroy?(): void;
}

/**
 * Global memory manager for all services
 */
export class MemoryManager {
    private static instance: MemoryManager;
    private cacheManagers: Map<string, CacheManager> = new Map();
    private memoryMonitorInterval: NodeJS.Timeout | null = null;
    private readonly MONITOR_INTERVAL = 300000; // 5 minutes
    private readonly MEMORY_WARNING_THRESHOLD = 0.8; // 80% of available memory
    
    private constructor() {
        this.startMemoryMonitoring();
    }
    
    public static getInstance(): MemoryManager {
        if (!MemoryManager.instance) {
            MemoryManager.instance = new MemoryManager();
        }
        return MemoryManager.instance;
    }
    
    /**
     * Register a cache manager for monitoring
     */
    public registerCacheManager(name: string, manager: CacheManager): void {
        this.cacheManagers.set(name, manager);
        logger.info(`MemoryManager: Registered cache manager '${name}'`);
    }
    
    /**
     * Unregister a cache manager
     */
    public unregisterCacheManager(name: string): void {
        const manager = this.cacheManagers.get(name);
        if (manager && manager.destroy) {
            manager.destroy();
        }
        this.cacheManagers.delete(name);
        logger.info(`MemoryManager: Unregistered cache manager '${name}'`);
    }
    
    /**
     * Start periodic memory monitoring
     */
    private startMemoryMonitoring(): void {
        this.memoryMonitorInterval = setInterval(() => {
            this.checkMemoryUsage();
        }, this.MONITOR_INTERVAL);
    }
    
    /**
     * Check overall memory usage and trigger cleanup if needed
     */
    private checkMemoryUsage(): void {
        try {
            const memoryStats = this.getSystemMemoryStats();
            const cacheStats = this.getAllCacheStats();
            
            logger.info('Memory check:', {
                system: memoryStats,
                caches: cacheStats
            });
            
            // Trigger cleanup if memory usage is high
            if (memoryStats.usagePercent > this.MEMORY_WARNING_THRESHOLD) {
                logger.warn(`High memory usage detected: ${(memoryStats.usagePercent * 100).toFixed(1)}%`);
                this.forceGlobalCleanup();
            }
            
            // Log cache sizes for monitoring
            const totalCacheEntries = Object.values(cacheStats).reduce((sum, stats: any) => {
                return sum + (stats.totalEntries || 0);
            }, 0);
            
            if (totalCacheEntries > 1000) {
                logger.warn(`Large cache size detected: ${totalCacheEntries} total entries`);
                this.forceGlobalCleanup();
            }
            
        } catch (error) {
            logger.error('Memory monitoring error:', error);
        }
    }
    
    /**
     * Get system memory statistics (approximation)
     */
    private getSystemMemoryStats(): { used: number; total: number; usagePercent: number } {
        // Note: In browser/Joplin environment, we can't get exact memory stats
        // This is a simplified approximation
        const approximateUsed = this.estimateMemoryUsage();
        const approximateTotal = 512 * 1024 * 1024; // Assume 512MB available
        
        return {
            used: approximateUsed,
            total: approximateTotal,
            usagePercent: approximateUsed / approximateTotal
        };
    }
    
    /**
     * Estimate memory usage based on cache sizes
     */
    private estimateMemoryUsage(): number {
        let estimatedUsage = 0;
        
        for (const [name, manager] of this.cacheManagers.entries()) {
            try {
                const stats = manager.getMemoryStats();
                // Rough estimate: each cache entry ~1KB
                const entryCount = stats.totalEntries || 0;
                estimatedUsage += entryCount * 1024;
            } catch (error) {
                logger.warn(`Failed to get memory stats for ${name}:`, error);
            }
        }
        
        return estimatedUsage;
    }
    
    /**
     * Get statistics from all registered cache managers
     */
    public getAllCacheStats(): Record<string, any> {
        const allStats: Record<string, any> = {};
        
        for (const [name, manager] of this.cacheManagers.entries()) {
            try {
                allStats[name] = manager.getMemoryStats();
            } catch (error) {
                logger.warn(`Failed to get stats from ${name}:`, error);
                allStats[name] = { error: error.message };
            }
        }
        
        return allStats;
    }
    
    /**
     * Force cleanup on all registered cache managers
     */
    public forceGlobalCleanup(): void {
        logger.info('MemoryManager: Forcing global cache cleanup');
        
        let cleanedCaches = 0;
        for (const [name, manager] of this.cacheManagers.entries()) {
            try {
                manager.forceMemoryCleanup();
                cleanedCaches++;
            } catch (error) {
                logger.warn(`Failed to cleanup ${name}:`, error);
            }
        }
        
        logger.info(`MemoryManager: Cleaned ${cleanedCaches} cache managers`);
        
        // Force garbage collection if available (Node.js environments)
        if (global.gc) {
            try {
                global.gc();
                logger.info('MemoryManager: Forced garbage collection');
            } catch (error) {
                logger.warn('Failed to force garbage collection:', error);
            }
        }
    }
    
    /**
     * Get comprehensive memory report
     */
    public getMemoryReport(): MemoryStats {
        const cacheStats = this.getAllCacheStats();
        const systemStats = this.getSystemMemoryStats();
        
        const totalCacheSize = Object.values(cacheStats).reduce((sum, stats: any) => {
            return sum + (stats.totalEntries || 0);
        }, 0);
        
        const recommendations: string[] = [];
        
        if (systemStats.usagePercent > 0.7) {
            recommendations.push('Consider reducing cache sizes or clearing old data');
        }
        
        if (totalCacheSize > 500) {
            recommendations.push('Large cache detected - consider more aggressive cleanup');
        }
        
        const activeCaches = Object.keys(cacheStats);
        
        return {
            totalCacheSize,
            activeCaches,
            memoryUsage: {
                used: systemStats.used,
                free: systemStats.total - systemStats.used,
                total: systemStats.total
            },
            recommendations
        };
    }
    
    /**
     * Emergency memory cleanup - clear all caches
     */
    public emergencyCleanup(): void {
        logger.warn('MemoryManager: Emergency cleanup initiated');
        
        for (const [name, manager] of this.cacheManagers.entries()) {
            try {
                // Try to destroy cache manager if possible
                if (manager.destroy) {
                    manager.destroy();
                } else {
                    manager.forceMemoryCleanup();
                }
            } catch (error) {
                logger.error(`Emergency cleanup failed for ${name}:`, error);
            }
        }
        
        // Clear the managers map
        this.cacheManagers.clear();
        
        logger.warn('MemoryManager: Emergency cleanup completed');
    }
    
    /**
     * Shutdown memory manager and cleanup resources
     */
    public shutdown(): void {
        if (this.memoryMonitorInterval) {
            clearInterval(this.memoryMonitorInterval);
            this.memoryMonitorInterval = null;
        }
        
        // Cleanup all registered managers
        for (const [name, manager] of this.cacheManagers.entries()) {
            try {
                if (manager.destroy) {
                    manager.destroy();
                }
            } catch (error) {
                logger.warn(`Failed to shutdown ${name}:`, error);
            }
        }
        
        this.cacheManagers.clear();
        logger.info('MemoryManager: Shutdown completed');
    }
}

/**
 * Utility function to check if memory usage is getting high
 */
export function isMemoryUsageHigh(): boolean {
    const manager = MemoryManager.getInstance();
    const report = manager.getMemoryReport();
    return report.memoryUsage.used / report.memoryUsage.total > 0.75;
}

/**
 * Utility function to trigger cleanup if memory is high
 */
export function cleanupIfMemoryHigh(): void {
    if (isMemoryUsageHigh()) {
        const manager = MemoryManager.getInstance();
        manager.forceGlobalCleanup();
    }
}

/**
 * Initialize memory management for the plugin
 */
export function initializeMemoryManagement(): void {
    const manager = MemoryManager.getInstance();
    
    // Register for process exit cleanup (if available)
    if (typeof process !== 'undefined' && process.on) {
        process.on('exit', () => {
            manager.shutdown();
        });
        
        process.on('SIGINT', () => {
            manager.shutdown();
            process.exit(0);
        });
    }
    
    logger.info('Memory management initialized');
}