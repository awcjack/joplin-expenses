/**
 * Mobile utility functions for responsive design and mobile-specific features
 */

/**
 * Detect if the current environment is mobile
 */
export function isMobileDevice(): boolean {
    try {
        // Check user agent for mobile indicators
        const userAgent = navigator.userAgent.toLowerCase();
        const mobileKeywords = [
            'android', 'iphone', 'ipad', 'ipod', 'blackberry', 
            'iemobile', 'opera mini', 'mobile', 'windows phone'
        ];
        
        const hasMobileKeyword = mobileKeywords.some(keyword => 
            userAgent.includes(keyword)
        );
        
        // Check screen dimensions (consider tablets as mobile for UI purposes)
        const hasSmallScreen = window.screen.width <= 1024 || window.screen.height <= 768;
        
        // Check for touch capability
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        
        return hasMobileKeyword || (hasSmallScreen && hasTouch);
    } catch (error) {
        console.warn('[MobileUtils] Failed to detect mobile device:', error);
        return false;
    }
}

/**
 * Detect if device supports touch interactions
 */
export function isTouchDevice(): boolean {
    try {
        return 'ontouchstart' in window || 
               navigator.maxTouchPoints > 0 || 
               (window as any).DocumentTouch && document instanceof (window as any).DocumentTouch;
    } catch (error) {
        console.warn('[MobileUtils] Failed to detect touch device:', error);
        return false;
    }
}

/**
 * Get optimal font size for mobile vs desktop
 */
export function getOptimalFontSize(baseFontSize: number = 16): number {
    if (isMobileDevice()) {
        // Ensure minimum 16px font size on mobile to prevent zoom
        return Math.max(baseFontSize, 16);
    }
    return baseFontSize;
}

/**
 * Get responsive input styles for forms
 */
export function getResponsiveInputStyles(): string {
    const fontSize = getOptimalFontSize(16);
    const padding = isMobileDevice() ? '12px' : '8px';
    
    return `
        width: 100%;
        padding: ${padding};
        font-size: ${fontSize}px;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-sizing: border-box;
        -webkit-appearance: none;
        appearance: none;
    `;
}

/**
 * Get responsive dialog styles
 */
export function getResponsiveDialogStyles(): string {
    if (isMobileDevice()) {
        return `
            max-width: 100vw;
            width: 100%;
            padding: 15px;
            box-sizing: border-box;
            margin: 0;
        `;
    } else {
        return `
            max-width: 500px;
            width: auto;
            padding: 20px;
            margin: 20px auto;
        `;
    }
}

/**
 * Add touch event support to elements
 */
export function addTouchSupport(
    element: Element,
    clickHandler: EventListener,
    options?: AddEventListenerOptions
): () => void {
    const cleanupFunctions: (() => void)[] = [];
    
    try {
        // Add click event (works on all devices)
        element.addEventListener('click', clickHandler, options);
        cleanupFunctions.push(() => {
            element.removeEventListener('click', clickHandler, options);
        });
        
        // Add touch events for better mobile experience
        if (isTouchDevice()) {
            let touchStartTime = 0;
            let touchMoved = false;
            
            const touchStartHandler = (e: Event) => {
                touchStartTime = Date.now();
                touchMoved = false;
            };
            
            const touchMoveHandler = (e: Event) => {
                touchMoved = true;
            };
            
            const touchEndHandler = (e: Event) => {
                if (!touchMoved && (Date.now() - touchStartTime) < 500) {
                    // Prevent both touch and click events from firing
                    e.preventDefault();
                    clickHandler(e);
                }
            };
            
            element.addEventListener('touchstart', touchStartHandler, options);
            element.addEventListener('touchmove', touchMoveHandler, options);
            element.addEventListener('touchend', touchEndHandler, options);
            
            cleanupFunctions.push(() => {
                element.removeEventListener('touchstart', touchStartHandler, options);
                element.removeEventListener('touchmove', touchMoveHandler, options);
                element.removeEventListener('touchend', touchEndHandler, options);
            });
        }
        
        // Return cleanup function
        return () => {
            cleanupFunctions.forEach(cleanup => {
                try {
                    cleanup();
                } catch (error) {
                    console.warn('[MobileUtils] Error during cleanup:', error);
                }
            });
        };
    } catch (error) {
        console.warn('[MobileUtils] Failed to add touch support:', error);
        return () => {}; // Return empty cleanup function
    }
}

/**
 * Get mobile-optimized popup positioning
 */
export function getMobileOptimizedPosition(
    targetElement: Element,
    popupElement: Element,
    preferredPosition: 'top' | 'bottom' | 'left' | 'right' = 'bottom'
): { top: string; left: string; position: string } {
    try {
        if (isMobileDevice()) {
            // On mobile, use simpler, more reliable positioning
            return {
                position: 'fixed',
                top: '20%',
                left: '5%',
                // Note: Should also set width: '90%' and max-height: '60vh' in CSS
            };
        }
        
        // Desktop positioning logic (existing behavior)
        const targetRect = targetElement.getBoundingClientRect();
        const popupRect = popupElement.getBoundingClientRect();
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };
        
        let top = targetRect.bottom + window.scrollY;
        let left = targetRect.left + window.scrollX;
        
        // Adjust if popup would go off-screen
        if (left + popupRect.width > viewport.width) {
            left = viewport.width - popupRect.width - 10;
        }
        
        if (top + popupRect.height > viewport.height + window.scrollY) {
            top = targetRect.top + window.scrollY - popupRect.height;
        }
        
        return {
            position: 'absolute',
            top: `${Math.max(0, top)}px`,
            left: `${Math.max(0, left)}px`
        };
    } catch (error) {
        console.warn('[MobileUtils] Failed to calculate optimal position:', error);
        return {
            position: 'fixed',
            top: '50%',
            left: '50%'
        };
    }
}

/**
 * Apply mobile-specific CSS optimizations
 */
export function applyMobileOptimizations(element: HTMLElement): void {
    try {
        if (isMobileDevice()) {
            // Prevent zoom on input focus (iOS Safari)
            element.style.setProperty('-webkit-user-select', 'none');
            element.style.setProperty('-webkit-touch-callout', 'none');
            element.style.setProperty('-webkit-tap-highlight-color', 'transparent');
            
            // Improve touch scrolling
            element.style.setProperty('-webkit-overflow-scrolling', 'touch');
            
            // Prevent unwanted text selection
            element.style.setProperty('user-select', 'none');
            
            // Improve button/input styling on mobile
            const inputs = element.querySelectorAll('input, select, textarea, button');
            inputs.forEach(input => {
                const inputElement = input as HTMLElement;
                inputElement.style.setProperty('-webkit-appearance', 'none');
                inputElement.style.setProperty('appearance', 'none');
                inputElement.style.setProperty('border-radius', '4px');
                
                // Ensure minimum font size to prevent zoom
                const currentFontSize = parseInt(getComputedStyle(inputElement).fontSize) || 16;
                if (currentFontSize < 16) {
                    inputElement.style.fontSize = '16px';
                }
            });
        }
    } catch (error) {
        console.warn('[MobileUtils] Failed to apply mobile optimizations:', error);
    }
}